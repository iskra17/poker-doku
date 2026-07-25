import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpRequestHandler } from './http-handler';
import { OpsEventRepository } from './ops-log';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { PromotionFundRepository } from './promotion-fund-repository';
import { RoomManager } from './room-manager';
import {
  TournamentCommandService,
  type TournamentAuthority,
} from './tournament-command-service';
import { TournamentInstanceRepository } from './tournament-instance-repository';
import { TournamentManager } from './tournament-manager';
import { TournamentScheduler } from './tournament-scheduler';

const NOW = Date.now();
const MINUTE = 60_000;
const TOKEN = 'admin-tournament-secret';
const BACKOFFICE: TournamentAuthority = { kind: 'backoffice' };

function standalone(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    name: '주말 프리롤',
    economyMode: 'freeroll',
    minEntrants: 8,
    maxEntrants: 24,
    botFillToMinimum: true,
    prizePool: { kind: 'promotion-funded', totalPrize: 100_000 },
    schedule: {
      visibleAt: NOW,
      registrationOpensAt: NOW,
      startsAt: NOW + 10 * MINUTE,
      manualStartExpiresAt: null,
    },
    ...overrides,
  };
}

function recurring(overrides: Record<string, unknown> = {}) {
  return standalone({
    name: '매일 프리롤',
    schedule: {
      visibleAt: NOW + 50 * MINUTE,
      registrationOpensAt: NOW + 55 * MINUTE,
      startsAt: NOW + 60 * MINUTE,
      manualStartExpiresAt: null,
    },
    recurrence: { kind: 'daily', hour: 13, minute: 0 },
    visibleLeadMs: 10 * MINUTE,
    registrationLeadMs: 5 * MINUTE,
    ...overrides,
  });
}

