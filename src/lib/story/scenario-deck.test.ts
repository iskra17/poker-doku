import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatCard, formatCards } from '../poker/card-notation';
import { PokerEngine } from '../poker/engine';
import { makePlayer } from '../poker/test-helpers';
import type { Card, RoomConfig } from '../poker/types';
import { ScenarioDeck, ScenarioDeckError } from './scenario-deck';

const FULL_SCRIPT = {
  hero: 'As Ks',
  villains: { 2: 'Qh Qd' },
  board: 'Ah Kd 7c 2d 9s',
};

/** 스크립트에 등장하는 모든 카드 표기 */
const SCRIPT_CARDS = new Set(['As', 'Ks', 'Qh', 'Qd', 'Ah', 'Kd', '7c', '2d', '9s']);

function armed(overrides: Partial<Parameters<ScenarioDeck['arm']>[0]> = {}): ScenarioDeck {
  const deck = new ScenarioDeck();
  deck.arm({
    script: FULL_SCRIPT,
    dealtSeatOrder: [0, 1, 2, 3],
    heroSeat: 0,
    ...overrides,
  });
  deck.reset();
  return deck;
}

function codes(cards: readonly Card[]): string[] {
  return cards.map(formatCard);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScenarioDeck 배치', () => {
  it('좌석순으로 정확히 배치한다 (홀카드 → 플랍 → 턴 → 리버, 번 카드 없음)', () => {
    const deck = armed();

    const seat0 = codes(deck.deal(2));
    const seat1 = codes(deck.deal(2));
    const seat2 = codes(deck.deal(2));
    const seat3 = codes(deck.deal(2));
    const flop = codes(deck.deal(3));
    const turn = codes(deck.deal(1));
    const river = codes(deck.deal(1));

    expect(seat0).toEqual(['As', 'Ks']);
    expect(seat2).toEqual(['Qh', 'Qd']);
    expect(flop).toEqual(['Ah', 'Kd', '7c']);
    expect(turn).toEqual(['2d']);
    expect(river).toEqual(['9s']);

    // 미지정 좌석은 스크립트 카드를 절대 받지 않는다
    for (const code of [...seat1, ...seat3]) {
      expect(SCRIPT_CARDS.has(code)).toBe(false);
    }
  });

  it('딜아웃 좌석이 있는 라인업도 딜 순서 기준으로 배치한다', () => {
    // 좌석 2는 이번 핸드에 딜아웃(0칩·자리비움) → 세 번째로 카드를 받는 좌석은 3번이다
    const deck = new ScenarioDeck();
    deck.arm({
      script: { hero: 'As Ks', villains: { 3: 'Qh Qd' } },
      dealtSeatOrder: [0, 1, 3],
      heroSeat: 0,
    });
    deck.reset();

    expect(codes(deck.deal(2))).toEqual(['As', 'Ks']);
    const second = codes(deck.deal(2));
    expect(codes(deck.deal(2))).toEqual(['Qh', 'Qd']);
    for (const code of second) expect(SCRIPT_CARDS.has(code)).toBe(false);
  });

  it('무장 후에도 덱은 52장 유니크이고 스크립트 카드가 잔여에 다시 나타나지 않는다', () => {
    const deck = armed();
    const all = codes(deck.deal(52));

    expect(deck.remaining()).toBe(0);
    expect(new Set(all).size).toBe(52);

    // 스크립트 카드는 지정된 절대 위치에 정확히 한 번씩만 존재한다 (잔여에서 제거됨)
    const positions = new Map<string, number[]>();
    all.forEach((code, index) => {
      if (SCRIPT_CARDS.has(code)) positions.set(code, [...(positions.get(code) ?? []), index]);
    });
    expect(Object.fromEntries(positions)).toEqual({
      As: [0], Ks: [1], // 좌석 0 (히어로)
      Qh: [4], Qd: [5], // 좌석 2 (빌런) — 좌석 1은 2·3번 자리로 밀린다
      Ah: [8], Kd: [9], '7c': [10], '2d': [11], '9s': [12], // 보드
    });
  });

  it('부분 보드는 앞에서부터 고정하고 나머지 보드는 CSPRNG로 채운다', () => {
    const deck = new ScenarioDeck();
    deck.arm({
      script: { hero: 'As Ks', board: 'Ah Kd 7c' },
      dealtSeatOrder: [0, 1],
      heroSeat: 0,
    });
    deck.reset();

    expect(codes(deck.deal(2))).toEqual(['As', 'Ks']);
    deck.deal(2); // seat 1
    expect(codes(deck.deal(3))).toEqual(['Ah', 'Kd', '7c']);
    const turnRiver = codes(deck.deal(2));
    for (const code of turnRiver) {
      expect(['As', 'Ks', 'Ah', 'Kd', '7c']).not.toContain(code);
    }
  });

  it('보드·빌런 미지정이면 히어로만 고정한다', () => {
    const deck = new ScenarioDeck();
    deck.arm({ script: { hero: 'As Ks' }, dealtSeatOrder: [0, 1, 2], heroSeat: 1 });
    deck.reset();

    const seat0 = codes(deck.deal(2));
    expect(codes(deck.deal(2))).toEqual(['As', 'Ks']);
    const seat2 = codes(deck.deal(2));
    for (const code of [...seat0, ...seat2]) {
      expect(['As', 'Ks']).not.toContain(code);
    }
  });
});

