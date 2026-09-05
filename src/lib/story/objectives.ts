/**
 * 스파링 행동 목표 판정 — 순수 모듈(서버 코디네이터·클라 결산 공용, I/O 없음).
 *
 * 계약(기획 A5-2 통과 규약 · B3(d) 「목표/리뷰/성적」):
 * - **통과 = 드릴 세트 완료 + primary 행동 목표**. 스택 같은 결과 조건은 통과 조건이 아니라
 *   등급·뱃지 전용이므로, 결과형 목표(`net-chips`·`win-hands`)는 bonus로만 쓴다.
 * - 비율형 목표는 언제나 **"기회 중 실행"** — 기회 0이면 `achieved: null`로 판정에서 제외한다(A13).
 *   카드 분포에 좌우되는 절대 비율(VPIP 등) 목표는 만들지 않는다.
 * - **히어로가 딜인되지 않은 핸드는 어떤 카운트에도 넣지 않는다**(B3(d) 히어로 타임아웃 계약 ②) —
 *   `addHand`가 입구에서 걸러 hands-played·모든 비율의 분모를 오염시키지 않는다.
 * - **결과 ≠ 결정(P4)**: 진 핸드도 올바르게 플레이했으면 행동 목표에 그대로 집계된다.
 *   승패·순이익은 오직 결과형 목표에만 들어간다.
 *
 * 입력은 엔진이 만든 `CompletedHandRecord` 하나뿐이다(`hand-history-replay`로 스트리트별 팟 재구성).
 * 원본 레코드는 전 좌석 홀카드를 담으므로 이 모듈의 반환값도 브로드캐스트 금지 — 히어로 관점 사실만 담는다.
 */
import { handPercentile } from '@/lib/bot/hand-rankings';
import { rankValue } from '@/lib/poker/deck';
import { evaluateHand } from '@/lib/poker/evaluator';
import type { CompletedHandRecord, HandHistoryActionKind } from '@/lib/poker/hand-history';
import {
  applyReplayContribution,
  createReplayContributionState,
  type PlayStreet,
  type ReplayContributionState,
} from '@/lib/poker/hand-history-replay';
import { computePotOdds, exactDrawPct, handRankOrder, unseenCards } from '@/lib/poker/learning';
import type { ActionType, Card, HandRank, Street } from '@/lib/poker/types';
import {
  CALL_VS_THREE_BET_THRESHOLD,
  FOUR_BET_THRESHOLD,
  OPEN_THRESHOLDS,
  THREE_BET_THRESHOLD,
} from './open-thresholds';
import type { Objective } from './types';
import type { DecisionMark, ObjectiveProgressView } from './views';

// ---------------------------------------------------------------------------
// 상수 (수치를 바꾸면 목표 판정과 리뷰 마크가 함께 움직인다)

/**
 * '약한 핸드(junk)' 임계 — Chen 백분위(0=최강 ~ 1=최약)가 이 값보다 크면 하위 절반이다.
 * 6-max 기준으로 어떤 포지션에서도 오픈 레인지에 들어가지 않는 구간의 보수적 하한.
 */
export const JUNK_PERCENTILE = 0.5;

/** '프리미엄' 임계 — 상위 15%(A7 ③ 프리플랍 폴드 ⚠ 구간의 기준). */
export const PREMIUM_PERCENTILE = 0.15;

/**
 * 가격 판정 허용 오차 5%p (A7 ③ "경계 ±5%p"). 에퀴티 추정이 근사값이라
 * 이 폭 안의 결정은 오답(⚠)으로 세지 않고 🤔로만 표시한다.
 */
export const EQUITY_TOLERANCE = 0.05;

/** 라이브 점수 가중치 — primary 0.7 / bonus 0.3, 한쪽 버킷이 비면 재정규화한다. */
export const PRIMARY_WEIGHT = 0.7;
export const BONUS_WEIGHT = 0.3;

/** minRatio 미지정 비율 목표의 기본값 — "기회를 전부 실행"(챕터 데이터는 항상 명시할 것). */
export const DEFAULT_MIN_RATIO = 1;

/** 부동소수 비교용 여유 (2/3 같은 값이 자기 자신과 어긋나지 않게). */
const RATIO_EPSILON = 1e-9;

/**
 * 메이드 핸드의 쇼다운 가치 근사 (핸드 랭크 순서값 → 상대 1명 대비 에퀴티).
 * 정밀 시뮬레이션이 아니라 "오즈가 맞는 콜인가"를 가르는 용도의 거친 표다 —
 * 원페어는 톱페어 여부로 갈리므로 아래 `madeEquity()`가 따로 처리한다.
 */
const MADE_EQUITY: readonly number[] = [
  0.10, // high-card
  0.35, // one-pair (madeEquity가 톱페어 여부로 재정의)
  0.65, // two-pair
  0.78, // three-of-a-kind
  0.85, // straight
  0.90, // flush
  0.94, // full-house
  0.97, // four-of-a-kind
  0.97, // straight-flush
  0.97, // royal-flush
];

