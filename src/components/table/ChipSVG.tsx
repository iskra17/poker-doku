'use client';

/**
 * 정통 포커칩 SVG 프리미티브.
 * 액면별 색상: 5 빨강 / 25 초록 / 100 잉크 / 500 퍼플 / 1K 골드 / 5K 핑크
 * ChipStack, PotDisplay, AnimationLayer(비행 칩)가 공유한다.
 */

export interface ChipDenom {
  value: number;
  base: string;
  edge: string;
  text: string;
}

export const CHIP_DENOMS: ChipDenom[] = [
  { value: 5000, base: '#FF4F9A', edge: '#ffd1e6', text: '#fff' },
  { value: 1000, base: '#E8B33A', edge: '#fff3cf', text: '#5b4300' },
  { value: 500, base: '#8B5CF6', edge: '#e4d6ff', text: '#fff' },
  { value: 100, base: '#2A2E3F', edge: '#c3c9dd', text: '#fff' },
  { value: 25, base: '#2FBE85', edge: '#ccf3e3', text: '#fff' },
  { value: 5, base: '#E14B4B', edge: '#ffd6d6', text: '#fff' },
];

/** 금액 → 칩 액면 분해 (큰 액면 우선, 최대 maxChips개) */
export function decomposeChips(amount: number, maxChips = 6): ChipDenom[] {
  const chips: ChipDenom[] = [];
  let remaining = amount;
  for (const denom of CHIP_DENOMS) {
    while (remaining >= denom.value && chips.length < maxChips) {
      chips.push(denom);
      remaining -= denom.value;
    }
    if (chips.length >= maxChips) break;
  }
  if (chips.length === 0) chips.push(CHIP_DENOMS[CHIP_DENOMS.length - 1]);
  return chips;
}

interface ChipSVGProps {
  denom: ChipDenom;
  size?: number; // px
  showValue?: boolean;
}

/**
 * 아이소메트릭(하단 시점) 칩 — 윗면 타원 + 두께 있는 측면.
 * 윗면 장식은 원 기준으로 그린 뒤 scale(1, ry/rx)로 눌러 시점을 맞춘다 (텍스트는 비변형).
 */
export default function ChipSVG({ denom, size = 24, showValue = false }: ChipSVGProps) {
  const squash = 11 / 18; // ry / rx

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {/* 측면(두께): 아래 타원 + 어둡게 */}
      <ellipse cx="20" cy="24" rx="18" ry="11" fill={denom.base} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <ellipse cx="20" cy="24" rx="18" ry="11" fill="rgba(0,0,0,0.32)" />
      {/* 앞면 엣지 스트라이프 3개 (전면 호를 따라) */}
      <rect x="8.5" y="26" width="5" height="7.5" rx="1.2" fill={denom.edge} opacity="0.9" />
      <rect x="17.5" y="27.5" width="5" height="7.5" rx="1.2" fill={denom.edge} opacity="0.9" />
      <rect x="26.5" y="26" width="5" height="7.5" rx="1.2" fill={denom.edge} opacity="0.9" />
      {/* 윗면 */}
      <ellipse cx="20" cy="17" rx="18" ry="11" fill={denom.base} stroke="rgba(0,0,0,0.3)" strokeWidth="0.8" />
      <g transform={`translate(20 17) scale(1 ${squash})`}>
        {/* 림 스트라이프 6개 */}
        {Array.from({ length: 6 }).map((_, i) => (
          <rect
            key={i}
            x="-2.8"
            y="-18.5"
            width="5.6"
            height="6.5"
            rx="1.4"
            fill={denom.edge}
            transform={`rotate(${i * 60})`}
          />
        ))}
        {/* 내부 링 (점선) */}
        <circle
          r="12.5"
          fill="none"
          stroke={denom.edge}
          strokeWidth="1.1"
          strokeDasharray="2.4 2.2"
          opacity="0.9"
        />
        {/* 중앙 페이스 */}
        <circle r="10.5" fill={denom.base} />
        <circle r="10.5" fill="rgba(255,255,255,0.14)" />
      </g>
      {showValue && (
        <text
          x="20" y="17"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={denom.value >= 1000 ? 8 : 10}
          fontWeight="800"
          fill={denom.text}
        >
          {denom.value >= 1000 ? `${denom.value / 1000}K` : denom.value}
        </text>
      )}
      {/* 하이라이트 */}
      <ellipse cx="14" cy="12" rx="7" ry="3" fill="rgba(255,255,255,0.18)" transform="rotate(-12 14 12)" />
    </svg>
  );
}
