import { describe, it, expect } from 'vitest';
import {
  explainBotDecision,
  explainForcedAction,
  BOT_EXPLANATION_TEXTS,
  type BotExplanationCode,
} from './bot-explain';
import type { BotDecision } from './bot-ai';
import { makePlayer, cards } from '../poker/test-helpers';
import { GameState, Player } from '../poker/types';

/**
 * 봇 속마음 분류 검증 (Phase 1b.4).
 * - 봇이 실제로 고른 액션 → 이유 코드 + 대사 (순수·결정론, Math.random 금지)
 * - 대사에는 카드·랭크·수트가 절대 들어가지 않는다 (스토리 방 유일 휴먼에게만 가는 정보)
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

/** 좌석 n개짜리 라인업 — 포지션(스틸) 판정용 */
function lineup(n: number, chips = 2000): Player[] {
  return Array.from({ length: n }, (_, i) =>
    makePlayer(`p${i + 1}`, chips, i, { type: 'bot', status: 'active' }),
  );
}

function bot(hole: string, overrides: Partial<Player> = {}): Player {
  return makePlayer('bot1', 2000, 0, {
    type: 'bot',
    status: 'active',
    holeCards: cards(hole),
    ...overrides,
  });
}

const D = (action: BotDecision['action'], amount = 0): BotDecision => ({ action, amount });

const FLOP_STATE = (partial: Partial<GameState> = {}) =>
  state({ street: 'flop', pots: [{ amount: 200, eligiblePlayerIds: [] }], currentBet: 0, ...partial });

describe('프리플랍 분류', () => {
  it('프리미엄 레이즈는 premium-open', () => {
    const p = bot('As Ad');
    expect(explainBotDecision({ player: p, state: state({ players: [p] }), decision: D('raise', 60) }).code)
      .toBe('premium-open');
  });

  it('중간권 핸드 레이즈는 speculative-open', () => {
    const p = bot('7s 6s');
    expect(explainBotDecision({ player: p, state: state({ players: [p] }), decision: D('raise', 60) }).code)
      .toBe('speculative-open');
  });

  it('버튼에서 오픈 팟을 약한 패로 레이즈하면 steal', () => {
    const seats = lineup(4);
    const p = { ...seats[0], holeCards: cards('Kd 9c') };
    seats[0] = p;
    const s = state({ players: seats, dealerIndex: 0, currentBet: 20 }); // 버튼(seat 0) · 미개봉 팟
    expect(explainBotDecision({ player: p, state: s, decision: D('raise', 60) }).code).toBe('steal');
  });

  it('얼리 포지션에서 같은 약한 패로 레이즈하면 bluff', () => {
    const seats = lineup(4);
    const p = { ...seats[2], holeCards: cards('Kd 9c') };
    seats[2] = p;
    const s = state({ players: seats, dealerIndex: 0, currentBet: 20 });
    expect(explainBotDecision({ player: p, state: s, decision: D('raise', 60) }).code).toBe('bluff');
  });

  it('블라인드 좌석이 레이즈에 콜하면 defend-blind', () => {
    const p = bot('Ah 5h', { currentBet: 20 });
    const s = state({ players: [p], currentBet: 60, bigBlindId: p.id });
    expect(explainBotDecision({ player: p, state: s, decision: D('call', 40) }).code).toBe('defend-blind');
  });

  it('레이즈 없는 상황의 저가 콜은 limp', () => {
    const p = bot('Ts 9s', { currentBet: 10 });
    const s = state({ players: [p], currentBet: 20, smallBlindId: p.id });
    expect(explainBotDecision({ player: p, state: s, decision: D('call', 10) }).code).toBe('limp');
  });

  it('블라인드가 아닌 좌석의 레이즈 콜은 priced-call', () => {
    const p = bot('Ts 9s');
    const s = state({ players: [p], currentBet: 60 });
    expect(explainBotDecision({ player: p, state: s, decision: D('call', 60) }).code).toBe('priced-call');
  });

  it('폴드는 fold-weak', () => {
    const p = bot('8h 3d');
    expect(explainBotDecision({ player: p, state: state({ players: [p] }), decision: D('fold') }).code)
      .toBe('fold-weak');
  });

  it('프리플랍 체크는 강하면 trap, 아니면 check-back', () => {
    const strong = bot('As Ad', { currentBet: 20 });
    const weak = bot('8h 3d', { currentBet: 20 });
    const s = state({ players: [strong] });
    expect(explainBotDecision({ player: strong, state: s, decision: D('check') }).code).toBe('trap');
    expect(explainBotDecision({ player: weak, state: s, decision: D('check') }).code).toBe('check-back');
  });

  it('숏스택(10BB 이하) 올인은 shove-short, 딥스택 프리미엄 올인은 commit-deep', () => {
    const short = bot('Ts 9s', { chips: 200 }); // 200/20 = 10BB
    const deep = bot('As Ad', { chips: 2000 });
    const s = state({ players: [short] });
    expect(explainBotDecision({ player: short, state: s, decision: D('all-in') }).code).toBe('shove-short');
    expect(explainBotDecision({ player: deep, state: s, decision: D('all-in') }).code).toBe('commit-deep');
  });
});