const TOP_PAIR_EQUITY = 0.50;
const WEAK_PAIR_EQUITY = 0.28;

// ---------------------------------------------------------------------------
// 핸드 강도 유틸

/**
 * 톱페어 이상인가 — 리버 밸류벳 기회 판정과 아우츠 필터의 공용 기준.
 * 투페어+는 무조건 true. 원페어는 ①포켓 오버페어 ②보드 최고 랭크를 내 카드로 페어시킨 경우만 true다
 * (보드 페어를 빌린 원페어는 내 카드가 관여하지 않으므로 false).
 */
export function isTopPairOrBetter(hole: readonly Card[], board: readonly Card[]): boolean {
  if (hole.length !== 2 || board.length < 3) return false;
  const order = handRankOrder(evaluateHand([...hole], [...board]).rank);
  if (order >= handRankOrder('two-pair')) return true;
  if (order < handRankOrder('one-pair')) return false;

  const boardValues = board.map(card => rankValue(card.rank));
  const topBoard = Math.max(...boardValues);
  const [a, b] = hole;
  if (a.rank === b.rank) return rankValue(a.rank) > topBoard;

  const matched = [a, b]
    .map(card => rankValue(card.rank))
    .filter(value => boardValues.includes(value));
  if (matched.length === 0) return false;
  return Math.max(...matched) >= topBoard;
}

function madeEquity(hole: readonly Card[], board: readonly Card[]): number {
  const rank: HandRank = evaluateHand([...hole], [...board]).rank;
  const order = handRankOrder(rank);
  if (order === handRankOrder('one-pair')) {
    return isTopPairOrBetter(hole, board) ? TOP_PAIR_EQUITY : WEAK_PAIR_EQUITY;
  }
  return MADE_EQUITY[order] ?? MADE_EQUITY[0];
}

/**
 * 아우츠 — "다음 1장으로 내 핸드 랭크가 올라가는 카드" 중 아래를 모두 만족하는 것만 센다.
 * ① **홀카드가 관여**할 것(내 카드와 페어 / 내 수트로 플러시 / 스트레이트+ 완성) — 보드가 페어되는
 *    카드는 상대도 같이 좋아지므로 아우츠가 아니다(전형적인 아우츠 과대계산 원인).
 * ② 결과가 원페어면 **톱페어 이상**일 것 — AKQ 보드에서 7을 페어시키는 카드는 아우츠가 아니다.
 * ③ (카드 5장 이상이 되는 턴부터) 보드만 플레이하는 것보다 강할 것.
 * 플랍·턴 전용 근사다 — 메이드 핸드의 추가 개선(세트 → 풀하우스 등)은 세지 않는다.
 */
export function countHeroOuts(hole: readonly Card[], board: readonly Card[]): number {
  if (hole.length !== 2 || board.length < 3 || board.length > 4) return 0;
  const heroCards = [...hole];
  const baseOrder = handRankOrder(evaluateHand(heroCards, [...board]).rank);
  const heroRanks = new Set(hole.map(card => card.rank));
  const heroSuits = new Set(hole.map(card => card.suit));
  const straightOrder = handRankOrder('straight');
  const flushOrder = handRankOrder('flush');
  const pairOrder = handRankOrder('one-pair');

  let count = 0;
  for (const card of unseenCards([...hole, ...board])) {
    const next = [...board, card];
    const evaluated = evaluateHand(heroCards, next);
    const order = handRankOrder(evaluated.rank);
    if (order <= baseOrder) continue;
    if (order === pairOrder && !isTopPairOrBetter(hole, next)) continue;

    const usesHero = heroRanks.has(card.rank)
      || (heroSuits.has(card.suit) && order >= flushOrder)
      || order >= straightOrder;
    if (!usesHero) continue;
    if (next.length >= 5 && evaluated.value <= evaluateHand([], next).value) continue;
    count++;
  }
  return count;
}

export interface HeroEquityEstimate {
  /** 0~1 추정 에퀴티 (메이드 가치와 드로우 확률 중 큰 쪽). */
  equity: number;
  /** 드로우 아우츠 — 리버(더 올 카드 없음)면 null. */
  outs: number | null;
}

/**
 * 히어로 에퀴티의 v1 근사 — **결정론·무작위 없음**.
 * `max(메이드 핸드 쇼다운 가치, 아우츠 완성 확률)`로 잡는다. 상대 레인지를 모르는 라이브 리뷰에서
 * 몬테카를로를 돌리면 같은 핸드가 매번 다르게 채점될 수 있으므로 근사 + ±5%p 허용오차로 간다.
 * 보드가 3~5장이 아니면(프리플랍) null.
 */
export function estimateHeroEquity(
  hole: readonly Card[],
  board: readonly Card[],
): HeroEquityEstimate | null {
  if (hole.length !== 2 || board.length < 3 || board.length > 5) return null;
  const made = madeEquity(hole, board);
  const cardsToCome = 5 - board.length;
  if (cardsToCome === 0) return { equity: made, outs: null };

  const outs = countHeroOuts(hole, board);
  const unseen = unseenCards([...hole, ...board]).length;
  const draw = outs > 0 ? exactDrawPct(outs, unseen, cardsToCome as 1 | 2) / 100 : 0;
  return { equity: Math.max(made, draw), outs };
}

