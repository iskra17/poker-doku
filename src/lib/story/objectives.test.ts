import { describe, expect, it } from 'vitest';
import { handPercentile } from '@/lib/bot/hand-rankings';
import type {
  CompletedHandRecord,
  HandHistoryAction,
  HandHistoryActionKind,
  HandHistoryPlayer,
} from '@/lib/poker/hand-history';
import { cards } from '@/lib/poker/test-helpers';
import type { Street } from '@/lib/poker/types';
import {
  JUNK_PERCENTILE,
  addHand,
  deriveHeroHandFacts,
  emptyTally,
  evaluateObjective,
  evaluateObjectives,
  isTopPairOrBetter,
  liveScore,
  primaryObjectivesMet,
  type ObjectiveTally,
} from './objectives';
import type { Objective, ObjectiveKind } from './types';
import type { ObjectiveProgressView } from './views';

// ---------------------------------------------------------------------------
// 합성 CompletedHandRecord 빌더 — 액션 타임라인에서 기여금·순이익을 스스로 유도해
// 엔진이 만드는 레코드와 같은 불변식(sum(contributed) === potTotal)을 유지한다.

type ActionTuple = [Street, string, HandHistoryActionKind, number];

interface SeatInput {
  id: string;
  hole?: string;
  startingChips?: number;
}

interface RecordInput {
  handNumber?: number;
  seats: SeatInput[];
  actions: ActionTuple[];
  board?: string;
  winners?: Array<{ playerId: string; amount: number }>;
  showdown?: boolean;
}

function makeRecord(input: RecordInput): CompletedHandRecord {
  const contributed = new Map<string, number>();
  const streetBets = new Map<string, number>();
  let street: Street = 'preflop';

  const actions: HandHistoryAction[] = input.actions.map(([actionStreet, playerId, kind, amount]) => {
    if (actionStreet !== street) {
      street = actionStreet;
      streetBets.clear();
    }
    const previous = streetBets.get(playerId) ?? 0;
    const add = (delta: number) => contributed.set(playerId, (contributed.get(playerId) ?? 0) + delta);
    if (kind === 'post-sb' || kind === 'post-bb') {
      add(amount);
      streetBets.set(playerId, previous + amount);
    } else if (kind === 'post-ante') {
      add(amount);
    } else if (kind === 'call') {
      add(amount);
      streetBets.set(playerId, previous + amount);
    } else if (kind === 'raise' || kind === 'all-in') {
      add(amount - previous);
      streetBets.set(playerId, amount);
    } else if (kind === 'uncalled-return') {
      add(-amount);
      streetBets.set(playerId, previous - amount);
    }
    return { street: actionStreet, playerId, kind, amount };
  });

  const winners = input.winners ?? [];
  const wonBy = new Map<string, number>();
  for (const winner of winners) wonBy.set(winner.playerId, (wonBy.get(winner.playerId) ?? 0) + winner.amount);

  const players: HandHistoryPlayer[] = input.seats.map((seat, index) => {
    const total = contributed.get(seat.id) ?? 0;
    const won = wonBy.get(seat.id) ?? 0;
    return {
      id: seat.id,
      name: seat.id,
      type: index === 0 ? 'human' : 'bot',
      seatIndex: index,
      position: index === 0 ? 'BTN' : 'BB',
      startingChips: seat.startingChips ?? 1000,
      holeCards: seat.hole ? cards(seat.hole) : null,
      totalContributed: total,
      won,
      profit: won - total,
      revealed: Boolean(input.showdown),
      finalStatus: 'active',
      handRank: null,
      handDescription: null,
    };
  });

  return {
    handNumber: input.handNumber ?? 1,
    smallBlind: 25,
    bigBlind: 50,
    players,
    actions,
    board: input.board ? cards(input.board) : [],
    winners: winners.map(winner => ({ ...winner, handRank: null, handDescription: null, potIndex: 0 })),
    potTotal: [...contributed.values()].reduce((sum, value) => sum + value, 0),
    rake: 0,
    showdown: Boolean(input.showdown),
  };
}

