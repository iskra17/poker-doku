'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

interface TurnTimerProps {
  /** 서버 스냅샷 기준 남은 시간 (ms) */
  remainingMs: number;
  /** 전체 턴 시간 (초) */
  totalSeconds: number;
  /** 감쌀 아바타 지름 (px) */
  sizePx: number;
}

/** 이 시간 미만으로 남으면 좌상단 숫자 카운트다운 표시 (9부터) */
const URGENT_MS = 10_000;

/**
 * 아바타를 감싸는 원형 SVG 카운트다운 링. 평소엔 링만 줄어들고,
 * 10초 미만이 남으면 프로필 좌상단에 9→0 숫자 카운트다운 배지가 뜬다.
 * 서버가 액션 시점에만 스냅샷을 보내므로, deadline 기준으로 로컬 틱한다 (드리프트 없음).
 */
export default function TurnTimer({ remainingMs, totalSeconds, sizePx }: TurnTimerProps) {
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
  // 10초 미만 카운트다운 — floor라 9999ms부터 9로 시작해 0까지 내려간다
  const urgent = remaining < URGENT_MS;
  const countdown = Math.max(0, Math.floor(remaining / 1000));

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
      {/* 긴박 카운트다운 — 프로필 좌상단, 초가 바뀔 때마다 팝 */}
      {urgent && (
        <motion.div
          key={countdown}
          initial={{ scale: 1.5, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 14, stiffness: 400 }}
          className="absolute -top-1 -left-1 min-w-[22px] h-[22px] px-1 rounded-full bg-black/85 border-2 flex items-center justify-center text-[13px] font-black tabular-nums"
          style={{ borderColor: color, color, boxShadow: `0 0 8px ${color}` }}
        >
          {countdown}
        </motion.div>
      )}
    </div>
  );
}
