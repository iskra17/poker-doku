/**
 * 비밀 연타 제스처 — 로비 로고를 짧은 시간 안에 N번 탭하면 운영자 모드를 토글한다(순수 상태 머신).
 * 창(window) 안에 count에 닿으면 triggered, 창을 넘기면 첫 탭부터 다시 센다.
 */
export const SECRET_TAP_COUNT = 7;
export const SECRET_TAP_WINDOW_MS = 3_000;

export interface SecretTapState {
  count: number;
  firstAt: number;
}

export interface SecretTapResult {
  state: SecretTapState | null;
  triggered: boolean;
  /** 목표까지 남은 탭 수 (triggered면 0) */
  remaining: number;
}

export function registerSecretTap(
  state: SecretTapState | null,
  now: number,
  options: { count?: number; windowMs?: number } = {},
): SecretTapResult {
  const count = options.count ?? SECRET_TAP_COUNT;
  const windowMs = options.windowMs ?? SECRET_TAP_WINDOW_MS;
  const fresh = !state || now - state.firstAt > windowMs;
  const next: SecretTapState = fresh ? { count: 1, firstAt: now } : { count: state.count + 1, firstAt: state.firstAt };
  if (next.count >= count) return { state: null, triggered: true, remaining: 0 };
  return { state: next, triggered: false, remaining: count - next.count };
}
