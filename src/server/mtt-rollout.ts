import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
import type { MttFeatureFlags } from './tournament-command-service';

export interface MttRolloutFactories<TScheduler, TRegistration> {
  createScheduler(): TScheduler;
  createRegistrationPorts(): TRegistration;
  recoverV2(scheduler: TScheduler): void;
  recoverLegacy(): void;
}

export interface MttRolloutResources<TScheduler, TRegistration> {
  readonly scheduler?: TScheduler;
  readonly registration?: TRegistration;
  readonly lateRegistration?: TRegistration;
}

export function shouldKeepPersistentLateRegistrationOpen(
  flags: MttFeatureFlags,
  config: TournamentConfigSnapshotV2,
): boolean {
  return (
    flags.schedulerV2
    && flags.lateRegistration
    && config.lateRegistration.enabled
  );
}

export function commitPersistentRunningRegistrationPolicy(
  flags: MttFeatureFlags,
  config: TournamentConfigSnapshotV2,
  closeOwnerToken: string,
  commitRunning: () => boolean,
  claimClose: (ownerToken: string) => {
    readonly status: string;
    readonly ownerToken?: string;
  },
): boolean {
  const committed = commitRunning();
  if (
    !committed
    || shouldKeepPersistentLateRegistrationOpen(flags, config)
  ) {
    return committed;
  }
  const close = claimClose(closeOwnerToken);
  return close.status === 'claimed'
    || (
      close.status === 'already-owned'
      && close.ownerToken === closeOwnerToken
    );
}

export function initializeMttRollout<TScheduler, TRegistration>(
  flags: MttFeatureFlags,
  factories: MttRolloutFactories<TScheduler, TRegistration>,
): MttRolloutResources<TScheduler, TRegistration> {
  if (!flags.schedulerV2) {
    factories.recoverLegacy();
    return {};
  }
  const scheduler = factories.createScheduler();
  const registration = factories.createRegistrationPorts();
  factories.recoverV2(scheduler);
  return {
    scheduler,
    registration,
    ...(flags.lateRegistration ? { lateRegistration: registration } : {}),
  };
}
