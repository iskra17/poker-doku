/**
 * SnG 스택 구간과 푸시/폴드 칩 EV — 4막(Ch12) 드릴·레슨·해설의 **단일 소스**.
 *
 * 순수 모듈(무작위·DOM·Node API 없음). 캐시 게임의 프리플랍 임계(`open-thresholds.ts`)와는
 * 완전히 다른 축이다 — 캐시는 "레인지 상위 몇 %", 여기는 "남은 스택이 BB 몇 개인가".
 * 두 임계를 한 파일로 합치지 말 것: 학습자가 같은 숫자로 착각한다.
 */

/** 이 BB 이하는 푸시/폴드 구간 (레이즈 후 폴드할 여지가 사실상 없다). */
export const PUSH_FOLD_MAX_BB = 10;
/** 이 BB 이하까지는 숏스택 (푸시/폴드 구간은 제외 — 경계는 겹치지 않는다). */
export const SHORT_STACK_MAX_BB = 20;

export type StackZone = 'push-fold' | 'short' | 'comfortable';

/**
 * 구간 라벨 — 문항 선택지와 해설이 **같은 문자열**을 쓴다.
 * 경계를 겹치게 쓰면(예: '10~20BB') 10BB가 두 구간에 들어가므로 상한/하한을 명시한다.
 */
export const STACK_ZONE_LABEL: Readonly<Record<StackZone, string>> = Object.freeze({
  'push-fold': `푸시/폴드 구간 (${PUSH_FOLD_MAX_BB}BB 이하)`,
  short: `숏스택 (${PUSH_FOLD_MAX_BB}BB 초과 ~ ${SHORT_STACK_MAX_BB}BB 이하)`,
  comfortable: `여유 (${SHORT_STACK_MAX_BB}BB 초과)`,
});

/** 선택지 표시 순서 (얕은 쪽부터). */
export const STACK_ZONE_ORDER: readonly StackZone[] = ['push-fold', 'short', 'comfortable'];

/** BB 배수 → 구간. 구간은 **판단 기준일 뿐 자동 액션이 아니다**(포지션·앞 액션이 답을 바꾼다). */
export function stackZone(bb: number): StackZone {
  if (!Number.isFinite(bb) || bb <= 0) {
    throw new Error(`stackZone: bb must be positive (got ${bb})`);
  }
  if (bb <= PUSH_FOLD_MAX_BB) return 'push-fold';
  if (bb <= SHORT_STACK_MAX_BB) return 'short';
  return 'comfortable';
}

// ---------------------------------------------------------------------------
// 푸시/폴드 칩 EV
// ---------------------------------------------------------------------------

export interface PushFoldCaller {
  /** 이 좌석이 콜할 확률 (0~1). */
  callProb: number;
  /** 이 좌석이 **첫 콜러**일 때의 쇼다운 팟 총액 (히어로 올인 + 콜 + 남은 데드 블라인드). */
  potIfCalls: number;
}

export interface PushFoldEvInput {
  /** 히어로가 밀어 넣는 유효 스택 (콜러는 전부 이 스택을 커버한다고 본다). */
  heroStack: number;
  /** 전원 폴드하면 가져오는 데드머니 (SB + BB + 앤티). */
  blindsTotal: number;
  /** 히어로 **뒤 액션 순서대로**의 좌석들. */
  callers: readonly PushFoldCaller[];
  /** 콜을 맞았을 때 히어로 에퀴티 (0~1). */
  equity: number;
}

export interface PushFoldEvResult {
  /** 전원 폴드 확률 Π(1 − cᵢ). */
  pFoldAll: number;
  /** 각 좌석이 첫 콜러가 될 확률 (입력 순서와 같다). */
  firstCallerProbs: number[];
  /** 폴드 EV 0 기준의 칩 EV. 양수면 올인, 음수면 폴드. */
  evPush: number;
}

/**
 * 푸시(올인) 대 폴드의 **칩 EV** — ICM은 무시한다.
 *
 * 근사 계약(문항 note에 그대로 적는다): ①첫 콜러 이후 추가 콜은 없다, ②좌석끼리의 카드 상관과
 * 앞선 폴드가 주는 카드 정보는 무시하고 콜 확률을 독립으로 곱한다, ③콜러는 히어로를 커버한다.
 * `EV = Π(1−cᵢ)×blindsTotal + Σᵢ (Π_{j<i}(1−c_j))·cᵢ·(equity×potIfCallsᵢ − heroStack)`.
 */
export function pushFoldEv(input: PushFoldEvInput): PushFoldEvResult {
  const { heroStack, blindsTotal, callers, equity } = input;
  if (!Number.isFinite(heroStack) || heroStack <= 0) {
    throw new Error(`pushFoldEv: heroStack must be positive (got ${heroStack})`);
  }
  if (!Number.isFinite(blindsTotal) || blindsTotal < 0) {
    throw new Error(`pushFoldEv: blindsTotal must be non-negative (got ${blindsTotal})`);
  }
  if (!Number.isFinite(equity) || equity < 0 || equity > 1) {
    throw new Error(`pushFoldEv: equity must be within [0, 1] (got ${equity})`);
  }
  if (callers.length === 0) {
    throw new Error('pushFoldEv: at least one caller is required');
  }

  const firstCallerProbs: number[] = [];
  let survive = 1;
  let evCalled = 0;
  for (const caller of callers) {
    if (!Number.isFinite(caller.callProb) || caller.callProb < 0 || caller.callProb > 1) {
      throw new Error(`pushFoldEv: callProb must be within [0, 1] (got ${caller.callProb})`);
    }
    if (!Number.isFinite(caller.potIfCalls) || caller.potIfCalls <= 0) {
      throw new Error(`pushFoldEv: potIfCalls must be positive (got ${caller.potIfCalls})`);
    }
    const firstCall = survive * caller.callProb;
    firstCallerProbs.push(firstCall);
    evCalled += firstCall * (equity * caller.potIfCalls - heroStack);
    survive *= 1 - caller.callProb;
  }

  return { pFoldAll: survive, firstCallerProbs, evPush: survive * blindsTotal + evCalled };
}
