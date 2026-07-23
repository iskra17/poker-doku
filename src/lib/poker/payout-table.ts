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

const PAYOUT_BANDS: readonly PayoutBand[] = [
  { maxEntrants: 4, percents: [100] },
  { maxEntrants: 7, percents: [65, 35] },
  { maxEntrants: 11, percents: [50, 30, 20] },
  { maxEntrants: 24, percents: [40, 26, 19, 15] },
  { maxEntrants: 34, percents: [38, 25, 16, 12, 9] },
  { maxEntrants: 48, percents: [30, 21, 15, 11, 9, 7.5, 6.5] },
];

/** 필드 크기 → 배분율 (1위부터, %). 48명 초과는 마지막 밴드로 폴백 (확장 시 밴드 추가) */
export function payoutPercents(entrants: number): readonly number[] {
  for (const band of PAYOUT_BANDS) {
    if (entrants <= band.maxEntrants) return band.percents;
  }
  return PAYOUT_BANDS[PAYOUT_BANDS.length - 1].percents;
}

/** 입상 인원 (필드 크기 기준) */
export function paidPlaces(entrants: number): number {
  return payoutPercents(entrants).length;
}

/**
 * 상금 풀 → 순위별 상금 (1위부터). 각 순위는 내림 후 잔여를 1위에 귀속해
 * 합계가 정확히 prizePool과 일치한다.
 */
export function computePayouts(prizePool: number, entrants: number): number[] {
  if (!Number.isSafeInteger(prizePool) || prizePool < 0) {
    throw new Error(`invalid prize pool: ${prizePool}`);
  }
  const percents = payoutPercents(entrants);
  const payouts = percents.map(pct => Math.floor((prizePool * pct) / 100));
  const distributed = payouts.reduce((s, v) => s + v, 0);
  payouts[0] += prizePool - distributed;
  return payouts;
}
