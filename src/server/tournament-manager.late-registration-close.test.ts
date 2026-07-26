import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from './room-manager';
import {
  TournamentManager,
  type PersistentLateRegistrationInstance,
  type PersistentPendingLateEntry,
  type PersistentRegistrationCloseClaim,
  type PersistentTournamentSettlementPorts,
  type PersistentTournamentStartSnapshot,
} from './tournament-manager';
import type { LateEntryKey } from './tournament-enrollment-repository';
import type { RegistrationCloseReason } from '../lib/tournament/tournament-state';

/**
 * 레이트 레지스트레이션 **마감 드라이버** 회귀.
 *
 * 결함(2026-07-26 QA P0-1): 상태기계·DB CAS·순수 판정 함수는 다 있는데 아무도 부르지
 * 않아 `registrationState`가 영원히 'open-late'였다. `checkCompletion`이 영속 토너먼트의
 * 완료를 'closed' + payoutFreeze 조건으로 거부하므로 결과는 영구 교착 —
 * 토너먼트 미완료·정산 미실행·탈락자 화면 정지.
 *
 * 여기 테스트는 전부 "드라이버가 없으면 실패"하도록 짜여 있다.
 */

const LEVEL_DURATION_MS = 480_000;

function snapshot(
  id: string,
  lateRegistration: boolean,
): PersistentTournamentStartSnapshot {
  return {
    id,
    economyMode: 'freeroll',
    directorProfileId: 'director-1',
    registrationState: lateRegistration ? 'open-late' : 'closed',
    registrationGeneration: 1,
    registrationOwnerToken: null,
    config: {
      version: 2,
      name: 'Late registration close',
      economy: { mode: 'freeroll', promotionAccountId: 'global' },
      tableSize: 6,
      field: {
        minEntrants: 6,
        maxEntrants: 12,
        botFillToMinimum: true,
      },
      turnTimeSeconds: 15,
      structure: {
        sourcePresetId: 'standard',
        startingStack: 10_000,
        segments: [{
          kind: 'level',
          durationMs: LEVEL_DURATION_MS,
          smallBlind: 50,
          bigBlind: 100,
          bigBlindAnte: 0,
        }],
      },
      prizePool: { kind: 'promotion-funded', totalPrize: 100_000 },
      payout: {
        tableVersion: 2,
        presetId: 'standard',
        paidFieldPercent: 15,
      },
      lateRegistration: lateRegistration
        ? {
            enabled: true,
            // 레벨 1개짜리 구조라 마감 시각 = 시작 + LEVEL_DURATION_MS
            durationLevels: 1,
            minStartingStackBb: 20,
          }
        : {
            enabled: false,
            durationLevels: 0,
            minStartingStackBb: 20,
          },
    },
  };
}

function lateEntry(profileId: string): PersistentPendingLateEntry {
  const key: LateEntryKey = {
    profileId,
    economyMode: 'freeroll',
    requestId: `request-${profileId}`,
    registrationAttempt: 1,
  };
  return { key, player: { id: profileId, name: profileId, avatar: 'ara' } };
}

interface Harness {
  readonly rooms: RoomManager;
  readonly manager: TournamentManager;
  readonly tournamentId: string;
  readonly roomIds: readonly string[];
  readonly instance: {
    status: string;
    registrationState: string;
    registrationGeneration: number;
    registrationOwnerToken: string | null;
    pendingLateEntrants: number;
    committedEntrants: number;
  };
  /** 마감 관련 부수효과의 **순서**까지 검증하기 위한 단일 로그 */
  readonly calls: string[];
  readonly closeReasons: RegistrationCloseReason[];
  readonly released: string[];
  readonly settlePayout: ReturnType<typeof vi.fn>;
}

