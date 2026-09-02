import type { GameState, Player } from '../poker/types';
import type { BotDecision } from './bot-ai';
import { analyzeHand } from './bot-ai';
import { handPercentile } from './hand-rankings';

/**
 * 봇 속마음 (수련 스토리 Ch7+ — spec-story-mode-2026-09 A7 ⑤ / B3(d)).
 *
 * 봇이 실제로 고른 액션을 **이유 코드 + 한 줄 대사**로 옮긴다. 스토리 방의 유일한 휴먼에게만
 * `story-update`로 나가는 정보라 카드·랭크·수트를 절대 담지 않는다 — 카테고리와 대사뿐이다
 * (`game-update`에 실으면 봇 핸드 강도가 그대로 샌다).
 *
 * 순수·결정론: 같은 (player, state, decision)이면 항상 같은 결과. `Math.random` 금지 —
 * 대사 변형은 `(handNumber + seatIndex) % n`으로 고른다.
 *
 * 분류는 봇 AI의 실제 판단 축(`analyzeHand` 강도/드로우, 핸드 백분위, 팟 대비 벳 크기,
 * 스택 깊이, 포지션)을 재사용한 **사후 해석**이다 — 봇의 결정 자체엔 영향을 주지 않는다.
 */

export type BotExplanationCode =
  | 'value-bet' | 'bluff' | 'semi-bluff' | 'draw-chase' | 'priced-call' | 'bluff-catch'
  | 'fold-weak' | 'fold-to-pressure' | 'check-back' | 'trap' | 'steal' | 'defend-blind'
  | 'shove-short' | 'commit-deep' | 'premium-open' | 'speculative-open' | 'limp' | 'forced' | 'unknown';

export interface BotExplanation {
  code: BotExplanationCode;
  text: string;
}

export interface ExplainInput {
  player: Player;
  state: GameState;
  decision: BotDecision;
}

// --- 분류 임계값 (bot-ai의 티어와 같은 눈금을 쓴다) ---

/** 프리플랍 '프리미엄' 백분위 상한 (0=최강) — AA~AK급 오픈 */
export const PREFLOP_PREMIUM_PCT = 0.10;
/** 프리플랍 '투기적' 백분위 상한 — 수딧 커넥터·스몰 페어까지 */
export const PREFLOP_SPECULATIVE_PCT = 0.35;
/** 밸류 벳 하한 강도 (bot-ai 톱페어 굿키커 ≈ 0.62) */
export const VALUE_STRENGTH = 0.60;
/** 트랩(강한 패 체크) 하한 강도 — bot-ai '강한 핸드' 티어와 동일 */
export const TRAP_STRENGTH = 0.65;
/** 몬스터 하한 강도 — bot-ai '몬스터' 티어와 동일 */
export const MONSTER_STRENGTH = 0.85;
/** 폴드가 '압박에 밀린' 것으로 보이는 최소 강도 (이 아래는 그냥 약한 패) */
export const PRESSURE_FOLD_MIN_STRENGTH = 0.30;
/** 팟 대비 콜 금액이 이 비율 이하면 '싼 값' */
export const CHEAP_CALL_RATIO = 0.35;
/** 팟 대비 이 비율 이상이면 '큰 벳' */
export const BIG_BET_RATIO = 0.60;
/** 이 스택(BB) 이하의 올인은 숏스택 쇼브 */
export const SHORT_STACK_BB = 10;

// --- 대사 풀 (카드·랭크·수트 언급 금지, 중립적 1인칭) ---

