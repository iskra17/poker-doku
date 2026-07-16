export interface CashRakeInput {
  totalPot: number;
  bigBlind: number;
  flopDealt: boolean;
}

function assertSafeNonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a safe nonnegative integer`);
  }
}

export function computeCashRake({ totalPot, bigBlind, flopDealt }: CashRakeInput): number {
  assertSafeNonnegativeInteger(totalPot, 'totalPot');
  if (!Number.isSafeInteger(bigBlind) || bigBlind <= 0) {
    throw new RangeError('bigBlind must be a positive safe integer');
  }
  if (!flopDealt || totalPot === 0) return 0;

  const proportionalRake = (BigInt(totalPot) * BigInt(5)) / BigInt(100);
  const cap = BigInt(bigBlind) * BigInt(5);
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
