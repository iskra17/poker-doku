export interface CashRakeInput {
  totalPot: number;
  bigBlind: number;
  flopDealt: boolean;
  /** 레이크율 만분율 (기본 500 = 5%) — 서버 런타임 설정이 주입, lib은 서버를 import하지 않는다 */
  rateBps?: number;
  /** 레이크 상한 (빅블라인드 배수, 기본 5BB) */
  capBB?: number;
}

function assertSafeNonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a safe nonnegative integer`);
  }
}

export function computeCashRake({
  totalPot,
  bigBlind,
  flopDealt,
  rateBps = 500,
  capBB = 5,
}: CashRakeInput): number {
  assertSafeNonnegativeInteger(totalPot, 'totalPot');
  if (!Number.isSafeInteger(bigBlind) || bigBlind <= 0) {
    throw new RangeError('bigBlind must be a positive safe integer');
  }
  assertSafeNonnegativeInteger(rateBps, 'rateBps');
  if (rateBps > 10_000) {
    throw new RangeError('rateBps must not exceed 10000');
  }
  assertSafeNonnegativeInteger(capBB, 'capBB');
  if (!flopDealt || totalPot === 0) return 0;

  const proportionalRake = (BigInt(totalPot) * BigInt(rateBps)) / BigInt(10_000);
  const cap = BigInt(bigBlind) * BigInt(capBB);
  return Number(proportionalRake < cap ? proportionalRake : cap);
}

export function allocateRakeAcrossPots(pots: readonly number[], rake: number): number[] {
  pots.forEach((amount, index) => assertSafeNonnegativeInteger(amount, `pots[${index}]`));
  assertSafeNonnegativeInteger(rake, 'rake');

  const total = pots.reduce((sum, amount) => sum + BigInt(amount), BigInt(0));
  const exactRake = BigInt(rake);
  if (exactRake > total) {
    throw new RangeError('rake must not exceed total pot');
  }
  if (exactRake === BigInt(0)) return pots.map(() => 0);

  const shares = pots.map((amount, index) => {
    const numerator = BigInt(amount) * exactRake;
    return {
      index,
      allocation: numerator / total,
      remainder: numerator % total,
    };
  });
  let remaining = exactRake - shares.reduce(
    (sum, share) => sum + share.allocation,
    BigInt(0),
  );

  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (const share of byRemainder) {
    if (remaining === BigInt(0)) break;
    share.allocation += BigInt(1);
    remaining -= BigInt(1);
  }

  return shares.map(share => Number(share.allocation));
}
