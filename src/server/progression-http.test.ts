import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfile } from '@/lib/profile/types';
import type { ProgressionSnapshot } from '@/lib/progression/types';
import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import { createHttpRequestHandler } from './http-handler';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProgressionRepository } from './progression-repository';
import { ProgressionService } from './progression-service';
import type { ProfileHttpManager } from './profile-http';

describe('progression HTTP API', () => {
  let database: PokerDatabase;
  let service: ProgressionService;
  let repository: ProgressionRepository;
  let limiter: TransientHttpRateLimiter;
  let baseUrl: string;
  let close: () => Promise<void>;
  let authenticateCredential: (credential: string) => Promise<PublicProfile | null>;
  let publicCosmeticsChanged: (
    profileId: string,
    snapshot: ProgressionSnapshot,
  ) => void;
  const profile: PublicProfile = {
    id: 'http-profile',
    alias: '도전자',
    avatarId: 'sakura',
    wallet: { balance: 10_000, activeEscrow: 0 },
  };

  beforeEach(async () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, profile.id);
    repository = new ProgressionRepository(database);
    service = new ProgressionService(database, repository);
    limiter = new TransientHttpRateLimiter();
    authenticateCredential = async (credential: string) => (
        credential === 'good-credential' ? profile : null
      );
    publicCosmeticsChanged = vi.fn();
    const manager = {
      authenticateCredential: (credential: string) => authenticateCredential(credential),
    } as ProfileHttpManager;
    const server = createServer(createHttpRequestHandler((_req, res) => {
      res.writeHead(404);
      res.end();
    }, {
      profileManager: manager,
      economyService: {
        claimDaily: () => { throw new Error('unused'); },
        claimRescue: () => { throw new Error('unused'); },
        getStatus: () => { throw new Error('unused'); },
      },
      progressionService: service,
      profileRateLimiter: limiter,
      // 대기열 0 — 즉시 거절 계약 검증 (운영 기본값은 대기열로 버스트 흡수)
      profileConcurrencyGate: new TransientHttpConcurrencyGate(1, 0),
      production: false,
      now: () => Date.parse('2026-07-17T12:00:00+09:00'),
      onProgressionPublicCosmeticsChanged: publicCosmeticsChanged,
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

  it('returns an authenticated no-store snapshot and today missions', async () => {
    const response = await request('/api/progression');
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({
      progression: { profile: { profileId: profile.id } },
      missions: { missionDate: '2026-07-17' },
    });
    expect((body.missions as { missions: unknown[] }).missions).toHaveLength(3);
  });

  it('rejects absent and invalid authentication without reflecting secrets', async () => {
    const absent = await fetch(`${baseUrl}/api/progression`);
    const invalid = await fetch(`${baseUrl}/api/progression`, {
      headers: { cookie: 'poker_doku_profile=super-secret-invalid' },
    });
    const text = await invalid.text();

    expect(absent.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(text).not.toContain('super-secret-invalid');
  });

  it('enforces method, JSON content type, and exact payload keys', async () => {
    const method = await request('/api/progression/character', { method: 'GET' });
    const media = await request('/api/progression/character', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ characterId: 'ara' }),
    });
    const extra = await post('/api/progression/character', {
      characterId: 'ara',
      admin: true,
    });

    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST');
    expect(media.status).toBe(415);
    expect(extra.status).toBe(400);
  });

  it('changes only to an approved character', async () => {
    expect((await post('/api/progression/character', {
      characterId: 'miyako',
    })).status).toBe(400);
    const changed = await post('/api/progression/character', {
      characterId: 'ara',
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({
      progression: { profile: { selectedCharacterId: 'ara' } },
    });
  });

  it('rejects unowned, wrong-slot, and wrong-character skin equipment', async () => {
    expect((await post('/api/progression/equipment', {
      slot: 'frame', itemId: 'dojo-frame-cherry-blossom',
    })).status).toBe(409);
    insertInventory('dojo-frame-cherry-blossom');
    expect((await post('/api/progression/equipment', {
      slot: 'title', itemId: 'dojo-frame-cherry-blossom',
    })).status).toBe(409);
    insertInventory('affinity-ara-skin');
    expect((await post('/api/progression/equipment', {
      slot: 'skin', itemId: 'affinity-ara-skin',
    })).status).toBe(409);
  });

  it('equips and unequips an owned item', async () => {
    await request('/api/progression');
    insertInventory('dojo-frame-cherry-blossom');
    const equipped = await post('/api/progression/equipment', {
      slot: 'frame', itemId: 'dojo-frame-cherry-blossom',
    });
    const unequipped = await post('/api/progression/equipment', {
      slot: 'frame', itemId: null,
    });
    expect(await equipped.json()).toMatchObject({
      progression: { equipment: { frame: 'dojo-frame-cherry-blossom' } },
    });
    expect(await unequipped.json()).toMatchObject({
      progression: { equipment: { frame: null } },
    });
    expect(publicCosmeticsChanged).toHaveBeenNthCalledWith(
      1,
      profile.id,
      expect.objectContaining({ equipment: expect.objectContaining({ frame: 'dojo-frame-cherry-blossom' }) }),
    );
    expect(publicCosmeticsChanged).toHaveBeenNthCalledWith(
      2,
      profile.id,
      expect.objectContaining({ equipment: expect.objectContaining({ frame: null }) }),
    );
  });

  it('allows one deterministic mission reroll and rejects a second', async () => {
    const first = await post('/api/progression/missions/reroll', { slot: 0 });
    const second = await post('/api/progression/missions/reroll', { slot: 1 });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
  });

  it('bounds concurrent credential verification without leaking credentials', async () => {
    let release: ((profile: PublicProfile) => void) | undefined;
    let started: (() => void) | undefined;
    const authenticationStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    authenticateCredential = () => new Promise<PublicProfile>(resolve => {
      release = resolve;
      started?.();
    });

    const first = request('/api/progression');
    await authenticationStarted;
    const busy = await request('/api/progression');
    release?.(profile);
    const completed = await first;

    expect(busy.status).toBe(429);
    expect(await busy.text()).not.toContain('good-credential');
    expect(completed.status).toBe(200);
  });

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        cookie: 'poker_doku_profile=good-credential',
        ...init.headers,
      },
    });
  }

  function post(path: string, body: unknown): Promise<Response> {
    return request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function insertInventory(itemId: string): void {
    const definition = getCollectionItemDefinition(itemId);
    if (!definition || definition.source.kind === 'streak') {
      throw new Error(`Not a permanent reward: ${itemId}`);
    }
    const source = definition.source;
    if (source.kind === 'dojo-level') {
      database.db.prepare(`
        UPDATE progression_profiles SET dojo_level = ?, dojo_xp_milli = 0
        WHERE profile_id = ? AND dojo_level < ?
      `).run(source.level, profile.id, source.level);
    } else if (source.kind === 'affinity-level') {
      database.db.prepare(`
        INSERT INTO character_affinity (profile_id, character_id, level, xp_milli)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(profile_id, character_id) DO UPDATE SET
          level = MAX(level, excluded.level), xp_milli = 0
      `).run(profile.id, source.characterId, source.level);
    } else {
      throw new Error('expected permanent progression reward');
    }
    const sourceEventId = `http-grant-${itemId}`;
    database.transaction(() => {
      repository.grantPermanentInventoryItemInTransaction({
        profileId: profile.id,
        itemId,
        sourceEventId,
        source,
        grantedAt: 1,
      });
      repository.insertProgressionEvent({
        idempotencyKey: sourceEventId,
        profileId: profile.id,
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: {
          eventId: sourceEventId,
          dojoXpMilli: 0,
          dojoLevelsGained: source.kind === 'dojo-level' ? [source.level] : [],
          characterId: source.kind === 'affinity-level'
            ? source.characterId
            : 'sakura',
          affinityMilli: 0,
          affinityLevelsGained: source.kind === 'affinity-level'
            ? [source.level]
            : [],
          missionCompletions: [],
          grantedItemIds: [itemId],
        },
        createdAt: 1,
      });
    });
  }
});

function insertProfile(database: PokerDatabase, id: string): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, 'hash', 'lookup', 'recovery', 'recovery-lookup',
              '도전자', 'sakura', 1, 1, 1)
  `).run(id);
}