describe('ScenarioDeck 무장 수명', () => {
  it('arm 전에는 무장 상태가 아니다', () => {
    expect(new ScenarioDeck().isArmed()).toBe(false);
  });

  it('disarm하면 스크립트를 적용하지 않는다', () => {
    const deck = new ScenarioDeck();
    deck.arm({ script: FULL_SCRIPT, dealtSeatOrder: [0, 1, 2, 3], heroSeat: 0 });
    expect(deck.isArmed()).toBe(true);
    deck.disarm();
    expect(deck.isArmed()).toBe(false);
    deck.reset();
    expect(deck.remaining()).toBe(52);
  });

  it('1회성이다 — 무장된 reset 이후에는 다시 평범한 CSPRNG 셔플로 돌아간다', () => {
    const deck = armed();
    expect(deck.isArmed()).toBe(false);

    // 여러 번 리셋했을 때 매번 'As Ks'가 앞에 오면 무장이 남아 있는 것
    const firstPairs = new Set<string>();
    for (let i = 0; i < 20; i++) {
      deck.reset();
      firstPairs.add(formatCards(deck.deal(2)));
    }
    expect(firstPairs.size).toBeGreaterThan(1);
    expect([...firstPairs].every(pair => pair === 'As Ks')).toBe(false);
  });
});

describe('ScenarioDeck 검증', () => {
  const base = { dealtSeatOrder: [0, 1, 2, 3], heroSeat: 0 };

  it('히어로·빌런·보드에 걸친 중복 카드를 거절한다', () => {
    const deck = new ScenarioDeck();
    expect(() => deck.arm({ ...base, script: { hero: 'As Ks', villains: { 2: 'As Qd' } } }))
      .toThrow(ScenarioDeckError);
    expect(() => deck.arm({ ...base, script: { hero: 'As Ks', board: 'Ah Kd As' } }))
      .toThrow(ScenarioDeckError);
    expect(deck.isArmed()).toBe(false);
  });

  it('잘못된 표기를 거절한다', () => {
    const deck = new ScenarioDeck();
    expect(() => deck.arm({ ...base, script: { hero: 'Zx Ks' } })).toThrow(ScenarioDeckError);
    expect(() => deck.arm({ ...base, script: { hero: 'As' } })).toThrow(ScenarioDeckError);
    expect(() => deck.arm({ ...base, script: { hero: 'As Ks', board: 'Ah Kd 7c 2d 9s 3h' } }))
      .toThrow(ScenarioDeckError);
  });

  it('히어로 좌석이 딜 순서에 없으면 거절한다', () => {
    const deck = new ScenarioDeck();
    expect(() => deck.arm({ dealtSeatOrder: [0, 1], heroSeat: 4, script: { hero: 'As Ks' } }))
      .toThrow(ScenarioDeckError);
  });

  it('빌런 좌석이 딜 순서에 없으면 거절한다', () => {
    const deck = new ScenarioDeck();
    expect(() => deck.arm({
      dealtSeatOrder: [0, 1],
      heroSeat: 0,
      script: { hero: 'As Ks', villains: { 4: 'Qh Qd' } },
    })).toThrow(ScenarioDeckError);
  });

  it('빈/중복 딜 순서를 거절한다', () => {
    const deck = new ScenarioDeck();
    expect(() => deck.arm({ dealtSeatOrder: [], heroSeat: 0, script: { hero: 'As Ks' } }))
      .toThrow(ScenarioDeckError);
    expect(() => deck.arm({ dealtSeatOrder: [0, 0], heroSeat: 0, script: { hero: 'As Ks' } }))
      .toThrow(ScenarioDeckError);
  });
});

