import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompletedHandRecord } from '@/lib/poker/hand-history';
import { cards } from '@/lib/poker/test-helpers';
import { createHttpRequestHandler } from './http-handler';
import { TableHandRepository } from './hand-history';
import { OpsEventRepository, shouldPersistOpsEvent } from './ops-log';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

/**
 * 운영 이벤트 영속화 + 백오피스 API 계약:
 * - 신호 이벤트(server-start/http-reject 등)만 화이트리스트로 영속, 플레이 이벤트는 제외.
 * - hand-end는 settlementOk:false일 때만 (정산 장애 추적).
 * - /api/admin/*는 DEBUG_LOG_TOKEN 게이트 — 토큰 없이는 403, 응답에 비밀 없음.
 */

describe('OpsEventRepository', () => {
  let database: PokerDatabase | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('화이트리스트 판정 — 운영 신호만 영속, 정산 실패 hand-end 포함', () => {
    const base = { seq: 1, t: 1 };
    expect(shouldPersistOpsEvent({ ...base, type: 'server-start' })).toBe(true);
    expect(shouldPersistOpsEvent({ ...base, type: 'http-reject' })).toBe(true);
    expect(shouldPersistOpsEvent({ ...base, type: 'grace-expired' })).toBe(true);
    expect(shouldPersistOpsEvent({ ...base, type: 'player-action' })).toBe(false);
    expect(shouldPersistOpsEvent({ ...base, type: 'hand-start' })).toBe(false);
    expect(shouldPersistOpsEvent({
      ...base, type: 'hand-end', data: { settlementOk: true },
    })).toBe(false);
    expect(shouldPersistOpsEvent({
      ...base, type: 'hand-end', data: { settlementOk: false },
    })).toBe(true);
  });

  it('MTT 수명주기/개입 이벤트를 영속한다 (Phase 2 — spec §6)', () => {
    const base = { seq: 1, t: 1 };
    for (const type of [
      'mtt-create', 'mtt-start', 'mtt-cancel', 'mtt-complete',
      'mtt-table-break', 'mtt-move', 'mtt-director-action',
    ]) {
      expect(shouldPersistOpsEvent({ ...base, type })).toBe(true);
    }
  });

  it('기록·커서 조회·타입 필터·초과분 정리가 동작한다', () => {
    database = openPokerDatabase(':memory:');
    const repo = new OpsEventRepository(database);

    repo.record({ seq: 1, t: 100, type: 'server-start', data: { port: 3000 } });
    repo.record({ seq: 2, t: 200, type: 'http-reject', playerId: 'p1', data: { kind: 'rate-limited' } });
    repo.record({ seq: 3, t: 300, type: 'http-reject', data: { kind: 'kdf-busy' } });

    expect(repo.count()).toBe(3);
    const all = repo.recent();
    expect(all.map(event => event.type)).toEqual(['http-reject', 'http-reject', 'server-start']);
    expect(all[2].data).toEqual({ port: 3000 });

    const rejected = repo.recent({ type: 'http-reject' });
    expect(rejected).toHaveLength(2);

    const paged = repo.recent({ before: rejected[0].id, limit: 1 });
    expect(paged[0].data).toEqual({ kind: 'rate-limited' });

    expect(repo.prune(2)).toBe(1);
    expect(repo.count()).toBe(2);
    expect(repo.recent().map(event => event.type)).toEqual(['http-reject', 'http-reject']);
  });
});

