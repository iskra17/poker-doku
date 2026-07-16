export interface LevelXpState {
  level: number;
  xpMilli: number;
}

export interface ProgressionBalance {
  readonly version: number;
  readonly dojoMaxLevel: number;
  readonly dojoXpPerCompletedHand: number;
  readonly dojoXpPerSngPlace: readonly number[];
  readonly dojoXpPerMission: number;
  readonly dojoXpForNextLevel: (level: number) => number;
  readonly affinityMaxLevel: number;
  readonly affinityPerCompletedHand: number;
  readonly affinityPerSngPlace: readonly number[];
  readonly affinityForNextLevel: (level: number) => number;
  readonly practiceFullRewardHandsPerKstDay: number;
  readonly practiceReducedRatePermille: number;
  readonly dailyMissionCount: number;
  readonly dailyFreeRerolls: number;
  readonly streakHandsRequired: number;
  readonly streakSngRequired: number;
  readonly weeklyRestPassGrant: number;
  readonly restPassCap: number;
  readonly streakFragmentEveryDays: number;
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function dojoXpForNextLevel(level: number): number {
  assertThresholdLevel(level, 50);
  return (100 + 25 * (level - 1)) * 1_000;
}

function affinityForNextLevel(level: number): number {
  assertThresholdLevel(level, 20);
  return (40 + 15 * (level - 1)) * 1_000;
}

export const PROGRESSION_BALANCE_V1 = Object.freeze({
  version: 1,
  dojoMaxLevel: 50,
  dojoXpPerCompletedHand: 10_000,
  dojoXpPerSngPlace: Object.freeze(
    [160, 100, 70, 50, 40, 30].map(value => value * 1_000),
  ),
  dojoXpPerMission: 100_000,
  dojoXpForNextLevel,
  affinityMaxLevel: 20,
  affinityPerCompletedHand: 2_000,
  affinityPerSngPlace: Object.freeze(
    [30, 20, 15, 12, 10, 8].map(value => value * 1_000),
  ),
  affinityForNextLevel,
  practiceFullRewardHandsPerKstDay: 30,
  practiceReducedRatePermille: 250,
  dailyMissionCount: 3,
  dailyFreeRerolls: 1,
  streakHandsRequired: 10,
  streakSngRequired: 1,
  weeklyRestPassGrant: 1,
  restPassCap: 1,
  streakFragmentEveryDays: 7,
}) satisfies ProgressionBalance;

const balanceRegistry = new Map<number, ProgressionBalance>([
  [PROGRESSION_BALANCE_V1.version, PROGRESSION_BALANCE_V1],
]);

class ImmutableBalanceRegistry implements ReadonlyMap<number, ProgressionBalance> {
  readonly [Symbol.toStringTag] = 'Map';
  readonly #source: ReadonlyMap<number, ProgressionBalance>;

  constructor(source: ReadonlyMap<number, ProgressionBalance>) {
    this.#source = source;
    Object.freeze(this);
  }

  get size(): number {
    return this.#source.size;
  }

  get(key: number): ProgressionBalance | undefined {
    return this.#source.get(key);
  }

  has(key: number): boolean {
    return this.#source.has(key);
  }

  entries(): MapIterator<[number, ProgressionBalance]> {
    return this.#source.entries();
  }

  keys(): MapIterator<number> {
    return this.#source.keys();
  }

  values(): MapIterator<ProgressionBalance> {
    return this.#source.values();
  }

  forEach(
    callbackfn: (
      value: ProgressionBalance,
      key: number,
      map: ReadonlyMap<number, ProgressionBalance>,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.#source) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  [Symbol.iterator](): MapIterator<[number, ProgressionBalance]> {
    return this.entries();
  }
}

export const BALANCE_BY_VERSION: ReadonlyMap<number, ProgressionBalance> =
  new ImmutableBalanceRegistry(balanceRegistry);

export function getBalance(version: number): ProgressionBalance {
  const balance = BALANCE_BY_VERSION.get(version);
  if (!balance) throw new Error(`UNKNOWN_PROGRESSION_BALANCE:${version}`);
  return balance;
}

export function applyDojoXp(
  state: LevelXpState,
  rewardMilli: number,
  balance: ProgressionBalance = PROGRESSION_BALANCE_V1,
): LevelXpState {
  return applyLevelXp(
    state,
    rewardMilli,
    balance.dojoMaxLevel,
    balance.dojoXpForNextLevel,
  );
}

export function applyAffinityXp(
  state: LevelXpState,
  rewardMilli: number,
  balance: ProgressionBalance = PROGRESSION_BALANCE_V1,
): LevelXpState {
  return applyLevelXp(
    state,
    rewardMilli,
    balance.affinityMaxLevel,
    balance.affinityForNextLevel,
  );
}

export function scaleReward(rewardMilli: number, ratePermille: number): number {
  assertNonnegativeSafeInteger(rewardMilli, 'PROGRESSION_REWARD_INVALID');
  if (
    !Number.isSafeInteger(ratePermille)
    || ratePermille < 0
    || ratePermille > 1_000
  ) {
    throw new Error('PROGRESSION_RATE_INVALID');
  }
  const product = BigInt(rewardMilli) * BigInt(ratePermille);
  if (product % BigInt(1_000) !== BigInt(0)) {
    throw new Error('PROGRESSION_REWARD_NOT_EXACT');
  }
  const scaled = product / BigInt(1_000);
  if (scaled > MAX_SAFE_BIGINT) {
    throw new Error('PROGRESSION_REWARD_OVERFLOW');
  }
  return Number(scaled);
}

export function milliToUiUnits(value: number): number {
  assertNonnegativeSafeInteger(value, 'PROGRESSION_REWARD_INVALID');
  return Math.floor(value / 1_000);
}

function applyLevelXp(
  state: LevelXpState,
  rewardMilli: number,
  maxLevel: number,
  thresholdForLevel: (level: number) => number,
): LevelXpState {
  assertNonnegativeSafeInteger(rewardMilli, 'PROGRESSION_REWARD_INVALID');
  assertLevelState(state, maxLevel, thresholdForLevel);
  if (state.level === maxLevel) return { level: maxLevel, xpMilli: 0 };

  let remaining = BigInt(state.xpMilli) + BigInt(rewardMilli);
  let level = state.level;
  while (level < maxLevel) {
    const threshold = BigInt(thresholdForLevel(level));
    if (remaining < threshold) break;
    remaining -= threshold;
    level += 1;
  }
  if (level === maxLevel) return { level, xpMilli: 0 };
  if (remaining > MAX_SAFE_BIGINT) {
    throw new Error('PROGRESSION_REWARD_OVERFLOW');
  }
  return { level, xpMilli: Number(remaining) };
}

function assertLevelState(
  state: LevelXpState,
  maxLevel: number,
  thresholdForLevel: (level: number) => number,
): void {
  if (
    !Number.isSafeInteger(state.level)
    || state.level < 1
    || state.level > maxLevel
    || !Number.isSafeInteger(state.xpMilli)
    || state.xpMilli < 0
    || (state.level === maxLevel && state.xpMilli !== 0)
    || (state.level < maxLevel
      && state.xpMilli >= thresholdForLevel(state.level))
  ) {
    throw new Error('PROGRESSION_XP_STATE_INVALID');
  }
}

function assertThresholdLevel(level: number, maxLevel: number): void {
  if (!Number.isSafeInteger(level) || level < 1 || level >= maxLevel) {
    throw new Error('PROGRESSION_LEVEL_INVALID');
  }
}

function assertNonnegativeSafeInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}