describe('ScenarioDeck 난수 소스', () => {
  it('Math.random을 절대 쓰지 않고 CSPRNG만 쓴다', () => {
    const mathRandom = vi.spyOn(Math, 'random');
    const secure = vi.spyOn(globalThis.crypto, 'getRandomValues');

    const deck = new ScenarioDeck();
    deck.arm({ script: FULL_SCRIPT, dealtSeatOrder: [0, 1, 2, 3], heroSeat: 0 });
    deck.reset();
    deck.deal(10);

    expect(mathRandom).not.toHaveBeenCalled();
    expect(secure.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('ScenarioDeck × PokerEngine', () => {
  const config: RoomConfig = {
    name: 'Story Practice',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 100,
    maxBuyIn: 10_000,
    maxPlayers: 6,
    turnTime: 30,
  };

  function seatFour(deck: ScenarioDeck): PokerEngine {
    const engine = new PokerEngine(config, 'story-room', deck);
    for (let i = 0; i < 4; i++) {
      engine.addPlayer(makePlayer(`p${i}`, 1_000, i));
    }
    engine.state.dealerIndex = 3; // startHand 후 딜러 = p0
    return engine;
  }

  it('startHand가 스크립트대로 홀카드를 딜한다', () => {
    const deck = new ScenarioDeck();
    const engine = seatFour(deck);
    deck.arm({ script: FULL_SCRIPT, dealtSeatOrder: [0, 1, 2, 3], heroSeat: 0 });
    engine.startHand();

    expect(formatCards(engine.state.players[0].holeCards)).toBe('As Ks');
    expect(formatCards(engine.state.players[2].holeCards)).toBe('Qh Qd');
    for (const seat of [1, 3]) {
      for (const card of engine.state.players[seat].holeCards) {
        expect(SCRIPT_CARDS.has(formatCard(card))).toBe(false);
      }
    }
  });

  it('쇼다운까지 진행하면 보드도 스크립트와 일치한다', () => {
    const deck = new ScenarioDeck();
    const engine = seatFour(deck);
    deck.arm({ script: FULL_SCRIPT, dealtSeatOrder: [0, 1, 2, 3], heroSeat: 0 });
    engine.startHand();
    runPassively(engine);

    expect(formatCards(engine.state.communityCards)).toBe('Ah Kd 7c 2d 9s');
    expect(engine.state.street).toBe('showdown');
  });

  it('다음 핸드는 무장이 풀려 평범한 셔플로 돌아간다', () => {
    const deck = new ScenarioDeck();
    const engine = seatFour(deck);
    deck.arm({ script: FULL_SCRIPT, dealtSeatOrder: [0, 1, 2, 3], heroSeat: 0 });
    engine.startHand();
    runPassively(engine);

    expect(deck.isArmed()).toBe(false);
    engine.startHand();
    expect(formatCards(engine.state.players[0].holeCards)).not.toBe('As Ks');
  });
});

/** 전원 체크/콜로 쇼다운까지 밀어붙인다 (스크립트 보드를 끝까지 보기 위함). */
function runPassively(engine: PokerEngine): void {
  for (let guard = 0; guard < 200 && engine.state.isHandInProgress; guard++) {
    if (engine.state.allInRunout) {
      engine.dealRunoutStreet();
      continue;
    }
    const player = engine.state.players[engine.state.activePlayerIndex];
    if (!player) break;
    const valid = engine.getValidActions(player);
    const type = valid.includes('check') ? 'check' : 'call';
    engine.processAction({ playerId: player.id, type, amount: 0 });
  }
}
