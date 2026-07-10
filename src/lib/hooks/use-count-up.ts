'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 숫자 카운트업 훅 — 값이 바뀌면 이전 값에서 새 값까지 부드럽게 굴러간다.
 * 팟/칩 금액 표시에 사용. (tabular-nums 클래스와 함께 쓸 것)
 */
export function useCountUp(target: number, durationMs = 400): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    // 0으로 리셋(새 핸드)은 즉시 반영 (rAF 콜백에서 — 렌더 순수성)
    if (target === 0) {
      fromRef.current = 0;
      rafRef.current = requestAnimationFrame(() => setDisplay(0));
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const value = Math.round(from + (target - from) * eased);
      setDisplay(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return display;
}
