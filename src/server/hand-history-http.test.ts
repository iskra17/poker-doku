import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompletedHandRecord } from '@/lib/poker/hand-history';
import { cards } from '@/lib/poker/test-helpers';
import type { PublicProfile } from '@/lib/profile/types';
import { createHttpRequestHandler } from './http-handler';
import { HandHistoryRepository, HandHistoryService } from './hand-history';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import type { ProfileHttpManager } from './profile-http';

const NOW = Date.parse('2026-07-18T21:00:00+09:00');
const HERO_ID = 'hero-profile';
const RIVAL_ID = 'rival-profile';

/** 히어로 폴드 → 라이벌(휴먼) 폴드 승리 — 쇼다운 없음(아무도 공개 안 됨) */
function makeRecord(handNumber: number, options: { revealed?: boolean } = {}): CompletedHandRecord {
  const revealed = options.revealed ?? false;
  return {
    handNumber,
    smallBlind: 10,
    bigBlind: 20,
    players: [
      {
        id: HERO_ID, name: '히어로', type: 'human', seatIndex: 0, position: 'BTN',
        startingChips: 1000, holeCards: cards('As Kd'), totalContributed: 0,
        won: 0, profit: 0, revealed: false, finalStatus: 'folded',
        handRank: null, handDescription: null,
      },
      {
        id: RIVAL_ID, name: '라이벌', type: 'human', seatIndex: 1, position: 'SB',
        startingChips: 1000, holeCards: cards('Qh Qd'), totalContributed: 10,
        won: 30, profit: 20, revealed, finalStatus: 'active',
        handRank: null, handDescription: null,
      },
      {
        id: 'bot-sakura', name: '사쿠라', type: 'bot', seatIndex: 2, position: 'BB',
        startingChips: 1000, holeCards: cards('2c 7d'), totalContributed: 20,
        won: 0, profit: -20, revealed: false, finalStatus: 'folded',
        handRank: null, handDescription: null,
      },
    ],
    actions: [
      { street: 'preflop', playerId: RIVAL_ID, kind: 'post-sb', amount: 10 },
      { street: 'preflop', playerId: 'bot-sakura', kind: 'post-bb', amount: 20 },
      { street: 'preflop', playerId: HERO_ID, kind: 'fold', amount: 0 },
      { street: 'preflop', playerId: 'bot-sakura', kind: 'fold', amount: 0 },
    ],
    board: [],
    winners: [{
      playerId: RIVAL_ID, amount: 30, handRank: null, handDescription: null, potIndex: 0,
    }],
    potTotal: 30,
    rake: 0,
    showdown: false,
  };
}

