'use client';

import { useEffect, useRef, useState } from 'react';

interface TurnTimerProps {
  /** 서버 스냅샷 기준 남은 시간 (ms) */
  remainingMs: number;
  /** 전체 턴 시간 (초) */
  totalSeconds: number;
  /** 감쌀 아바타 지름 (px) */
  sizePx: number;
  showNumber?: boolean;
}

/**
 * 아바타를 감싸는 원형 SVG 카운트다운 링 + 숫자 배지.
 * 서버가 액션 시점에만 스냅샷을 보내므로, deadline 기준으로 로컬 틱한다 (드리프트 없음).
 */
export default function TurnTimer({ remainingMs, totalSeconds, sizePx, showNumber = true }: TurnTimerProps) {
  // 초기값은 prop 그대로 (렌더 순수성), 이후엔 인터벌 콜백에서만 갱신
  const [remaining, setRemaining] = useState(remainingMs);
  const anchorRef = useRef<{ at: number; base: number } | null>(null);

  useEffect(() => {
    anchorRef.current = { at: Date.now(), base: remainingMs };
    const interval = setInterval(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setRemaining(Math.max(0, anchor.base - (Date.now() - anchor.at)));
    }, 100);
    return () => clearInterval(interval);
  }, [remainingMs]);
  const totalMs = Math.max(1, totalSeconds * 1000);
  const frac = Math.min(1, remaining / totalMs);
  const seconds = Math.ceil(remaining / 1000);

  const stroke = 3;
  const ringSize = sizePx + 10;
  const r = (ringSize - stroke * 2) / 2;
  const circumference = 2 * Math.PI * r;
  const color = frac > 0.5 ? '#6BE4FF' : frac > 0.2 ? '#FFC94D' : '#FF5C5C';

  return (
    <div className="absolute pointer-events-none" style={{ inset: -5 }}>
      <svg width={ringSize} height={ringSize} className="-rotate-90">
        <circle
          cx={ringSize / 2} cy={ringSize / 2} r={r}
          fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke}
        />
        <circle
          cx={ringSize / 2} cy={ringSize / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - frac)}
          style={frac <= 0.2 ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined}
        />
      </svg>
      {showNumber && (
        <div
          className="absolute -bottom-1 -left-1 min-w-[18px] h-[18px] px-0.5 rounded-full bg-black/80 border flex items-center justify-center text-[10px] font-bold tabular"
          style={{ borderColor: color, color }}
        >
          {seconds}
        </div>
      )}
    </div>
  );
}
