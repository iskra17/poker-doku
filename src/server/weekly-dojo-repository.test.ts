import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { WeeklyDojoRepository } from './weekly-dojo-repository';

/**
 * 주간 도장 영속(v42) 회귀:
 * - 시도 번호는 플레이 전에 확정 예약되고 주당 3회로 막힌다
 * - 프로필당 라이브 시도는 하나 (주가 바뀌어도 유지 → 지난 주 시도를 먼저 끝내야 한다)
 * - 방을 다시 열면 에폭이 올라가 새 엔진의 handNumber 1이 이전 기록과 충돌하지 않는다
 * - 핸드 인덱스는 저장소가 계산한다 (호출자가 제출할 수 없다) + 상한 초과 기록 거절
 * - 중복 콜백은 스택을 다시 쓰지 않고, 비어 있던 복원 스냅샷만 채운다
 * - 완료는 멱등이고 점수는 저장된 확정 스택으로만 계산한다
 * - 순위표는 3시도를 모두 끝낸 프로필만 담는다 / 지갑·원장에는 흔적이 없다
 */

const WEEK = '2026-W37';
const NEXT_WEEK = '2026-W38';
const T0 = Date.parse('2026-09-09T12:00:00+09:00');
const HERO = 'wd-hero';

const BASE = {
  weekKey: WEEK,
  lineupVersion: 'wd-v1',
  startingChips: 2_000,
  bigBlind: 20,
  maxHands: 20,
  attemptsPerWeek: 3,
} as const;

const CHECKPOINT = JSON.stringify({
  v: 1,
  lineupVersion: 'wd-v1',
  dealerSeatIndex: 2,
  heroChips: 1_800,
  seats: [
    { seatIndex: 1, characterId: 'mochi', chips: 2_000 },
    { seatIndex: 2, characterId: 'choco', chips: 2_100 },
    { seatIndex: 3, characterId: 'luna', chips: 2_000 },
    { seatIndex: 4, characterId: 'gumi', chips: 2_100 },
    { seatIndex: 5, characterId: 'paeng', chips: 2_000 },
  ],
});

