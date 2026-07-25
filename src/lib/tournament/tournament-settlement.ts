import { createHash } from 'node:crypto';

export class TournamentSettlementContractError extends Error {
  constructor() {
    super('INVALID_TOURNAMENT_SETTLEMENT');
    this.name = 'TournamentSettlementContractError';
  }
}

export interface ProvisionalEliminationBatch {
  readonly sequence: number;
  readonly playerIds: readonly string[];
}

export interface TournamentPayoutFreezeRow {
  readonly place: number;
  readonly amount: number;
}

export interface TournamentPayoutFreeze {
  readonly version: number;
  readonly finalEntrants: number;
  readonly prizePool: number;
  readonly payouts: readonly TournamentPayoutFreezeRow[];
  readonly checksum: string;
}

export type PersistedTournamentPayoutFreeze = Omit<
  TournamentPayoutFreeze,
  'checksum'
>;

export interface TournamentSettlementResult {
  readonly place: number;
  readonly playerId: string;
  readonly participantType: 'human' | 'bot';
  readonly profileId: string | null;
  readonly registrationAttempt: number | null;
  readonly displayName: string;
  readonly prize: number;
  readonly disposition: 'wallet-credit' | 'promotion-return' | 'none';
}

export interface TournamentSettlementPlan {
  readonly version: number;
  readonly checksum: string;
  readonly prizePool: number;
  readonly fingerprint: string;
  readonly results: readonly TournamentSettlementResult[];
  readonly now: number;
}

export function appendProvisionalEliminationBatch(
  existing: readonly ProvisionalEliminationBatch[],
  next: ProvisionalEliminationBatch,
): readonly ProvisionalEliminationBatch[] {
  const seen = new Set<string>();
  for (let index = 0; index < existing.length; index += 1) {
    const batch = existing[index]!;
    if (batch.sequence !== index + 1 || batch.playerIds.length < 1) invalid();
    for (const playerId of batch.playerIds) {
      assertIdentifier(playerId);
      if (seen.has(playerId)) invalid();
      seen.add(playerId);
    }
  }
  if (
    next.sequence !== existing.length + 1
    || next.playerIds.length < 1
  ) {
    invalid();
  }
  const nextPlayers = new Set<string>();
  for (const playerId of next.playerIds) {
    assertIdentifier(playerId);
    if (seen.has(playerId) || nextPlayers.has(playerId)) invalid();
    nextPlayers.add(playerId);
  }
  return [
    ...existing.map(batch => ({
      sequence: batch.sequence,
      playerIds: [...batch.playerIds],
    })),
    { sequence: next.sequence, playerIds: [...next.playerIds] },
  ];
}

export function buildTournamentPayoutFreeze(input: {
  readonly version: number;
  readonly finalEntrants: number;
  readonly prizePool: number;
  readonly payouts: readonly number[];
}): TournamentPayoutFreeze {
  assertPositiveInteger(input.version);
  assertPositiveInteger(input.finalEntrants);
  assertPositiveInteger(input.prizePool);
  if (input.payouts.length !== input.finalEntrants) invalid();
  let total = 0;
  const payouts = input.payouts.map((amount, index) => {
    assertNonNegativeInteger(amount);
    total = safeAdd(total, amount);
    return { place: index + 1, amount };
  });
  if (total !== input.prizePool) invalid();
  const frozen = {
    version: input.version,
    finalEntrants: input.finalEntrants,
    prizePool: input.prizePool,
    payouts,
  };
  return {
    ...frozen,
    checksum: hashCanonical(frozen),
  };
}

