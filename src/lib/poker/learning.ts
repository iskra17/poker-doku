/**
 * 학습 계산 코어 — 드릴 생성/채점·코치 패널·서버 판정이 **같은 함수**를 공유한다.
 * 규칙을 클라와 서버에 따로 구현하면 "화면 해설과 채점 결과가 다른" 사고가 나므로
 * 팟오즈·아우츠·에퀴티·넛츠는 전부 여기서만 계산한다.
 *
 * 순수 모듈 — DOM/Node API를 쓰지 않는다(서버·클라 공용). 셔플/딜링 경로가 아니므로
 * `deck.ts`의 CSPRNG 규칙 대상이 아니고, 무작위가 필요한 곳은 주입된 시드 RNG
 * (`seeded-rng.ts`)만 쓴다 — 같은 시드면 같은 추정치가 나와야 드릴이 재현된다.
 */
import { evaluateHand } from './evaluator';
import { formatCard } from './card-notation';
import { rangeCombos } from './range';
import { mulberry32, randomInt } from './seeded-rng';
import type { Card, EvaluatedHand, HandRank, Rank, Suit } from './types';

const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: readonly Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

/** 핸드 랭크의 순서값 (high-card=0 … royal-flush=9) — 목표 랭크 비교용. */
const HAND_RANK_ORDER: Readonly<Record<HandRank, number>> = Object.freeze({
  'high-card': 0,
  'one-pair': 1,
  'two-pair': 2,
  'three-of-a-kind': 3,
  straight: 4,
  flush: 5,
  'full-house': 6,
  'four-of-a-kind': 7,
  'straight-flush': 8,
  'royal-flush': 9,
});

export function handRankOrder(rank: HandRank): number {
  return HAND_RANK_ORDER[rank];
}

/**
 * 표준 52장 — **셔플 없는 정적 순서**. `deck.ts`의 `Deck`은 생성 즉시 CSPRNG로 셔플되므로
 * 열거 계산에는 쓰지 않는다 (열거 결과가 호출마다 뒤바뀌면 스냅샷 테스트가 무의미해진다).
 */
export function allCards(): Card[] {
  const out: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) out.push({ suit, rank });
  }
  return out;
}

function cardKey(card: Card): string {
  return formatCard(card);
}

function assertDistinct(cards: readonly Card[], label: string): void {
  const seen = new Set<string>();
  for (const card of cards) {
    const key = cardKey(card);
    if (seen.has(key)) throw new Error(`${label}: duplicate card ${key}`);
    seen.add(key);
  }
}

/** 52장에서 `known`(홀카드·보드·데드)을 뺀 나머지. */
export function unseenCards(known: readonly Card[]): Card[] {
  const used = new Set(known.map(cardKey));
  return allCards().filter(card => !used.has(cardKey(card)));
}

// ---------------------------------------------------------------------------
// 팟오즈
// ---------------------------------------------------------------------------

export interface PotOdds {
  /** 팟:콜 비율 (팟 150·콜 50 → 3). */
  ratio: number;
  /** 콜 필요 승률 % (0~100). */
  pct: number;
  /** 콜 필요 승률 (0~1) — 에퀴티와 바로 비교하는 값. */
  requiredEquity: number;
}

/**
 * 팟오즈. **`potTotal`은 상대 벳까지 포함해 지금 중앙에 있는 총액**이다
 * (기획 A4 D-ODDS 팟 정의 — "팟 150 + 벳 50 = 200 → 20%"로 읽히는 표기 금지).
 * 예) 팟 150(상대 벳 50 포함) + 콜 50 → 50/200 = 25%, 비율 150:50 = 3.
 */
export function computePotOdds(toCall: number, potTotal: number): PotOdds {
  if (!Number.isFinite(toCall) || toCall <= 0) {
    throw new Error(`computePotOdds: toCall must be positive (got ${toCall})`);
  }
  if (!Number.isFinite(potTotal) || potTotal <= 0) {
    throw new Error(`computePotOdds: potTotal must be positive (got ${potTotal})`);
  }
  const requiredEquity = toCall / (potTotal + toCall);
  return { ratio: potTotal / toCall, pct: requiredEquity * 100, requiredEquity };
}