function objective(kind: ObjectiveKind, extra: Partial<Objective> = {}): Objective {
  return { id: `obj-${kind}`, kind, label: kind, ...extra };
}

function tallyOf(...records: Array<{ record: CompletedHandRecord; heroId?: string }>): ObjectiveTally {
  return records.reduce(
    (tally, entry) => addHand(tally, deriveHeroHandFacts(entry.record, entry.heroId ?? 'hero')),
    emptyTally(),
  );
}

// ---------------------------------------------------------------------------
// 픽스처

/** 히어로가 72o를 프리플랍에 접는다 (SB 폴드 → BB 미응수 반환). */
function junkFoldHand(handNumber = 1): CompletedHandRecord {
  return makeRecord({
    handNumber,
    seats: [{ id: 'hero', hole: '7c 2d' }, { id: 'villain', hole: 'As Kd' }],
    actions: [
      ['preflop', 'hero', 'post-sb', 25],
      ['preflop', 'villain', 'post-bb', 50],
      ['preflop', 'hero', 'fold', 0],
      ['preflop', 'villain', 'uncalled-return', 25],
    ],
    winners: [{ playerId: 'villain', amount: 50 }],
  });
}

/** 히어로가 72o로 들어가 오즈에 안 맞는 큰 콜까지 하고 진다. */
function junkCallHand(handNumber = 2): CompletedHandRecord {
  return makeRecord({
    handNumber,
    seats: [{ id: 'hero', hole: '7c 2d' }, { id: 'villain', hole: '9s 9h' }],
    board: 'Ah Ks Qd 3c 4h',
    actions: [
      ['preflop', 'hero', 'post-sb', 25],
      ['preflop', 'villain', 'post-bb', 50],
      ['preflop', 'hero', 'call', 25],
      ['preflop', 'villain', 'check', 0],
      ['flop', 'villain', 'raise', 150],
      ['flop', 'hero', 'call', 150],
      ['turn', 'villain', 'check', 0],
      ['turn', 'hero', 'check', 0],
      ['river', 'villain', 'check', 0],
      ['river', 'hero', 'check', 0],
    ],
    winners: [{ playerId: 'villain', amount: 400 }],
    showdown: true,
  });
}

/** 히어로가 플러시 드로우로 가격에 맞는 콜을 하고 **진다** (결과 ≠ 결정). */
function goodCallButLostHand(handNumber = 3): CompletedHandRecord {
  return makeRecord({
    handNumber,
    seats: [{ id: 'hero', hole: 'Ah Kh' }, { id: 'villain', hole: '9s 9c' }],
    board: 'Qh 7h 2s 3d 4c',
    actions: [
      ['preflop', 'hero', 'post-sb', 25],
      ['preflop', 'villain', 'post-bb', 50],
      ['preflop', 'hero', 'call', 25],
      ['preflop', 'villain', 'check', 0],
      ['flop', 'villain', 'raise', 50],
      ['flop', 'hero', 'call', 50],
      ['turn', 'villain', 'check', 0],
      ['turn', 'hero', 'check', 0],
      ['river', 'villain', 'check', 0],
      ['river', 'hero', 'check', 0],
    ],
    winners: [{ playerId: 'villain', amount: 200 }],
    showdown: true,
  });
}

/** 히어로가 프리플랍 어그레서로 플랍 c벳까지 하고 이긴다. */
function cbetHand(handNumber = 4, flopKind: HandHistoryActionKind = 'raise'): CompletedHandRecord {
  const flop: ActionTuple[] = flopKind === 'raise'
    ? [
        ['flop', 'hero', 'raise', 200],
        ['flop', 'villain', 'fold', 0],
        ['flop', 'hero', 'uncalled-return', 200],
      ]
    : [
        ['flop', 'hero', 'check', 0],
        ['flop', 'villain', 'check', 0],
      ];
  return makeRecord({
    handNumber,
    seats: [{ id: 'hero', hole: 'Ad Kc' }, { id: 'villain', hole: '9s 9c' }],
    board: 'Qh 7h 2s',
    actions: [
      ['preflop', 'villain', 'post-sb', 25],
      ['preflop', 'hero', 'post-bb', 50],
      ['preflop', 'villain', 'call', 25],
      ['preflop', 'hero', 'raise', 150],
      ['preflop', 'villain', 'call', 100],
      ...flop,
    ],
    winners: [{ playerId: 'hero', amount: 300 }],
  });
}

