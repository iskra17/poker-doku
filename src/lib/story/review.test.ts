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
import { JUNK_PERCENTILE, PREMIUM_PERCENTILE } from './objectives';
import { reviewHand } from './review';

// ---------------------------------------------------------------------------
// 합성 CompletedHandRecord 빌더 (objectives.test.ts와 같은 규칙 — 액션에서 기여금을 유도한다)

type ActionTuple = [Street, string, HandHistoryActionKind, number];

interface RecordInput {
  handNumber?: number;
  seats: Array<{ id: string; hole?: string; startingChips?: number }>;
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

/** 히어로가 프리플랍에 결정만 하고 나머지는 체크로 흘러가는 핸드 (프리플랍 판정 격리용). */
function preflopOnlyHand(hole: string, decision: 'fold' | 'call'): CompletedHandRecord {
  const tail: ActionTuple[] = decision === 'fold'
    ? [
        ['preflop', 'hero', 'fold', 0],
        ['preflop', 'villain', 'uncalled-return', 25],
      ]
    : [
        ['preflop', 'hero', 'call', 25],
        ['preflop', 'villain', 'check', 0],
        ['flop', 'villain', 'check', 0],
        ['flop', 'hero', 'check', 0],
        ['turn', 'villain', 'check', 0],
        ['turn', 'hero', 'check', 0],
        ['river', 'villain', 'check', 0],
        ['river', 'hero', 'check', 0],
      ];
  return makeRecord({
    seats: [{ id: 'hero', hole }, { id: 'villain', hole: '9s 9c' }],
    board: decision === 'fold' ? undefined : 'Qd 7c 2h 3d 4s',
    actions: [
      ['preflop', 'hero', 'post-sb', 25],
      ['preflop', 'villain', 'post-bb', 50],
      ...tail,
    ],
    winners: [{ playerId: 'villain', amount: decision === 'fold' ? 50 : 100 }],
    showdown: decision === 'call',
  });
}

/** 히어로 AKs 플러시 드로우 — 플랍 벳 대면 결정만 바꿔 끼운다. */
function flushDrawHand(bet: number, heroAction: 'call' | 'fold'): CompletedHandRecord {
  const flop: ActionTuple[] = heroAction === 'call'
    ? [
        ['flop', 'villain', 'raise', bet],
        ['flop', 'hero', 'call', bet],
        ['turn', 'villain', 'check', 0],
        ['turn', 'hero', 'check', 0],
        ['river', 'villain', 'check', 0],
        ['river', 'hero', 'check', 0],
      ]
    : [
        ['flop', 'villain', 'raise', bet],
        ['flop', 'hero', 'fold', 0],
        ['flop', 'villain', 'uncalled-return', bet],
      ];
  return makeRecord({
    seats: [{ id: 'hero', hole: 'Ah Kh' }, { id: 'villain', hole: '9s 9c' }],
    board: 'Qh 7h 2s 3d 4c',
    actions: [
      ['preflop', 'hero', 'post-sb', 25],
      ['preflop', 'villain', 'post-bb', 50],
      ['preflop', 'hero', 'call', 25],
      ['preflop', 'villain', 'check', 0],
      ...flop,
    ],
    winners: [{ playerId: 'villain', amount: heroAction === 'call' ? 100 + bet * 2 : 100 }],
    showdown: heroAction === 'call',
  });
}

describe('reviewHand — 진입 조건', () => {
  it('히어로가 딜인되지 않았으면 null', () => {
    expect(reviewHand(preflopOnlyHand('7c 2d', 'fold'), 'ghost')).toBeNull();
  });

  it('블라인드만 내고 액션이 없었으면 null (BB 워크)', () => {
    const walked = makeRecord({
      seats: [{ id: 'hero', hole: 'Ah Kh' }, { id: 'villain', hole: '9s 9c' }],
      actions: [
        ['preflop', 'villain', 'post-sb', 25],
        ['preflop', 'hero', 'post-bb', 50],
        ['preflop', 'villain', 'fold', 0],
        ['preflop', 'hero', 'uncalled-return', 25],
      ],
      winners: [{ playerId: 'hero', amount: 50 }],
    });
    expect(reviewHand(walked, 'hero')).toBeNull();
  });

  it('규칙에 걸리는 자리가 없으면 빈 판정 목록을 돌려준다 (null이 아니다)', () => {
    // 중간 구간 손의 프리플랍 폴드는 포지션에 따라 모두 정당해서 판정하지 않는다.
    const percentile = handPercentile(cards('Ac Td'));
    expect(percentile).toBeGreaterThan(PREMIUM_PERCENTILE);
    expect(percentile).toBeLessThanOrEqual(JUNK_PERCENTILE);

    const review = reviewHand(preflopOnlyHand('Ac Td', 'fold'), 'hero');
    expect(review).not.toBeNull();
    expect(review?.verdicts).toEqual([]);
  });
});

describe('reviewHand — 프리플랍 4구간', () => {
  it('약한 손 폴드는 👍', () => {
    const review = reviewHand(preflopOnlyHand('7c 2d', 'fold'), 'hero');
    expect(review?.verdicts).toHaveLength(1);
    expect(review?.verdicts[0]).toMatchObject({ street: 'preflop', action: 'fold', mark: 'good' });
    expect(review?.verdicts[0].reason).toContain('폴드가 정답');
    expect(review?.verdicts[0].facts).toEqual({});
  });

  it('상위 15% 손 폴드는 ⚠', () => {
    const record = makeRecord({
      seats: [{ id: 'hero', hole: 'Ah Kh' }, { id: 'villain', hole: '9s 9c' }],
      actions: [
        ['preflop', 'villain', 'post-sb', 25],
        ['preflop', 'hero', 'post-bb', 50],
        ['preflop', 'villain', 'raise', 150],
        ['preflop', 'hero', 'fold', 0],
        ['preflop', 'villain', 'uncalled-return', 100],
      ],
      winners: [{ playerId: 'villain', amount: 100 }],
    });
    const review = reviewHand(record, 'hero');
    expect(review?.verdicts).toHaveLength(1);
    expect(review?.verdicts[0]).toMatchObject({ street: 'preflop', action: 'fold', mark: 'warn' });
  });

  it('약한 핸드로 들어가면 ⚠', () => {
    const review = reviewHand(preflopOnlyHand('7c 2d', 'call'), 'hero');
    expect(review?.verdicts).toHaveLength(1);
    expect(review?.verdicts[0]).toMatchObject({ street: 'preflop', action: 'call', mark: 'warn' });
  });

  it('프리미엄으로 들어가면 👍, 경계 구간은 🤔', () => {
    const premium = reviewHand(preflopOnlyHand('Ah Kh', 'call'), 'hero');
    expect(premium?.verdicts[0]).toMatchObject({ mark: 'good', action: 'call' });

    const middle = reviewHand(preflopOnlyHand('Ac Td', 'call'), 'hero');
    expect(middle?.verdicts[0]).toMatchObject({ mark: 'hmm', action: 'call' });
  });
});

describe('reviewHand — 벳 대면 가격 결정', () => {
  it('가격이 맞는 콜은 👍 (진 핸드여도 — 결과 ≠ 결정)', () => {
    const record = flushDrawHand(50, 'call');
    expect(record.players.find(player => player.id === 'hero')?.profit).toBeLessThan(0);

    const review = reviewHand(record, 'hero');
    expect(review?.verdicts.map(verdict => verdict.mark)).toEqual(['good', 'good']);
    const call = review!.verdicts[1];
    expect(call).toMatchObject({ street: 'flop', action: 'call', amount: 50, mark: 'good' });
    expect(call.facts.potOdds).toBeCloseTo(0.25, 5);
    expect(call.facts.equity).toBeGreaterThan(0.5);
    expect(call.facts.outs).toBe(15);
    expect(call.reason).toContain('가격이 맞는 콜');
  });

  it('오즈가 안 맞는 콜은 ⚠', () => {
    const record = makeRecord({
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
    const review = reviewHand(record, 'hero');
    expect(review?.verdicts.map(verdict => verdict.mark)).toEqual(['warn', 'warn']);
    expect(review?.verdicts[1]).toMatchObject({ street: 'flop', action: 'call', mark: 'warn' });
    expect(review?.verdicts[1].reason).toContain('오즈가 맞지 않는 콜');
  });

  it('가격이 안 맞는 자리에서 폴드하면 👍', () => {
    const record = makeRecord({
      seats: [{ id: 'hero', hole: '7c 2d' }, { id: 'villain', hole: '9s 9h' }],
      board: 'Ah Ks Qd',
      actions: [
        ['preflop', 'hero', 'post-sb', 25],
        ['preflop', 'villain', 'post-bb', 50],
        ['preflop', 'hero', 'call', 25],
        ['preflop', 'villain', 'check', 0],
        ['flop', 'villain', 'raise', 150],
        ['flop', 'hero', 'fold', 0],
        ['flop', 'villain', 'uncalled-return', 150],
      ],
      winners: [{ playerId: 'villain', amount: 100 }],
    });
    const review = reviewHand(record, 'hero');
    const fold = review?.verdicts.find(verdict => verdict.street === 'flop');
    expect(fold).toMatchObject({ action: 'fold', amount: 0, mark: 'good' });
    expect(fold?.reason).toContain('폴드가 정답');
  });

  it('오즈가 충분한 드로우를 폴드하면 ⚠', () => {
    const review = reviewHand(flushDrawHand(25, 'fold'), 'hero');
    const fold = review?.verdicts.find(verdict => verdict.street === 'flop');
    expect(fold).toMatchObject({ action: 'fold', mark: 'warn' });
    expect(fold?.facts.potOdds).toBeCloseTo(25 / 150, 5);
    expect(fold?.reason).toContain('오즈가 충분한 자리');
  });
});

describe('reviewHand — 판정 수 상한', () => {
  const record = makeRecord({
    seats: [
      { id: 'hero', hole: 'Ah Kh' },
      { id: 'v1', hole: '9s 9c' },
      { id: 'v2', hole: 'Jd Jc' },
    ],
    board: 'Qh 7h 2s',
    actions: [
      ['preflop', 'v1', 'post-sb', 25],
      ['preflop', 'v2', 'post-bb', 50],
      ['preflop', 'hero', 'call', 50],
      ['preflop', 'v1', 'call', 25],
      ['preflop', 'v2', 'check', 0],
      ['flop', 'v1', 'raise', 25],
      ['flop', 'hero', 'call', 25],
      ['flop', 'v2', 'raise', 300],
      ['flop', 'v1', 'fold', 0],
      ['flop', 'hero', 'fold', 0],
      ['flop', 'v2', 'uncalled-return', 275],
    ],
    winners: [{ playerId: 'v2', amount: 225 }],
  });

  it('기본은 시간순 전체 판정', () => {
    const review = reviewHand(record, 'hero');
    expect(review?.verdicts.map(verdict => [verdict.street, verdict.action, verdict.mark])).toEqual([
      ['preflop', 'call', 'good'],
      ['flop', 'call', 'good'],
      ['flop', 'fold', 'warn'],
    ]);
  });

  it('상한을 넘으면 ⚠ > 🤔 > 👍 순으로 남기고 시간순으로 되돌린다', () => {
    const review = reviewHand(record, 'hero', { maxVerdicts: 2 });
    expect(review?.verdicts.map(verdict => [verdict.street, verdict.action, verdict.mark])).toEqual([
      ['preflop', 'call', 'good'],
      ['flop', 'fold', 'warn'],
    ]);

    expect(reviewHand(record, 'hero', { maxVerdicts: 1 })?.verdicts.map(verdict => verdict.mark)).toEqual(['warn']);
    expect(reviewHand(record, 'hero', { maxVerdicts: 0 })?.verdicts).toEqual([]);
  });
});
