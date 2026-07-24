/**
 * MTT 페이아웃 계단표 — 필드 크기별 입상 인원·배분율.
 *
 * 근거 (docs/research-mtt-2026-07-23.md §2-3): 온라인 소규모 MTT 관행
 * (Stars 45인 MT-SnG 7명 입상, 우승 몫 총상금의 ~30%). v1 상한 48명 기준이며
 * 49명+ 확장 시 밴드를 추가한다 (필드 15~18% 입상 계단표).
 *
 * 합계 불변식: computePayouts 결과의 합 === prizePool (반올림 잔여는 1위에 귀속).
 */

interface PayoutBand {
  maxEntrants: number; // 이 인원 이하일 때 적용
  percents: readonly number[]; // 1위부터, 합 100
}

export const PAYOUT_PRESET_IDS = ['standard', 'flat', 'top-heavy'] as const;
export type PayoutPresetId = (typeof PAYOUT_PRESET_IDS)[number];

const STANDARD_BANDS: readonly PayoutBand[] = [
  { maxEntrants: 4, percents: [100] },
  { maxEntrants: 7, percents: [65, 35] },
  { maxEntrants: 11, percents: [50, 30, 20] },
  { maxEntrants: 24, percents: [40, 26, 19, 15] },
  { maxEntrants: 34, percents: [38, 25, 16, 12, 9] },
  { maxEntrants: 48, percents: [30, 21, 15, 11, 9, 7.5, 6.5] },
];

const FLAT_BANDS: readonly PayoutBand[] = [
  { maxEntrants: 2, percents: [100] },
  { maxEntrants: 4, percents: [65, 35] },
  { maxEntrants: 7, percents: [50, 30, 20] },
  { maxEntrants: 11, percents: [40, 28, 19, 13] },
  { maxEntrants: 24, percents: [32, 23, 17, 12, 9, 7] },
  { maxEntrants: 34, percents: [25, 19, 15, 12, 10, 8, 6, 5] },
  { maxEntrants: 48, percents: [20, 16, 13.5, 11, 9.5, 8, 7, 6, 5, 4] },
];

const TOP_HEAVY_BANDS: readonly PayoutBand[] = [
  { maxEntrants: 4, percents: [100] },
  { maxEntrants: 7, percents: [70, 30] },
  { maxEntrants: 11, percents: [65, 35] },
  { maxEntrants: 24, percents: [50, 30, 20] },
  { maxEntrants: 34, percents: [44, 27, 17, 12] },
  { maxEntrants: 48, percents: [36, 25, 17, 12, 10] },
];

export const PAYOUT_PRESETS = {
  standard: { label: '표준형', bands: STANDARD_BANDS },
  flat: { label: '넓은 입상형', bands: FLAT_BANDS },
  'top-heavy': { label: '상위 집중형', bands: TOP_HEAVY_BANDS },
} satisfies Record<PayoutPresetId, {
  label: string;
  bands: readonly PayoutBand[];
}>;

/** 필드 크기 → 배분율 (1위부터, %). 48명 초과는 마지막 밴드로 폴백 (확장 시 밴드 추가) */
export function payoutPercents(
  entrants: number,
  presetId: PayoutPresetId = 'standard',
): readonly number[] {
  if (!Number.isInteger(entrants) || entrants < 2) {
    throw new Error(`invalid entrant count: ${entrants}`);
  }
  const bands = PAYOUT_PRESETS[presetId].bands;
  for (const band of bands) {
    if (entrants <= band.maxEntrants) return band.percents;
  }
  return bands[bands.length - 1].percents;
}

/** 입상 인원 (필드 크기 기준) */
export function paidPlaces(
  entrants: number,
  presetId: PayoutPresetId = 'standard',
): number {
  return payoutPercents(entrants, presetId).length;
}

/**
 * 상금 풀 → 순위별 상금 (1위부터). 각 순위는 내림 후 잔여를 1위에 귀속해
 * 합계가 정확히 prizePool과 일치한다.
 */
export function computePayouts(
  prizePool: number,
  entrants: number,
  presetId: PayoutPresetId = 'standard',
): number[] {
  if (!Number.isSafeInteger(prizePool) || prizePool < 0) {
    throw new Error(`invalid prize pool: ${prizePool}`);
  }
  const percents = payoutPercents(entrants, presetId);
  const payouts = percents.map(pct => Math.floor((prizePool * pct) / 100));
  const distributed = payouts.reduce((s, v) => s + v, 0);
  payouts[0] += prizePool - distributed;
  return payouts;
}