describe('/api/admin/* 백오피스 API', () => {
  const servers: ReturnType<typeof createServer>[] = [];
  let database: PokerDatabase | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
      server.close(() => resolve());
    })));
    database?.close();
    database = undefined;
  });

  async function start() {
    database = openPokerDatabase(':memory:');
    const opsEvents = new OpsEventRepository(database);
    opsEvents.record({ seq: 1, t: 1_000, type: 'server-start', data: {} });
    const nextHandler = vi.fn((_req, res) => {
      res.writeHead(200);
      res.end('next');
    });
    const adminTournamentCommands = {
      create: vi.fn(() => ({ ok: true as const, tournamentId: 'mtt-created' })),
      start: vi.fn(() => 'ok' as const),
      act: vi.fn(() => 'ok' as const),
    };
    const server = createServer(createHttpRequestHandler(nextHandler, {
      debugToken: 'admin-secret',
      database,
      opsEvents,
      adminRuntime: () => ({
        sessions: { sessions: 2, sockets: 1, grace: 1 },
        sessionList: [
          { playerId: 'p1', connected: true, roomId: 'room-1', graceActive: false },
        ],
        rooms: [{
          id: 'room-1', name: '테스트 방', mode: 'cash', tableType: 'mixed',
          economyMode: 'practice', handNumber: 3, handInProgress: true,
          street: 'flop', humans: 1, bots: 2, sittingOut: 0, disconnected: 0,
          potTotal: 120, blinds: '10/20',
          seats: [{
            seatIndex: 0, name: '테스터', type: 'human', chips: 1000,
            status: 'active', currentBet: 20, sitOutNext: false,
            disconnected: false, pendingRemoval: false,
          }],
        }],
        roomRuntime: { rooms: 1 },
        tournaments: [{
          id: 'mtt-1', name: '도쿠컵', phase: 'running' as const, speed: 'turbo' as const,
          hostId: 'p1', createdAt: 1_000, startedAt: 2_000, finishedAt: null,
          paused: true, level: 3, onBreak: false, h4hActive: false,
          economyMode: 'practice' as const,
          payoutPreset: 'standard' as const,
          entrantCount: 12, seatedCount: 12, remaining: 9, prizePool: 120_000,
          tables: [{
            roomId: 'mtt-room-1', no: 1, players: 6, humans: 2, alive: 5,
            handInProgress: false, held: 'break',
          }],
          standings: [{
            playerId: 'p1', name: '테스터', chips: 15_000, tableNo: 1, place: null, prize: 0,
          }],
        }],
      }),
      adminTournamentCommands,
    }));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${port}`, adminTournamentCommands };
  }

  it('토큰이 없거나 틀리면 403', async () => {
    const { baseUrl } = await start();
    expect((await fetch(`${baseUrl}/api/admin/overview`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/admin/overview?token=wrong`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/admin/profiles?token=wrong`)).status).toBe(403);
  });

  it('overview는 세션/방/DB 집계를 반환한다', async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/api/admin/overview?token=admin-secret`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      sessions: { sockets: number };
      rooms: Array<{ name: string; handInProgress: boolean }>;
      db: { profiles: number; opsEvents: number };
    };
    expect(body.sessions.sockets).toBe(1);
    expect(body.rooms[0].name).toBe('테스트 방');
    expect(body.rooms[0].handInProgress).toBe(true);
    expect(body.db.profiles).toBe(0);
    expect(body.db.opsEvents).toBe(1);
  });

  it('events는 영속 이벤트를 최신순으로 반환한다', async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/api/admin/events?token=admin-secret`);
    expect(response.status).toBe(200);
    const body = await response.json() as { events: Array<{ type: string }> };
    expect(body.events[0].type).toBe('server-start');
  });

  it('profiles는 활동 지표·지갑·접속 상태를 반환한다 (비밀 컬럼 없음)', async () => {
    const { baseUrl } = await start();
    // 익명 프로필 1개 시드 (스키마 필수 컬럼만)
    database!.db.prepare(`
      INSERT INTO profiles (
        id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
        alias, avatar_id, adult_confirmed_at, created_at, updated_at,
        last_seen_at, connect_count
      ) VALUES ('p1', 'ch', 'cl', 'rh', 'rl', '테스트#0001', 'hana', 1, 1, 1, 500, 7)
    `).run();
    database!.db.prepare(`
      INSERT INTO wallets (profile_id, balance, updated_at) VALUES ('p1', 8000, 1)
    `).run();

    const response = await fetch(`${baseUrl}/api/admin/profiles?token=admin-secret`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      profiles: Array<Record<string, unknown>>;
    };
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]).toMatchObject({
      id: 'p1',
      alias: '테스트#0001',
      connectCount: 7,
      lastSeenAt: 500,
      wallet: { balance: 8000, activeEscrow: 0 },
      online: true,
      roomId: 'room-1',
    });
    // 자격증명/복구 관련 비밀 컬럼이 응답에 실리지 않는다
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('recovery');
  });

  it('hands는 정본 목록·방 필터·상세(전체 홀카드)를 반환한다', async () => {
    const { baseUrl } = await start();
    const tableHands = new TableHandRepository(database!);
    const record: CompletedHandRecord = {
      handNumber: 1,
      smallBlind: 10,
      bigBlind: 20,
      players: [
        {
          id: 'p1', name: '휴먼', type: 'human', seatIndex: 0, position: 'BTN',
          startingChips: 1000, holeCards: cards('As Kd'), totalContributed: 0,
          won: 0, profit: 0, revealed: false, finalStatus: 'folded',
          handRank: null, handDescription: null,
        },
        {
          id: 'bot-1', name: '봇', type: 'bot', seatIndex: 1, position: 'SB',
          startingChips: 1000, holeCards: cards('Qh Qd'), totalContributed: 30,
          won: 30, profit: 0, revealed: false, finalStatus: 'active',
          handRank: null, handDescription: null,
        },
      ],
      actions: [],
      board: [],
      winners: [{
        playerId: 'bot-1', amount: 30, handRank: null, handDescription: null, potIndex: 0,
      }],
      potTotal: 30,
      rake: 3,
      showdown: false,
    };
    const handId = tableHands.insert({
      roomId: 'room-1', roomName: '테스트 방', gameMode: 'cash', record, playedAt: 2_000,
    });

    const listResponse = await fetch(`${baseUrl}/api/admin/hands?token=admin-secret&room=room-1`);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as {
      mode: string;
      hands: Array<{ id: number; potTotal: number; rake: number }>;
    };
    expect(listBody.mode).toBe('table');
    expect(listBody.hands).toHaveLength(1);
    expect(listBody.hands[0]).toMatchObject({ id: handId, potTotal: 30, rake: 3 });
    // 목록에는 홀카드가 실리지 않는다
    expect(JSON.stringify(listBody)).not.toContain('holeCards');

    const emptyList = await fetch(`${baseUrl}/api/admin/hands?token=admin-secret&room=other`);
    expect(((await emptyList.json()) as { hands: unknown[] }).hands).toHaveLength(0);

    const detailResponse = await fetch(`${baseUrl}/api/admin/hands/${handId}?token=admin-secret`);
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json() as {
      hand: { id: number; players: Array<{ holeCards: unknown }> };
    };
    expect(detailBody.hand.id).toBe(handId);
    // 정본 상세는 폴드 좌석 홀카드까지 그대로 (핸드 감사 전용 계약)
    expect(detailBody.hand.players[0].holeCards).toEqual(cards('As Kd'));

    expect((await fetch(`${baseUrl}/api/admin/hands/999999?token=admin-secret`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/admin/hands/${handId}`)).status).toBe(403);
  });

  it('tournaments는 런타임 토너먼트 전체 뷰를 반환한다 (Phase 2)', async () => {
    const { baseUrl } = await start();
    expect((await fetch(`${baseUrl}/api/admin/tournaments`)).status).toBe(403);
    const response = await fetch(`${baseUrl}/api/admin/tournaments?token=admin-secret`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      tournaments: Array<Record<string, unknown>>;
    };
    expect(body.tournaments).toHaveLength(1);
    expect(body.tournaments[0]).toMatchObject({
      id: 'mtt-1',
      phase: 'running',
      paused: true,
      remaining: 9,
    });
  });

  it('creates and operates tournaments through authenticated backoffice commands', async () => {
    const { baseUrl, adminTournamentCommands } = await start();
    const draft = {
      name: '백오피스 토너먼트',
      speed: 'standard',
      maxEntrants: 8,
      startAt: null,
      botFill: true,
      turnTime: 15,
      economyMode: 'practice',
      payoutPreset: 'standard',
    };

    expect((await fetch(`${baseUrl}/api/admin/tournaments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    })).status).toBe(403);

    const created = await fetch(`${baseUrl}/api/admin/tournaments?token=admin-secret`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ tournamentId: 'mtt-created' });
    expect(adminTournamentCommands.create).toHaveBeenCalledWith(draft);

    const acted = await fetch(
      `${baseUrl}/api/admin/tournaments/mtt-created/actions?token=admin-secret`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      },
    );
    expect(acted.status).toBe(200);
    expect(adminTournamentCommands.act).toHaveBeenCalledWith(
      'mtt-created',
      { kind: 'pause' },
    );
  });

  it('security는 기간 내 신호 이벤트 타입별 집계를 반환한다', async () => {
    const { baseUrl } = await start();
    const opsEvents = new OpsEventRepository(database!);
    const at = Date.now();
    opsEvents.record({ seq: 2, t: at - 3_000, type: 'http-reject', data: {} });
    opsEvents.record({ seq: 3, t: at - 2_000, type: 'http-reject', data: {} });
    opsEvents.record({ seq: 4, t: at - 1_000, type: 'grace-expired', data: {} });

    const response = await fetch(`${baseUrl}/api/admin/security?token=admin-secret&hours=24`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      windowHours: number;
      counts: Record<string, number>;
    };
    expect(body.windowHours).toBe(24);
    expect(body.counts['http-reject']).toBe(2);
    expect(body.counts['grace-expired']).toBe(1);
  });

  it('overview는 문의 알림 커서와 24h 핸드 집계를 포함한다', async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/api/admin/overview?token=admin-secret`);
    const body = await response.json() as {
      latestFeedbackId: number;
      handStats24h: { hands: number; rake: number; potTotal: number };
      db: { tableHands: number };
    };
    expect(body.latestFeedbackId).toBe(0);
    expect(body.handStats24h).toEqual({ hands: 0, rake: 0, potTotal: 0 });
    expect(body.db.tableHands).toBe(0);
  });

  it('overview는 same-install 리텐션 블록(일일 활성/코호트/활성화)을 포함한다', async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/api/admin/overview?token=admin-secret`);
    const body = await response.json() as {
      retention: {
        daily: unknown[];
        cohorts: unknown[];
        activation: { totalProfiles: number; playedOneHand: number; playedTenHands: number };
      };
    };
    expect(Array.isArray(body.retention.daily)).toBe(true);
    expect(Array.isArray(body.retention.cohorts)).toBe(true);
    expect(body.retention.activation).toEqual({
      totalProfiles: 0,
      playedOneHand: 0,
      playedTenHands: 0,
    });
  });
});
