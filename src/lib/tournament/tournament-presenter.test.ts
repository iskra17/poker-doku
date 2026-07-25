import { describe, expect, it } from 'vitest';
import type {
  PublicTournamentLifecycle,
  PublicTournamentSummary,
} from '@/lib/realtime/protocol';
import type { TournamentRegistrationState } from './tournament-state';
import {
  presentTournament,
  tournamentFundingLabel,
  tournamentLifecycleLabel,
  tournamentRegistrationLabel,
} from './tournament-presenter';

const SERVER_NOW = Date.UTC(2026, 6, 25, 0, 0, 0);

function tournament(
  overrides: Partial<PublicTournamentSummary> = {},
): PublicTournamentSummary {
  return {
    id: 'mtt-1',
    name: '토요 프리롤',
    lifecycle: 'registering',
    statusReason: null,
    speed: 'standard',
    entrantCount: 7,
    maxEntrants: 48,
    tableSize: 6,
    remaining: 7,
    tableCount: 0,
    prizePool: 180_000,
    startAt: SERVER_NOW + 30 * 60_000,
    startedAt: null,
    botFill: true,
    hostId: 'operator',
    level: 0,
    paused: false,
    economyMode: 'freeroll',
    entryBuyIn: 0,
    entryFee: 0,
    payoutPreset: 'standard',
    schedule: {
      visibleAt: SERVER_NOW - 30 * 60_000,
      registrationOpensAt: SERVER_NOW - 20 * 60_000,
      scheduledStartsAt: SERVER_NOW + 30 * 60_000,
      manualStartExpiresAt: null,
      actualStartedAt: null,
    },
    structure: {
      sourcePresetId: 'standard',
      startingStack: 10_000,
      segments: [
        {
          kind: 'level',
          durationMs: 8 * 60_000,
          smallBlind: 100,
          bigBlind: 200,
          bigBlindAnte: 0,
        },
        {
          kind: 'level',
          durationMs: 8 * 60_000,
          smallBlind: 200,
          bigBlind: 400,
          bigBlindAnte: 400,
        },
        {
          kind: 'level',
          durationMs: 8 * 60_000,
          smallBlind: 300,
          bigBlind: 600,
          bigBlindAnte: 600,
        },
      ],
      currentSegmentIndex: null,
      currentSegmentEndsAt: null,
    },
    payout: {
      tableVersion: 2,
      presetId: 'standard',
      paidFieldPercent: 15,
      status: 'provisional',
      totalPrize: 180_000,
      payouts: [],
      fundingStatus: 'promotion-reserved',
    },
    registrationState: 'open-prestart',
    registrationCloseReason: null,
    lateRegistrationClosesAt: null,
    minEntrants: 8,
    initialEntrants: 0,
    acceptedEntrants: 7,
    pendingLateEntrants: 0,
    aliveSeated: 0,
    finalEntrants: null,
    botFillToMinimum: true,
    myRegistrationStatus: null,
    mySeat: null,
    canRegister: true,
    canCancelRegistration: false,
    ...overrides,
  };
}

describe('tournament presenter labels', () => {
  it.each<[PublicTournamentLifecycle, string]>([
    ['upcoming', '예정'],
    ['registering', '등록 중'],
    ['start-delayed', '시작 지연'],
    ['starting', '시작 준비 중'],
    ['running', '진행 중'],
    ['payout-pending', '상금 지급 처리 중'],
    ['refund-pending', '환불 처리 중'],
    ['completed', '종료'],
    ['cancelled', '취소'],
  ])('labels lifecycle %s in Korean', (value, expected) => {
    expect(tournamentLifecycleLabel(value)).toBe(expected);
  });

  it.each<[TournamentRegistrationState, string]>([
    ['not-open', '등록 전'],
    ['open-prestart', '등록 진행 중'],
    ['locked-for-start', '등록 마감'],
    ['open-late', '레이트 레지 진행 중'],
    ['closing', '좌석 배정 마감 중'],
    ['closed', '등록 마감'],
  ])('labels registration state %s in Korean', (value, expected) => {
    expect(tournamentRegistrationLabel(value)).toBe(expected);
  });

  it.each([
    ['entry-funded', '참가비 상금'],
    ['promotion-reserved', '상금 예약 완료'],
    ['payout-pending', '상금 지급 처리 중'],
    ['settled', '상금 지급 완료'],
  ] as const)('labels funding state %s in Korean', (value, expected) => {
    expect(tournamentFundingLabel(value)).toBe(expected);
  });
});