describe('hand history HTTP API', () => {
  let database: PokerDatabase;
  let repository: HandHistoryRepository;
  let service: HandHistoryService;
  let limiter: TransientHttpRateLimiter;
  let baseUrl: string;
  let close: () => Promise<void>;

  const heroProfile: PublicProfile = {
    id: HERO_ID,
    alias: '히어로',
    avatarId: 'sakura',
    wallet: { balance: 10_000, activeEscrow: 0 },
  };
  const rivalProfile: PublicProfile = {
    id: RIVAL_ID,
    alias: '라이벌',
    avatarId: 'hana',
    wallet: { balance: 10_000, activeEscrow: 0 },
  };

  beforeEach(async () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, HERO_ID);
    insertProfile(database, RIVAL_ID);
    repository = new HandHistoryRepository(database);
    service = new HandHistoryService(repository, { now: () => NOW });
    limiter = new TransientHttpRateLimiter();
    const manager = {
      authenticateCredential: async (credential: string) => {
        if (credential === 'hero-credential') return heroProfile;
        if (credential === 'rival-credential') return rivalProfile;
        return null;
      },
    } as ProfileHttpManager;
    const server = createServer(createHttpRequestHandler((_req, res) => {
      res.writeHead(404);
      res.end();
    }, {
      database,
      profileManager: manager,
      economyService: {
        claimDaily: () => { throw new Error('unused'); },
        claimRescue: () => { throw new Error('unused'); },
        getStatus: () => { throw new Error('unused'); },
      },
      profileRateLimiter: limiter,
      profileConcurrencyGate: new TransientHttpConcurrencyGate(1),
      production: false,
      now: () => NOW,
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise(resolve => server.close(() => resolve()));
  });

  afterEach(async () => {
    await close();
    limiter.close();
    database.close();
  });

  function get(path: string, cookie = 'poker_doku_profile=hero-credential') {
    return fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
  }

  function record(handNumber: number, options: { revealed?: boolean } = {}) {
    service.recordCompletedHand({
      roomId: 'room-1',
      roomName: '벚꽃 라운지',
      gameMode: 'cash',
      record: makeRecord(handNumber, options),
    });
  }

  it('lists only the requesting profile hands, hero-perspective', async () => {
    record(1);

    const heroList = await get('/api/hands');
    expect(heroList.status).toBe(200);
    const heroPayload = await heroList.json();
    expect(heroPayload.items).toHaveLength(1);
    expect(heroPayload.items[0]).toMatchObject({
      roomName: '벚꽃 라운지',
      gameMode: 'cash',
      bigBlind: 20,
      handNumber: 1,
      profit: 0,
      playedAt: NOW,
      heroCards: cards('As Kd'),
      board: [],
    });
    expect(heroPayload.nextBefore).toBeNull();

    // 같은 핸드가 라이벌에게는 라이벌 관점으로 저장된다
    const rivalList = await get('/api/hands', 'poker_doku_profile=rival-credential');
    const rivalPayload = await rivalList.json();
    expect(rivalPayload.items).toHaveLength(1);
    expect(rivalPayload.items[0].profit).toBe(20);
    expect(rivalPayload.items[0].heroCards).toEqual(cards('Qh Qd'));
  });

  it('masks unrevealed opponents in the stored detail', async () => {
    record(1);
    const list = await (await get('/api/hands')).json();
    const detail = await (await get(`/api/hands/${list.items[0].id}`)).json();

    expect(detail.hand.heroId).toBe(HERO_ID);
    const byId = new Map(
      (detail.hand.players as { id: string; holeCards: unknown }[]).map(p => [p.id, p]),
    );
    expect(byId.get(HERO_ID)!.holeCards).toEqual(cards('As Kd'));
    // 공개되지 않은 상대(휴먼/봇)의 홀카드는 저장 시점에 이미 제거된다
    expect(byId.get(RIVAL_ID)!.holeCards).toBeNull();
    expect(byId.get('bot-sakura')!.holeCards).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('"Q"');
  });

  it('keeps revealed opponent cards visible', async () => {
    record(1, { revealed: true });
    const list = await (await get('/api/hands')).json();
    const detail = await (await get(`/api/hands/${list.items[0].id}`)).json();
    const rival = (detail.hand.players as { id: string; holeCards: unknown }[])
      .find(p => p.id === RIVAL_ID)!;
    expect(rival.holeCards).toEqual(cards('Qh Qd'));
  });

  it('denies access to another profile hand and unauthenticated requests', async () => {
    record(1);
    const heroList = await (await get('/api/hands')).json();
    const heroHandId = heroList.items[0].id;

    const stolen = await get(`/api/hands/${heroHandId}`, 'poker_doku_profile=rival-credential');
    expect(stolen.status).toBe(404);

    expect((await get('/api/hands', '')).status).toBe(401);
    expect((await get('/api/hands', 'poker_doku_profile=bad')).status).toBe(401);
    const wrongMethod = await fetch(`${baseUrl}/api/hands`, {
      method: 'POST',
      headers: { cookie: 'poker_doku_profile=hero-credential' },
    });
    expect(wrongMethod.status).toBe(405);
    expect((await get('/api/hands/not-a-number')).status).toBe(404);
  });

  it('paginates with the before cursor', async () => {
    record(1);
    record(2);
    record(3);

    const first = await (await get('/api/hands?limit=2')).json();
    expect(first.items.map((item: { handNumber: number }) => item.handNumber))
      .toEqual([3, 2]);
    expect(first.nextBefore).toBe(first.items[1].id);

    const second = await (
      await get(`/api/hands?limit=2&before=${first.nextBefore}`)
    ).json();
    expect(second.items.map((item: { handNumber: number }) => item.handNumber))
      .toEqual([1]);
    expect(second.nextBefore).toBeNull();
  });

  it('prunes old hands past the per-profile retention cap', async () => {
    const smallService = new HandHistoryService(repository, {
      keepPerProfile: 2,
      now: () => NOW,
    });
    for (let handNumber = 1; handNumber <= 4; handNumber += 1) {
      smallService.recordCompletedHand({
        roomId: 'room-1',
        roomName: '벚꽃 라운지',
        gameMode: 'cash',
        record: makeRecord(handNumber),
      });
    }
    expect(repository.countByProfile(HERO_ID)).toBe(2);
    const list = await (await get('/api/hands')).json();
    expect(list.items.map((item: { handNumber: number }) => item.handNumber))
      .toEqual([4, 3]);
  });
});

function insertProfile(database: PokerDatabase, id: string): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(id, `hash-${id}`, `lookup-${id}`, `recovery-${id}`, `recovery-lookup-${id}`, `테스터-${id}`);
}
