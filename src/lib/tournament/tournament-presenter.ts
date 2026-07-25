import type {
  PublicTournamentLifecycle,
  PublicTournamentPayout,
  PublicTournamentSummary,
} from '@/lib/realtime/protocol';
import type {
  TournamentRegistrationState,
  TournamentRegistrationStatus,
} from './tournament-state';

type FundingStatus = PublicTournamentPayout['fundingStatus'];

export type TournamentPrimaryActionKind =
  | 'register'
  | 'cancel'
  | 'return'
  | 'waiting'
  | 'pending'
  | 'details';

export interface TournamentPrimaryAction {
  kind: TournamentPrimaryActionKind;
  label: string;
  disabled: boolean;
}

export interface TournamentPresentation {
  lifecycleLabel: string;
  registrationLabel: string;
  fundingLabel: string;
  economyLabel: string;
  fieldPolicyLabel: string;
  fieldLabel: string;
  payoutLabel: string;
  economyNotice: string;
  primaryAction: TournamentPrimaryAction;
  registrationDeadline: number | null;
  stackDepthLabel: string | null;
  lateRegistrationWarning: string | null;
  seatingNotice: string | null;
}

const LIFECYCLE_LABELS: Readonly<Record<PublicTournamentLifecycle, string>> = {
  upcoming: '예정',
  registering: '등록 중',
  'start-delayed': '시작 지연',
  starting: '시작 준비 중',
  running: '진행 중',
  'payout-pending': '상금 지급 처리 중',
  'refund-pending': '환불 처리 중',
  completed: '종료',
  cancelled: '취소',
};

const REGISTRATION_LABELS: Readonly<Record<TournamentRegistrationState, string>> = {
  'not-open': '등록 전',
  'open-prestart': '등록 진행 중',
  'locked-for-start': '등록 마감',
  'open-late': '레이트 레지 진행 중',
  closing: '좌석 배정 마감 중',
  closed: '등록 마감',
};

const FUNDING_LABELS: Readonly<Record<FundingStatus, string>> = {
  'entry-funded': '참가비 상금',
  'promotion-reserved': '상금 예약 완료',
  'payout-pending': '상금 지급 처리 중',
  settled: '상금 지급 완료',
};

export function tournamentLifecycleLabel(
  lifecycle: PublicTournamentLifecycle,
): string {
  return LIFECYCLE_LABELS[lifecycle];
}

export function tournamentRegistrationLabel(
  registrationState: TournamentRegistrationState,
): string {
  return REGISTRATION_LABELS[registrationState];
}

export function tournamentFundingLabel(fundingStatus: FundingStatus): string {
  return FUNDING_LABELS[fundingStatus];
}

function formatChips(value: number): string {
  return Math.max(0, value).toLocaleString('ko-KR');
}

function isRegistered(status: TournamentRegistrationStatus | null): boolean {
  return (
    status === 'registered' ||
    status === 'seat-claimed' ||
    status === 'late-pending' ||
    status === 'seated'
  );
}

function registrationDeadline(summary: PublicTournamentSummary): number | null {
  if (summary.registrationState === 'open-late') {
    return summary.lateRegistrationClosesAt;
  }
  if (summary.registrationState !== 'open-prestart') return null;
  return (
    summary.schedule.scheduledStartsAt ??
    summary.schedule.manualStartExpiresAt ??
    null
  );
}

function primaryAction(
  summary: PublicTournamentSummary,
  serverNow: number,
  deadline: number | null,
): TournamentPrimaryAction {
  if (summary.mySeat) {
    return { kind: 'return', label: '게임 복귀', disabled: false };
  }
  if (
    summary.myRegistrationStatus === 'late-pending' ||
    summary.registrationState === 'closing'
  ) {
    return { kind: 'waiting', label: '좌석 배정 대기', disabled: true };
  }
  if (summary.lifecycle === 'payout-pending') {
    return { kind: 'pending', label: '상금 지급 처리 중', disabled: true };
  }
  if (summary.lifecycle === 'refund-pending') {
    return {
      kind: 'pending',
      label:
        summary.economyMode === 'freeroll'
          ? '상금 반환 처리 중'
          : '환불 처리 중',
      disabled: true,
    };
  }
  if (
    summary.canCancelRegistration &&
    isRegistered(summary.myRegistrationStatus)
  ) {
    return { kind: 'cancel', label: '등록 취소', disabled: false };
  }
  if (summary.canRegister) {
    const stale = deadline !== null && serverNow >= deadline;
    return {
      kind: 'register',
      label: stale ? '등록 마감' : '참가 등록',
      disabled: stale,
    };
  }
  if (summary.lifecycle === 'completed') {
    return { kind: 'details', label: '결과 보기', disabled: false };
  }
  return {
    kind: 'details',
    label:
      summary.registrationState === 'closed' ||
      summary.registrationState === 'locked-for-start'
        ? '등록 마감'
        : '상세 보기',
    disabled: false,
  };
}

