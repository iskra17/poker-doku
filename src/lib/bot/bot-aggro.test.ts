import { describe, it, expect } from 'vitest';
import { decideBotAction, loosenPreflopRange, AGGRO_SHOVE_TRIGGER, AGGRO_SHOVE_HEAVY, AGGRO_RAISE_TRIGGER } from './bot-ai';
import { AggroTracker, AGGRO_WINDOW_HANDS } from './aggro-tracker';
import { BOT_PERSONALITIES } from './personalities';
import { handPercentile } from './hand-rankings';
import { makePlayer, cards } from '../poker/test-helpers';
import { GameState, ActionType } from '../poker/types';

/**
 * 상습 쇼버/레이저 대응 (특별 케이스 익스플로잇) 계약:
 * - 기본 전략(노리드)은 큰 커밋에 폴드가 맞다 — aggro 미전달 시 기존 결정론 유지.
 * - 상대의 최근 윈도우 쇼브가 트리거(3회)를 넘으면 강한 핸드(티어3+)로 맞서고,
 *   헤비(5회)면 플레이어블(티어2+)까지 넓힌다. 잡핸드는 여전히 접는다.
 * - 상습 레이저(6회+)에겐 컨티뉴 레인지를 넓히고 폴드 성향을 반감한다.
 * - 포스트플랍: 상습 쇼버의 큰 커밋 압박엔 톱페어급(0.5+)으로 블러프캐치.
 */

function state(partial: Partial<GameState> = {}): GameState {
  return {
    id: 'test',
    players: [],
    communityCards: [],
    pots: [{ amount: 30, eligiblePlayerIds: [] }],
    currentBet: 20,
    minRaise: 20,
    street: 'preflop',
    dealerIndex: 0,
    activePlayerIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    isHandInProgress: true,
    winners: null,
    handRake: 0,
    lastAction: null,
    turnTimer: 30,
    handNumber: 1,
    actionSeq: 0,
    ...partial,
  };
}

const FOLD_OR_CALL: ActionType[] = ['fold', 'call'];
const rngAt = (v: number) => () => v;

describe('AggroTracker — 윈도우 집계', () => {
  it('윈도우 내 쇼브/레이즈를 구분 집계한다', () => {
    const t = new AggroTracker();
    t.record('u1', 'shove', 1);
    t.record('u1', 'shove', 2);
    t.record('u1', 'raise', 3);
    expect(t.stats('u1', 3)).toEqual({ shoves: 2, raises: 1 });
    expect(t.stats('unknown', 3)).toEqual({ shoves: 0, raises: 0 });
  });

  it('윈도우보다 오래된 이벤트는 잊는다 (영구 낙인 방지)', () => {
    const t = new AggroTracker();
    t.record('u1', 'shove', 1);
    t.record('u1', 'shove', 2);
    expect(t.stats('u1', 2).shoves).toBe(2);
    expect(t.stats('u1', 2 + AGGRO_WINDOW_HANDS + 1).shoves).toBe(0);
  });

  it('remove로 특정 플레이어 기록을 지운다', () => {
    const t = new AggroTracker();
    t.record('u1', 'shove', 1);
    t.remove('u1');
    expect(t.stats('u1', 1).shoves).toBe(0);
  });
});

