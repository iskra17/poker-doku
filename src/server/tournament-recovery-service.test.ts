import { describe, expect, it, vi } from 'vitest';
import {
  TournamentRecoveryService,
  type TournamentRecoveryPlan,
} from './tournament-recovery-service';

describe('TournamentRecoveryService', () => {
  it('preserves prestart entries before generic recovery and resumes pending money work', () => {
    const calls: string[] = [];
    const plan: TournamentRecoveryPlan = {
      preserveReservedMttEntries: new Map([
        ['registering', new Map([
          ['profile-1', { economyEntryAttempt: 2, buyIn: 1_500, fee: 150 }],
        ])],
      ]),
      deferToMttVoidInstanceIds: new Set(['refund-wallet', 'refund-freeroll']),
      refundInstanceIds: ['refund-wallet', 'refund-freeroll'],
      payoutInstanceIds: ['payout-pending'],
    };
    const service = new TournamentRecoveryService({
      loadAndValidate: vi.fn(() => {
        calls.push('load');
        return plan;
      }),
      recoverGeneric: vi.fn(options => {
        calls.push('generic');
        expect(options.preserveReservedMttEntries).toBe(
          plan.preserveReservedMttEntries,
        );
        expect(options.deferToMttVoidInstanceIds).toBe(
          plan.deferToMttVoidInstanceIds,
        );
      }),
      resumeRefund: vi.fn(instanceId => calls.push(`refund:${instanceId}`)),
      resumePayout: vi.fn(instanceId => calls.push(`payout:${instanceId}`)),
      reconcileTemplatesAndTimers: vi.fn(() => calls.push('scheduler')),
    });

    service.recoverBeforeListen();

    expect(calls).toEqual([
      'load',
      'generic',
      'refund:refund-wallet',
      'refund:refund-freeroll',
      'payout:payout-pending',
      'scheduler',
    ]);
  });

  it('never converts payout-pending work into a refund', () => {
    const resumeRefund = vi.fn();
    const resumePayout = vi.fn();
    const service = new TournamentRecoveryService({
      loadAndValidate: () => ({
        preserveReservedMttEntries: new Map(),
        deferToMttVoidInstanceIds: new Set(),
        refundInstanceIds: [],
        payoutInstanceIds: ['payout-only'],
      }),
      recoverGeneric: vi.fn(),
      resumeRefund,
      resumePayout,
      reconcileTemplatesAndTimers: vi.fn(),
    });

    service.recoverBeforeListen();

    expect(resumeRefund).not.toHaveBeenCalled();
    expect(resumePayout).toHaveBeenCalledWith('payout-only');
  });
});