describe('deriveHeroHandFacts', () => {
  it('히어로가 딜인되지 않은 핸드는 어떤 집계에도 들어가지 않는다', () => {
    const record = junkCallHand();
    const facts = deriveHeroHandFacts(record, 'ghost');
    expect(facts.dealtIn).toBe(false);
    expect(facts.handNumber).toBe(record.handNumber);

    const tally = addHand(emptyTally(), facts);
    expect(tally.hands).toHaveLength(0);
    expect(evaluateObjective(objective('hands-played', { target: 1 }), tally, true).progress).toBe(0);
    expect(evaluateObjective(objective('hands-played', { target: 1 }), tally, true).achieved).toBe(false);
  });

  it('프리플랍 junk 폴드를 읽는다', () => {
    const facts = deriveHeroHandFacts(junkFoldHand(), 'hero');
    expect(facts.dealtIn).toBe(true);
    expect(facts.junk).toBe(true);
    expect(facts.heroHandPercentile).toBeGreaterThan(JUNK_PERCENTILE);
    expect(facts.preflopFolded).toBe(true);
    expect(facts.preflopVpip).toBe(false);
    expect(facts.preflopDecision).toMatchObject({ action: 'fold' });
    expect(facts.won).toBe(false);
    expect(facts.netChips).toBe(-25);
    expect(facts.bustedThisHand).toBe(false);
  });

  it('진 핸드라도 가격에 맞는 콜은 👍로 집계한다 (결과 ≠ 결정)', () => {
    const facts = deriveHeroHandFacts(goodCallButLostHand(), 'hero');
    expect(facts.won).toBe(false);
    expect(facts.netChips).toBe(-100);
    expect(facts.junk).toBe(false);
    expect(facts.potOddsCalls).toHaveLength(1);

    const call = facts.potOddsCalls[0];
    expect(call.street).toBe('flop');
    expect(call.toCall).toBe(50);
    // 팟 = 상대 벳 포함 중앙 총액 (프리플랍 100 + 벳 50)
    expect(call.potTotal).toBe(150);
    expect(call.potOdds).toBeCloseTo(0.25, 5);
    expect(call.outs).toBe(15); // 하트 9 + A 3 + K 3
    expect(call.equity).toBeGreaterThan(0.5);
    expect(call.mark).toBe('good');
    expect(call.correct).toBe(true);
  });

  it('가격이 안 맞는 콜은 ⚠로 표시하고 오답으로 센다', () => {
    const facts = deriveHeroHandFacts(junkCallHand(), 'hero');
    expect(facts.preflopVpip).toBe(true);
    expect(facts.junk).toBe(true);
    expect(facts.potOddsCalls).toHaveLength(1);

    const call = facts.potOddsCalls[0];
    expect(call.potTotal).toBe(250);
    expect(call.potOdds).toBeCloseTo(150 / 400, 5);
    expect(call.outs).toBe(0); // AKQ 보드에서 7·2를 페어시켜도 톱페어가 아니다
    expect(call.mark).toBe('warn');
    expect(call.correct).toBe(false);
  });

  it('c벳 기회와 실행을 구분한다', () => {
    const executed = deriveHeroHandFacts(cbetHand(4, 'raise'), 'hero');
    expect(executed.wasAggressorOnFlop).toBe(true);
    expect(executed.cbetOpportunity).toBe(true);
    expect(executed.cbet).toBe(true);
    expect(executed.won).toBe(true);
    expect(executed.netChips).toBe(150);

    const missed = deriveHeroHandFacts(cbetHand(5, 'check'), 'hero');
    expect(missed.cbetOpportunity).toBe(true);
    expect(missed.cbet).toBe(false);

    // 어그레서가 아니었던 핸드는 기회 자체가 없다
    expect(deriveHeroHandFacts(goodCallButLostHand(), 'hero').cbetOpportunity).toBe(false);
  });

  it('리버 밸류벳 기회와 실행을 구분한다', () => {
    const build = (riverKind: HandHistoryActionKind) => makeRecord({
      seats: [{ id: 'hero', hole: 'Ah Ad' }, { id: 'villain', hole: '9s 9c' }],
      board: 'Ac 7h 2s 3d 4c',
      actions: [
        ['preflop', 'hero', 'post-sb', 25],
        ['preflop', 'villain', 'post-bb', 50],
        ['preflop', 'hero', 'call', 25],
        ['preflop', 'villain', 'check', 0],
        ['flop', 'villain', 'check', 0],
        ['flop', 'hero', 'check', 0],
        ['turn', 'villain', 'check', 0],
        ['turn', 'hero', 'check', 0],
        ['river', 'villain', 'check', 0],
        ['river', 'hero', riverKind, riverKind === 'raise' ? 100 : 0],
        ...(riverKind === 'raise'
          ? ([['river', 'villain', 'call', 100]] as ActionTuple[])
          : ([] as ActionTuple[])),
      ],
      winners: [{ playerId: 'hero', amount: riverKind === 'raise' ? 300 : 100 }],
      showdown: true,
    });

    const bet = deriveHeroHandFacts(build('raise'), 'hero');
    expect(bet.riverValueBetOpportunity).toBe(true);
    expect(bet.riverValueBet).toBe(true);

    const checked = deriveHeroHandFacts(build('check'), 'hero');
    expect(checked.riverValueBetOpportunity).toBe(true);
    expect(checked.riverValueBet).toBe(false);
  });

  it('파산 핸드를 표시한다', () => {
    const record = makeRecord({
      seats: [{ id: 'hero', hole: 'Ah Kh', startingChips: 200 }, { id: 'villain', hole: '9s 9c' }],
      board: 'Qh 7h 2s 3d 4c',
      actions: [
        ['preflop', 'hero', 'post-sb', 25],
        ['preflop', 'villain', 'post-bb', 50],
        ['preflop', 'hero', 'all-in', 200],
        ['preflop', 'villain', 'call', 150],
      ],
      winners: [{ playerId: 'villain', amount: 400 }],
      showdown: true,
    });
    const facts = deriveHeroHandFacts(record, 'hero');
    expect(facts.netChips).toBe(-200);
    expect(facts.bustedThisHand).toBe(true);
    // 올인으로 플랍 액션이 없으면 c벳 기회도 없다
    expect(facts.wasAggressorOnFlop).toBe(true);
    expect(facts.cbetOpportunity).toBe(false);
  });
});

