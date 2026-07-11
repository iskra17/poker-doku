'use client';

import { useEffect, useState } from 'react';

/**
 * 특정 시각(epoch ms)까지 남은 초 — 인터벌 콜백에서만 갱신 (렌더 순수성).
 * target이 0/미래가 아니면 null. 첫 틱(≤500ms) 전에도 null.
 */
export function useCountdownTo(targetMs: number): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!targetMs) return;
    const id = setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((targetMs - Date.now()) / 1000)));
    }, 500);
    return () => clearInterval(id);
  }, [targetMs]);

  return targetMs ? seconds : null;
}

/** 초 → "m:ss" */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