function createHarness(options: {
  readonly lateRegistration: boolean;
  readonly pendingLateEntries?: readonly PersistentPendingLateEntry[];
  /** 마감 드라이버 포트를 아예 주입하지 않는다 (레거시 더블 재현) */
  readonly withDriverPorts?: boolean;
} = { lateRegistration: true }): Harness {
  const tournamentId = 'late-close-1';
  const calls: string[] = [];
  const closeReasons: RegistrationCloseReason[] = [];
  const released: string[] = [];
  let pending = [...(options.pendingLateEntries ?? [])];
  const instance = {
    status: 'running',
    registrationState: options.lateRegistration ? 'open-late' : 'closed',
    registrationGeneration: 1,
    registrationOwnerToken: null as string | null,
    pendingLateEntrants: pending.length,
    committedEntrants: 6,
  };

  const claimRegistrationClose = (
    _tournamentId: string,
    ownerToken: string,
    reason: RegistrationCloseReason,
  ): PersistentRegistrationCloseClaim => {
    calls.push(`claim:${reason}`);
    if (
      instance.status !== 'running'
      || instance.registrationState !== 'open-late'
      || instance.registrationOwnerToken !== null
    ) {
      return { status: 'not-claimable' };
    }
    closeReasons.push(reason);
    instance.registrationState = 'closing';
    instance.registrationGeneration += 1;
    instance.registrationOwnerToken = ownerToken;
    return {
      status: 'claimed',
      ownerToken,
      generation: instance.registrationGeneration,
    };
  };

  const settlePayout = vi.fn();
  const settlement: PersistentTournamentSettlementPorts = {
    // 실제 persistTournamentPayoutFreeze의 CAS 전제조건을 그대로 흉내낸다:
    // pending_late_entrants = 0이 아니면 동결 자체가 성립하지 않는다.
    freezeRegistration: input => {
      calls.push('freeze');
      if (instance.pendingLateEntrants !== 0) return false;
      if (
        instance.registrationState !== 'closing'
        || instance.registrationGeneration !== input.generation
        || instance.registrationOwnerToken !== input.ownerToken
      ) {
        return false;
      }
      instance.registrationState = 'closed';
      instance.registrationOwnerToken = null;
      return true;
    },
    listParticipants: () => [{
      playerId: 'human-1',
      profileId: 'human-1',
      registrationAttempt: 1,
      displayName: 'Human One',
    }],
    claimPayoutPending: () => 'claimed',
    settlePayout,
  };

  const rooms = new RoomManager(() => {}, () => {});
  const driverPorts = options.withDriverPorts === false
    ? {}
    : {
        claimRegistrationClose,
        listPendingLateEntries: () => pending,
        releaseLateMttEntry: (_id: string, entry: LateEntryKey) => {
          calls.push(`release:${entry.profileId}`);
          pending = pending.filter(
            candidate => candidate.key.profileId !== entry.profileId,
          );
          instance.pendingLateEntrants = pending.length;
          return { status: 'released' };
        },
      };
  const manager = new TournamentManager(rooms, {
    onLateRegistrationReleased: ({ profileId }) => {
      calls.push(`unlock:${profileId}`);
      released.push(profileId);
    },
  }, {
    persistentRuntimeEnabled: true,
    persistentLateRegistration: {
      readInstance: (): PersistentLateRegistrationInstance => ({ ...instance }),
      commitLateMttBatch: vi.fn(),
      ...driverPorts,
    },
    persistentSettlement: settlement,
  });

  const prepared = manager.prepareFromInstance(
    snapshot(tournamentId, options.lateRegistration),
    [{ id: 'human-1', name: 'Human One', avatar: 'ara' }],
    'start-owner',
  );
  manager.activatePreparedTournament(tournamentId, 'start-owner', Date.now());

  return {
    rooms,
    manager,
    tournamentId,
    roomIds: [...prepared.roomIds],
    instance,
    calls,
    closeReasons,
    released,
    settlePayout,
  };
}