export const BOT_EXPLANATION_TEXTS: Record<BotExplanationCode, string[]> = {
  'value-bet': [
    '이 정도면 밸류로 갈 만해.',
    '좋은 패니까 값을 받아야지.',
    '여기서 안 받으면 언제 받아.',
  ],
  bluff: [
    '여긴 비어 있어. 그래도 밀어붙인다.',
    '가진 건 없지만 이야기는 만들 수 있어.',
    '아무것도 없을 때가 오히려 기회야.',
  ],
  'semi-bluff': [
    '아직 완성은 아니지만 밀 만한 그림이야.',
    '접히면 좋고, 안 접혀도 뒤가 남았어.',
    '기회가 살아 있으니 공격이 낫다.',
  ],
  'draw-chase': [
    '가격이 맞으니 한 번 더 보자.',
    '완성되면 크게 먹을 수 있어.',
    '아직 뒤가 남았어. 따라간다.',
  ],
  'priced-call': [
    '이 가격이면 부담 없어. 받아준다.',
    '싸게 보는 거니까 콜.',
    '값이 저렴해. 한 번 확인하자.',
  ],
  'bluff-catch': [
    '허풍일 가능성이 충분해. 받아본다.',
    '이 정도면 잡아줘야 하는 자리야.',
    '접기엔 아까운 자리다.',
  ],
  'fold-weak': [
    '이건 아니야. 접는다.',
    '싸울 만한 패가 아니야. 다음 기회에.',
    '여기서 버티는 건 낭비지.',
  ],
  'fold-to-pressure': [
    '압박이 세네. 여기선 물러난다.',
    '이 크기를 감당할 자리는 아니야.',
    '무리해서 따라갈 이유가 없어.',
  ],
  'check-back': [
    '굳이 키울 자리는 아니야. 넘어간다.',
    '여긴 공짜로 보는 게 이득이지.',
    '조용히 지나가자.',
  ],
  trap: [
    '일부러 조용히 간다. 물어주면 좋겠는데.',
    '지금은 숨기는 쪽이 이득이야.',
    '약해 보이게 두는 것도 전략이지.',
  ],
  steal: [
    '다들 약해 보여. 블라인드는 내가 가져간다.',
    '아무도 안 들어왔으니 지금이 기회야.',
    '자리값으로 한 번 눌러본다.',
  ],
  'defend-blind': [
    '이미 낸 몫이 있어. 그냥은 못 준다.',
    '블라인드는 지켜야지.',
    '여기서 매번 접으면 계속 털린다.',
  ],
  'shove-short': [
    '스택이 얕아. 지금 밀어야 해.',
    '더 기다리면 블라인드에 녹는다.',
    '망설일 여유가 없어. 전부 건다.',
  ],
  'commit-deep': [
    '여기까지 왔으면 끝까지 간다.',
    '이 자리는 물러설 데가 없어.',
    '전부 걸 만한 자리야.',
  ],
  'premium-open': [
    '최상급이야. 크게 시작한다.',
    '이런 자리는 망설일 이유가 없지.',
    '처음부터 강하게 간다.',
  ],
  'speculative-open': [
    '가능성이 있어. 싸게 그림을 그려보자.',
    '잘 맞으면 크게 만들 수 있어.',
    '기대해 볼 만한 조합이야.',
  ],
  limp: [
    '일단 싸게 들어가서 보자.',
    '큰 싸움은 나중에. 지금은 구경만.',
    '값이 싸니까 발만 담근다.',
  ],
  forced: [
    '상황이 바뀌었네. 안전하게 간다.',
    '계획이 어긋났어. 일단 넘긴다.',
  ],
  unknown: [
    '음… 여긴 감으로 간다.',
    '판단이 애매해. 무난하게 처리하자.',
  ],
};

/** 대사 변형 선택 — (handNumber + seatIndex) 결정론, Math.random 금지 */
function pickText(code: BotExplanationCode, state: GameState, player: Player): string {
  const variants = BOT_EXPLANATION_TEXTS[code] ?? BOT_EXPLANATION_TEXTS.unknown;
  const hand = Number.isFinite(state?.handNumber) ? Math.trunc(state.handNumber) : 0;
  const seat = Number.isFinite(player?.seatIndex) ? Math.trunc(player.seatIndex) : 0;
  const idx = (((hand + seat) % variants.length) + variants.length) % variants.length;
  return variants[idx];
}

function explanation(code: BotExplanationCode, state: GameState, player: Player): BotExplanation {
  return { code, text: pickText(code, state, player) };
}

// --- 상황 헬퍼 ---

function potTotal(state: GameState): number {
  return (state.pots ?? []).reduce((s, p) => s + (p?.amount ?? 0), 0);
}

/**
 * 딜링에 참여 중인 좌석 기준 버튼/컷오프/SB 여부 — 스틸 스팟 판정용.
 * (bot-ai의 isLatePosition과 같은 규칙. 저쪽은 모듈 비공개라 판정만 복제한다)
 */
function isLatePosition(player: Player, state: GameState): boolean {
  const inHand = (state.players ?? []).filter(
    p => p.status === 'active' || p.status === 'all-in' || p.status === 'folded',
  );
  if (inHand.length < 2) return false;
  const seats = inHand.map(p => p.seatIndex).sort((a, b) => a - b);
  const dealerSeat = state.players[state.dealerIndex]?.seatIndex;
  if (dealerSeat === undefined) return false;
  const dealerPos = seats.indexOf(dealerSeat);
  const myPos = seats.indexOf(player.seatIndex);
  if (dealerPos < 0 || myPos < 0) return false;
  const n = seats.length;
  if (myPos === dealerPos) return true;
  if (myPos === (dealerPos + 1) % n) return true; // SB
  return n >= 4 && myPos === (dealerPos - 1 + n) % n; // 컷오프
}

function isBlindSeat(player: Player, state: GameState): boolean {
  return state.smallBlindId === player.id || state.bigBlindId === player.id;
}

// --- 분류 ---