/**
 * 가격 결정(콜/폴드) 마크. 콜은 에퀴티가 필요 승률 이상이면 👍, 5%p 이내로 모자라면 🤔, 그 밖은 ⚠.
 * 폴드는 정확히 반대 — 에퀴티가 필요 승률을 5%p 넘게 웃도는데 폴드했으면 ⚠.
 * `correct`(목표 집계)는 "⚠가 아님"과 같은 뜻이라 목표와 리뷰가 절대 어긋나지 않는다.
 */
export function classifyPricedDecision(
  kind: 'call' | 'fold',
  equity: number,
  requiredEquity: number,
): DecisionMark {
  const margin = equity - requiredEquity;
  if (kind === 'call') {
    if (margin >= 0) return 'good';
    return margin >= -EQUITY_TOLERANCE ? 'hmm' : 'warn';
  }
  if (margin <= 0) return 'good';
  return margin <= EQUITY_TOLERANCE ? 'hmm' : 'warn';
}

// ---------------------------------------------------------------------------
// 핸드 사실(facts)

export interface PricedDecisionFact {
  street: Street;
  /** 콜에 필요한 추가 투입액 (폴드면 접은 시점의 콜 금액). */
  toCall: number;
  /** **상대 벳을 포함한 중앙 총액** — `computePotOdds`의 potTotal 정의와 동일. */
  potTotal: number;
  /** 콜 필요 승률 0~1. */
  potOdds: number;
  /** 추정 에퀴티 0~1. */
  equity: number;
  /** 드로우 아우츠 (리버면 null). */
  outs: number | null;
  mark: DecisionMark;
  /** ⚠가 아니면 true — 목표 `correct-pot-odds-call`의 집계 단위. */
  correct: boolean;
  /** `record.actions` 인덱스 — 리뷰가 시간순을 복원할 때 쓴다. */
  actionIndex: number;
}

export interface PreflopDecisionFact {
  action: ActionType;
  amount: number;
  actionIndex: number;
}

export interface HeroHandFacts {
  handNumber: number;
  /** 히어로가 이 핸드에 딜인됐는가 — false면 어떤 집계에도 들어가지 않는다. */
  dealtIn: boolean;
  won: boolean;
  /** 히어로 순이익 (won − totalContributed, 미응수 반환 반영). */
  netChips: number;
  /** 블라인드를 뺀 자발적 프리플랍 투입(콜/레이즈/올인). */
  preflopVpip: boolean;
  /** 프리플랍에 폴드했는가 (림프 후 폴드면 preflopVpip와 동시에 true). */
  preflopFolded: boolean;
  /** 프리플랍 첫 자발적 결정(체크 제외) — 없으면 null. */
  preflopDecision: PreflopDecisionFact | null;
  /** 블라인드 포스팅·미응수 반환을 뺀 히어로 액션 수. */
  voluntaryActions: number;
  /** Chen 백분위 0~1 (낮을수록 강함). 홀카드를 모르면 null. */
  heroHandPercentile: number | null;
  /** 백분위가 JUNK_PERCENTILE보다 약한 핸드. */
  junk: boolean;
  potOddsCalls: PricedDecisionFact[];
  potOddsFolds: PricedDecisionFact[];
  /** 히어로가 프리플랍 마지막 어그레서로 플랍을 봤는가. */
  wasAggressorOnFlop: boolean;
  cbetOpportunity: boolean;
  cbet: boolean;
  riverValueBetOpportunity: boolean;
  riverValueBet: boolean;
  /** 핸드 종료 시 스택 0 (시작 스택 + 순이익). */
  bustedThisHand: boolean;
  /** 히어로가 폴드하지 않고 경합 쇼다운까지 갔는가. */
  sawShowdown: boolean;
  /** 어느 스트리트든 히어로가 폴드했는가. */
  folded: boolean;
  /** 언오픈 팟에서 포지션 임계(OPEN_THRESHOLDS) 안 핸드로 첫 프리플랍 결정을 맞았는가 — 오픈 레이즈 기회. */
  openRaiseOpportunity: boolean;
  /** 그 기회에 레이즈(올인 포함)로 열었는가. */
  openRaise: boolean;

