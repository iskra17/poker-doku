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
