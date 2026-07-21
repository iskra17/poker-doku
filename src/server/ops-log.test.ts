import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpRequestHandler } from './http-handler';
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
          humans: 1, bots: 2, sittingOut: 0, disconnected: 0, potTotal: 120,
          blinds: '10/20',
        }],
        roomRuntime: { rooms: 1 },
      }),
    }));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${port}` };
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
});