describe('프리플랍 — 상습 쇼버에 맞서기', () => {
  // 100BB 딥스택이 100BB 쇼브를 직면 (commitFrac 1.0 ≥ 0.4 → 기본은 프리미엄 외 폴드)
  const shoveState = () => state({
    currentBet: 2000,
    pots: [{ amount: 2030, eligiblePlayerIds: [] }],
  });
  const bot = (hole: string) => makePlayer('bot', 2000, 0, {
    type: 'bot', personalityId: 'hana', holeCards: cards(hole),
  });

  it('aggro 미전달(기본 전략): 강한 핸드(JJ)도 쇼브에 폴드 — 기존 결정론 유지', () => {
    expect(decideBotAction(bot('Js Jd'), shoveState(), FOLD_OR_CALL, rngAt(0.5)).action).toBe('fold');
  });

  it('쇼브 트리거(3회)부터 강한 핸드(티어3: JJ)로 콜, 플레이어블(99)은 아직 폴드', () => {
    const aggro = { shoves: AGGRO_SHOVE_TRIGGER, raises: 0 };
    expect(decideBotAction(bot('Js Jd'), shoveState(), FOLD_OR_CALL, rngAt(0.5), aggro).action).toBe('call');
    expect(decideBotAction(bot('9s 9d'), shoveState(), FOLD_OR_CALL, rngAt(0.5), aggro).action).toBe('fold');
  });

  it('쇼브 헤비(5회)면 플레이어블(티어2: 99)까지 콜, 잡핸드(72o)는 여전히 폴드', () => {
    const aggro = { shoves: AGGRO_SHOVE_HEAVY, raises: 0 };
    expect(decideBotAction(bot('9s 9d'), shoveState(), FOLD_OR_CALL, rngAt(0.5), aggro).action).toBe('call');
    expect(decideBotAction(bot('7s 2d'), shoveState(), FOLD_OR_CALL, rngAt(0.5), aggro).action).toBe('fold');
  });

  it('한두 번의 쇼브(트리거 미만)는 기본 전략대로 접는다', () => {
    const aggro = { shoves: AGGRO_SHOVE_TRIGGER - 1, raises: 0 };
    expect(decideBotAction(bot('Js Jd'), shoveState(), FOLD_OR_CALL, rngAt(0.5), aggro).action).toBe('fold');
  });
});

describe('프리플랍 — 상습 레이저에 컨티뉴 레인지 확대', () => {
  it('평소엔 접던 마지널 핸드를 상습 레이저(6회+) 상대로는 콜한다', () => {
    const base = BOT_PERSONALITIES['hana'];
    BOT_PERSONALITIES['test-aggro'] = { ...base, id: 'test-aggro', threeBet: 2, coldCall: 3, wtsd: 0 };
    try {
      // 컨티뉴 레인지 5% → 폴드 완화 계층 적용 52.5% — Q4o(≈72%)가 기본 밖·
      // 상습 레이저 확대 레인지(×1.5 = 78.75%) 안에 있어야 유효
      const hole = cards('Qh 4d');
      const pct = handPercentile(hole);
      const baseRange = loosenPreflopRange((2 + 3) / 100);
      expect(pct).toBeGreaterThan(baseRange);
      expect(pct).toBeLessThanOrEqual(baseRange * 1.5);

      const st = state({ currentBet: 60, pots: [{ amount: 90, eligiblePlayerIds: [] }] }); // 3BB 오픈
      const bot = makePlayer('bot', 2000, 0, {
        type: 'bot', personalityId: 'test-aggro', holeCards: hole,
      });
      expect(decideBotAction(bot, st, FOLD_OR_CALL, rngAt(0.99)).action).toBe('fold');
      expect(
        decideBotAction(bot, st, FOLD_OR_CALL, rngAt(0.99), { shoves: 0, raises: AGGRO_RAISE_TRIGGER }).action,
      ).toBe('call');
    } finally {
      delete BOT_PERSONALITIES['test-aggro'];
    }
  });
});

describe('포스트플랍 — 상습 쇼버 압박에 블러프캐치', () => {
  it('톱페어(0.5+)로 큰 커밋 압박: 기본은 폴드, 상습 쇼버에겐 콜', () => {
    // A♠K♦ + A♥7♣2♦ 플랍 = 톱페어 톱키커 (strength ≈ 0.62)
    const st = state({
      street: 'flop',
      communityCards: cards('Ah 7c 2d'),
      currentBet: 1500,
      pots: [{ amount: 500, eligiblePlayerIds: [] }],
    });
    const bot = makePlayer('bot', 2000, 0, {
      type: 'bot', personalityId: 'hana', holeCards: cards('As Kd'),
    });
    expect(decideBotAction(bot, st, FOLD_OR_CALL, rngAt(0.5)).action).toBe('fold');
    expect(
      decideBotAction(bot, st, FOLD_OR_CALL, rngAt(0.5), { shoves: AGGRO_SHOVE_TRIGGER, raises: 0 }).action,
    ).toBe('call');
  });
});