function currentLevelIndex(summary: PublicTournamentSummary): number | null {
  const index = summary.structure.currentSegmentIndex;
  if (index === null) return null;
  if (summary.structure.segments[index]?.kind === 'level') return index;
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    if (summary.structure.segments[previous]?.kind === 'level') return previous;
  }
  return null;
}

function nextLevelBigBlind(
  summary: PublicTournamentSummary,
  fromIndex: number,
): number | null {
  for (
    let index = fromIndex + 1;
    index < summary.structure.segments.length;
    index += 1
  ) {
    const segment = summary.structure.segments[index];
    if (segment?.kind === 'level') return segment.bigBlind;
  }
  return null;
}

function lateRegistrationCopy(summary: PublicTournamentSummary): {
  stackDepthLabel: string | null;
  warning: string | null;
} {
  if (summary.registrationState !== 'open-late') {
    return { stackDepthLabel: null, warning: null };
  }
  const index = currentLevelIndex(summary);
  if (index === null) return { stackDepthLabel: null, warning: null };
  const segment = summary.structure.segments[index];
  if (!segment || segment.kind !== 'level' || segment.bigBlind <= 0) {
    return { stackDepthLabel: null, warning: null };
  }

  const currentDepth = Math.floor(
    summary.structure.startingStack / segment.bigBlind,
  );
  const nextBigBlind = nextLevelBigBlind(summary, index);
  const nextDepth =
    nextBigBlind === null
      ? null
      : summary.structure.startingStack / nextBigBlind;

  return {
    stackDepthLabel: `시작 스택 ${formatChips(summary.structure.startingStack)} · 현재 ${currentDepth}BB`,
    warning:
      nextDepth !== null && nextDepth < 20
        ? '다음 레벨에서 20BB 미만이 되면 등록이 조기 마감됩니다.'
        : null,
  };
}

function payoutLabel(summary: PublicTournamentSummary): string {
  if (summary.economyMode === 'freeroll') {
    const fixed = '총상금 예약 완료 · 총액 고정';
    if (summary.payout.status === 'final') return `${fixed} · 확정`;
    return summary.registrationState === 'open-late'
      ? `${fixed} · 입상 인원/배분 마감 전 변동 가능`
      : fixed;
  }
  if (summary.payout.status === 'final') return '확정';
  return summary.registrationState === 'open-late'
    ? '마감 전 변동 가능'
    : '현재 등록 기준 예상 · 마감 전 변동 가능';
}

export function presentTournament(
  summary: PublicTournamentSummary,
  serverNow: number,
): TournamentPresentation {
  const deadline = registrationDeadline(summary);
  const lateCopy = lateRegistrationCopy(summary);
  const economyLabel =
    summary.economyMode === 'freeroll'
      ? '프리롤 · 바이인 없음'
      : `유료 토너먼트 · 바이인 ${formatChips(summary.entryBuyIn)} + 수수료 ${formatChips(summary.entryFee)}`;

  return {
    lifecycleLabel: tournamentLifecycleLabel(summary.lifecycle),
    registrationLabel: tournamentRegistrationLabel(summary.registrationState),
    fundingLabel:
      summary.lifecycle === 'refund-pending' &&
      summary.economyMode === 'freeroll'
        ? '상금 반환 처리 중'
        : tournamentFundingLabel(summary.payout.fundingStatus),
    economyLabel,
    fieldPolicyLabel: summary.botFillToMinimum
      ? '최소 인원까지 봇 충원'
      : '사람만 참가',
    fieldLabel: `현재 ${formatChips(summary.acceptedEntrants)}명 · 최소 ${formatChips(summary.minEntrants)}명 / 최대 ${formatChips(summary.maxEntrants)}명`,
    payoutLabel: payoutLabel(summary),
    economyNotice:
      summary.economyMode === 'freeroll'
        ? '봇 입상 상금은 운영 기금으로 반환됩니다'
        : '사람만 참가 · 최소 인원 미달 시 자동 취소 및 전액 환불',
    primaryAction: primaryAction(summary, serverNow, deadline),
    registrationDeadline: deadline,
    stackDepthLabel: lateCopy.stackDepthLabel,
    lateRegistrationWarning: lateCopy.warning,
    seatingNotice:
      summary.myRegistrationStatus === 'late-pending'
        ? '공정한 좌석 배정을 위해 현재 핸드 종료를 기다리는 중입니다.'
        : null,
  };
}