describe('WeeklyDojoRepository', () => {
  let database: PokerDatabase;
  let repository: WeeklyDojoRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new WeeklyDojoRepository(database);
    insertProfile(database, HERO);
  });

  afterEach(() => {
    database.close();
  });

  function reserve(profileId = HERO, weekKey = WEEK, at = T0) {
    return repository.reserveAttempt({ ...BASE, profileId, weekKey, at });
  }

  function reserveId(profileId = HERO, weekKey = WEEK, at = T0): string {
    const result = reserve(profileId, weekKey, at);
    expect(result.status).toBe('reserved');
    return result.status === 'reserved' ? result.attempt.id : '';
  }

  function boundary(
    attemptId: string,
    options: {
      epoch?: number;
      hand?: number;
      chips: number;
      checkpoint?: string | null;
      at?: number;
    },
  ) {
    return repository.recordHandBoundary({
      attemptId,
      roomEpoch: options.epoch ?? 1,
      handNumber: options.hand ?? 1,
      chipsAfter: options.chips,
      checkpointJson: options.checkpoint === undefined ? CHECKPOINT : options.checkpoint,
      at: options.at ?? T0 + 1_000,
    });
  }

  function playOut(
    attemptId: string,
    chips: number,
    reason: 'max-hands' | 'bust' | 'forfeit' | 'table-short' = 'forfeit',
    at = T0 + 1_000,
  ): void {
    repository.beginRoomEpoch(attemptId, at);
    boundary(attemptId, { chips, at });
    repository.completeAttempt({ attemptId, reason, at: at + 1 });
  }

  it('reserves attempt numbers before play and stops at three per week', () => {
    const first = reserve();
    expect(first.status).toBe('reserved');
    expect(first.status === 'reserved' && first.attempt.attemptNo).toBe(1);
    // 예약 시점에 이미 committed_chips = 시작 스택, 에폭은 0 (아직 방을 열지 않았다)
    expect(first.status === 'reserved' && first.attempt.committedChips).toBe(2_000);
    expect(first.status === 'reserved' && first.attempt.roomEpoch).toBe(0);
    expect(first.status === 'reserved' && first.attempt.checkpointJson).toBeNull();

    playOut(first.status === 'reserved' ? first.attempt.id : '', 1_500);
    expect(reserveId()).toBeTruthy();
    playOut(repository.findLiveAttempt(HERO)!.id, 2_500);
    playOut(reserveId(), 2_000);

    expect(reserve().status).toBe('cap-reached');
    expect(repository.listAttempts(HERO, WEEK)).toHaveLength(3);
    expect(repository.listAttempts(HERO, WEEK).map(row => row.attemptNo)).toEqual([1, 2, 3]);
  });

  it('returns the running attempt instead of handing out a fresh number', () => {
    const attemptId = reserveId();

    const again = reserve();
    expect(again.status).toBe('resumed');
    expect(again.status === 'resumed' && again.attempt.id).toBe(attemptId);
    expect(repository.listAttempts(HERO, WEEK)).toHaveLength(1);
  });

  it('finishes last week under the old key before opening a new-week attempt', () => {
    const staleId = reserveId(HERO, WEEK);

    const rollover = reserve(HERO, NEXT_WEEK, T0 + 7 * 86_400_000);
    expect(rollover.status).toBe('resumed');
    expect(rollover.status === 'resumed' && rollover.attempt.weekKey).toBe(WEEK);

    repository.completeAttempt({ attemptId: staleId, reason: 'forfeit', at: T0 + 7 * 86_400_000 });
    const fresh = reserve(HERO, NEXT_WEEK, T0 + 7 * 86_400_000);
    expect(fresh.status).toBe('reserved');
    expect(fresh.status === 'reserved' && fresh.attempt.weekKey).toBe(NEXT_WEEK);
    expect(fresh.status === 'reserved' && fresh.attempt.attemptNo).toBe(1);
    expect(repository.listAttempts(HERO, WEEK)).toHaveLength(1);
  });

  it('separates hands across room epochs so a resumed engine cannot collide', () => {
    const attemptId = reserveId();
    expect(repository.beginRoomEpoch(attemptId, T0).status).toBe('ok');

    expect(boundary(attemptId, { epoch: 1, hand: 1, chips: 1_900 }).status).toBe('recorded');
    expect(boundary(attemptId, { epoch: 1, hand: 2, chips: 1_800 }).status).toBe('recorded');

    // 재개 — 새 엔진은 handNumber 1부터 다시 시작한다
    const resumed = repository.beginRoomEpoch(attemptId, T0 + 10);
    expect(resumed.status === 'ok' && resumed.attempt.roomEpoch).toBe(2);
    expect(resumed.status === 'ok' && resumed.attempt.handsPlayed).toBe(2);

    const third = boundary(attemptId, { epoch: 2, hand: 1, chips: 1_700 });
    expect(third.status).toBe('recorded');
    // 인덱스는 시도 전체에서 단조 증가한다 — 조용히 무시되지 않는다
    expect(third.status === 'recorded' && third.attempt.handsPlayed).toBe(3);
    expect(third.status === 'recorded' && third.attempt.committedChips).toBe(1_700);
    expect(handRows(database, attemptId)).toEqual([
      { roomEpoch: 1, handNumber: 1, handIndex: 1, chipsAfter: 1_900 },
      { roomEpoch: 1, handNumber: 2, handIndex: 2, chipsAfter: 1_800 },
      { roomEpoch: 2, handNumber: 1, handIndex: 3, chipsAfter: 1_700 },
    ]);
  });

  it('records each committed hand once and only fills a missing checkpoint on repeat', () => {
    const attemptId = reserveId();
    repository.beginRoomEpoch(attemptId, T0);

    // 진행 중 이탈로 확정된 경계 — 복원 스냅샷은 비어 있다
    const first = boundary(attemptId, { hand: 4, chips: 1_800, checkpoint: null });
    expect(first.status).toBe('recorded');
    expect(first.status === 'recorded' && first.attempt.handsPlayed).toBe(1);
    expect(first.status === 'recorded' && first.attempt.checkpointJson).toBeNull();

    // 정산 재시도로 같은 핸드가 다시 들어와도 스택/카운터는 흔들리지 않는다
    const duplicate = boundary(attemptId, { hand: 4, chips: 999_999, checkpoint: null });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.status === 'duplicate' && duplicate.attempt.handsPlayed).toBe(1);
    expect(duplicate.status === 'duplicate' && duplicate.attempt.committedChips).toBe(1_800);

    // 진짜 핸드 종료 시점의 스냅샷만 뒤늦게 채워진다 (스택은 그대로)
    const finalized = boundary(attemptId, { hand: 4, chips: 999_999 });
    expect(finalized.status).toBe('duplicate');
    expect(finalized.status === 'duplicate' && finalized.attempt.checkpointJson).toBe(CHECKPOINT);
    expect(finalized.status === 'duplicate' && finalized.attempt.committedChips).toBe(1_800);

    // 이미 채워진 스냅샷은 덮어쓰지 않는다
    const later = boundary(attemptId, { hand: 4, chips: 1_800, checkpoint: '{"v":1}' });
    expect(later.status === 'duplicate' && later.attempt.checkpointJson).toBe(CHECKPOINT);
    expect(handRows(database, attemptId)).toHaveLength(1);
  });

  it('refuses boundaries past the hand cap', () => {
    const attemptId = repository.reserveAttempt({
      ...BASE, profileId: HERO, weekKey: WEEK, at: T0, maxHands: 2,
    });
    const id = attemptId.status === 'reserved' ? attemptId.attempt.id : '';
    repository.beginRoomEpoch(id, T0);
    expect(boundary(id, { hand: 1, chips: 1_900 }).status).toBe('recorded');
    expect(boundary(id, { hand: 2, chips: 1_800 }).status).toBe('recorded');

    const overflow = boundary(id, { hand: 3, chips: 1_700 });
    expect(overflow.status).toBe('cap-reached');
    expect(overflow.status === 'cap-reached' && overflow.attempt.handsPlayed).toBe(2);
    expect(overflow.status === 'cap-reached' && overflow.attempt.committedChips).toBe(1_800);
    expect(handRows(database, id)).toHaveLength(2);
  });

  it('scores from the stored committed stack and completes idempotently', () => {
    const attemptId = reserveId();
    repository.beginRoomEpoch(attemptId, T0);
    boundary(attemptId, { hand: 1, chips: 1_240, at: T0 + 10 });

    const done = repository.completeAttempt({ attemptId, reason: 'forfeit', at: T0 + 20 });
    expect(done.status).toBe('completed');
    // (1240 - 2000) / 20 = -38BB → -38,000 milli-BB
    expect(done.status === 'completed' && done.attempt.scoreMilliBB).toBe(-38_000);
    expect(done.status === 'completed' && done.attempt.finishReason).toBe('forfeit');

    const again = repository.completeAttempt({ attemptId, reason: 'bust', at: T0 + 30 });
    expect(again.status).toBe('already-completed');
    expect(again.status === 'already-completed' && again.attempt.scoreMilliBB).toBe(-38_000);
    expect(again.status === 'already-completed' && again.attempt.finishReason).toBe('forfeit');

    // 완료된 시도에는 더 이상 핸드도 에폭도 붙지 않는다
    expect(boundary(attemptId, { hand: 2, chips: 9_000 }).status).toBe('not-live');
    expect(repository.beginRoomEpoch(attemptId, T0 + 40).status).toBe('not-live');
  });

  it('ranks only profiles that finished all three attempts and leaves the wallet untouched', () => {
    insertProfile(database, 'partial');
    const finish = (profileId: string, stacks: readonly number[]): void => {
      for (const [index, chips] of stacks.entries()) {
        const reserved = repository.reserveAttempt({
          ...BASE, profileId, weekKey: WEEK, at: T0 + index,
        });
        expect(reserved.status).toBe('reserved');
        playOut(
          reserved.status === 'reserved' ? reserved.attempt.id : '',
          chips,
          'max-hands',
          T0 + index * 100,
        );
      }
    };
    finish(HERO, [2_400, 2_000, 1_800]);
    finish('partial', [3_000, 3_000]);

    const standings = repository.listWeeklyStandings(WEEK, 3);
    expect(standings).toHaveLength(1);
    expect(standings[0]).toMatchObject({
      profileId: HERO,
      alias: `alias-${HERO}`,
      avatarId: 'sakura',
      completedAttempts: 3,
    });
    // (400 + 0 - 200) / 20 = 10BB
    expect(standings[0].scoreMilliBB).toBe(10_000);

    expect(rowCount(database, 'chip_ledger')).toBe(0);
    expect(rowCount(database, 'seat_escrows')).toBe(0);
    expect(walletBalance(database, HERO)).toBe(0);
  });

  it('removes attempts and hand boundaries when the profile is deleted', () => {
    const attemptId = reserveId();
    repository.beginRoomEpoch(attemptId, T0);
    boundary(attemptId, { chips: 1_000 });

    database.db.prepare('DELETE FROM profiles WHERE id = ?').run(HERO);

    expect(rowCount(database, 'weekly_dojo_attempts')).toBe(0);
    expect(rowCount(database, 'weekly_dojo_hands')).toBe(0);
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
  database.db.prepare(`
    INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, 0, 1)
  `).run(id);
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

function walletBalance(database: PokerDatabase, profileId: string): number {
  const row = database.db
    .prepare('SELECT balance FROM wallets WHERE profile_id = ?')
    .get(profileId) as { balance: number } | undefined;
  return row?.balance ?? -1;
}