  // ── 2막 (Ch4~6)
  /** 언오픈 팟에서 첫 결정이 콜(림프)이었는가 — BB의 체크는 림프가 아니다. */
  limped: boolean;
  /** 스틸 기회 — CO/BTN 언오픈 팟 + 포지션 임계 안 핸드 (`open-raise`의 레이트 포지션 부분집합). */
  stealOpportunity: boolean;
  /** 그 기회에 오픈 레이즈했는가. */
  stealOpen: boolean;
  /** 리버 첫 자유 액션이 벳인데 톱페어 미만(에어)이었는가 — 스테이션 상대 블러프 금지 목표의 위반 단위. */
  riverAirBet: boolean;
  /** 리버 밸류벳(`riverValueBet`)의 벳 전 팟 대비 크기 % — 밸류벳이 아니면 null. */
  riverValueBetPct: number | null;
  /** 앞자리 오픈(레이즈 1회) 뒤 첫 결정을 맞았는가. */
  facedOpen: boolean;
  /** 오픈을 맞은 핸드가 3벳 구간(상위 THREE_BET_THRESHOLD%)인가 — 프리미엄 3벳 기회. */
  premiumThreeBetOpportunity: boolean;
  /** 그 기회에 3벳(레이즈·올인)했는가. */
  premiumThreeBet: boolean;
  /** 내 오픈 레이즈가 3벳을 맞고 다시 내 차례가 왔는가. */
  facedThreeBet: boolean;
  /** 3벳을 맞은 핸드가 콜 구간 밖(상위 CALL_VS_THREE_BET_THRESHOLD% 밖)인가 — 폴드해야 하는 기회. */
  junkVsThreeBet: boolean;
  /** 3벳을 맞고 폴드했는가. */
  foldedVsThreeBet: boolean;
  /** 4벳 구간(상위 FOUR_BET_THRESHOLD%) 밖 핸드로 4벳했는가 — 위반 단위. */
  junkFourBet: boolean;
}

function emptyFacts(handNumber: number): HeroHandFacts {
  return {
    handNumber,
    dealtIn: false,
    won: false,
    netChips: 0,
    preflopVpip: false,
    preflopFolded: false,
    preflopDecision: null,
    voluntaryActions: 0,
    heroHandPercentile: null,
    junk: false,
    potOddsCalls: [],
    potOddsFolds: [],
    wasAggressorOnFlop: false,
    cbetOpportunity: false,
    cbet: false,
    riverValueBetOpportunity: false,
    riverValueBet: false,
    bustedThisHand: false,
    sawShowdown: false,
    folded: false,
    openRaiseOpportunity: false,
    openRaise: false,
    limped: false,
    stealOpportunity: false,
    stealOpen: false,
    riverAirBet: false,
    riverValueBetPct: null,
    facedOpen: false,
    premiumThreeBetOpportunity: false,
    premiumThreeBet: false,
    facedThreeBet: false,
    junkVsThreeBet: false,
    foldedVsThreeBet: false,
    junkFourBet: false,
  };
}

/** 스틸 포지션 — Ch4 「BTN/CO 스틸 기회」. SB 스틸은 블라인드 대 블라인드라 따로 세지 않는다. */
const STEAL_POSITIONS: ReadonlySet<string> = new Set(['CO', 'BTN']);

function isVoluntaryKind(kind: HandHistoryActionKind): kind is ActionType {
  return kind !== 'post-sb' && kind !== 'post-bb' && kind !== 'post-ante' && kind !== 'uncalled-return';
}

function boardForStreet(board: readonly Card[], street: PlayStreet): Card[] | null {
  const need = street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' ? 5 : 0;
  if (need === 0 || board.length < need) return null;
  return board.slice(0, need);
}

function maxStreetBet(state: ReplayContributionState): number {
  return Math.max(0, ...Array.from(state.streetBets.values()));
}

/**
 * `CompletedHandRecord` 하나에서 히어로 관점 사실을 뽑는다.
 * 액션 타임라인을 한 번 훑으며 스트리트별 팟·벳을 재구성하므로(hand-history-replay 계약)
 * 팟오즈 판정의 '팟'은 항상 상대 벳을 포함한 중앙 총액이다.
 */