describe('presentTournament', () => {
  it('disables a stale registration action from serverNow before a timer rerender', () => {
    const summary = tournament({
      schedule: {
        visibleAt: SERVER_NOW - 60_000,
        registrationOpensAt: SERVER_NOW - 60_000,
        scheduledStartsAt: SERVER_NOW - 1,
        manualStartExpiresAt: null,
        actualStartedAt: null,
      },
      canRegister: true,
    });

    expect(presentTournament(summary, SERVER_NOW).primaryAction).toEqual({
      kind: 'register',
      label: '등록 마감',
      disabled: true,
    });
  });

  it('presents freeroll fixed prizes and bot returns without practice wording', () => {
    const presentation = presentTournament(tournament(), SERVER_NOW);
    const copy = [
      presentation.economyLabel,
      presentation.fieldPolicyLabel,
      presentation.payoutLabel,
      presentation.economyNotice,
      presentation.fundingLabel,
    ].join(' ');

    expect(presentation.economyLabel).toBe('프리롤 · 바이인 없음');
    expect(presentation.fieldPolicyLabel).toBe('최소 인원까지 봇 충원');
    expect(presentation.payoutLabel).toBe('총상금 예약 완료 · 총액 고정');
    expect(presentation.economyNotice).toBe(
      '봇 입상 상금은 운영 기금으로 반환됩니다',
    );
    expect(copy).not.toMatch(/연습 모드|연습용 상금|표시용 칩/);
  });

  it('presents wallet tournaments as human-only with full refunds', () => {
    const presentation = presentTournament(
      tournament({
        economyMode: 'wallet',
        entryBuyIn: 1_500,
        entryFee: 150,
        botFill: false,
        botFillToMinimum: false,
        payout: {
          tableVersion: 2,
          presetId: 'standard',
          paidFieldPercent: 15,
          status: 'provisional',
          totalPrize: 10_500,
          payouts: [],
          fundingStatus: 'entry-funded',
        },
      }),
      SERVER_NOW,
    );

    expect(presentation.economyLabel).toBe('유료 토너먼트 · 바이인 1,500 + 수수료 150');
    expect(presentation.fieldPolicyLabel).toBe('사람만 참가');
    expect(presentation.economyNotice).toBe(
      '사람만 참가 · 최소 인원 미달 시 자동 취소 및 전액 환불',
    );
    expect(presentation.payoutLabel).toBe(
      '현재 등록 기준 예상 · 마감 전 변동 가능',
    );
  });

  it('marks a frozen freeroll payout as final while keeping its fixed total', () => {
    const summary = tournament({
      payout: {
        ...tournament().payout,
        status: 'final',
      },
    });

    expect(presentTournament(summary, SERVER_NOW).payoutLabel).toBe(
      '총상금 예약 완료 · 총액 고정 · 확정',
    );
  });

  it('shows late registration depth, deadline, and a next-level stack warning', () => {
    const presentation = presentTournament(
      tournament({
        lifecycle: 'running',
        registrationState: 'open-late',
        lateRegistrationClosesAt: SERVER_NOW + 10 * 60_000,
        structure: {
          sourcePresetId: 'standard',
          startingStack: 10_000,
          segments: [
            {
              kind: 'level',
              durationMs: 8 * 60_000,
              smallBlind: 200,
              bigBlind: 400,
              bigBlindAnte: 400,
            },
            {
              kind: 'level',
              durationMs: 8 * 60_000,
              smallBlind: 300,
              bigBlind: 600,
              bigBlindAnte: 600,
            },
          ],
          currentSegmentIndex: 0,
          currentSegmentEndsAt: SERVER_NOW + 4 * 60_000,
        },
      }),
      SERVER_NOW,
    );

    expect(presentation.registrationLabel).toBe('레이트 레지 진행 중');
    expect(presentation.stackDepthLabel).toBe('시작 스택 10,000 · 현재 25BB');
    expect(presentation.lateRegistrationWarning).toBe(
      '다음 레벨에서 20BB 미만이 되면 등록이 조기 마감됩니다.',
    );
    expect(presentation.registrationDeadline).toBe(SERVER_NOW + 10 * 60_000);
  });

  it('shows seating-close and pending payout/refund actions', () => {
    const seating = presentTournament(
      tournament({
        lifecycle: 'running',
        registrationState: 'closing',
        myRegistrationStatus: 'late-pending',
        canRegister: false,
      }),
      SERVER_NOW,
    );
    expect(seating.primaryAction).toEqual({
      kind: 'waiting',
      label: '좌석 배정 대기',
      disabled: true,
    });
    expect(seating.seatingNotice).toBe(
      '공정한 좌석 배정을 위해 현재 핸드 종료를 기다리는 중입니다.',
    );

    const payout = presentTournament(
      tournament({
        lifecycle: 'payout-pending',
        registrationState: 'closed',
        canRegister: false,
        payout: {
          ...tournament().payout,
          fundingStatus: 'payout-pending',
        },
      }),
      SERVER_NOW,
    );
    expect(payout.primaryAction).toEqual({
      kind: 'pending',
      label: '상금 지급 처리 중',
      disabled: true,
    });

    const freerollRefund = presentTournament(
      tournament({
        lifecycle: 'refund-pending',
        registrationState: 'closed',
        canRegister: false,
      }),
      SERVER_NOW,
    );
    expect(freerollRefund.primaryAction).toEqual({
      kind: 'pending',
      label: '상금 반환 처리 중',
      disabled: true,
    });

    const walletRefund = presentTournament(
      tournament({
        lifecycle: 'refund-pending',
        registrationState: 'closed',
        economyMode: 'wallet',
        canRegister: false,
      }),
      SERVER_NOW,
    );
    expect(walletRefund.primaryAction).toEqual({
      kind: 'pending',
      label: '환불 처리 중',
      disabled: true,
    });
  });
});