describe('isTopPairOrBetter', () => {
  it('톱페어·오버페어만 통과시킨다', () => {
    expect(isTopPairOrBetter(cards('Ah Kd'), cards('Ac 7h 2s'))).toBe(true);   // 톱페어
    expect(isTopPairOrBetter(cards('Jh Jd'), cards('9c 7h 2s'))).toBe(true);   // 오버페어
    expect(isTopPairOrBetter(cards('7d 2c'), cards('Ac 7h 3s'))).toBe(false);  // 바닥 페어
    expect(isTopPairOrBetter(cards('9h 9d'), cards('Ac 7h 2s'))).toBe(false);  // 언더페어
    expect(isTopPairOrBetter(cards('Ah Kd'), cards('Qc 7h 2s Qd'))).toBe(false); // 보드 페어를 빌린 원페어
    expect(isTopPairOrBetter(cards('7h 7d'), cards('7c 7s 2h'))).toBe(true);   // 쿼드는 무조건
  });
});

describe('objectives', () => {
  it('횟수 목표 — hands-played · win-hands · net-chips(BB 단위 포함)', () => {
    const tally = tallyOf(
      { record: junkFoldHand(1) },
      { record: cbetHand(2) },
    );
    expect(evaluateObjective(objective('hands-played', { target: 2 }), tally, true)).toMatchObject({
      progress: 2, target: 2, achieved: true, primary: true,
    });
    expect(evaluateObjective(objective('hands-played', { target: 3 }), tally, true).achieved).toBe(false);
    expect(evaluateObjective(objective('win-hands', { target: 1 }), tally, false)).toMatchObject({
      progress: 1, achieved: true,
    });

    // 순이익 = -25 + 150 = 125 칩 = 2.5BB
    expect(evaluateObjective(objective('net-chips', { target: 100 }), tally, false)).toMatchObject({
      progress: 125, achieved: true,
    });
    expect(evaluateObjective(objective('net-chips', { target: 2, params: { bb: 50 } }), tally, false)).toMatchObject({
      progress: 2.5, target: 2, achieved: true,
    });
    expect(
      evaluateObjective(objective('net-chips', { target: 3, params: { bb: 50 } }), tally, false).achieved,
    ).toBe(false);
    // 핸드가 없으면 결과형 목표는 판정 불가
    expect(evaluateObjective(objective('net-chips', { target: 0 }), emptyTally(), false).achieved).toBeNull();
  });

  it('fold-preflop-junk — 기회(junk 핸드) 중 실행 비율, target이 있으면 횟수 목표', () => {
    const tally = tallyOf({ record: junkFoldHand(1) }, { record: junkCallHand(2) });
    expect(evaluateObjective(objective('fold-preflop-junk', { minRatio: 0.5 }), tally, true)).toMatchObject({
      progress: 0.5, target: 0.5, achieved: true,
    });
    expect(evaluateObjective(objective('fold-preflop-junk', { minRatio: 1 }), tally, true).achieved).toBe(false);
    expect(evaluateObjective(objective('fold-preflop-junk', { target: 1 }), tally, true)).toMatchObject({
      progress: 1, target: 1, achieved: true,
    });
  });

  it('no-junk-entry — 상한 목표', () => {
    const clean = tallyOf({ record: junkFoldHand(1) }, { record: goodCallButLostHand(2) });
    expect(evaluateObjective(objective('no-junk-entry'), clean, true)).toMatchObject({
      progress: 0, target: 0, achieved: true,
    });

    const dirty = tallyOf({ record: junkCallHand(1) });
    expect(evaluateObjective(objective('no-junk-entry'), dirty, true).achieved).toBe(false);
    expect(evaluateObjective(objective('no-junk-entry', { maxCount: 1 }), dirty, true).achieved).toBe(true);
  });

  it('기회 0인 비율 목표는 판정에서 제외한다 (achieved null)', () => {
    const tally = tallyOf({ record: goodCallButLostHand(1) });
    expect(evaluateObjective(objective('cbet-when-aggressor', { minRatio: 0.67 }), tally, true)).toMatchObject({
      progress: 0, target: null, achieved: null,
    });
    expect(evaluateObjective(objective('value-bet-river', { minRatio: 0.5 }), tally, true).achieved).toBeNull();
    expect(evaluateObjective(objective('fold-preflop-junk', { minRatio: 1 }), tally, true).achieved).toBeNull();
  });

  it('cbet-when-aggressor — 기회 중 실행', () => {
    const tally = tallyOf({ record: cbetHand(1, 'raise') }, { record: cbetHand(2, 'check') });
    expect(evaluateObjective(objective('cbet-when-aggressor', { minRatio: 0.5 }), tally, true)).toMatchObject({
      progress: 0.5, achieved: true,
    });
    expect(
      evaluateObjective(objective('cbet-when-aggressor', { minRatio: 0.67 }), tally, true).achieved,
    ).toBe(false);
  });

  it('correct-pot-odds-call — 벳 대면 가격 결정 전체를 센다', () => {
    const tally = tallyOf({ record: goodCallButLostHand(1) }, { record: junkCallHand(2) });
    expect(evaluateObjective(objective('correct-pot-odds-call', { minRatio: 0.5 }), tally, true)).toMatchObject({
      progress: 0.5, achieved: true,
    });
    expect(
      evaluateObjective(objective('correct-pot-odds-call', { minRatio: 0.8 }), tally, true).achieved,
    ).toBe(false);
  });

  it('survive — 파산이 하나라도 있으면 실패, 핸드가 없으면 판정 불가', () => {
    const alive = tallyOf({ record: goodCallButLostHand(1) });
    expect(evaluateObjective(objective('survive'), alive, true)).toMatchObject({ progress: 1, achieved: true });

    const busted = makeRecord({
      seats: [{ id: 'hero', hole: 'Ah Kh', startingChips: 200 }, { id: 'villain', hole: '9s 9c' }],
      board: 'Qh 7h 2s 3d 4c',
      actions: [
        ['preflop', 'hero', 'post-sb', 25],
        ['preflop', 'villain', 'post-bb', 50],
        ['preflop', 'hero', 'all-in', 200],
        ['preflop', 'villain', 'call', 150],
      ],
      winners: [{ playerId: 'villain', amount: 400 }],
      showdown: true,
    });
    expect(evaluateObjective(objective('survive'), tallyOf({ record: busted }), true).achieved).toBe(false);
    expect(evaluateObjective(objective('survive'), emptyTally(), true).achieved).toBeNull();
  });

  it('quiz-accuracy — 외부 집계가 없으면 판정 불가', () => {
    const tally = tallyOf({ record: goodCallButLostHand(1) });
    const quiz = objective('quiz-accuracy', { minRatio: 0.75 });
    expect(evaluateObjective(quiz, tally, true).achieved).toBeNull();
    expect(evaluateObjective(quiz, tally, true, { quiz: { answered: 4, correct: 3 } })).toMatchObject({
      progress: 0.75, target: 0.75, achieved: true,
    });
    expect(
      evaluateObjective(quiz, tally, true, { quiz: { answered: 4, correct: 2 } }).achieved,
    ).toBe(false);
  });

  it('evaluateObjectives는 primary → bonus 순으로 플래그를 채운다', () => {
    const views = evaluateObjectives(
      {
        primary: [objective('hands-played', { target: 1 })],
        bonus: [objective('net-chips', { target: 0 })],
      },
      tallyOf({ record: cbetHand(1) }),
    );
    expect(views.map(view => [view.kind, view.primary])).toEqual([
      ['hands-played', true],
      ['net-chips', false],
    ]);
  });
});