// ---------------------------------------------------------------------------
// 아우츠 / 드로우 확률
// ---------------------------------------------------------------------------

/**
 * 2·4의 법칙 — 아우츠로 뜰 확률을 암산하는 근사식.
 * 1장 남았으면 ×2, 2장 남았으면 ×4. 다만 아우츠가 많아질수록 ×4가 과대평가라
 * **아우츠 ≥ 9면 `outs*4 - (outs-8)`로 보정**한다(널리 쓰이는 관행 보정).
 * 예) 9아우츠 2장 → 36 − 1 = 35% (정확값 34.97%), 15아우츠 → 60 − 7 = 53% (정확값 54.1%).
 */
export function ruleOfTwoAndFour(outs: number, cardsToCome: 1 | 2): number {
  if (!Number.isInteger(outs) || outs < 0) {
    throw new Error(`ruleOfTwoAndFour: outs must be a non-negative integer (got ${outs})`);
  }
  if (cardsToCome !== 1 && cardsToCome !== 2) {
    throw new Error(`ruleOfTwoAndFour: cardsToCome must be 1 or 2 (got ${cardsToCome})`);
  }
  if (cardsToCome === 1) return outs * 2;
  return outs >= 9 ? outs * 4 - (outs - 8) : outs * 4;
}

/**
 * 드로우 완성 확률의 **정확값** (%). 근사식(2·4의 법칙)의 정답지.
 * 1장: `outs/unseen`. 2장: `1 − C(unseen−outs, 2)/C(unseen, 2)` (둘 다 빗나갈 확률의 여사건).
 */
export function exactDrawPct(outs: number, unseen: number, cardsToCome: 1 | 2): number {
  if (!Number.isInteger(outs) || outs < 0) throw new Error(`exactDrawPct: invalid outs ${outs}`);
  if (!Number.isInteger(unseen) || unseen <= 0) throw new Error(`exactDrawPct: invalid unseen ${unseen}`);
  if (outs > unseen) throw new Error(`exactDrawPct: outs ${outs} exceeds unseen ${unseen}`);
  if (cardsToCome !== 1 && cardsToCome !== 2) {
    throw new Error(`exactDrawPct: cardsToCome must be 1 or 2 (got ${cardsToCome})`);
  }
  if (cardsToCome === 1) return (outs / unseen) * 100;
  if (unseen < 2) throw new Error('exactDrawPct: need at least 2 unseen cards for two streets');
  const miss = unseen - outs;
  const missBoth = miss < 2 ? 0 : (miss * (miss - 1)) / (unseen * (unseen - 1));
  return (1 - missBoth) * 100;
}

export interface OutsResult {
  /** 다음 1장으로 조건을 만족시키는 카드들 (결정론 순서). */
  outs: Card[];
  /** 아직 보이지 않은 카드 수 — 확률 계산의 분모. */
  unseen: number;
}

function assertBoardForOuts(board: readonly Card[]): void {
  if (board.length < 3 || board.length > 4) {
    throw new Error(`outs: board must have 3 or 4 cards (got ${board.length})`);
  }
}

/**
 * "다음 1장으로 히어로가 빌런을 **이기게** 되는 카드" 열거 (타이는 아우츠로 세지 않는다).
 * 빌런 핸드를 아는 학습 상황(리뷰·드릴 해설) 전용 — 실전 추정은 `estimateEquity`.
 */
