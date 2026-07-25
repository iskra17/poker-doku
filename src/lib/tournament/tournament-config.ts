export interface TournamentFieldPolicy {
  readonly minEntrants: number;
  readonly maxEntrants: number;
  readonly botFillToMinimum: boolean;
}

export type TournamentEconomyPolicy =
  | {
      readonly mode: 'freeroll';
      readonly promotionAccountId: 'global';
    }
  | {
      readonly mode: 'wallet';
      readonly productVersion: number;
      readonly buyIn: number;
      readonly fee: number;
    };

export type PrizePoolPolicy =
  | {
      readonly kind: 'promotion-funded';
      readonly totalPrize: number;
    }
  | {
      readonly kind: 'entry-pool';
    };

export type TournamentStructureSegment =
  | {
      readonly kind: 'level';
      readonly durationMs: number;
      readonly smallBlind: number;
      readonly bigBlind: number;
      readonly bigBlindAnte: number;
    }
  | {
      readonly kind: 'break';
      readonly durationMs: number;
    };

export type TournamentPresetId = 'standard' | 'turbo' | 'hyper';

export interface TournamentStructure {
  readonly sourcePresetId: TournamentPresetId | null;
  readonly startingStack: number;
  readonly segments: readonly TournamentStructureSegment[];
}

export type TournamentPayoutPolicy =
  | {
      readonly tableVersion: 2;
      readonly presetId: 'top-heavy';
      readonly paidFieldPercent: 10;
    }
  | {
      readonly tableVersion: 2;
      readonly presetId: 'standard';
      readonly paidFieldPercent: 15;
    }
  | {
      readonly tableVersion: 2;
      readonly presetId: 'flat';
      readonly paidFieldPercent: 20;
    };

export type LateRegistrationPolicy =
  | {
      readonly enabled: false;
      readonly durationLevels: 0;
      readonly minStartingStackBb: 20;
    }
  | {
      readonly enabled: true;
      readonly durationLevels: 1 | 2 | 3;
      readonly minStartingStackBb: 20;
    };

export interface TournamentConfigSnapshotV2 {
  readonly version: 2;
  readonly name: string;
  readonly economy: TournamentEconomyPolicy;
  readonly tableSize: 6;
  readonly field: TournamentFieldPolicy;
  readonly turnTimeSeconds: 8 | 15 | 30;
  readonly structure: TournamentStructure;
  readonly prizePool: PrizePoolPolicy;
  readonly payout: TournamentPayoutPolicy;
  readonly lateRegistration: LateRegistrationPolicy;
}

export interface TournamentSchedule {
  readonly visibleAt: number;
  readonly registrationOpensAt: number;
  readonly startsAt: number | null;
  readonly manualStartExpiresAt: number | null;
}

export type TournamentRecurrence =
  | {
      readonly kind: 'hourly';
      readonly minute: number;
    }
  | {
      readonly kind: 'daily';
      readonly hour: number;
      readonly minute: number;
    }
  | {
      readonly kind: 'weekly';
      readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
      readonly hour: number;
      readonly minute: number;
    };

export interface CreateTournamentCommand {
  readonly requestId: string;
  readonly schedule: TournamentSchedule;
  readonly recurrence: TournamentRecurrence | null;
  readonly firstStartsAt: number | null;
  readonly recurrenceEndsAt: number | null;
  readonly visibleLeadMs: number | null;
  readonly registrationLeadMs: number | null;
  readonly config: TournamentConfigSnapshotV2;
}