export function deriveHeroHandFacts(record: CompletedHandRecord, heroId: string): HeroHandFacts {
  const hero = record.players.find(player => player.id === heroId);
  if (!hero) return emptyFacts(record.handNumber);

  const facts = emptyFacts(record.handNumber);
  facts.dealtIn = true;
  facts.netChips = hero.profit;
  facts.won = record.winners.some(winner => winner.playerId === heroId && winner.amount > 0);
  facts.bustedThisHand = hero.startingChips + hero.profit <= 0;

  const hole = hero.holeCards && hero.holeCards.length === 2 ? hero.holeCards : null;
  if (hole) {
    const percentile = handPercentile(hole);
    facts.heroHandPercentile = percentile;
    facts.junk = percentile > JUNK_PERCENTILE;
  }

  let state = createReplayContributionState();
  let street: PlayStreet = 'preflop';
  let preflopAggressorId: string | null = null;
  let heroFolded = false;
  let flopFirstFree: HandHistoryActionKind | null = null;
  let riverFirstFree: HandHistoryActionKind | null = null;
  /** 리버 첫 자유 액션이 벳이었을 때의 (벳 크기, 벳 전 팟) — 사이징 목표용. 콜백 안에서 채우므로 홀더로 둔다. */
  const riverBet: { current: { amount: number; potBefore: number } | null } = { current: null };
  /** 프리플랍 레이즈 횟수(블라인드 제외) — 첫 결정에서 1이면 "오픈을 맞았다". */
  let preflopRaises = 0;
  /** 히어로가 언오픈 팟을 레이즈로 열었는가 + 그 뒤 다른 사람의 리레이즈 수. */
  let heroOpened = false;
  let raisesAfterHeroOpen = 0;
  const pct = facts.heroHandPercentile === null ? null : facts.heroHandPercentile * 100;

  record.actions.forEach((action, actionIndex) => {
    if (action.street !== street && action.street !== 'showdown') {
      street = action.street as PlayStreet;
      state = { ...state, streetBets: new Map<string, number>() };
    }
    const maxBet = maxStreetBet(state);
    const heroBet = state.streetBets.get(heroId) ?? 0;
    const toCall = Math.max(0, maxBet - heroBet);
    const isHero = action.playerId === heroId;
    const aggressive = (action.kind === 'raise' || action.kind === 'all-in') && action.amount > maxBet;

    if (aggressive && action.street === 'preflop') {
      preflopAggressorId = action.playerId;
      if (heroOpened && !isHero) raisesAfterHeroOpen++;
    }

    if (isHero && isVoluntaryKind(action.kind)) {
      facts.voluntaryActions++;
      if (action.kind === 'fold') heroFolded = true;

      if (action.street === 'preflop') {
        if (action.kind === 'call' || action.kind === 'raise' || action.kind === 'all-in') {
          facts.preflopVpip = true;
        }
        if (action.kind === 'fold') facts.preflopFolded = true;
        if (!facts.preflopDecision && action.kind !== 'check') {
          facts.preflopDecision = { action: action.kind, amount: action.amount, actionIndex };
          const raised = action.kind === 'raise' || action.kind === 'all-in';
          // 오픈 레이즈 기회: 앞에 레이즈가 없고(테이블 벳 ≤ BB) 내 포지션 임계 안의 핸드일 때만.
          // 림프는 기회를 "놓친" 것으로 센다 — Ch2 「림프 대신 레이즈/폴드」와 같은 규약.
          const threshold = OPEN_THRESHOLDS[hero.position];
          const unopened = maxBet <= record.bigBlind;
          if (unopened && threshold !== undefined && pct !== null && pct < threshold) {
            facts.openRaiseOpportunity = true;
            facts.openRaise = raised;
            if (STEAL_POSITIONS.has(hero.position)) {
              facts.stealOpportunity = true;
              facts.stealOpen = raised;
            }
          }
          if (unopened && action.kind === 'call') facts.limped = true;
          if (unopened && raised) heroOpened = true;
          // 앞자리 오픈(레이즈 정확히 1회)을 맞은 첫 결정 — 프리미엄이면 3벳 기회(Ch6).
          if (!unopened && preflopRaises === 1) {
            facts.facedOpen = true;
            if (pct !== null && pct < THREE_BET_THRESHOLD) {
              facts.premiumThreeBetOpportunity = true;
              facts.premiumThreeBet = raised;
            }
          }
        } else if (facts.preflopDecision && heroOpened && raisesAfterHeroOpen >= 1 && !facts.facedThreeBet
          && action.kind !== 'check') {
          // 내 오픈이 3벳을 맞고 다시 내 차례 — 3구간 판정(Ch6).
          facts.facedThreeBet = true;
          const raised = action.kind === 'raise' || action.kind === 'all-in';
          if (pct !== null) {
            facts.junkVsThreeBet = pct >= CALL_VS_THREE_BET_THRESHOLD;
            facts.junkFourBet = raised && pct >= FOUR_BET_THRESHOLD;
          }
          facts.foldedVsThreeBet = action.kind === 'fold';
        }
        if (aggressive) preflopRaises++;
      } else {
        if (street === 'flop' && flopFirstFree === null && toCall === 0) flopFirstFree = action.kind;
        if (street === 'river' && riverFirstFree === null && toCall === 0) {
          riverFirstFree = action.kind;
          if (action.kind === 'raise' || action.kind === 'all-in') riverBet.current = { amount: action.amount, potBefore: state.pot };
        }

        const streetBoard = hole ? boardForStreet(record.board, street) : null;
        // 콜 = 'call' 또는 콜 금액에 못 미치는 'all-in'(실질 콜). 벳을 넘기는 올인은 레이즈라 제외.
        const called = action.kind === 'call' || (action.kind === 'all-in' && action.amount <= maxBet);
        const folded = action.kind === 'fold';
        if (streetBoard && hole && toCall > 0 && (called || folded)) {
          const paid = action.kind === 'all-in' ? Math.min(toCall, action.amount - heroBet) : toCall;
          const estimate = paid > 0 && state.pot > 0 ? estimateHeroEquity(hole, streetBoard) : null;
          if (estimate) {
            const odds = computePotOdds(paid, state.pot);
            const kind = called ? 'call' : 'fold';
            const mark = classifyPricedDecision(kind, estimate.equity, odds.requiredEquity);
            const fact: PricedDecisionFact = {
              street,
              toCall: paid,
              potTotal: state.pot,
              potOdds: odds.requiredEquity,
              equity: estimate.equity,
              outs: estimate.outs,
              mark,
              correct: mark !== 'warn',
              actionIndex,
            };
            if (called) facts.potOddsCalls.push(fact);
            else facts.potOddsFolds.push(fact);
          }
        }
      }
    }

    // 상대의 프리플랍 레이즈도 세야 "오픈을 맞았다"가 성립한다 (히어로 분기 안에서는 히어로 레이즈만 셌다).
    if (!isHero && aggressive && action.street === 'preflop') preflopRaises++;
    state = applyReplayContribution(state, action);
  });

  const sawFlop = record.board.length >= 3 && !facts.preflopFolded;
  facts.wasAggressorOnFlop = sawFlop && preflopAggressorId === heroId;
  facts.cbetOpportunity = facts.wasAggressorOnFlop && flopFirstFree !== null;
  facts.cbet = facts.cbetOpportunity && (flopFirstFree === 'raise' || flopFirstFree === 'all-in');

  const river = hole && record.board.length === 5 ? record.board.slice(0, 5) : null;
  const strongOnRiver = river !== null && hole !== null && isTopPairOrBetter(hole, river);
  facts.riverValueBetOpportunity = strongOnRiver && riverFirstFree !== null && !heroFolded;
  facts.riverValueBet = facts.riverValueBetOpportunity
    && (riverFirstFree === 'raise' || riverFirstFree === 'all-in');
  const bet = riverBet.current;
  if (facts.riverValueBet && bet && bet.potBefore > 0) {
    facts.riverValueBetPct = Math.round((bet.amount / bet.potBefore) * 100);
  }
  // 에어 리버 벳: 리버 첫 자유 액션이 벳인데 톱페어 미만(스트레이트+ 메이드는 밸류로 본다).
  const madeOnRiver = river !== null && hole !== null
    && handRankOrder(evaluateHand([...hole], [...river]).rank) >= handRankOrder('straight');
  facts.riverAirBet = river !== null && !heroFolded && !strongOnRiver && !madeOnRiver
    && (riverFirstFree === 'raise' || riverFirstFree === 'all-in');
  facts.folded = heroFolded;
  facts.sawShowdown = record.showdown && !heroFolded;

  return facts;
}