export function countOutsVsHand(
  hero: Card[],
  board: Card[],
  villain: Card[],
  dead: readonly Card[] = [],
): OutsResult {
  if (hero.length !== 2) throw new Error(`countOutsVsHand: hero must have 2 cards (got ${hero.length})`);
  if (villain.length !== 2) throw new Error(`countOutsVsHand: villain must have 2 cards (got ${villain.length})`);
  assertBoardForOuts(board);
  const known = [...hero, ...board, ...villain, ...dead];
  assertDistinct(known, 'countOutsVsHand');

  const unseen = unseenCards(known);
  const outs: Card[] = [];
  for (const card of unseen) {
    const nextBoard = [...board, card];
    if (evaluateHand(hero, nextBoard).value > evaluateHand(villain, nextBoard).value) outs.push(card);
  }
  return { outs, unseen: unseen.length };
}

/**
 * "다음 1장으로 히어로가 최소 `minRank` 이상이 되는 카드" 열거.
 * 이미 그 랭크 이상이면 아우츠는 빈 배열 (드로우가 아니라 메이드 상태).
 */
export function countOutsToRank(
  hero: Card[],
  board: Card[],
  minRank: HandRank,
  dead: readonly Card[] = [],
): OutsResult {
  if (hero.length !== 2) throw new Error(`countOutsToRank: hero must have 2 cards (got ${hero.length})`);
  assertBoardForOuts(board);
  const known = [...hero, ...board, ...dead];
  assertDistinct(known, 'countOutsToRank');

  const unseen = unseenCards(known);
  const target = handRankOrder(minRank);
  if (handRankOrder(evaluateHand(hero, board).rank) >= target) {
    return { outs: [], unseen: unseen.length };
  }
  const outs: Card[] = [];
  for (const card of unseen) {
    if (handRankOrder(evaluateHand(hero, [...board, card]).rank) >= target) outs.push(card);
  }
  return { outs, unseen: unseen.length };
}

// ---------------------------------------------------------------------------
// 에퀴티
// ---------------------------------------------------------------------------

export interface EquityResult {
  /** 승/무/패 비율 (합 1). */
  win: number;
  tie: number;
  lose: number;
  /** win + tie/2 (0~1). */
  equity: number;
  method: 'enumerate' | 'monte-carlo';
  /** 실제로 평가한 런아웃(또는 샘플) 수. */
  trials: number;
}

export interface EquityOptions {
  /** 시드 RNG 주입 — 미지정이면 `mulberry32(1)`(결정론 기본값). */
  rng?: () => number;
  /** 몬테카를로 샘플 수. 고정 핸드 프리플랍 기본 20000, 레인지 기본 2000. */
  samples?: number;
  /** 덱에서 빼야 할 추가 카드(다른 좌석의 폴드 카드 등). */
  dead?: readonly Card[];
}

const DEFAULT_FIXED_SAMPLES = 20_000;
const DEFAULT_RANGE_SAMPLES = 2_000;
/**
 * 레인지 에퀴티를 완전 열거로 처리할 상한 (콤보 수 × 런아웃 수).
 * evaluateHand 한 번이 ~1.2µs라 런아웃 하나에 두 핸드를 재면 5,000 트라이얼 ≈ 250ms —
 * 코치 패널이 요청당 감당할 만한 상한이다. 리버(런아웃 1)·턴(44)은 대부분 여기 들어와
 * 정확값이 나오고, 플랍(990)은 레인지가 6콤보만 넘어도 시드 MC로 떨어진다(기획 기본값).
 */
const RANGE_ENUMERATION_LIMIT = 5_000;

