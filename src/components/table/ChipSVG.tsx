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

export default function ChipSVG({ denom, size = 24, showValue = false }: ChipSVGProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {/* 바깥 원 */}
      <circle cx="20" cy="20" r="19" fill={denom.base} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      {/* 엣지 스트라이프 6개 */}
      {Array.from({ length: 6 }).map((_, i) => {
        const angle = i * 60;
        return (
          <rect
            key={i}
            x="17.2"
            y="1"
            width="5.6"
            height="7"
            rx="1.4"
            fill={denom.edge}
            transform={`rotate(${angle} 20 20)`}
          />
        );
      })}
      {/* 내부 링 (점선) */}
      <circle
        cx="20" cy="20" r="12.5"
        fill="none"
        stroke={denom.edge}
        strokeWidth="1.1"
        strokeDasharray="2.4 2.2"
        opacity="0.9"
      />
      {/* 중앙 페이스 */}
      <circle cx="20" cy="20" r="10.5" fill={denom.base} />
      <circle cx="20" cy="20" r="10.5" fill="rgba(255,255,255,0.12)" />
      {showValue && (
        <text
          x="20" y="20"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={denom.value >= 1000 ? 9 : 11}
          fontWeight="800"
          fill={denom.text}
        >
          {denom.value >= 1000 ? `${denom.value / 1000}K` : denom.value}
        </text>
      )}
      {/* 하이라이트 */}
      <ellipse cx="15" cy="13" rx="7" ry="4.5" fill="rgba(255,255,255,0.18)" transform="rotate(-25 15 13)" />
    </svg>
  );
}