describe('포스트플랍 분류', () => {
  it('셋으로 벳/레이즈하면 value-bet', () => {
    const p = bot('As Ad');
    const s = FLOP_STATE({ players: [p], communityCards: cards('Ah 7c 2d') });
    expect(explainBotDecision({ player: p, state: s, decision: D('raise', 120) }).code).toBe('value-bet');
  });

  it('플러시 드로우로 벳하면 semi-bluff', () => {
    const p = bot('Ks Qs');
    const s = FLOP_STATE({ players: [p], communityCards: cards('9s 4s 2h') });
    expect(explainBotDecision({ player: p, state: s, decision: D('raise', 120) }).code).toBe('semi-bluff');
  });

  it('메이드도 드로우도 없이 벳하면 bluff', () => {
    const p = bot('7h 2c');
    const s = FLOP_STATE({ players: [p], communityCards: cards('As Kd 9c') });
    expect(explainBotDecision({ player: p, state: s, decision: D('raise', 120) }).code).toBe('bluff');
  });

  it('강한 패로 체크하면 trap, 약한 패로 체크하면 check-back', () => {
    const strong = bot('As Ad');
    const weak = bot('7h 2c');
    expect(explainBotDecision({
      player: strong,
      state: FLOP_STATE({ players: [strong], communityCards: cards('Ah 7c 2d') }),
      decision: D('check'),
    }).code).toBe('trap');
    expect(explainBotDecision({
      player: weak,
      state: FLOP_STATE({ players: [weak], communityCards: cards('As Kd 9c') }),
      decision: D('check'),
    }).code).toBe('check-back');
  });

  it('드로우로 콜하면 draw-chase', () => {
    const p = bot('Ks Qs');
    const s = FLOP_STATE({ players: [p], communityCards: cards('9s 4s 2h'), currentBet: 100 });
    expect(explainBotDecision({ player: p, state: s, decision: D('call', 100) }).code).toBe('draw-chase');
  });

  it('같은 톱페어라도 콜 값이 싸면 priced-call, 비싸면 bluff-catch', () => {
    const p = bot('Kh Qd');
    const board = cards('Kc 7c 2d');
    const cheap = FLOP_STATE({ players: [p], communityCards: board, currentBet: 40 });
    const pricey = FLOP_STATE({
      players: [p],
      communityCards: board,
      pots: [{ amount: 100, eligiblePlayerIds: [] }],
      currentBet: 80,
    });
    expect(explainBotDecision({ player: p, state: cheap, decision: D('call', 40) }).code).toBe('priced-call');
    expect(explainBotDecision({ player: p, state: pricey, decision: D('call', 80) }).code).toBe('bluff-catch');
  });

  it('톱페어로 큰 벳에 접으면 fold-to-pressure, 에어로 접으면 fold-weak', () => {
    const pair = bot('Kh Qd');
    const air = bot('7h 2c');
    const big = (player: Player, board: string) => FLOP_STATE({
      players: [player],
      communityCards: cards(board),
      pots: [{ amount: 100, eligiblePlayerIds: [] }],
      currentBet: 100,
    });
    expect(explainBotDecision({ player: pair, state: big(pair, 'Kc 7c 2d'), decision: D('fold') }).code)
      .toBe('fold-to-pressure');
    expect(explainBotDecision({ player: air, state: big(air, 'As Kd 9c'), decision: D('fold') }).code)
      .toBe('fold-weak');
  });

  it('작은 벳에 톱페어로 접으면 fold-weak (압박이 아니다)', () => {
    const p = bot('Kh Qd');
    const s = FLOP_STATE({ players: [p], communityCards: cards('Kc 7c 2d'), currentBet: 40 });
    expect(explainBotDecision({ player: p, state: s, decision: D('fold') }).code).toBe('fold-weak');
  });

  it('올인은 스택 깊이·강도 순으로 shove-short → commit-deep → value-bet → bluff', () => {
    const board = cards('Ah Ac 2d');
    const shortStack = bot('7h 3c', { chips: 200 });
    const quads = bot('As Ad');
    const trips = bot('Kh Kd');
    const air = bot('7h 3c');
    const s = (player: Player) => FLOP_STATE({ players: [player], communityCards: board });
    expect(explainBotDecision({ player: shortStack, state: s(shortStack), decision: D('all-in') }).code)
      .toBe('shove-short');
    expect(explainBotDecision({ player: quads, state: s(quads), decision: D('all-in') }).code)
      .toBe('commit-deep');
    expect(explainBotDecision({ player: trips, state: s(trips), decision: D('all-in') }).code)
      .toBe('value-bet');
    expect(explainBotDecision({ player: air, state: s(air), decision: D('all-in') }).code)
      .toBe('bluff');
  });
});

