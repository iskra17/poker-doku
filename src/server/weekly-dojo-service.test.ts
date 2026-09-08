import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../lib/poker/types';
import { parseWeeklyDojoCheckpoint } from '../lib/weekly-dojo/checkpoint';
import { WEEKLY_DOJO_LINEUP } from '../lib/weekly-dojo/config';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { RoomManager } from './room-manager';
import { WeeklyDojoRepository } from './weekly-dojo-repository';
import { WeeklyDojoService } from './weekly-dojo-service';

/**
 * 주간 도장 런타임 통합 — RoomManager 실물 + SQLite 실물 + fake timers.
 *
 * 검증 축:
 * - 개인 전용 방(고정 라인업 6석, 로비 목록/초대 코드 없음, 타인 착석 거절)
 * - **진행 중 핸드의 손실은 나가기/포기로 지울 수 없다** (칩을 넣고 지는 보드를 본 뒤 이탈)
 * - 재개는 확정 스택·봇 스택·버튼을 그대로 복원하고 핸드 인덱스가 정확히 이어진다
 * - 반복 재개가 칩 풀을 보존한다 (봇에게 새 칩을 주지 않는다)
 * - 상한/파산 종료가 확정 스택으로 기록되고, 지갑·진행도에는 아무 영향이 없다
 */

const HERO = 'wd-hero';
const T0 = Date.parse('2026-09-09T12:00:00+09:00');
const TABLE_POOL = 12_000; // 히어로 2,000 + 봇 5 × 2,000 (practice = 레이크 없음)

function makeHero(id: string, seat: { seatIndex: number; chips: number }): Player {
  return {
    id,
    name: '수련생',
    type: 'human',
    avatar: 'sakura',
    chips: seat.chips,
    seatIndex: seat.seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
    timeBankChips: 1,
  };
}