describe('TournamentManager late-registration close driver', () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'));
  });

  afterEach(() => {
    harness?.manager.shutdown();
    harness?.rooms.shutdown();
    harness = null;
    vi.useRealTimers();
  });

  it('closes the registration window on the wall clock deadline', () => {
    harness = createHarness({ lateRegistration: true });
    const { manager, tournamentId, instance, closeReasons } = harness;
    // 시계만 흐르게 하고 테이블은 멈춰 둔다 (핸드 진행은 이 테스트의 대상이 아니다).
    // 마감 타이머는 의도적으로 pause-aware가 아니므로 정지 중에도 발화해야 한다.
    expect(manager.directorActionAsOperator(tournamentId, { kind: 'pause' }))
      .toBe('ok');
    expect(instance.registrationState).toBe('open-late');

    vi.advanceTimersByTime(LEVEL_DURATION_MS + 1_000);

    expect(closeReasons).toEqual(['time']);
    expect(instance.registrationState).toBe('closed');
    expect(instance.registrationOwnerToken).toBeNull();
  });

  it('closes on the last survivor before the deadline and finishes the tournament', () => {
    harness = createHarness({ lateRegistration: true });
    const { manager, rooms, roomIds, instance, closeReasons, settlePayout } =
      harness;
    const deadline = Date.now() + LEVEL_DURATION_MS;
    const roomId = roomIds[0]!;
    const engine = rooms.getRoom(roomId)!.engine;
    for (const player of engine.state.players) {
      if (player.type === 'human') continue;
      player.handStartChips = 100;
      player.chips = 0;
    }

    manager.roomHooks.onHandComplete(roomId);

    // 마감 시각 전인데도 닫혀야 한다 — 시간 마감만 기다리면 남은 1명이
    // 핸드를 더 돌릴 수 없어 그대로 교착된다 (QA 결함의 직접 재현)
    expect(Date.now()).toBeLessThan(deadline);
    expect(closeReasons).toEqual(['last-player']);
    expect(instance.registrationState).toBe('closed');
    expect(manager.getDetail('late-close-1')?.summary.phase).toBe('completed');
    expect(settlePayout).toHaveBeenCalledOnce();
  });

  it('never freezes before every unseated late entry is refunded and unlocked', () => {
    harness = createHarness({
      lateRegistration: true,
      pendingLateEntries: [lateEntry('late-1'), lateEntry('late-2')],
    });
    const { manager, tournamentId, instance, calls, released } = harness;
    expect(instance.pendingLateEntrants).toBe(2);
    expect(manager.directorActionAsOperator(tournamentId, { kind: 'pause' }))
      .toBe('ok');

    vi.advanceTimersByTime(LEVEL_DURATION_MS + 1_000);

    expect(released).toEqual(['late-1', 'late-2']);
    expect(instance.pendingLateEntrants).toBe(0);
    expect(instance.registrationState).toBe('closed');
    // freeze는 반드시 두 건의 취소·환불 **뒤에** 딱 한 번 — 순서가 뒤집히면
    // 실제 CAS(pending_late_entrants = 0)가 거부해 영구 교착이 된다.
    expect(calls.filter(call => call !== 'claim:time')).toEqual([
      'release:late-1',
      'unlock:late-1',
      'release:late-2',
      'unlock:late-2',
      'freeze',
    ]);
  });

  it('drops the close clock on cancel', () => {
    harness = createHarness({ lateRegistration: true });
    const { manager, tournamentId, calls } = harness;
    // 무장 직후엔 [다음 핸드 예약, 마감 시계] 2개가 떠 있다
    expect(vi.getTimerCount()).toBe(2);

    expect(manager.directorActionAsOperator(tournamentId, { kind: 'cancel' }))
      .toBe('ok');

    // 취소는 방·봇 타이머까지 함께 정리한다 — 남아야 할 건 결과 노출용 cleanup 1개뿐.
    // 마감 시계가 살아 있으면 여기서 2가 된다.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(LEVEL_DURATION_MS + 1_000);
    expect(calls).toEqual([]);
  });

  it('leaves no timer behind after shutdown', () => {
    harness = createHarness({ lateRegistration: true });

    harness.manager.shutdown();
    harness.rooms.shutdown();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays inert when the close ports are not injected', () => {
    harness = createHarness({
      lateRegistration: true,
      withDriverPorts: false,
    });
    const { manager, tournamentId, instance, calls } = harness;
    expect(manager.directorActionAsOperator(tournamentId, { kind: 'pause' }))
      .toBe('ok');

    vi.advanceTimersByTime(LEVEL_DURATION_MS + 1_000);

    // 포트 미주입 = 레거시 동작 유지 (기존 테스트 더블을 깨지 않는다는 계약)
    expect(calls).toEqual([]);
    expect(instance.registrationState).toBe('open-late');
  });
});
