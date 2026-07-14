import type { ChipDisplayMode } from '@/lib/store/settings-store';

/**
 * 금액 표기 단일 소스 — 칩/BB 표기 토글(chipDisplayMode)이 좌석 칩·팟·베팅액·액션바에
 * 일괄 반영되도록 모든 금액 라벨은 이 함수를 거친다.
 * BB 모드: 현재 빅블라인드 기준, 소수 첫째 자리 반올림 (100.0 → "100BB").
 * 칩 모드: compact면 K/M 축약(베팅 칩 스택처럼 좁은 자리), 아니면 천 단위 구분.
 */
export function formatChipAmount(
  amount: number,
  mode: ChipDisplayMode,
  bigBlind: number,
  opts?: { compact?: boolean },
): string {
  if (mode === 'bb' && bigBlind > 0) {
    const bb = Math.round((amount / bigBlind) * 10) / 10;
    return `${bb.toLocaleString()}BB`;
  }
  if (opts?.compact) {
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
    return amount.toString();
  }
  return amount.toLocaleString();
}