describe('scheduled tournament admin HTTP API', () => {
  let database: PokerDatabase;
  let rooms: RoomManager;
  let manager: TournamentManager;
  let scheduler: TournamentScheduler;
  let service: TournamentCommandService;
  let instances: TournamentInstanceRepository;
  let baseUrl: string;
  let close: () => Promise<void>;
  let cookie: string;
  let csrfToken: string;

  beforeEach(async () => {
    database = openPokerDatabase(':memory:');
    rooms = new RoomManager(() => {}, () => {});
    manager = new TournamentManager(rooms, { isConnected: () => true });
    instances = new TournamentInstanceRepository(database, () => NOW);
    scheduler = new TournamentScheduler({
      database,
      clock: () => NOW,
    });
    service = new TournamentCommandService(
      manager,
      new Set(['operator-1']),
      undefined,
      { database, instances, scheduler, now: () => NOW },
    );
    new PromotionFundRepository(database).adjustFund({
      requestId: randomUUID(),
      delta: 2_000_000,
      reason: 'Admin tournament HTTP test funding',
      actor: { kind: 'backoffice-admin', id: 'test' },
      at: NOW,
    });

    const adminTournamentCommands = {
      list: (at: number) => service.listAdmin(BACKOFFICE, at),
      createInstance: (raw: unknown, at: number) =>
        service.createPersistentInstance(BACKOFFICE, raw, at),
      createTemplate: (raw: unknown, at: number) =>
        service.createRecurringTemplate(BACKOFFICE, raw, at),
      patchTemplate: (
        id: string,
        revision: number,
        raw: unknown,
        at: number,
      ) => service.patchRecurringTemplate(
        BACKOFFICE,
        id,
        revision,
        raw,
        at,
      ),
      actTemplate: (
        id: string,
        revision: number,
        raw: unknown,
        at: number,
      ) => service.actOnTemplate(BACKOFFICE, id, revision, raw, at),
      start: (id: string) => service.start(BACKOFFICE, id),
      act: (id: string, action: Parameters<TournamentCommandService['act']>[2]) =>
        service.act(BACKOFFICE, id, action),
    };
    const server = createServer(createHttpRequestHandler((_req, res) => {
      res.writeHead(404);
      res.end();
    }, {
      database,
      debugToken: TOKEN,
      opsEvents: new OpsEventRepository(database),
      adminTournamentCommands: adminTournamentCommands as never,
      adminRuntime: () => ({
        sessions: { sessions: 0, sockets: 0, grace: 0 },
        sessionList: [],
        rooms: [],
        roomRuntime: {},
        tournaments: [],
      }),
      production: false,
      now: () => NOW,
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise(resolve => server.close(() => resolve()));

    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(login.status).toBe(201);
    cookie = login.headers.get('set-cookie')!.split(';', 1)[0];
    csrfToken = (await login.json() as { csrfToken: string }).csrfToken;
  });

  afterEach(async () => {
    await close();
    scheduler.close();
    manager.shutdown();
    rooms.shutdown();
    database.close();
  });

  function mutate(path: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}${path}`, {
      method: path.includes('/actions') ? 'POST' : 'POST',
      headers: {
        cookie,
        origin: baseUrl,
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  it('creates one standalone v2 instance through the shared parser', async () => {
    const request = standalone();
    const response = await mutate('/api/admin/tournaments', request);

    expect(response.status).toBe(201);
    const payload = await response.json() as {
      tournamentId: string;
      serverNow: number;
    };
    expect(payload).toMatchObject({
      tournamentId: request.requestId,
      serverNow: NOW,
    });
    expect(instances.getInstance(payload.tournamentId)).toMatchObject({
      id: request.requestId,
      templateId: null,
      config: {
        version: 2,
        economy: { mode: 'freeroll' },
        field: { minEntrants: 8, maxEntrants: 24 },
      },
    });
  });

  it('creates patches and toggles a recurring template with if-match', async () => {
    const created = await mutate(
      '/api/admin/tournament-templates',
      recurring(),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      template: { id: string; revision: number; enabled: boolean };
    };
    expect(createdBody.template).toMatchObject({ revision: 1, enabled: true });

    const patched = await fetch(
      `${baseUrl}/api/admin/tournament-templates/${createdBody.template.id}`,
      {
        method: 'PATCH',
        headers: {
          cookie,
          origin: baseUrl,
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'if-match': '1',
        },
        body: JSON.stringify({ name: '수정된 매일 프리롤' }),
      },
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      template: { revision: 2, name: '수정된 매일 프리롤' },
      serverNow: NOW,
    });

    const disabled = await mutate(
      `/api/admin/tournament-templates/${createdBody.template.id}/actions`,
      { action: 'disable' },
      { 'if-match': '2' },
    );
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({
      template: { revision: 3, enabled: false },
      serverNow: NOW,
    });

    const stale = await mutate(
      `/api/admin/tournament-templates/${createdBody.template.id}/actions`,
      { action: 'enable' },
      { 'if-match': '2' },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: 'revision-conflict',
      actualRevision: 3,
      serverNow: NOW,
    });

    const generated = await mutate(
      `/api/admin/tournament-templates/${createdBody.template.id}/actions`,
      { action: 'generate-next' },
      { 'if-match': '3' },
    );
    expect(generated.status).toBe(200);
    expect(await generated.json()).toMatchObject({
      template: { revision: 3, enabled: false },
      generated: expect.any(Number),
      serverNow: NOW,
    });
  });

  it('returns hidden occurrences leases retries and funding warnings to backoffice', async () => {
    const hidden = standalone({
      schedule: {
        visibleAt: NOW + 60 * MINUTE,
        registrationOpensAt: NOW + 70 * MINUTE,
        startsAt: NOW + 80 * MINUTE,
        manualStartExpiresAt: null,
      },
    });
    expect((await mutate('/api/admin/tournaments', hidden)).status).toBe(201);
    const leased = standalone();
    expect((await mutate('/api/admin/tournaments', leased)).status).toBe(201);
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'starting',
          registration_state = 'locked-for-start',
          start_attempt = 2,
          start_owner_id = 'expired-owner',
          start_lease_until = ?,
          updated_at = ?
      WHERE id = ?
    `).run(NOW - 1, NOW + 1, leased.requestId);

    const retrying = standalone({
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: NOW,
        manualStartExpiresAt: null,
      },
    });
    expect((await mutate('/api/admin/tournaments', retrying)).status).toBe(201);
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'start-delayed',
          status_reason = 'capacity',
          registration_state = 'locked-for-start',
          next_retry_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(NOW + MINUTE, NOW + 1, retrying.requestId);

    const warning = standalone({
      schedule: {
        visibleAt: NOW + 90 * MINUTE,
        registrationOpensAt: NOW + 100 * MINUTE,
        startsAt: NOW + 110 * MINUTE,
        manualStartExpiresAt: null,
      },
    });
    expect((await mutate('/api/admin/tournaments', warning)).status).toBe(201);
    const fundBalance = database.db.prepare(`
      SELECT balance
      FROM promotion_fund
      WHERE account_id = 'global'
    `).get() as { balance: number };
    database.db.prepare(`
      INSERT INTO promotion_fund_ledger (
        id, account_id, kind, delta, balance_after, instance_id,
        actor_kind, actor_id, reason, idempotency_key, created_at
      ) VALUES (
        ?, 'global', 'freeroll-prize-reserve', -99999, ?, ?,
        'system', 'test', 'mismatched reserve warning', ?, ?
      )
    `).run(
      randomUUID(),
      fundBalance.balance - 99_999,
      warning.requestId,
      randomUUID(),
      NOW + 1,
    );
    database.db.prepare(`
      INSERT INTO tournament_prize_escrow (
        instance_id, account_id, amount, status, human_paid, bot_returned,
        settlement_fingerprint, reserved_at, settled_at, refunded_at, updated_at
      ) VALUES (?, 'global', 99999, 'reserved', 0, 0, NULL, ?, NULL, NULL, ?)
    `).run(warning.requestId, NOW + 1, NOW + 1);
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible', updated_at = ?
      WHERE id = ?
    `).run(NOW + 1, warning.requestId);

    const response = await fetch(`${baseUrl}/api/admin/tournaments`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      tournaments: Array<Record<string, unknown>>;
      serverNow: number;
    };
    expect(payload.serverNow).toBe(NOW);
    expect(payload.tournaments).toContainEqual(expect.objectContaining({
      id: hidden.requestId,
      status: 'scheduled-hidden',
    }));
    expect(payload.tournaments).toContainEqual(expect.objectContaining({
      id: leased.requestId,
      status: 'starting',
      startAttempt: 2,
      startOwnerId: 'expired-owner',
      startLeaseUntil: NOW - 1,
      invariantWarnings: expect.arrayContaining([
        'STALE_START_LEASE',
      ]),
    }));
    expect(payload.tournaments).toContainEqual(expect.objectContaining({
      id: retrying.requestId,
      status: 'start-delayed',
      nextRetryAt: NOW + MINUTE,
    }));
    expect(payload.tournaments).toContainEqual(expect.objectContaining({
      id: warning.requestId,
      invariantWarnings: expect.arrayContaining([
        'PROMOTION_ESCROW_AMOUNT_MISMATCH',
      ]),
    }));
  });

  it('returns serverNow on every tournament response', async () => {
    const cases = [
      fetch(`${baseUrl}/api/admin/tournaments`),
      fetch(`${baseUrl}/api/admin/tournament-templates`, {
        headers: { cookie },
      }),
      mutate('/api/admin/tournaments', { bad: true }),
      mutate('/api/admin/tournament-templates', { bad: true }),
      fetch(`${baseUrl}/api/admin/tournaments`, {
        method: 'POST',
        headers: {
          cookie,
          origin: baseUrl,
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: '{',
      }),
    ];
    for (const response of await Promise.all(cases)) {
      expect(await response.json()).toMatchObject({ serverNow: NOW });
    }
  });

  it('limits body bytes and custom segment rows', async () => {
    const tooLarge = await mutate('/api/admin/tournaments', {
      ...standalone(),
      padding: 'x'.repeat(9 * 1_024),
    });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({
      error: 'body-too-large',
      serverNow: NOW,
    });

    const levels = Array.from({ length: 31 }, (_, index) => ({
      kind: 'level',
      durationMs: MINUTE,
      smallBlind: 50 + index,
      bigBlind: 100 + index,
      bigBlindAnte: 0,
    }));
    const tooManySegments = await mutate('/api/admin/tournaments', standalone({
      structure: {
        sourcePresetId: null,
        startingStack: 10_000,
        segments: levels,
      },
    }));
    expect(tooManySegments.status).toBe(400);
    expect(await tooManySegments.json()).toMatchObject({
      error: 'invalid-payload',
      serverNow: NOW,
    });
  });

  it('requires session csrf and exact same-origin before parsing mutations', async () => {
    const body = JSON.stringify(standalone());
    const unauthenticated = await fetch(`${baseUrl}/api/admin/tournaments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body,
    });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ serverNow: NOW });

    const crossOrigin = await fetch(`${baseUrl}/api/admin/tournaments`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        origin: 'https://evil.example.test',
        'x-csrf-token': csrfToken,
      },
      body,
    });
    expect(crossOrigin.status).toBe(403);
    expect(instances.listAdminProjections(NOW)).toEqual([]);
  });

  it('rejects unknown and no-op template mutations without advancing revision', async () => {
    const created = await mutate(
      '/api/admin/tournament-templates',
      recurring(),
    );
    const body = await created.json() as {
      template: { id: string; revision: number };
    };
    const path = `/api/admin/tournament-templates/${body.template.id}`;
    const patch = (value: unknown) => fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        cookie,
        origin: baseUrl,
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        'if-match': '1',
      },
      body: JSON.stringify(value),
    });

    expect((await patch({})).status).toBe(400);
    expect((await patch({ enabled: true })).status).toBe(400);
    expect((await patch({ unknown: true })).status).toBe(400);
    expect((await mutate(`${path}/actions`, {
      action: 'generate-next',
      unknown: true,
    }, { 'if-match': '1' })).status).toBe(400);

    const listed = await (await fetch(
      `${baseUrl}/api/admin/tournament-templates`,
      { headers: { cookie } },
    )).json() as { templates: Array<{ id: string; revision: number }> };
    expect(listed.templates.find(item => item.id === body.template.id)?.revision)
      .toBe(1);
  });
});