describe('WeeklyDojoService', () => {
  let database: PokerDatabase;
  let repository: WeeklyDojoRepository;
  let manager: RoomManager;
  let service: WeeklyDojoService;
  let progression: {
    captureHandStart: ReturnType<typeof vi.fn>;
    completeHand: ReturnType<typeof vi.fn>;
    completeSng: ReturnType<typeof vi.fn>;
    disposeRoom: ReturnType<typeof vi.fn>;
  };
  let online = true;
  let now = T0;

  function buildService(
    options: { maxHands?: number; holdTimeoutMs?: number } = {},
  ): WeeklyDojoService {
    const built = new WeeklyDojoService({
      repository,
      roomManager: manager,
      hero: {
        isOnline: () => online,
        seatHero: (profileId, roomId, seat) => manager.joinRoom(roomId, makeHero(profileId, seat)),
      },
      now: () => now,
      finishDelayMs: 0,
      sweepIntervalMs: 0,
      maxHands: 2,
      ...options,
    });
    manager.setWeeklyDojoHooks(built);
    return built;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    now = T0;
    online = true;
    database = openPokerDatabase(':memory:');
    repository = new WeeklyDojoRepository(database);
    insertProfile(database, HERO);
    progression = {
      captureHandStart: vi.fn(),
      completeHand: vi.fn(),
      completeSng: vi.fn(),
      disposeRoom: vi.fn(),
    };
    manager = new RoomManager(() => {}, () => {}, undefined, {
      progression: progression as never,
    });
    service = buildService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    service.shutdown();
    manager.shutdown();
    database.close();
    vi.useRealTimers();
  });

  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  function start(target = service) {
    const result = target.start(HERO);
    expect(result.ok).toBe(true);
    return result.ok ? result.value : null!;
  }

  const attemptRow = (attemptId: string) => repository.findAttempt(attemptId)!;
  const stateOf = (roomId: string) => manager.getRoom(roomId)?.engine.state;
  const heroSeat = (roomId: string) =>
    stateOf(roomId)?.players.find(player => player.id === HERO);
  /**
   * 좌석 스택 총합. 핸드 사이에서만 의미가 있다 — 엔진은 승자 연출을 위해 종료된 핸드의
   * `pots`를 다음 핸드까지 남겨 두므로 팟을 더하면 이중 계산이 된다.
   */
  const tablePool = (roomId: string) =>
    (stateOf(roomId)?.players ?? []).reduce((sum, player) => sum + player.chips, 0);
  const dealerSeat = (roomId: string) => {
    const state = stateOf(roomId);
    return state ? state.players[state.dealerIndex]?.seatIndex : undefined;
  };

  /** 히어로가 자기 턴마다 지정 액션을 하며 실제 핸드를 진행시킨다 */
  async function driveUntil(
    roomId: string,
    done: () => boolean,
    action: 'check' | 'call' = 'check',
    steps = 400,
  ): Promise<boolean> {
    for (let index = 0; index < steps; index++) {
      if (done()) return true;
      const state = stateOf(roomId);
      if (!state) return done();
      const active = state.players[state.activePlayerIndex];
      if (state.isHandInProgress && active?.id === HERO) {
        if (!manager.processPlayerAction(roomId, HERO, action)) {
          if (!manager.processPlayerAction(roomId, HERO, 'check')) {
            manager.processPlayerAction(roomId, HERO, 'fold');
          }
        }
        if (done()) return true;
      }
      await tick(500);
    }
    return done();
  }

  const driveHands = (roomId: string, attemptId: string, target: number) =>
    driveUntil(roomId, () => attemptRow(attemptId).handsPlayed >= target);

  function openBlindHand() {
    service.shutdown();
    service = buildService({maxHands:6});
    const opened = start();
    const engine = manager.getRoom(opened.roomId)!.engine;
    engine.state.dealerIndex = 3;
    engine.startHand();
    while (engine.state.players[engine.state.activePlayerIndex]?.id !== HERO) {
      const actor = engine.state.players[engine.state.activePlayerIndex];
      expect(manager.processPlayerAction(opened.roomId,actor.id,'call')).toBe(true);
    }
    return {...opened,engine};
  }

  it('preserves a resumable checkpoint when disconnect grace expires mid-hand', async () => {
    const {roomId,attemptId} = openBlindHand();
    online = false;
    manager.handleDisconnect(roomId,HERO);
    expect(manager.handleGraceExpired(roomId,HERO)).toBe(true);
    await tick(120_000);
    expect(manager.getRoom(roomId)).toBeUndefined();
    const saved = attemptRow(attemptId);
    expect(saved.status).toBe('live');
    expect(saved.handsPlayed).toBe(1);
    expect(parseWeeklyDojoCheckpoint(saved.checkpointJson)).not.toBeNull();
    online = true;
    const resumed = start();
    expect(resumed.attemptId).toBe(attemptId);
    expect(tablePool(resumed.roomId)).toBe(TABLE_POOL);
  });

  it('retries a failed mid-close boundary before releasing the room', async () => {
    const {roomId,attemptId} = openBlindHand();
    manager.processPlayerAction(roomId,HERO,'check');
    const chips = heroSeat(roomId)!.chips;
    vi.spyOn(repository,'recordHandBoundary').mockImplementationOnce(() => { throw new Error('write unavailable'); });
    expect(service.leaveTable(HERO).ok).toBe(false);
    await tick(120_000);
    const saved = attemptRow(attemptId);
    expect(saved.status).toBe('live');
    expect(saved.committedChips).toBe(chips);
    expect(saved.handsPlayed).toBe(1);
    expect(parseWeeklyDojoCheckpoint(saved.checkpointJson)).not.toBeNull();
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(start().attemptId).toBe(attemptId);
  });

  it('does not dispose an unresolved all-in when the close watchdog fires', async () => {
    const {roomId,attemptId,engine} = openBlindHand();
    expect(manager.processPlayerAction(roomId,HERO,'all-in')).toBe(true);
    const stalled = vi.spyOn(engine,'processAction').mockReturnValue({valid:false,handComplete:false});
    expect(service.leaveTable(HERO).ok).toBe(true);
    await tick(61_000);
    expect(manager.getRoom(roomId)).toBeDefined();
    expect(engine.state.isHandInProgress).toBe(true);
    expect(attemptRow(attemptId).handsPlayed).toBe(0);
    stalled.mockRestore();
  });

  it('opens a private table with the fixed lineup and hides it from the lobby', () => {
    const { roomId, slot } = start();

    const room = manager.getRoom(roomId)!;
    expect(slot).toBe(1);
    expect(room.config.economyMode).toBe('practice');
    expect(room.config.tableType).toBe('bots');
    expect(room.config.weeklyDojoAttemptId).toBeTruthy();
    expect(room.engine.state.players).toHaveLength(6);
    expect(
      room.engine.state.players
        .filter(player => player.type === 'bot')
        .map(player => player.personalityId),
    ).toEqual(WEEKLY_DOJO_LINEUP.map(seat => seat.characterId));
    expect(heroSeat(roomId)!.chips).toBe(2_000);
    expect(tablePool(roomId)).toBe(TABLE_POOL);

    // 로비 목록·초대 코드에 노출되지 않는다
    expect(manager.getRoomList(HERO).some(entry => entry.id === roomId)).toBe(false);
    expect(manager.getInviteCode(roomId)).toBeNull();
    // 다른 사람은 앉을 수 없다 (봇 전용 테이블 = 휴먼 1명)
    expect(manager.joinRoom(roomId, makeHero('intruder', { seatIndex: 0, chips: 2_000 }))).toBe(false);
  });

  it('rejects the room kind when the hooks or economy contract is broken', () => {
    const bare = new RoomManager(() => {}, () => {});
    expect(() => bare.createRoom({
      name: '주간 도장', smallBlind: 10, bigBlind: 20, minBuyIn: 2_000, maxBuyIn: 2_000,
      maxPlayers: 6, economyMode: 'practice', turnTime: 15, tableType: 'bots',
      weeklyDojoAttemptId: 'wd_x',
    })).toThrow('Weekly dojo room requires weekly dojo hooks');
    expect(() => manager.createRoom({
      name: '주간 도장', smallBlind: 10, bigBlind: 20, minBuyIn: 2_000, maxBuyIn: 2_000,
      maxPlayers: 6, economyMode: 'wallet', turnTime: 15, tableType: 'bots',
      weeklyDojoAttemptId: 'wd_x',
    })).toThrow('Weekly dojo room must be practice economy');
  });

  it('ends at the hand cap and records the committed stack without touching wallet or XP', async () => {
    const { roomId, attemptId } = start();

    await driveUntil(roomId, () => attemptRow(attemptId).status === 'completed');

    const row = attemptRow(attemptId);
    expect(row.status).toBe('completed');
    expect(row.finishReason).toBe('max-hands');
    expect(row.handsPlayed).toBe(2);
    const boundaries = handRows(database, attemptId);
    expect(boundaries.map(item => item.handIndex)).toEqual([1, 2]);
    expect(row.committedChips).toBe(boundaries[1].chipsAfter);
    expect(row.scoreMilliBB).toBe((row.committedChips - 2_000) * 50);
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(service.hasLiveRoom(HERO)).toBe(false);

    // 경제·진행도 어디에도 흔적이 없다
    expect(progression.captureHandStart).not.toHaveBeenCalled();
    expect(progression.completeHand).not.toHaveBeenCalled();
    expect(rowCount(database, 'chip_ledger')).toBe(0);
    expect(rowCount(database, 'seat_escrows')).toBe(0);
  });

  // --- 핵심: 진행 중 핸드의 손실은 지울 수 없다 -------------------------------

  it('keeps a normally folded blind when leaving before the bots finish', async () => {
    service.shutdown();
    service = buildService({maxHands:6});
    const {roomId,attemptId} = start();
    const engine = manager.getRoom(roomId)!.engine;
    // Put the hero in the BB and call around to them without random bot choices.
    engine.state.dealerIndex = 3;
    engine.startHand();
    expect(engine.state.bigBlindId).toBe(HERO);
    while (engine.state.players[engine.state.activePlayerIndex]?.id !== HERO) {
      const actor = engine.state.players[engine.state.activePlayerIndex];
      expect(manager.processPlayerAction(roomId,actor.id,'call')).toBe(true);
    }
    expect(manager.processPlayerAction(roomId,HERO,'fold')).toBe(true);
    expect(heroSeat(roomId)?.status).toBe('folded');
    expect(engine.state.isHandInProgress).toBe(true);
    const chips = heroSeat(roomId)!.chips;
    expect(chips).toBe(1_980);
    const result = service.leaveTable(HERO);
    expect(result.ok && result.value.status).toBe('closing');
    expect(attemptRow(attemptId).handsPlayed).toBe(1);
    expect(attemptRow(attemptId).committedChips).toBe(chips);
    expect(service.leaveTable(HERO).ok).toBe(true);
    expect(manager.getRoom(roomId)).toBeDefined();
    await tick(120_000);
    expect(manager.getRoom(roomId)).toBeUndefined();
    const saved = attemptRow(attemptId);
    expect(saved.status).toBe('live');
    expect(saved.handsPlayed).toBe(1);
    expect(parseWeeklyDojoCheckpoint(saved.checkpointJson)).not.toBeNull();
    const resumed = start();
    expect(resumed.attemptId).toBe(attemptId);
    expect(heroSeat(resumed.roomId)?.chips).toBe(chips);
    expect(tablePool(resumed.roomId)).toBe(TABLE_POOL);
  });

  it('persists the live-hand loss when the player leaves mid hand', async () => {
    service.shutdown();
    service = buildService({ maxHands: 6 });
    const { roomId, attemptId } = start();

    // 히어로가 실제로 칩을 넣고 아직 그 핸드에 살아 있는 순간까지 진행한다
    const invested = await driveUntil(roomId, () => {
      const state = stateOf(roomId);
      const hero = heroSeat(roomId);
      return !!state?.isHandInProgress
        && !!hero
        && hero.status === 'active'
        && hero.totalContributed > 0;
    }, 'call');
    expect(invested).toBe(true);
    const contested = heroSeat(roomId)!;
    const stackAtLeave = contested.chips;
    expect(stackAtLeave).toBeLessThan(2_000);

    const left = service.leaveTable(HERO);
    expect(left.ok).toBe(true);

    // 나가는 즉시 손실이 영속된다 — 여기서 크래시가 나도 이 핸드는 남는다
    const row = attemptRow(attemptId);
    expect(row.status).toBe('live');
    expect(row.handsPlayed).toBe(1);
    expect(row.committedChips).toBe(stackAtLeave);
    expect(row.committedChips).toBeLessThan(2_000);

    // 남은 봇 핸드가 끝나면 방이 닫히고 복원 스냅샷이 채워진다
    await tick(120_000);
    expect(manager.getRoom(roomId)).toBeUndefined();
    const settled = attemptRow(attemptId);
    expect(settled.status).toBe('live');
    expect(settled.handsPlayed).toBe(1);
    expect(settled.committedChips).toBe(stackAtLeave);
    expect(parseWeeklyDojoCheckpoint(settled.checkpointJson)).not.toBeNull();
  });

  it('scores a forfeit from the live hand the player walked away from', async () => {
    service.shutdown();
    service = buildService({ maxHands: 6 });
    const { roomId, attemptId } = start();

    await driveUntil(roomId, () => {
      const state = stateOf(roomId);
      const hero = heroSeat(roomId);
      return !!state?.isHandInProgress && !!hero && hero.status === 'active' && hero.totalContributed > 0;
    }, 'call');
    const stackAtForfeit = heroSeat(roomId)!.chips;
    expect(stackAtForfeit).toBeLessThan(2_000);

    const forfeited = service.forfeit(HERO);
    expect(forfeited.ok).toBe(true);
    await tick(120_000);

    const row = attemptRow(attemptId);
    expect(row.status).toBe('completed');
    expect(row.finishReason).toBe('forfeit');
    // 진행 중이던 핸드의 기여금은 그대로 손실로 남는다
    expect(row.committedChips).toBe(stackAtForfeit);
    expect(row.scoreMilliBB).toBe(-100_000);
    expect(row.handsPlayed).toBe(1);
    expect(manager.getRoom(roomId)).toBeUndefined();
  });

  it('keeps the live-hand loss when the seat is reclaimed by the server', async () => {
    service.shutdown();
    service = buildService({ maxHands: 6 });
    const { roomId, attemptId } = start();

    await driveUntil(roomId, () => {
      const state = stateOf(roomId);
      const hero = heroSeat(roomId);
      return !!state?.isHandInProgress && !!hero && hero.status === 'active' && hero.totalContributed > 0;
    }, 'call');
    const stackAtDrop = heroSeat(roomId)!.chips;

    // grace 만료 회수 경로 — 좌석 제거 직전에 경계가 남아야 한다
    manager.leaveRoom(roomId, HERO);
    await tick(120_000);

    const row = attemptRow(attemptId);
    expect(row.handsPlayed).toBe(1);
    expect(row.committedChips).toBe(stackAtDrop);
    expect(row.committedChips).toBeLessThan(2_000);
  });

  it('stays consistent under rapid leave/forfeit/reconnect', async () => {
    service.shutdown();
    service = buildService({ maxHands: 6 });
    const first = start();

    await driveUntil(first.roomId, () => {
      const state = stateOf(first.roomId);
      const hero = heroSeat(first.roomId);
      return !!state?.isHandInProgress && !!hero && hero.status === 'active' && hero.totalContributed > 0;
    }, 'call');
    const stack = heroSeat(first.roomId)!.chips;

    // 연타: 나가기 → 나가기 → 포기 → 포기. 이미 마무리 중이면 멱등하게 같은 시도를 가리킨다
    const firstLeave = service.leaveTable(HERO);
    expect(firstLeave.ok).toBe(true);
    for (const repeat of [
      service.leaveTable(HERO),
      service.forfeit(HERO),
      service.forfeit(HERO),
    ]) {
      if (!repeat.ok) continue; // 이미 닫혔다면 stale-state가 정답이다
      expect(repeat.value.attemptId).toBe(first.attemptId);
      expect(['closing', 'closed', 'left']).toContain(repeat.value.status);
    }
    await tick(120_000);

    const row = attemptRow(first.attemptId);
    expect(row.status).toBe('completed');
    expect(row.committedChips).toBe(stack);
    expect(row.handsPlayed).toBe(1);
    expect(handRows(database, first.attemptId).map(item => item.handIndex)).toEqual([1]);

    // 재연결 후 다음 시도는 새 슬롯이고, 이전 기록은 그대로다
    const next = start();
    expect(next.slot).toBe(2);
    expect(next.attemptId).not.toBe(first.attemptId);
    expect(attemptRow(first.attemptId).committedChips).toBe(stack);
  });

  // --- 재개: 에폭·체크포인트 ---------------------------------------------------

  it('resumes with the exact next hand index after two committed hands', async () => {
    service.shutdown();
    service = buildService({ maxHands: 6 });
    const { roomId, attemptId } = start();

    expect(await driveHands(roomId, attemptId, 2)).toBe(true);
    expect(service.leaveTable(HERO).ok).toBe(true);
    await tick(120_000);
    expect(manager.getRoom(roomId)).toBeUndefined();

    const before = attemptRow(attemptId);
    expect(before.status).toBe('live');
    expect(before.roomEpoch).toBe(1);
    const playedBefore = before.handsPlayed;
    expect(playedBefore).toBeGreaterThanOrEqual(2);

    const resumed = start();
    expect(resumed.attemptId).toBe(attemptId);
    expect(resumed.resumed).toBe(true);
    expect(attemptRow(attemptId).roomEpoch).toBe(2);
    // 새 엔진은 handNumber 1부터 다시 시작한다 — 그래도 인덱스는 이어져야 한다
    expect(stateOf(resumed.roomId)!.handNumber).toBe(0);

    expect(await driveHands(resumed.roomId, attemptId, playedBefore + 1)).toBe(true);
    const rows = handRows(database, attemptId);
    expect(rows.map(item => item.handIndex))
      .toEqual(Array.from({ length: rows.length }, (_, index) => index + 1));
    expect(rows.some(item => item.roomEpoch === 2 && item.handNumber === 1)).toBe(true);
    expect(attemptRow(attemptId).handsPlayed).toBe(rows.length);
  });

  it('restores bot stacks, the button and the chip pool on repeated resumes', async () => {
    service.shutdown();
    service = buildService({ maxHands: 8 });
    const { roomId, attemptId } = start();

    expect(await driveHands(roomId, attemptId, 2)).toBe(true);
    expect(service.leaveTable(HERO).ok).toBe(true);
    await tick(120_000);

    for (let round = 0; round < 2; round++) {
      const saved = attemptRow(attemptId);
      const checkpoint = parseWeeklyDojoCheckpoint(saved.checkpointJson);
      expect(checkpoint).not.toBeNull();

      const resumed = start();
      // 봇에게 새 칩을 주지 않는다 — 좌석별 스택이 스냅샷 그대로다
      for (const seat of checkpoint!.seats) {
        const bot = stateOf(resumed.roomId)!.players
          .find(player => player.seatIndex === seat.seatIndex)!;
        expect(bot.type).toBe('bot');
        expect(bot.personalityId).toBe(seat.characterId);
        expect(bot.chips).toBe(seat.chips);
      }
      expect(heroSeat(resumed.roomId)!.chips).toBe(saved.committedChips);
      // 버튼 앵커가 이어진다 (다음 핸드의 블라인드 순서 보존)
      expect(dealerSeat(resumed.roomId)).toBe(checkpoint!.dealerSeatIndex);
      // 칩 풀 총합 보존 — 반복 재개가 칩을 만들어내지 않는다
      expect(tablePool(resumed.roomId)).toBe(TABLE_POOL);

      expect(await driveHands(resumed.roomId, attemptId, saved.handsPlayed + 1)).toBe(true);
      expect(tablePool(resumed.roomId)).toBe(TABLE_POOL);
      expect(service.leaveTable(HERO).ok).toBe(true);
      await tick(120_000);
    }

    expect(attemptRow(attemptId).roomEpoch).toBe(3);
  });

  it('closes a resumed attempt that already hit the hand cap instead of dealing more', async () => {
    service.shutdown();
    service = buildService({ maxHands: 2 });
    const { roomId, attemptId } = start();

    expect(await driveHands(roomId, attemptId, 2)).toBe(true);
    await tick(30_000);
    expect(attemptRow(attemptId).status).toBe('completed');
    expect(attemptRow(attemptId).finishReason).toBe('max-hands');
    expect(handRows(database, attemptId)).toHaveLength(2);

    // 다음 start는 새 시도(슬롯 2)를 열지, 끝난 시도를 다시 열지 않는다
    const next = start();
    expect(next.slot).toBe(2);
    expect(next.attemptId).not.toBe(attemptId);
  });

  it('refuses to reopen an attempt whose restore snapshot is missing', () => {
    const { attemptId } = start();
    repository.recordHandBoundary({
      attemptId,
      roomEpoch: attemptRow(attemptId).roomEpoch,
      handNumber: 99,
      chipsAfter: 1_500,
      checkpointJson: null,
      at: now,
    });
    service.leaveTable(HERO);

    const blocked = service.start(HERO);
    expect(blocked.ok).toBe(false);
    const row = attemptRow(attemptId);
    // 시작 스택으로 봇을 리필해 이어가지 않는다 — 그 자리에서 손실을 확정한다
    expect(row.status).toBe('completed');
    expect(row.finishReason).toBe('recovery');
    expect(row.committedChips).toBe(1_500);
    expect(row.scoreMilliBB).toBe(-25_000);
  });

  it('holds at the hand boundary while the player is away instead of letting bots burn hands', async () => {
    service.shutdown();
    service = buildService({ maxHands: 6 });
    const { roomId, attemptId } = start();
    heroSeat(roomId)!.isDisconnected = true;

    await tick(120_000);

    const row = attemptRow(attemptId);
    expect(row.status).toBe('live');
    expect(row.handsPlayed).toBeLessThan(row.maxHands);
    expect(service.isHeld(roomId)).toBe(true);
    expect(service.getView(HERO).live?.paused).toBe(true);
    manager.handleReconnect(roomId,HERO);
    expect(service.start(HERO).ok).toBe(true);
    expect(service.isHeld(roomId)).toBe(false);
    expect(service.getView(HERO).live?.paused).toBe(false);
    expect(await driveHands(roomId,attemptId,row.handsPlayed+1)).toBe(true);
  });

  it('ignores a repeated hand-end callback for the same hand', () => {
    const { roomId, attemptId } = start();
    heroSeat(roomId)!.chips = 2_500;

    const before = attemptRow(attemptId).handsPlayed;
    service.onHandComplete(roomId);
    const once = attemptRow(attemptId);
    service.onHandComplete(roomId);
    const twice = attemptRow(attemptId);

    expect(once.handsPlayed).toBe(before);
    expect(twice.handsPlayed).toBe(once.handsPlayed);
    expect(twice.committedChips).toBe(once.committedChips);
  });
});

function insertProfile(database: PokerDatabase, id: string): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(
    id,
    `credential-hash-${id}`,
    `credential-lookup-${id}`,
    `recovery-hash-${id}`,
    `recovery-lookup-${id}`,
    `alias-${id}`,
  );
}

function handRows(
  database: PokerDatabase,
  attemptId: string,
): { roomEpoch: number; handNumber: number; handIndex: number; chipsAfter: number }[] {
  return database.db.prepare(`
    SELECT room_epoch AS roomEpoch, hand_number AS handNumber,
           hand_index AS handIndex, chips_after AS chipsAfter
    FROM weekly_dojo_hands WHERE attempt_id = ? ORDER BY hand_index
  `).all(attemptId) as unknown as {
    roomEpoch: number; handNumber: number; handIndex: number; chipsAfter: number;
  }[];
}

function rowCount(database: PokerDatabase, table: string): number {
  const row = database.db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  return row.count;
}