export function buildTournamentSettlementPlan(input: {
  readonly instanceId: string;
  readonly configVersion: number;
  readonly freeze: TournamentPayoutFreeze;
  readonly results: readonly TournamentSettlementResult[];
  readonly now: number;
}): TournamentSettlementPlan {
  assertIdentifier(input.instanceId);
  assertPositiveInteger(input.configVersion);
  assertTimestamp(input.now);
  assertFreeze(input.freeze);
  if (input.results.length !== input.freeze.finalEntrants) invalid();

  const playerIds = new Set<string>();
  const profileIds = new Set<string>();
  let total = 0;
  const results = input.results.map((result, index) => {
    assertIdentifier(result.playerId);
    assertDisplayName(result.displayName);
    assertNonNegativeInteger(result.prize);
    if (
      result.place !== index + 1
      || playerIds.has(result.playerId)
      || result.prize !== input.freeze.payouts[index]?.amount
    ) {
      invalid();
    }
    playerIds.add(result.playerId);
    if (result.participantType === 'human') {
      assertIdentifier(result.profileId);
      assertPositiveInteger(result.registrationAttempt);
      if (
        profileIds.has(result.profileId)
        || (
          result.prize > 0
            ? result.disposition !== 'wallet-credit'
            : result.disposition !== 'none'
        )
      ) {
        invalid();
      }
      profileIds.add(result.profileId);
    } else if (result.participantType === 'bot') {
      if (
        result.profileId !== null
        || result.registrationAttempt !== null
        || (
          result.prize > 0
            ? result.disposition !== 'promotion-return'
            : result.disposition !== 'none'
        )
      ) {
        invalid();
      }
    } else {
      invalid();
    }
    total = safeAdd(total, result.prize);
    return { ...result };
  });
  if (total !== input.freeze.prizePool) invalid();

  const fingerprint = hashCanonical({
    instanceId: input.instanceId,
    configVersion: input.configVersion,
    payoutFreezeVersion: input.freeze.version,
    payoutFreezeChecksum: input.freeze.checksum,
    prizePool: input.freeze.prizePool,
    finalEntrants: results.length,
    results: results.map(result => ({
      place: result.place,
      playerId: result.playerId,
      participantType: result.participantType,
      profileId: result.profileId,
      registrationAttempt: result.registrationAttempt,
      displayName: result.displayName,
      prize: result.prize,
      disposition: result.disposition,
    })),
  });
  return {
    version: input.freeze.version,
    checksum: input.freeze.checksum,
    prizePool: input.freeze.prizePool,
    fingerprint,
    results,
    now: input.now,
  };
}

export function persistedTournamentPayoutFreeze(
  freeze: TournamentPayoutFreeze,
): PersistedTournamentPayoutFreeze {
  assertFreeze(freeze);
  return {
    version: freeze.version,
    finalEntrants: freeze.finalEntrants,
    prizePool: freeze.prizePool,
    payouts: freeze.payouts.map(payout => ({ ...payout })),
  };
}

function assertFreeze(freeze: TournamentPayoutFreeze): void {
  assertPositiveInteger(freeze.version);
  assertPositiveInteger(freeze.finalEntrants);
  assertPositiveInteger(freeze.prizePool);
  assertIdentifier(freeze.checksum);
  if (freeze.payouts.length !== freeze.finalEntrants) invalid();
  let total = 0;
  for (let index = 0; index < freeze.payouts.length; index += 1) {
    const payout = freeze.payouts[index]!;
    if (payout.place !== index + 1) invalid();
    assertNonNegativeInteger(payout.amount);
    total = safeAdd(total, payout.amount);
  }
  if (total !== freeze.prizePool) invalid();
  const expected = hashCanonical({
    version: freeze.version,
    finalEntrants: freeze.finalEntrants,
    prizePool: freeze.prizePool,
    payouts: freeze.payouts,
  });
  if (freeze.checksum !== expected) invalid();
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) invalid();
  return total;
}

function assertIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < 1
    || value.length > 200
  ) {
    invalid();
  }
}

function assertDisplayName(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < 1
    || value.length > 100
  ) {
    invalid();
  }
}

function assertPositiveInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid();
}

function assertNonNegativeInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
}

function assertTimestamp(value: unknown): asserts value is number {
  assertNonNegativeInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new TournamentSettlementContractError();
}
