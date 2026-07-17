import { ARENA_CONFIG_V1 } from './config';
import type { MmrDeltaInput } from './types';

export function calculateMmrDelta(input: MmrDeltaInput): number {
  assertMmrInput(input);

  const actualScore = (ARENA_CONFIG_V1.seats - input.place)
    / (ARENA_CONFIG_V1.seats - 1);
  const expectedScore = input.opponentMmrs.reduce(
    (total, opponentMmr) => total + eloExpected(input.playerMmr, opponentMmr),
    0,
  ) / input.opponentMmrs.length;
  const rawDelta = Math.round(input.k * (actualScore - expectedScore));
  return Math.max(
    -ARENA_CONFIG_V1.mmrDeltaCap,
    Math.min(ARENA_CONFIG_V1.mmrDeltaCap, rawDelta),
  );
}

function eloExpected(playerMmr: number, opponentMmr: number): number {
  return 1 / (1 + 10 ** ((opponentMmr - playerMmr) / 400));
}

function assertMmrInput(input: MmrDeltaInput): void {
  if (
    !input
    || !Number.isSafeInteger(input.playerMmr)
    || !Array.isArray(input.opponentMmrs)
    || input.opponentMmrs.length !== ARENA_CONFIG_V1.seats - 1
    || input.opponentMmrs.some(mmr => !Number.isSafeInteger(mmr))
    || !Number.isInteger(input.place)
    || input.place < 1
    || input.place > ARENA_CONFIG_V1.seats
    || !Number.isSafeInteger(input.k)
    || input.k <= 0
  ) {
    throw new Error('ARENA_MMR_INPUT_INVALID');
  }
}
