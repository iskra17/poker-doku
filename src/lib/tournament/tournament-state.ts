export type TournamentInstanceStatus =
  | 'scheduled-hidden'
  | 'scheduled-visible'
  | 'registering'
  | 'start-delayed'
  | 'starting'
  | 'running'
  | 'payout-pending'
  | 'refund-pending'
  | 'completed'
  | 'cancelled';

export type TournamentRegistrationState =
  | 'not-open'
  | 'open-prestart'
  | 'locked-for-start'
  | 'open-late'
  | 'closing'
  | 'closed';

export type RegistrationCloseReason =
  | 'late-reg-disabled'
  | 'time'
  | 'full'
  | 'stack-floor'
  | 'bubble'
  | 'final-table'
  | 'last-player'
  | 'tournament-cancelled'
  | 'tournament-completed';

export type TournamentInstanceStatusReason =
  | 'capacity'
  | 'restart-checkin-grace'
  | 'not-enough'
  | 'missed-start'
  | 'promotion-insufficient'
  | 'financial-invariant'
  | 'invalid-config'
  | 'template-superseded'
  | 'operator-cancel'
  | 'server-restart-unrecoverable'
  | 'start-economy-failed'
  | 'room-create-failed';

export type TournamentRegistrationStatus =
  | 'registered'
  | 'cancelled'
  | 'no-show'
  | 'seat-claimed'
  | 'late-pending'
  | 'seated'
  | 'eliminated'
  | 'finished'
  | 'refunded';

const LEGAL_REGISTRATION_STATES: Readonly<
  Record<TournamentInstanceStatus, readonly TournamentRegistrationState[]>
> = {
  'scheduled-hidden': ['not-open'],
  'scheduled-visible': ['not-open'],
  registering: ['open-prestart'],
  'start-delayed': ['locked-for-start'],
  starting: ['locked-for-start'],
  running: ['open-late', 'closing', 'closed'],
  'payout-pending': ['closed'],
  'refund-pending': ['closed'],
  completed: ['closed'],
  cancelled: ['closed'],
};

export function isTournamentStatePair(
  status: TournamentInstanceStatus,
  registrationState: TournamentRegistrationState,
): boolean {
  return LEGAL_REGISTRATION_STATES[status].includes(registrationState);
}