/** k개 조합의 인덱스를 순회. k > n이면 한 번도 방문하지 않는다. */
function forEachCombination(n: number, k: number, visit: (indices: readonly number[]) => void): void {
  if (k < 0 || k > n) return;
  if (k === 0) {
    visit([]);
    return;
  }
  const idx: number[] = [];
  for (let i = 0; i < k; i++) idx.push(i);
  for (;;) {
    visit(idx);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

/** 작업 덱 앞쪽 `count`장을 부분 Fisher-Yates로 뽑는다 (덱 배열은 제자리 치환됨). */
function sampleCards(deck: Card[], count: number, rng: () => number): Card[] {
  const picked: Card[] = [];
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(rng, deck.length - i);
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
    picked.push(deck[i]);
  }
  return picked;
}

interface Tally {
  win: number;
  tie: number;
  lose: number;
}

function score(tally: Tally, trials: number, method: 'enumerate' | 'monte-carlo'): EquityResult {
  if (trials === 0) throw new Error('estimateEquity: no runouts evaluated');
  const win = tally.win / trials;
  const tie = tally.tie / trials;
  const lose = tally.lose / trials;
  return { win, tie, lose, equity: win + tie / 2, method, trials };
}

function settle(tally: Tally, hero: Card[], villain: Card[], board: Card[]): void {
  const diff = evaluateHand(hero, board).value - evaluateHand(villain, board).value;
  if (diff > 0) tally.win++;
  else if (diff < 0) tally.lose++;
  else tally.tie++;
}

/**
 * 히어로 에퀴티 추정.
 *
 * - 빌런이 **고정 2장** + 보드 3장 이상 → 남은 런아웃 **완전 열거**
 *   (플랍 C(45,2)=990 · 턴 44 · 리버 1). 결정론이며 rng를 쓰지 않는다.
 * - 빌런이 고정 2장 + 프리플랍(보드 0장) → 시드 몬테카를로(기본 20,000).
 * - 빌런이 **레인지**(핸드 키 Set) → 콤보를 뽑고 남은 보드를 채우는 시드 몬테카를로
 *   (기본 2,000). 단 콤보 수 × 런아웃 수가 50,000 이하로 작으면 완전 열거로 승격한다.
 *
 * 반환 `equity = win + tie/2` (0~1).
 */
export function estimateEquity(
  hero: Card[],
  board: Card[],
  villain: Card[] | ReadonlySet<string>,
  options: EquityOptions = {},
): EquityResult {
  if (hero.length !== 2) throw new Error(`estimateEquity: hero must have 2 cards (got ${hero.length})`);
  if (board.length > 5) throw new Error(`estimateEquity: board must have at most 5 cards (got ${board.length})`);
  const dead = options.dead ?? [];
  const rng = options.rng ?? mulberry32(1);
  const cardsToCome = 5 - board.length;

  if (Array.isArray(villain)) {
    return equityVsFixedHand(hero, board, villain, dead, rng, options.samples, cardsToCome);
  }
  return equityVsRange(hero, board, villain, dead, rng, options.samples, cardsToCome);
}

function equityVsFixedHand(
  hero: Card[],
  board: Card[],
  villain: Card[],
  dead: readonly Card[],
  rng: () => number,
  samples: number | undefined,
  cardsToCome: number,
): EquityResult {
  if (villain.length !== 2) {
    throw new Error(`estimateEquity: villain must have 2 cards (got ${villain.length})`);
  }
  const known = [...hero, ...board, ...villain, ...dead];
  assertDistinct(known, 'estimateEquity');
  const deck = unseenCards(known);
  const tally: Tally = { win: 0, tie: 0, lose: 0 };

  if (board.length >= 3) {
    let trials = 0;
    forEachCombination(deck.length, cardsToCome, indices => {
      const full = board.slice();
      for (const i of indices) full.push(deck[i]);
      settle(tally, hero, villain, full);
      trials++;
    });
    return score(tally, trials, 'enumerate');
  }

  const target = samples ?? DEFAULT_FIXED_SAMPLES;
  if (!Number.isInteger(target) || target <= 0) {
    throw new Error(`estimateEquity: samples must be a positive integer (got ${target})`);
  }
  const working = deck.slice();
  for (let s = 0; s < target; s++) {
    settle(tally, hero, villain, [...board, ...sampleCards(working, cardsToCome, rng)]);
  }
  return score(tally, target, 'monte-carlo');
}

function equityVsRange(
  hero: Card[],
  board: Card[],
  range: ReadonlySet<string>,
  dead: readonly Card[],
  rng: () => number,
  samples: number | undefined,
  cardsToCome: number,
): EquityResult {
  const known = [...hero, ...board, ...dead];
  assertDistinct(known, 'estimateEquity');
  const combos = rangeCombos(range, known);
  if (combos.length === 0) {
    throw new Error('estimateEquity: villain range has no live combos after removing dead cards');
  }
  const baseDeck = unseenCards(known);
  const tally: Tally = { win: 0, tie: 0, lose: 0 };

  // 콤보 × 런아웃이 충분히 작으면 근사 대신 완전 열거 (리버·턴 레인지 스팟이 여기 해당).
  const runouts = binomial(baseDeck.length - 2, cardsToCome);
  if (board.length >= 3 && combos.length * runouts <= RANGE_ENUMERATION_LIMIT) {
    let trials = 0;
    for (const combo of combos) {
      const blocked = new Set(combo.map(cardKey));
      const deck = baseDeck.filter(card => !blocked.has(cardKey(card)));
      forEachCombination(deck.length, cardsToCome, indices => {
        const full = board.slice();
        for (const i of indices) full.push(deck[i]);
        settle(tally, hero, combo, full);
        trials++;
      });
    }
    return score(tally, trials, 'enumerate');
  }

  const target = samples ?? DEFAULT_RANGE_SAMPLES;
  if (!Number.isInteger(target) || target <= 0) {
    throw new Error(`estimateEquity: samples must be a positive integer (got ${target})`);
  }
  for (let s = 0; s < target; s++) {
    const combo = combos[randomInt(rng, combos.length)];
    const blocked = new Set(combo.map(cardKey));
    const deck = baseDeck.filter(card => !blocked.has(cardKey(card)));
    settle(tally, hero, combo, [...board, ...sampleCards(deck, cardsToCome, rng)]);
  }
  return score(tally, target, 'monte-carlo');
}

// ---------------------------------------------------------------------------
// 넛츠 / 핸드 순위
// ---------------------------------------------------------------------------

export interface NutsResult {
  hand: EvaluatedHand;
  /** 그 최고값을 만드는 홀카드 2장 조합 **전부**. */
  holeCards: Card[][];
}

/**
 * 보드(3~5장)에서 가능한 **최강 조합**과 그걸 만드는 홀카드 전부.
 * 남은 카드의 2장 조합을 전수 평가한다 (리버 C(47,2)=1,081).
 */
export function findNuts(board: Card[], dead: readonly Card[] = []): NutsResult {
  if (board.length < 3 || board.length > 5) {
    throw new Error(`findNuts: board must have 3~5 cards (got ${board.length})`);
  }
  assertDistinct([...board, ...dead], 'findNuts');
  const deck = unseenCards([...board, ...dead]);

  let best: EvaluatedHand | null = null;
  let holeCards: Card[][] = [];
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const hole = [deck[i], deck[j]];
      const hand = evaluateHand(hole, board);
      if (!best || hand.value > best.value) {
        best = hand;
        holeCards = [hole];
      } else if (hand.value === best.value) {
        holeCards.push(hole);
      }
    }
  }
  if (!best) throw new Error('findNuts: no candidate hands');
  return { hand: best, holeCards };
}

export interface RankedCandidate {
  holeCards: Card[];
  hand: EvaluatedHand;
  /** 1부터. 동점은 같은 rank를 공유하고 다음 순위는 건너뛴다 (1,1,3). */
  rank: number;
}

/** 후보 홀카드들을 같은 보드에서 평가해 강한 순으로 정렬. */
export function rankHands(board: Card[], candidates: Card[][]): RankedCandidate[] {
  const evaluated = candidates.map(holeCards => ({ holeCards, hand: evaluateHand(holeCards, board) }));
  evaluated.sort((a, b) => b.hand.value - a.hand.value);

  const out: RankedCandidate[] = [];
  let rank = 0;
  let previous: number | null = null;
  evaluated.forEach((entry, index) => {
    if (previous === null || entry.hand.value !== previous) {
      rank = index + 1;
      previous = entry.hand.value;
    }
    out.push({ ...entry, rank });
  });
  return out;
}
