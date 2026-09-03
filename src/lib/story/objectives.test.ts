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
  primaryObjectivesAllAchieved,
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
  /** 기본: 0번 BTN, 나머지 BB — 2막 스틸/3벳 픽스처는 명시한다 */
  position?: string;
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
      position: seat.position ?? (index === 0 ? 'BTN' : 'BB'),
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

/**
 * 언오픈 팟(테이블 벳 = BB)에서 BTN(makeRecord 좌석 0)의 AKo — 오픈 레이즈 기회.
 * mode 'raise'는 실행, 'limp'는 기회를 놓친 림프, 'faced'는 앞에 레이즈가 있어 기회 자체가 아니다.
 */
function openRaiseHand(handNumber: number, mode: 'raise' | 'limp' | 'faced'): CompletedHandRecord {
  if (mode === 'faced') {
    return makeRecord({
      handNumber,
      seats: [{ id: 'hero', hole: 'Ad Kc' }, { id: 'villain', hole: '9s 9c' }],
      actions: [
        ['preflop', 'villain', 'post-sb', 25],
        ['preflop', 'hero', 'post-bb', 50],
        ['preflop', 'villain', 'raise', 150],
        ['preflop', 'hero', 'fold', 0],
        ['preflop', 'villain', 'uncalled-return', 100],
      ],
      winners: [{ playerId: 'villain', amount: 100 }],
    });
  }
  const open: ActionTuple[] = mode === 'raise'
    ? [
        ['preflop', 'hero', 'raise', 150],
        ['preflop', 'villain', 'fold', 0],
        ['preflop', 'hero', 'uncalled-return', 100],
      ]
    : [
        ['preflop', 'hero', 'call', 25],
        ['preflop', 'villain', 'check', 0],
        ['flop', 'villain', 'check', 0],
        ['flop', 'hero', 'check', 0],
      ];
  return makeRecord({
    handNumber,
    seats: [{ id: 'hero', hole: 'Ad Kc' }, { id: 'villain', hole: '9s 9c' }],
    board: mode === 'raise' ? undefined : 'Qh 7h 2s',
    actions: [
      ['preflop', 'hero', 'post-sb', 25],
      ['preflop', 'villain', 'post-bb', 50],
      ...open,
    ],
    winners: [{ playerId: mode === 'raise' ? 'hero' : 'villain', amount: 100 }],
    showdown: mode === 'limp',
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

  it('쇼다운 도달·폴드 사실을 읽는다 (Ch1 미션형 목표의 집계 단위)', () => {
    const folded = deriveHeroHandFacts(junkFoldHand(), 'hero');
    expect(folded.folded).toBe(true);
    expect(folded.sawShowdown).toBe(false);

    const showdown = deriveHeroHandFacts(goodCallButLostHand(), 'hero');
    expect(showdown.folded).toBe(false);
    expect(showdown.sawShowdown).toBe(true);

    // 플랍에서 폴드한 핸드는 쇼다운 플래그가 있어도 "쇼다운까지 간" 핸드가 아니다
    const foldedOnFlop = makeRecord({
      seats: [{ id: 'hero', hole: 'Ah Kh' }, { id: 'villain', hole: '9s 9c' }, { id: 'third', hole: 'Qd Qc' }],
      board: 'Qh 7h 2s 3d 4c',
      actions: [
        ['preflop', 'hero', 'post-sb', 25],
        ['preflop', 'villain', 'post-bb', 50],
        ['preflop', 'third', 'call', 50],
        ['preflop', 'hero', 'call', 25],
        ['preflop', 'villain', 'check', 0],
        ['flop', 'villain', 'raise', 100],
        ['flop', 'third', 'call', 100],
        ['flop', 'hero', 'fold', 0],
      ],
      winners: [{ playerId: 'third', amount: 350 }],
      showdown: true,
    });
    const facts = deriveHeroHandFacts(foldedOnFlop, 'hero');
    expect(facts.folded).toBe(true);
    expect(facts.sawShowdown).toBe(false);
  });

  it('오픈 레이즈 기회 — 언오픈 팟 + 포지션 임계 안 핸드일 때만, 림프는 놓친 기회', () => {
    expect(deriveHeroHandFacts(openRaiseHand(1, 'raise'), 'hero')).toMatchObject({ openRaiseOpportunity: true, openRaise: true });
    expect(deriveHeroHandFacts(openRaiseHand(2, 'limp'), 'hero')).toMatchObject({ openRaiseOpportunity: true, openRaise: false });
    // 앞에 레이즈가 있으면 기회가 아니다
    expect(deriveHeroHandFacts(openRaiseHand(3, 'faced'), 'hero')).toMatchObject({ openRaiseOpportunity: false, openRaise: false });
    // 임계 밖(72o)은 언오픈 팟이어도 기회가 아니다
    expect(deriveHeroHandFacts(junkCallHand(4), 'hero')).toMatchObject({ openRaiseOpportunity: false, openRaise: false });
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

  it('reach-showdown · fold-hands — 미션형 횟수 목표', () => {
    const tally = tallyOf({ record: junkFoldHand(1) }, { record: goodCallButLostHand(2) }, { record: junkFoldHand(3) });
    expect(evaluateObjective(objective('reach-showdown', { target: 1 }), tally, true)).toMatchObject({ progress: 1, target: 1, achieved: true });
    expect(evaluateObjective(objective('fold-hands', { target: 2 }), tally, true)).toMatchObject({ progress: 2, target: 2, achieved: true });
    expect(evaluateObjective(objective('fold-hands', { target: 3 }), tally, true).achieved).toBe(false);
  });

  it('open-raise — 기회 중 실행, target은 실행 횟수이고 기회 0이면 판정 불가', () => {
    const tally = tallyOf({ record: openRaiseHand(1, 'raise') }, { record: openRaiseHand(2, 'limp') }, { record: openRaiseHand(3, 'faced') });
    expect(evaluateObjective(objective('open-raise', { minRatio: 0.5 }), tally, true)).toMatchObject({ progress: 0.5, achieved: true });
    expect(evaluateObjective(objective('open-raise', { target: 1 }), tally, true)).toMatchObject({ progress: 1, target: 1, achieved: true });
    expect(evaluateObjective(objective('open-raise', { target: 2 }), tally, true).achieved).toBe(false);
    // 기회가 한 번도 없었으면 실패가 아니라 판정 불가 — maxHands 상한에서 제외된다
    const noChance = tallyOf({ record: junkFoldHand(1) }, { record: openRaiseHand(2, 'faced') });
    expect(evaluateObjective(objective('open-raise', { target: 1 }), noChance, true)).toMatchObject({ progress: 0, target: 1, achieved: null });
  });

  it('비율형 kind의 maxCount는 위반(기회 − 실행) 상한이다 — Ch3 「오즈 위반 ⚠ 1회 이하」', () => {
    const tally = tallyOf({ record: goodCallButLostHand(1) }, { record: junkCallHand(2) });
    expect(evaluateObjective(objective('correct-pot-odds-call', { maxCount: 1 }), tally, true)).toMatchObject({ progress: 1, target: 1, achieved: true });
    expect(evaluateObjective(objective('correct-pot-odds-call', { maxCount: 0 }), tally, true)).toMatchObject({ progress: 1, target: 0, achieved: false });
    // 기회 0이면 위반 0 — 상한형은 항상 판정 가능
    expect(evaluateObjective(objective('correct-pot-odds-call', { maxCount: 1 }), emptyTally(), true)).toMatchObject({ progress: 0, achieved: true });
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

  it('primaryObjectivesAllAchieved — 조기 종료는 primary 전부 달성일 때만, 판정 불가는 막는다', () => {
    expect(primaryObjectivesAllAchieved([view({ achieved: true }), view({ id: 'y', achieved: true })])).toBe(true);
    expect(primaryObjectivesAllAchieved([view({ achieved: true }), view({ id: 'y', achieved: null })])).toBe(false);
    expect(primaryObjectivesAllAchieved([view({ achieved: true }), view({ id: 'y', achieved: false })])).toBe(false);
    // bonus만 있으면(primary 없음) 끝내지 않는다
    expect(primaryObjectivesAllAchieved([view({ primary: false, achieved: true })])).toBe(false);
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


// ---------------------------------------------------------------------------
// 2막 목표 (Ch4~6) — 림프·스틸·리버 에어/사이징·3벳 대면

describe('2막 사실 추출', () => {
  /** SB 히어로가 언오픈 팟에서 콜(림프) / 레이즈 / 폴드. */
  const sbHand = (kind: 'call' | 'raise' | 'fold', hole = 'Kh Tc') => makeRecord({
    seats: [{ id: 'hero', hole, position: 'SB' }, { id: 'villain', hole: '9s 9c', position: 'BB' }],
    actions: [
      ['preflop', 'hero', 'post-sb', 25],
      ['preflop', 'villain', 'post-bb', 50],
      ['preflop', 'hero', kind, kind === 'call' ? 25 : kind === 'raise' ? 150 : 0],
      ...(kind === 'call' ? ([['preflop', 'villain', 'check', 0]] as ActionTuple[]) : ([['preflop', 'villain', 'fold', 0]] as ActionTuple[])),
    ],
    winners: [{ playerId: kind === 'fold' ? 'villain' : 'hero', amount: 50 }],
  });

  it('언오픈 팟의 콜은 림프, BB 체크·레이즈·폴드는 림프가 아니다', () => {
    expect(deriveHeroHandFacts(sbHand('call'), 'hero').limped).toBe(true);
    expect(deriveHeroHandFacts(sbHand('raise'), 'hero').limped).toBe(false);
    expect(deriveHeroHandFacts(sbHand('fold'), 'hero').limped).toBe(false);
    const bbCheck = makeRecord({
      seats: [{ id: 'villain', hole: '9s 9c', position: 'SB' }, { id: 'hero', hole: 'Kh Tc', position: 'BB' }],
      actions: [
        ['preflop', 'villain', 'post-sb', 25],
        ['preflop', 'hero', 'post-bb', 50],
        ['preflop', 'villain', 'call', 25],
        ['preflop', 'hero', 'check', 0],
      ],
      winners: [{ playerId: 'hero', amount: 100 }],
    });
    expect(deriveHeroHandFacts(bbCheck, 'hero').limped).toBe(false);
  });

  it('스틸 기회는 CO/BTN 언오픈 + 임계 안 핸드에서만 열린다', () => {
    const btn = (hole: string, kind: 'raise' | 'fold' | 'call') => makeRecord({
      seats: [{ id: 'hero', hole, position: 'BTN' }, { id: 'sb', hole: '9s 9c', position: 'SB' }, { id: 'bb', hole: '4d 4c', position: 'BB' }],
      actions: [
        ['preflop', 'sb', 'post-sb', 25],
        ['preflop', 'bb', 'post-bb', 50],
        ['preflop', 'hero', kind, kind === 'raise' ? 125 : kind === 'call' ? 50 : 0],
        ['preflop', 'sb', 'fold', 0],
        ['preflop', 'bb', 'fold', 0],
      ],
      winners: [{ playerId: kind === 'fold' ? 'bb' : 'hero', amount: 75 }],
    });
    const steal = deriveHeroHandFacts(btn('Kh Tc', 'raise'), 'hero');
    expect(steal.stealOpportunity).toBe(true);
    expect(steal.stealOpen).toBe(true);
    expect(steal.openRaiseOpportunity).toBe(true);

    const missed = deriveHeroHandFacts(btn('Kh Tc', 'call'), 'hero');
    expect(missed.stealOpportunity).toBe(true);
    expect(missed.stealOpen).toBe(false);
    expect(missed.limped).toBe(true);

    // 72o는 BTN 임계(35%) 밖 — 기회 자체가 없다
    const junk = deriveHeroHandFacts(btn('7c 2d', 'fold'), 'hero');
    expect(junk.stealOpportunity).toBe(false);

    // SB 언오픈은 오픈 기회지만 스틸 기회로는 세지 않는다
    const sb = deriveHeroHandFacts(sbHand('raise'), 'hero');
    expect(sb.openRaiseOpportunity).toBe(true);
    expect(sb.stealOpportunity).toBe(false);
  });

  it('오픈을 맞은 프리미엄은 3벳 기회, 3벳하면 실행', () => {
    const faced = (hole: string, kind: 'raise' | 'call' | 'fold') => makeRecord({
      seats: [{ id: 'villain', hole: '9s 9c', position: 'SB' }, { id: 'hero', hole, position: 'BB' }],
      actions: [
        ['preflop', 'villain', 'post-sb', 25],
        ['preflop', 'hero', 'post-bb', 50],
        ['preflop', 'villain', 'raise', 150],
        ['preflop', 'hero', kind, kind === 'raise' ? 450 : kind === 'call' ? 100 : 0],
        ...(kind === 'raise' ? ([['preflop', 'villain', 'fold', 0], ['preflop', 'hero', 'uncalled-return', 300]] as ActionTuple[]) : []),
      ],
      winners: [{ playerId: kind === 'fold' ? 'villain' : 'hero', amount: 300 }],
    });
    const threeBet = deriveHeroHandFacts(faced('As Ah', 'raise'), 'hero');
    expect(threeBet.facedOpen).toBe(true);
    expect(threeBet.premiumThreeBetOpportunity).toBe(true);
    expect(threeBet.premiumThreeBet).toBe(true);
    expect(threeBet.openRaiseOpportunity).toBe(false);

    const flat = deriveHeroHandFacts(faced('As Ah', 'call'), 'hero');
    expect(flat.premiumThreeBetOpportunity).toBe(true);
    expect(flat.premiumThreeBet).toBe(false);

    // 7-2o는 프리미엄이 아니라 기회가 없다
    const junk = deriveHeroHandFacts(faced('7c 2d', 'fold'), 'hero');
    expect(junk.facedOpen).toBe(true);
    expect(junk.premiumThreeBetOpportunity).toBe(false);
  });

  it('내 오픈이 3벳을 맞으면 3구간 — 하위 폴드는 실행, 하위 4벳은 위반', () => {
    const vsThreeBet = (hole: string, kind: 'fold' | 'call' | 'raise') => makeRecord({
      seats: [{ id: 'hero', hole, position: 'CO' }, { id: 'villain', hole: 'Qs Qc', position: 'BTN' }, { id: 'sb', hole: '4d 4c', position: 'SB' }, { id: 'bb', hole: '5d 5c', position: 'BB' }],
      actions: [
        ['preflop', 'sb', 'post-sb', 25],
        ['preflop', 'bb', 'post-bb', 50],
        ['preflop', 'hero', 'raise', 150],
        ['preflop', 'villain', 'raise', 450],
        ['preflop', 'sb', 'fold', 0],
        ['preflop', 'bb', 'fold', 0],
        ['preflop', 'hero', kind, kind === 'raise' ? 1000 : kind === 'call' ? 300 : 0],
        ...(kind === 'raise' ? ([['preflop', 'villain', 'fold', 0], ['preflop', 'hero', 'uncalled-return', 550]] as ActionTuple[]) : []),
        ...(kind === 'fold' ? ([['preflop', 'villain', 'uncalled-return', 300]] as ActionTuple[]) : []),
      ],
      winners: [{ playerId: kind === 'fold' ? 'villain' : 'hero', amount: 375 }],
    });
    // A♦T♣(19.3%)는 콜 구간(8%) 밖 — 폴드가 정답
    const fold = deriveHeroHandFacts(vsThreeBet('Ad Tc', 'fold'), 'hero');
    expect(fold.facedThreeBet).toBe(true);
    expect(fold.junkVsThreeBet).toBe(true);
    expect(fold.foldedVsThreeBet).toBe(true);
    expect(fold.junkFourBet).toBe(false);

    const fourBet = deriveHeroHandFacts(vsThreeBet('Ad Tc', 'raise'), 'hero');
    expect(fourBet.facedThreeBet).toBe(true);
    expect(fourBet.foldedVsThreeBet).toBe(false);
    expect(fourBet.junkFourBet).toBe(true);

    // AA로 4벳은 위반이 아니고, T♠T♦(4.1%)는 콜 구간이라 하위가 아니다
    expect(deriveHeroHandFacts(vsThreeBet('As Ah', 'raise'), 'hero').junkFourBet).toBe(false);
    const tens = deriveHeroHandFacts(vsThreeBet('Ts Td', 'call'), 'hero');
    expect(tens.facedThreeBet).toBe(true);
    expect(tens.junkVsThreeBet).toBe(false);

    // 3벳을 맞지 않은 오픈은 아무 3벳 사실도 없다
    expect(deriveHeroHandFacts(openRaiseHand(1, 'raise'), 'hero').facedThreeBet).toBe(false);
  });

  it('리버 밸류벳 크기(%)와 에어 벳을 구분한다', () => {
    const river = (hole: string, betAmount: number) => makeRecord({
      seats: [{ id: 'hero', hole: hole }, { id: 'villain', hole: '9s 9c' }],
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
        ['river', 'hero', 'raise', betAmount],
        ['river', 'villain', 'fold', 0],
        ['river', 'hero', 'uncalled-return', betAmount],
      ],
      winners: [{ playerId: 'hero', amount: 100 }],
    });
    // 팟 100에 75 벳 = 75% — 밸류벳(AA 탑페어+)
    const big = deriveHeroHandFacts(river('Ah Ad', 75), 'hero');
    expect(big.riverValueBet).toBe(true);
    expect(big.riverValueBetPct).toBe(75);
    expect(big.riverAirBet).toBe(false);
    const small = deriveHeroHandFacts(river('Ah Ad', 25), 'hero');
    expect(small.riverValueBetPct).toBe(25);
    // K♥Q♥는 A-7-2-3-4에서 아무것도 없다 — 에어 벳
    const air = deriveHeroHandFacts(river('Kh Qh', 50), 'hero');
    expect(air.riverValueBet).toBe(false);
    expect(air.riverAirBet).toBe(true);
    expect(air.riverValueBetPct).toBeNull();
  });
});

describe('2막 목표 판정', () => {
  const riverValue = (hole: string, betAmount: number) => makeRecord({
    seats: [{ id: 'hero', hole }, { id: 'villain', hole: '9s 9c' }],
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
      ['river', 'hero', 'raise', betAmount],
      ['river', 'villain', 'fold', 0],
      ['river', 'hero', 'uncalled-return', betAmount],
    ],
    winners: [{ playerId: 'hero', amount: 100 }],
  });

  it('no-limp / no-air-river-bet / no-junk-4bet은 위반 상한형', () => {
    const limp = openRaiseHand(1, 'limp');
    const tally = tallyOf({ record: limp }, { record: openRaiseHand(2, 'raise') });
    expect(evaluateObjective(objective('no-limp', { maxCount: 0 }), tally, true).achieved).toBe(false);
    expect(evaluateObjective(objective('no-limp', { maxCount: 1 }), tally, true).achieved).toBe(true);
    expect(evaluateObjective(objective('no-limp'), emptyTally(), true).achieved).toBe(true);

    const air = tallyOf({ record: riverValue('Kh Qh', 50) });
    expect(evaluateObjective(objective('no-air-river-bet', { maxCount: 0 }), air, true).achieved).toBe(false);
    expect(evaluateObjective(objective('no-air-river-bet', { maxCount: 1 }), air, true).achieved).toBe(true);
  });

  it('value-bet-sizing은 밸류벳 중 팟 50% 이상 비율 — 밸류벳이 없으면 판정 불가', () => {
    const tally = tallyOf({ record: riverValue('Ah Ad', 75) }, { record: riverValue('Ah Ad', 25) });
    const half = evaluateObjective(objective('value-bet-sizing', { minRatio: 0.5 }), tally, true);
    expect(half.achieved).toBe(true);
    const all = evaluateObjective(objective('value-bet-sizing', { minRatio: 1 }), tally, true);
    expect(all.achieved).toBe(false);
    expect(evaluateObjective(objective('value-bet-sizing', { minRatio: 0.5 }), emptyTally(), true).achieved).toBeNull();
    // 에어 벳은 밸류벳 기회에 들어가지 않는다
    expect(evaluateObjective(objective('value-bet-sizing', { minRatio: 1 }), tallyOf({ record: riverValue('Kh Qh', 50) }), true).achieved).toBeNull();
  });

  it('steal-open · premium-3bet · fold-vs-3bet-junk는 기회 중 실행', () => {
    const btnSteal = (kind: 'raise' | 'fold') => makeRecord({
      seats: [{ id: 'hero', hole: 'Kh Tc', position: 'BTN' }, { id: 'sb', hole: '9s 9c', position: 'SB' }, { id: 'bb', hole: '4d 4c', position: 'BB' }],
      actions: [
        ['preflop', 'sb', 'post-sb', 25],
        ['preflop', 'bb', 'post-bb', 50],
        ['preflop', 'hero', kind, kind === 'raise' ? 125 : 0],
        ['preflop', 'sb', 'fold', 0],
        ['preflop', 'bb', 'fold', 0],
      ],
      winners: [{ playerId: kind === 'fold' ? 'bb' : 'hero', amount: 75 }],
    });
    const steals = tallyOf({ record: btnSteal('raise') }, { record: btnSteal('raise') }, { record: btnSteal('fold') });
    const twoThirds = evaluateObjective(objective('steal-open', { minRatio: 2 / 3 }), steals, true);
    expect(twoThirds.achieved).toBe(true);
    expect(twoThirds.progress).toBeCloseTo(2 / 3);
    expect(evaluateObjective(objective('steal-open', { target: 3 }), steals, true).achieved).toBe(false);
    expect(evaluateObjective(objective('steal-open', { target: 1 }), emptyTally(), true).achieved).toBeNull();

    const premium = tallyOf({ record: makeRecord({
      seats: [{ id: 'villain', hole: '9s 9c', position: 'SB' }, { id: 'hero', hole: 'As Ah', position: 'BB' }],
      actions: [
        ['preflop', 'villain', 'post-sb', 25],
        ['preflop', 'hero', 'post-bb', 50],
        ['preflop', 'villain', 'raise', 150],
        ['preflop', 'hero', 'raise', 450],
        ['preflop', 'villain', 'fold', 0],
        ['preflop', 'hero', 'uncalled-return', 300],
      ],
      winners: [{ playerId: 'hero', amount: 300 }],
    }) });
    expect(evaluateObjective(objective('premium-3bet', { target: 1 }), premium, true).achieved).toBe(true);

    // 히어로(CO)가 언오픈 팟을 열고 BTN이 3벳 — 폴드 2회·콜 1회
    const vsThreeBet = (kind: 'fold' | 'call') => makeRecord({
      seats: [{ id: 'hero', hole: 'Ad Tc', position: 'CO' }, { id: 'villain', hole: 'Qs Qc', position: 'BTN' }, { id: 'sb', hole: '4d 4c', position: 'SB' }, { id: 'bb', hole: '5d 5c', position: 'BB' }],
      actions: [
        ['preflop', 'sb', 'post-sb', 25],
        ['preflop', 'bb', 'post-bb', 50],
        ['preflop', 'hero', 'raise', 150],
        ['preflop', 'villain', 'raise', 450],
        ['preflop', 'sb', 'fold', 0],
        ['preflop', 'bb', 'fold', 0],
        ['preflop', 'hero', kind, kind === 'call' ? 300 : 0],
        ...(kind === 'fold' ? ([['preflop', 'villain', 'uncalled-return', 300]] as ActionTuple[]) : []),
      ],
      winners: [{ playerId: 'villain', amount: 375 }],
    });
    const folds = tallyOf({ record: vsThreeBet('fold') }, { record: vsThreeBet('fold') }, { record: vsThreeBet('call') });
    const seventy = evaluateObjective(objective('fold-vs-3bet-junk', { minRatio: 0.7 }), folds, true);
    expect(seventy.achieved).toBe(false);
    expect(seventy.progress).toBeCloseTo(2 / 3);
    expect(evaluateObjective(objective('fold-vs-3bet-junk', { minRatio: 0.6 }), folds, true).achieved).toBe(true);
    expect(evaluateObjective(objective('no-junk-4bet'), folds, true).achieved).toBe(true);
  });
});

describe('헤즈업(2인) 포지션 라벨 — Ch6 보스 팽팽', () => {
  // positionLabels(2)는 'BTN/SB'·'BB'라 OPEN_THRESHOLDS에 없다. 3벳 3구간 사실은 포지션 무관이어야 Ch6 primary가 헤즈업에서 집계된다.
  it('BB에서 BTN/SB 오픈을 맞은 프리미엄은 3벳 기회로 잡힌다', () => {
    const faced = (hole: string, kind: 'raise' | 'call') => makeRecord({
      seats: [{ id: 'hero', hole, position: 'BB' }, { id: 'paeng', hole: '9s 9c', position: 'BTN/SB' }],
      actions: [
        ['preflop', 'paeng', 'post-sb', 25],
        ['preflop', 'hero', 'post-bb', 50],
        ['preflop', 'paeng', 'raise', 150],
        ['preflop', 'hero', kind, kind === 'raise' ? 450 : 100],
        ...(kind === 'raise' ? ([['preflop', 'paeng', 'fold', 0], ['preflop', 'hero', 'uncalled-return', 300]] as ActionTuple[]) : []),
      ],
      winners: [{ playerId: 'hero', amount: 300 }],
    });
    const threeBet = deriveHeroHandFacts(faced('Ks Kh', 'raise'), 'hero');
    expect(threeBet.facedOpen).toBe(true);
    expect(threeBet.premiumThreeBetOpportunity).toBe(true);
    expect(threeBet.premiumThreeBet).toBe(true);
    expect(deriveHeroHandFacts(faced('Ks Kh', 'call'), 'hero').premiumThreeBet).toBe(false);
  });

  it('BTN/SB에서 오픈이 3벳을 맞으면 3구간이 잡히고, 오픈/스틸 기회는 헤즈업 라벨이라 세지 않는다', () => {
    const vsThreeBet = (hole: string, kind: 'fold' | 'raise') => makeRecord({
      seats: [{ id: 'hero', hole, position: 'BTN/SB' }, { id: 'paeng', hole: 'Qs Qc', position: 'BB' }],
      actions: [
        ['preflop', 'hero', 'post-sb', 25],
        ['preflop', 'paeng', 'post-bb', 50],
        ['preflop', 'hero', 'raise', 150],
        ['preflop', 'paeng', 'raise', 450],
        ['preflop', 'hero', kind, kind === 'raise' ? 1000 : 0],
        ...(kind === 'raise' ? ([['preflop', 'paeng', 'fold', 0], ['preflop', 'hero', 'uncalled-return', 550]] as ActionTuple[]) : []),
        ...(kind === 'fold' ? ([['preflop', 'paeng', 'uncalled-return', 300]] as ActionTuple[]) : []),
      ],
      winners: [{ playerId: kind === 'fold' ? 'paeng' : 'hero', amount: 300 }],
    });
    const fold = deriveHeroHandFacts(vsThreeBet('Ad Tc', 'fold'), 'hero');
    expect(fold.facedThreeBet).toBe(true);
    expect(fold.junkVsThreeBet).toBe(true);
    expect(fold.foldedVsThreeBet).toBe(true);
    expect(fold.openRaiseOpportunity).toBe(false);
    expect(fold.stealOpportunity).toBe(false);
    const fourBet = deriveHeroHandFacts(vsThreeBet('Ad Tc', 'raise'), 'hero');
    expect(fourBet.junkFourBet).toBe(true);

    // Ch6 primary 3종은 헤즈업 사실만으로 판정된다
    const tally = tallyOf({ record: vsThreeBet('Ad Tc', 'fold') }, { record: vsThreeBet('Ad Tc', 'fold') });
    const results = evaluateObjectives({
      primary: [
        { id: 'fold-junk', kind: 'fold-vs-3bet-junk', label: '폴드', minRatio: 0.7 },
        { id: 'no-4bet', kind: 'no-junk-4bet', label: '4벳 0', maxCount: 0 },
      ],
      bonus: [],
    }, tally);
    expect(results.map(view => [view.id, view.achieved])).toEqual([['fold-junk', true], ['no-4bet', true]]);
  });
});