function explainPreflop(input: ExplainInput): BotExplanation {
  const { player, state, decision } = input;
  const bb = state.bigBlind || 1;
  const toCall = Math.max(0, (state.currentBet ?? 0) - (player.currentBet ?? 0));
  const stackBB = (player.chips + player.currentBet) / bb;
  const pct = player.holeCards?.length === 2 ? handPercentile(player.holeCards) : 1;
  const facingRaise = (state.currentBet ?? 0) > bb;
  const unopened = !facingRaise;

  switch (decision.action) {
    case 'fold':
      return explanation('fold-weak', state, player);

    case 'check':
      // BB 옵션 체크 — 강한 패면 함정, 아니면 그냥 넘김
      return explanation(pct <= PREFLOP_PREMIUM_PCT ? 'trap' : 'check-back', state, player);

    case 'call':
      if (facingRaise && isBlindSeat(player, state)) return explanation('defend-blind', state, player);
      // 레이즈 없는 BB 콜/SB 컴플리트 = 림프
      if (unopened && toCall <= bb) return explanation('limp', state, player);
      return explanation('priced-call', state, player);

    case 'all-in':
      if (stackBB <= SHORT_STACK_BB) return explanation('shove-short', state, player);
      if (pct <= PREFLOP_PREMIUM_PCT) return explanation('commit-deep', state, player);
      if (pct <= PREFLOP_SPECULATIVE_PCT) return explanation('value-bet', state, player);
      return explanation('bluff', state, player);

    case 'raise':
      if (pct <= PREFLOP_PREMIUM_PCT) return explanation('premium-open', state, player);
      if (pct <= PREFLOP_SPECULATIVE_PCT) return explanation('speculative-open', state, player);
      if (unopened && isLatePosition(player, state)) return explanation('steal', state, player);
      return explanation('bluff', state, player);

    default:
      return explanation('unknown', state, player);
  }
}

function explainPostflop(input: ExplainInput): BotExplanation {
  const { player, state, decision } = input;
  const community = state.communityCards ?? [];
  // 홀카드가 마스킹됐거나(공개 스냅샷) 보드가 덜 깔렸으면 강도 판정 불가
  if (player.holeCards?.length !== 2 || community.length < 3) {
    return explanation('unknown', state, player);
  }
  const { strength, draw } = analyzeHand(player, community);
  const bb = state.bigBlind || 1;
  const toCall = Math.max(0, (state.currentBet ?? 0) - (player.currentBet ?? 0));
  const pot = potTotal(state);
  const callRatio = pot > 0 ? toCall / pot : (toCall > 0 ? 1 : 0);
  const stackBB = (player.chips + player.currentBet) / bb;

  switch (decision.action) {
    case 'check':
      return explanation(strength >= TRAP_STRENGTH ? 'trap' : 'check-back', state, player);

    case 'fold':
      return explanation(
        callRatio >= BIG_BET_RATIO && strength >= PRESSURE_FOLD_MIN_STRENGTH
          ? 'fold-to-pressure'
          : 'fold-weak',
        state,
        player,
      );

    case 'call':
      // 드로우 우선 — 완성 전 콜은 값이 싸든 비싸든 '따라가는' 이유가 먼저다
      if (draw > 0 && strength < VALUE_STRENGTH) return explanation('draw-chase', state, player);
      if (callRatio <= CHEAP_CALL_RATIO) return explanation('priced-call', state, player);
      // 값비싼 콜은 상대 블러프 레인지를 잡는 판단 (밸류 콜도 이 코드로 묶는다 — 코드 목록 한계)
      return explanation('bluff-catch', state, player);

    case 'all-in':
      if (stackBB <= SHORT_STACK_BB) return explanation('shove-short', state, player);
      if (strength >= MONSTER_STRENGTH) return explanation('commit-deep', state, player);
      if (strength >= VALUE_STRENGTH) return explanation('value-bet', state, player);
      return explanation(draw > 0 ? 'semi-bluff' : 'bluff', state, player);

    case 'raise':
      if (strength >= VALUE_STRENGTH) return explanation('value-bet', state, player);
      return explanation(draw > 0 ? 'semi-bluff' : 'bluff', state, player);

    default:
      return explanation('unknown', state, player);
  }
}

/**
 * 봇이 고른 액션을 이유 코드 + 대사 한 줄로 해석한다.
 * 알 수 없는 입력(홀카드 마스킹·비정상 상태 등)에도 절대 throw하지 않고 'unknown'을 돌려준다.
 */
export function explainBotDecision(input: ExplainInput): BotExplanation {
  try {
    const { player, state, decision } = input ?? ({} as ExplainInput);
    if (!player || !state || !decision) {
      return { code: 'unknown', text: BOT_EXPLANATION_TEXTS.unknown[0] };
    }
    return state.street === 'preflop' ? explainPreflop(input) : explainPostflop(input);
  } catch {
    return { code: 'unknown', text: BOT_EXPLANATION_TEXTS.unknown[0] };
  }
}

/**
 * 결정이 엔진에 거부돼 체크/폴드로 강제 진행된 경우의 속마음.
 * 원래 결정의 해석을 그대로 내보내면 실제 일어난 액션과 어긋나므로 'forced'로 대체한다.
 */
export function explainForcedAction(player: Player, state: GameState): BotExplanation {
  try {
    return explanation('forced', state, player);
  } catch {
    return { code: 'forced', text: BOT_EXPLANATION_TEXTS.forced[0] };
  }
}
