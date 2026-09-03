import { describe, expect, it } from 'vitest';
import { registerSecretTap, SECRET_TAP_COUNT, SECRET_TAP_WINDOW_MS } from './secret-tap';

describe('registerSecretTap', () => {
  it('창 안에서 N번 탭하면 triggered, 그 전엔 remaining 카운트다운', () => {
    let state = null as ReturnType<typeof registerSecretTap>['state'];
    for (let i = 1; i < SECRET_TAP_COUNT; i += 1) {
      const result = registerSecretTap(state, 1_000 + i * 100);
      expect(result.triggered).toBe(false);
      expect(result.remaining).toBe(SECRET_TAP_COUNT - i);
      state = result.state;
    }
    const last = registerSecretTap(state, 1_000 + SECRET_TAP_COUNT * 100);
    expect(last.triggered).toBe(true);
    expect(last.remaining).toBe(0);
    expect(last.state).toBeNull();
  });

  it('창을 넘기면 첫 탭부터 다시 센다', () => {
    let state = registerSecretTap(null, 0).state;
    for (let i = 0; i < 3; i += 1) state = registerSecretTap(state, 100 * (i + 1)).state;
    expect(state?.count).toBe(4);
    const late = registerSecretTap(state, SECRET_TAP_WINDOW_MS + 1);
    expect(late.triggered).toBe(false);
    expect(late.state).toEqual({ count: 1, firstAt: SECRET_TAP_WINDOW_MS + 1 });
  });

  it('count/windowMs 옵션을 존중한다', () => {
    const first = registerSecretTap(null, 0, { count: 2, windowMs: 500 });
    expect(first.triggered).toBe(false);
    expect(registerSecretTap(first.state, 400, { count: 2, windowMs: 500 }).triggered).toBe(true);
    expect(registerSecretTap(first.state, 600, { count: 2, windowMs: 500 }).triggered).toBe(false);
  });
});