// ---------------------------------------------------------------------------
// 누적 · 판정

export interface ObjectiveTally {
  hands: HeroHandFacts[];
}

export function emptyTally(): ObjectiveTally {
  return { hands: [] };
}

/**
 * 핸드 하나를 누적한다(불변 스타일 — 새 tally 반환).
 * **딜인되지 않은 핸드는 그대로 버린다** — 히어로 타임아웃·자리비움으로 봇끼리 돈 핸드가
 * hands-played나 비율 목표의 분모에 섞이면 안 된다(B3(d) 계약 ②).
 */
export function addHand(tally: ObjectiveTally, facts: HeroHandFacts): ObjectiveTally {
  if (!facts.dealtIn) return { hands: [...tally.hands] };
  return { hands: [...tally.hands, facts] };
}

export interface ObjectiveExtras {
  final?: boolean;
  readingResponses?: Partial<Record<'gumi-river-call' | 'honest-river-fold' | 'luna-checkraise-fold', { opportunities: number; correct: number }>>;
  /** 라이브 리딩 퀴즈 집계 (Ch7+) — 없으면 quiz-accuracy는 판정 불가(null). */
  quiz?: { issued?: number; answered: number; correct: number; required?: number };
  opponentResponse?: { opportunities: number; correct: number };
}

function view(
  objective: Objective,
  primary: boolean,
  progress: number,
  target: number | null,
  achieved: boolean | null,
): ObjectiveProgressView {
  return { id: objective.id, kind: objective.kind, label: objective.label, primary, progress, target, achieved };
}

/**
 * 비율(기회 중 실행) 목표.
 * - `maxCount`가 있으면 위반(기회 − 실행) 상한 — 기회 0이면 위반 0이라 항상 판정 가능하다.
 * - `target`이 있으면 실행 횟수 목표 — 기회 0이면 판정 불가(null): "기회가 안 왔다"를 실패로 세지 않는다.
 * - 둘 다 없으면 minRatio(기본 1) 비율.
 */
function ratioView(
  objective: Objective,
  primary: boolean,
  opportunities: number,
  executed: number,
): ObjectiveProgressView {
  if (objective.maxCount !== undefined) {
    const misses = Math.max(0, opportunities - executed);
    return view(objective, primary, misses, objective.maxCount, misses <= objective.maxCount);
  }
  if (objective.target !== undefined) {
    if (opportunities === 0) return view(objective, primary, 0, objective.target, null);
    return view(objective, primary, executed, objective.target, executed >= objective.target);
  }
  if (opportunities === 0) return view(objective, primary, 0, null, null);
  const minRatio = objective.minRatio ?? DEFAULT_MIN_RATIO;
  const ratio = executed / opportunities;
  return view(objective, primary, ratio, minRatio, ratio >= minRatio - RATIO_EPSILON);
}