describe('primaryObjectivesMet · liveScore', () => {
  const view = (over: Partial<ObjectiveProgressView>): ObjectiveProgressView => ({
    id: 'x', kind: 'hands-played', label: 'x', primary: true, progress: 0, target: 1, achieved: true, ...over,
  });

  it('판정 가능한 primary가 모두 달성되면 true, 하나라도 실패면 false', () => {
    expect(primaryObjectivesMet([view({ achieved: true }), view({ achieved: null })])).toBe(true);
    expect(primaryObjectivesMet([view({ achieved: true }), view({ achieved: false })])).toBe(false);
  });

  it('primary가 전부 판정 불가면 null — 통과 판정에서 제외된다', () => {
    expect(primaryObjectivesMet([view({ achieved: null }), view({ achieved: null })])).toBeNull();
    expect(primaryObjectivesMet([view({ primary: false, achieved: false })])).toBeNull();
    expect(primaryObjectivesMet([])).toBeNull();
  });

  it('liveScore는 primary 0.7 / bonus 0.3, 빈 버킷은 재정규화한다', () => {
    expect(liveScore([
      view({ achieved: true }), view({ achieved: false }),
      view({ primary: false, achieved: true }),
    ])).toBeCloseTo(0.5 * 0.7 + 1 * 0.3, 5);

    // primary가 전부 판정 불가 → bonus만으로 100%
    expect(liveScore([
      view({ achieved: null }),
      view({ primary: false, achieved: true }), view({ primary: false, achieved: false }),
    ])).toBeCloseTo(0.5, 5);

    // bonus가 없으면 primary만으로 100%
    expect(liveScore([view({ achieved: true })])).toBe(1);
    expect(liveScore([view({ achieved: null })])).toBe(0);
    expect(liveScore([])).toBe(0);
  });
});

describe('junk 임계', () => {
  it('72o는 junk, AKs는 아니다', () => {
    expect(handPercentile(cards('7c 2d'))).toBeGreaterThan(JUNK_PERCENTILE);
    expect(handPercentile(cards('Ah Kh'))).toBeLessThan(JUNK_PERCENTILE);
  });
});
