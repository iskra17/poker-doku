import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTournamentRequest } from '../lib/realtime/protocol';
import { RoomManager } from './room-manager';
import { TournamentManager } from './tournament-manager';
import {
  TournamentCommandService,
  parseTournamentOperatorIds,
} from './tournament-command-service';

const DRAFT: CreateTournamentRequest = {
  name: '운영 토너먼트',
  speed: 'standard',
  maxEntrants: 8,
  startAt: null,
  botFill: true,
  turnTime: 15,
  economyMode: 'practice',
  payoutPreset: 'standard',
};

describe('TournamentCommandService', () => {
  let rooms: RoomManager;
  let manager: TournamentManager;
  let service: TournamentCommandService;

  beforeEach(() => {
    vi.useFakeTimers();
    rooms = new RoomManager(() => {}, () => {});
    manager = new TournamentManager(rooms, { isConnected: () => true });
    service = new TournamentCommandService(manager, new Set(['operator-1', 'operator-2']));
  });

  afterEach(() => {
    manager.shutdown();
    rooms.shutdown();
    vi.useRealTimers();
  });

  it('parses a trimmed, unique operator allowlist', () => {
    expect(parseTournamentOperatorIds(' operator-1, ,operator-2,operator-1 '))
      .toEqual(new Set(['operator-1', 'operator-2']));
    expect(parseTournamentOperatorIds(undefined)).toEqual(new Set());
  });

  it('rejects ordinary profiles before tournament creation', () => {
    expect(service.create(
      { kind: 'operator-profile', profileId: 'guest' },
      DRAFT,
    )).toEqual({ ok: false, reason: 'forbidden' });
    expect(manager.listTournaments()).toHaveLength(0);
  });

  it('allows operator profiles and backoffice to create without registering a player', () => {
    const operatorCreated = service.create(
      { kind: 'operator-profile', profileId: 'operator-1' },
      DRAFT,
    );
    const backofficeCreated = service.create(
      { kind: 'backoffice' },
      { ...DRAFT, name: '백오피스 토너먼트' },
    );

    expect(operatorCreated.ok).toBe(true);
    expect(backofficeCreated.ok).toBe(true);
    expect(manager.listTournaments()).toHaveLength(2);
    for (const summary of manager.listTournaments()) {
      expect(summary.entrantCount).toBe(0);
    }
  });

  it('allows a different operator to administer an existing tournament', () => {
    const created = service.create(
      { kind: 'operator-profile', profileId: 'operator-1' },
      DRAFT,
    );
    if (!created.ok) throw new Error('create failed');

    expect(service.act(
      { kind: 'operator-profile', profileId: 'operator-2' },
      created.tournamentId,
      { kind: 'cancel' },
    )).toBe('ok');
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('cancelled');
  });

  it('rejects ordinary profile start and director commands', () => {
    const created = service.create({ kind: 'backoffice' }, DRAFT);
    if (!created.ok) throw new Error('create failed');
    const guest = { kind: 'operator-profile', profileId: 'guest' } as const;

    expect(service.start(guest, created.tournamentId)).toBe('forbidden');
    expect(service.act(guest, created.tournamentId, { kind: 'cancel' })).toBe('forbidden');
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('registering');
  });
});