function countView(
  objective: Objective,
  primary: boolean,
  count: number,
  fallbackTarget = 1,
): ObjectiveProgressView {
  const target = objective.target ?? fallbackTarget;
  return view(objective, primary, count, target, count >= target);
}

export function evaluateObjective(
  objective: Objective,
  tally: ObjectiveTally,
  primary: boolean,
  extras?: ObjectiveExtras,
): ObjectiveProgressView {
  const hands = tally.hands;
  switch (objective.kind) {
    case 'hands-played':
      return countView(objective, primary, hands.length);

    case 'win-hands':
      return countView(objective, primary, hands.filter(hand => hand.won).length);

    case 'net-chips': {
      // params.bb가 있으면 목표를 BB 단위로 읽는다(챕터 데이터가 스택 표기와 같아지도록).
      const bbRaw = objective.params?.bb;
      const bb = typeof bbRaw === 'number' && bbRaw > 0 ? bbRaw : null;
      const chips = hands.reduce((sum, hand) => sum + hand.netChips, 0);
      const progress = bb ? chips / bb : chips;
      const target = objective.target ?? 0;
      if (hands.length === 0) return view(objective, primary, progress, target, null);
      return view(objective, primary, progress, target, progress >= target);
    }

    case 'fold-preflop-junk': {
      const opportunities = hands.filter(hand => hand.junk);
      const executed = opportunities.filter(hand => hand.preflopFolded);
      return ratioView(objective, primary, opportunities.length, executed.length);
    }

    case 'no-junk-entry': {
      const count = hands.filter(hand => hand.junk && hand.preflopVpip).length;
      const maxCount = objective.maxCount ?? 0;
      return view(objective, primary, count, maxCount, count <= maxCount);
    }

    case 'cbet-when-aggressor': {
      const opportunities = hands.filter(hand => hand.cbetOpportunity);
      const executed = opportunities.filter(hand => hand.cbet);
      return ratioView(objective, primary, opportunities.length, executed.length);
    }

    case 'correct-pot-odds-call': {
      // 이름은 레거시 — 벳 대면 콜/폴드 **가격 결정 전체**가 집계 단위다.
      let opportunities = 0;
      let executed = 0;
      for (const hand of hands) {
        for (const decision of [...hand.potOddsCalls, ...hand.potOddsFolds]) {
          opportunities++;
          if (decision.correct) executed++;
        }
      }
      return ratioView(objective, primary, opportunities, executed);
    }

    case 'value-bet-river': {
      const opportunities = hands.filter(hand => hand.riverValueBetOpportunity);
      const executed = opportunities.filter(hand => hand.riverValueBet);
      return ratioView(objective, primary, opportunities.length, executed.length);
    }

    case 'survive': {
      if (hands.length === 0) return view(objective, primary, 0, null, null);
      const survived = !hands.some(hand => hand.bustedThisHand);
      return view(objective, primary, survived ? 1 : 0, 1, survived);
    }

    case 'reach-showdown':
      return countView(objective, primary, hands.filter(hand => hand.sawShowdown).length);

    case 'fold-hands':
      return countView(objective, primary, hands.filter(hand => hand.folded).length);

    case 'open-raise': {
      const opportunities = hands.filter(hand => hand.openRaiseOpportunity);
      const executed = opportunities.filter(hand => hand.openRaise);
      return ratioView(objective, primary, opportunities.length, executed.length);
    }

    // ── 2막
    case 'no-limp': {
      const count = hands.filter(hand => hand.limped).length;
      const maxCount = objective.maxCount ?? 0;
      return view(objective, primary, count, maxCount, count <= maxCount);
    }

    case 'steal-open': {
      const opportunities = hands.filter(hand => hand.stealOpportunity);
      const executed = opportunities.filter(hand => hand.stealOpen);
      return ratioView(objective, primary, opportunities.length, executed.length);
    }

    case 'no-air-river-bet': {
      const count = hands.filter(hand => hand.riverAirBet).length;
      const maxCount = objective.maxCount ?? 0;
      return view(objective, primary, count, maxCount, count <= maxCount);
    }

    case 'value-bet-sizing': {
      // params.minPct — 벳 전 팟 대비 최소 크기 % (기본 50). 기회 = 실제로 한 리버 밸류벳.
      const minRaw = objective.params?.minPct;
      const minPct = typeof minRaw === 'number' && minRaw > 0 ? minRaw : 50;
      const opportunities = hands.filter(hand => hand.riverValueBet && hand.riverValueBetPct !== null);
      const executed = opportunities.filter(hand => (hand.riverValueBetPct ?? 0) >= minPct);
      return ratioView(objective, primary, opportunities.length, executed.length);
    }

    case 'premium-3bet': {
      const opportunities = hands.filter(hand => hand.premiumThreeBetOpportunity);
      const executed = opportunities.filter(hand => hand.premiumThreeBet);
      return ratioView(objective, primary, opportunities.length, executed.length);
    }

    case 'fold-vs-3bet-junk': {
      const opportunities = hands.filter(hand => hand.facedThreeBet && hand.junkVsThreeBet);
      const executed = opportunities.filter(hand => hand.foldedVsThreeBet);
      return ratioView(objective, primary, opportunities.length, executed.length);
    }

    case 'no-junk-4bet': {
      const count = hands.filter(hand => hand.junkFourBet).length;
      const maxCount = objective.maxCount ?? 0;
      return view(objective, primary, count, maxCount, count <= maxCount);
    }

    case 'gumi-river-call':
    case 'honest-river-fold':
    case 'luna-checkraise-fold': {
      const response = extras?.readingResponses?.[objective.kind];
      const opportunities = response?.opportunities ?? 0;
      const correct = response?.correct ?? 0;
      if (opportunities === 0) return view(objective, primary, 0, objective.target ?? null, null);
      const capped = objective.finalOpportunityCap && extras?.final && objective.target !== undefined
        ? { ...objective, target: Math.min(objective.target, opportunities) } : objective;
      return ratioView(capped, primary, opportunities, correct);
    }
    case 'opponent-response': {
      const response = extras?.opponentResponse;
      return ratioView(objective, primary, response?.opportunities ?? 0, response?.correct ?? 0);
    }
    case 'quiz-accuracy': {
      const quiz = extras?.quiz;
      const required = typeof objective.params?.required === 'number' ? objective.params.required : null;
      if (required !== null) {
        const ratio = (quiz?.correct ?? 0) / required;
        const threshold = objective.minRatio ?? DEFAULT_MIN_RATIO;
        return view(objective, primary, ratio, threshold, !!quiz && quiz.required === required
          && (quiz.issued ?? 0) >= required && quiz.answered >= required && ratio >= threshold - RATIO_EPSILON);
      }
      if (!quiz || quiz.answered <= 0) return view(objective, primary, 0, null, null);
      const minRatio = objective.minRatio ?? DEFAULT_MIN_RATIO;
      const ratio = quiz.correct / quiz.answered;
      return view(objective, primary, ratio, minRatio, ratio >= minRatio - RATIO_EPSILON);
    }

    default:
      return view(objective, primary, 0, null, null);
  }
}