describe('예외·강제 진행', () => {
  it('홀카드가 마스킹된 포스트플랍은 unknown', () => {
    const p = bot('As Ad', { holeCards: [] });
    const s = FLOP_STATE({ players: [p], communityCards: cards('Ah 7c 2d') });
    expect(explainBotDecision({ player: p, state: s, decision: D('raise', 100) }).code).toBe('unknown');
  });

  it('비정상 입력에도 throw하지 않고 unknown을 준다', () => {
    const broken = { player: null, state: null, decision: null } as unknown as Parameters<
      typeof explainBotDecision
    >[0];
    expect(() => explainBotDecision(broken)).not.toThrow();
    expect(explainBotDecision(broken).code).toBe('unknown');
    const halfBroken = { player: bot('As Ad'), state: state(), decision: null } as unknown as Parameters<
      typeof explainBotDecision
    >[0];
    expect(explainBotDecision(halfBroken).code).toBe('unknown');
  });

  it('알 수 없는 액션 타입도 unknown', () => {
    const p = bot('As Ad');
    const s = state({ players: [p] });
    const weird = { action: 'teleport', amount: 0 } as unknown as BotDecision;
    expect(explainBotDecision({ player: p, state: s, decision: weird }).code).toBe('unknown');
  });

  it('강제 체크/폴드는 forced 코드를 준다', () => {
    const p = bot('As Ad');
    const e = explainForcedAction(p, state({ players: [p] }));
    expect(e.code).toBe('forced');
    expect(BOT_EXPLANATION_TEXTS.forced).toContain(e.text);
  });
});

describe('결정론·정보 유출 방지', () => {
  it('같은 입력이면 항상 같은 대사 (Math.random 미사용)', () => {
    const p = bot('As Ad');
    const s = state({ players: [p] });
    const first = explainBotDecision({ player: p, state: s, decision: D('raise', 60) });
    for (let i = 0; i < 20; i++) {
      expect(explainBotDecision({ player: p, state: s, decision: D('raise', 60) })).toEqual(first);
    }
  });

  it('handNumber·seatIndex가 바뀌면 변형이 순환한다', () => {
    const texts = new Set<string>();
    for (let hand = 0; hand < 3; hand++) {
      const p = bot('As Ad', { seatIndex: 0 });
      const s = state({ players: [p], handNumber: hand });
      const e = explainBotDecision({ player: p, state: s, decision: D('raise', 60) });
      expect(BOT_EXPLANATION_TEXTS['premium-open']).toContain(e.text);
      texts.add(e.text);
    }
    expect(texts.size).toBe(BOT_EXPLANATION_TEXTS['premium-open'].length);
    // 좌석이 한 칸 밀리면 같은 핸드에서도 다른 변형
    const seat0 = bot('As Ad', { seatIndex: 0 });
    const seat1 = bot('As Ad', { seatIndex: 1 });
    const s0 = state({ players: [seat0], handNumber: 7 });
    expect(explainBotDecision({ player: seat0, state: s0, decision: D('raise', 60) }).text)
      .not.toBe(explainBotDecision({ player: seat1, state: s0, decision: D('raise', 60) }).text);
  });

  it('음수 handNumber에도 인덱스가 범위를 벗어나지 않는다', () => {
    const p = bot('As Ad');
    const s = state({ players: [p], handNumber: -5 });
    const e = explainBotDecision({ player: p, state: s, decision: D('raise', 60) });
    expect(BOT_EXPLANATION_TEXTS['premium-open']).toContain(e.text);
  });

  it('어떤 대사도 카드 랭크·수트를 언급하지 않는다', () => {
    const cardToken = /[AKQJT2-9][shdc]\b/;
    const koreanSuit = /스페이드|하트|다이아|클럽|♠|♥|♦|♣/;
    const codes = Object.keys(BOT_EXPLANATION_TEXTS) as BotExplanationCode[];
    expect(codes.length).toBe(19);
    for (const code of codes) {
      const variants = BOT_EXPLANATION_TEXTS[code];
      expect(variants.length).toBeGreaterThanOrEqual(2);
      for (const text of variants) {
        expect(text.length).toBeGreaterThan(0);
        expect(cardToken.test(text), `${code}: ${text}`).toBe(false);
        expect(koreanSuit.test(text), `${code}: ${text}`).toBe(false);
        // 라틴 문자·숫자 자체를 쓰지 않는다 (카드 표기 유출 원천 차단)
        expect(/[A-Za-z0-9]/.test(text), `${code}: ${text}`).toBe(false);
      }
    }
  });
});
