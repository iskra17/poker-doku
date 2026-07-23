import { Deck } from './deck';
import { PokerEngine } from './engine';
import { Card, Player, Rank, Suit } from './types';

// 카드 축약 표기: 'As' = A♠, 'Th' = 10♥, '2c' = 2♣, 'Kd' = K♦
const SUIT_MAP: Record<string, Suit> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
const RANK_MAP: Record<string, Rank> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};

export function card(code: string): Card {
  const rank = RANK_MAP[code[0]];
  const suit = SUIT_MAP[code[1]];
  if (!rank || !suit) throw new Error(`Invalid card code: ${code}`);
  return { suit, rank };
}

export function cards(codes: string): Card[] {
  return codes.trim().split(/\s+/).map(card);
}

/**
 * 결정론적 덱: reset()이 미리 정한 순서를 복원한다.
 * startHand()의 딜 순서: 좌석 배열 순서대로 각 플레이어 2장 연속 → 플랍 3 → 턴 1 → 리버 1 (번 카드 없음)
 * 지정한 카드 이후는 남은 표준 덱 카드로 채운다.
 */
export class RiggedDeck extends Deck {
  private rigged: Card[];

  constructor(riggedCodes: string) {
    super();
    this.rigged = cards(riggedCodes);
    this.reset();
  }

  reset(): void {
    if (!this.rigged) return; // 부모 생성자에서 호출될 때
    const used = new Set(this.rigged.map(c => `${c.rank}${c.suit}`));
    const rest: Card[] = [];
    for (const suit of ['hearts', 'diamonds', 'clubs', 'spades'] as Suit[]) {
      for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as Rank[]) {
        if (!used.has(`${rank}${suit}`)) rest.push({ suit, rank });
      }
    }
    // splice(0, n)으로 앞에서부터 딜하므로 rigged를 앞에 배치
    (this as unknown as { cards: Card[] }).cards = [...this.rigged.map(c => ({ ...c })), ...rest];
  }
}

export function makePlayer(id: string, chips: number, seatIndex: number, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: overrides.name ?? `Player ${id}`,
    type: 'human',
    avatar: '🧑',
    chips,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
    ...overrides,
  };
}

/** 테이블 전체 칩 (스택 + 팟). 핸드 어느 시점이든 보존되어야 한다. */
export function totalTableChips(engine: PokerEngine): number {
  const stacks = engine.state.players.reduce((s, p) => s + p.chips, 0);
  const pots = engine.state.pots.reduce((s, p) => s + p.amount, 0);
  return stacks + pots;
}

/** 플레이어 스택 합계 (핸드 종료 후 = 시작 전과 동일해야 함) */
export function totalStacks(engine: PokerEngine): number {
  return engine.state.players.reduce((s, p) => s + p.chips, 0);
}

export interface TableSetup {
  engine: PokerEngine;
  initialTotal: number;
}

export interface TableSetupOptions {
  maxPlayers?: number; // 기본 6 — MTT 가변 정원 테스트용
  gameMode?: 'cash' | 'sng' | 'mtt';
  ante?: number; // BB 앤티 (MTT)
  smallBlind?: number;
  bigBlind?: number;
}

/**
 * 표준 테스트 테이블: 블라인드 10/20.
 * dealerIndex를 조작해 startHand 후 딜러가 players[0]이 되도록 한다.
 * (advanceDealerButton이 시작 시 딜러를 한 칸 전진시키므로 마지막 인덱스로 설정)
 */
export function setupTable(
  chipCounts: number[],
  riggedCodes?: string,
  options: TableSetupOptions = {},
): TableSetup {
  const config = {
    name: 'Test Table',
    smallBlind: options.smallBlind ?? 10,
    bigBlind: options.bigBlind ?? 20,
    minBuyIn: 100,
    maxBuyIn: 10000,
    maxPlayers: options.maxPlayers ?? 6,
    turnTime: 30,
    ...(options.gameMode ? { gameMode: options.gameMode } : {}),
    ...(options.ante !== undefined ? { ante: options.ante } : {}),
  };
  const deck = riggedCodes ? new RiggedDeck(riggedCodes) : new Deck();
  const engine = new PokerEngine(config, 'test-room', deck);
  chipCounts.forEach((chips, i) => {
    engine.addPlayer(makePlayer(`p${i + 1}`, chips, i));
  });
  engine.state.dealerIndex = chipCounts.length - 1; // startHand 후 딜러 = p1
  return { engine, initialTotal: chipCounts.reduce((a, b) => a + b, 0) };
}

/** 현재 액션 차례인 플레이어 */
export function actor(engine: PokerEngine): Player {
  return engine.state.players[engine.state.activePlayerIndex];
}

/**
 * 단계별 올인 런아웃을 즉시 끝까지 진행 (운영에선 RoomManager가 시간차로 호출).
 * 올인으로 베팅이 닫힌 뒤의 최종 결과를 검증하는 테스트용.
 */
export function completeRunout(engine: PokerEngine): void {
  while (engine.state.allInRunout && engine.state.isHandInProgress) {
    engine.dealRunoutStreet();
  }
}

/** 차례인 플레이어로 액션 실행 (편의 헬퍼) */
export function act(
  engine: PokerEngine,
  type: 'fold' | 'check' | 'call' | 'raise' | 'all-in',
  amount = 0,
): { valid: boolean; handComplete: boolean } {
  return engine.processAction({ playerId: actor(engine).id, type, amount });
}