export function evaluateObjectives(
  objectives: { primary: Objective[]; bonus: Objective[] },
  tally: ObjectiveTally,
  extras?: ObjectiveExtras,
): ObjectiveProgressView[] {
  return [
    ...objectives.primary.map(objective => evaluateObjective(objective, tally, true, extras)),
    ...objectives.bonus.map(objective => evaluateObjective(objective, tally, false, extras)),
  ];
}

/**
 * primary 목표 통과 여부.
 * - 판정 가능한 primary 중 하나라도 실패면 `false`.
 * - 기회 0 등으로 **전부 판정 불가**(또는 primary 목표 자체가 없음)면 `null` —
 *   `grading.chapterPassed`가 `!== false`로 읽어 통과시킨다(기회 0 목표는 판정에서 제외, A13).
 * - 그 밖엔 `true`.
 */
export function primaryObjectivesMet(views: readonly ObjectiveProgressView[]): boolean | null {
  const primaries = views.filter(item => item.primary);
  if (primaries.some(item => item.achieved === false)) return false;
  const determinable = primaries.filter(item => item.achieved !== null);
  if (determinable.length === 0) return null;
  return true;
}

/**
 * 미션형 조기 종료 판정 — primary 목표가 하나 이상 있고 **전부** 달성(achieved === true)일 때만 true.
 * 판정 불가(null)는 "아직 기회가 오지 않았다"이므로 끝내지 않는다(maxHands 상한에서만 제외된다).
 * 상한형(maxCount) 목표는 위반 전엔 항상 달성이라, 미션형 스텝은 횟수형 primary를 하나 이상 둬야 한다.
 */
export function primaryObjectivesAllAchieved(views: readonly ObjectiveProgressView[]): boolean {
  const primaries = views.filter(item => item.primary);
  return primaries.length > 0 && primaries.every(item => item.achieved === true);
}

/**
 * 라이브 점수 0~1 (`gradeChapter`의 `liveScore`).
 * 목표별 배점은 이진(달성 1 / 미달 0) — 결산 성적표의 ✓/✗ 표기와 같은 기준이다.
 * 판정 불가(achieved === null) 목표는 자기 버킷에서 빠지고, 버킷이 통째로 비면 남은 쪽이 100%를 갖는다.
 * 양쪽 다 비면 0을 반환하므로, 호출부는 그런 런에서 `gradeChapter`에 null을 넘겨야 한다.
 */
export function liveScore(views: readonly ObjectiveProgressView[]): number {
  const bucket = (primary: boolean): number | null => {
    const items = views.filter(item => item.primary === primary && item.achieved !== null);
    if (items.length === 0) return null;
    return items.filter(item => item.achieved).length / items.length;
  };
  const primary = bucket(true);
  const bonus = bucket(false);
  if (primary === null && bonus === null) return 0;
  if (primary === null) return bonus ?? 0;
  if (bonus === null) return primary;
  return primary * PRIMARY_WEIGHT + bonus * BONUS_WEIGHT;
}
