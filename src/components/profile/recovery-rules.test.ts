import { describe, expect, it } from 'vitest';
import {
  consumeRecoveryRotationConfirmation,
  getProfileDeletionAvailability,
} from './recovery-rules';

describe('profile deletion availability', () => {
  it('blocks any active seat even when its public escrow amount is zero', () => {
    expect(getProfileDeletionAvailability(true)).toEqual({
      allowed: false,
      guidance: '참가 중인 게임/좌석을 완전히 나가 칩을 정산한 뒤 삭제할 수 있어요.',
    });
    expect(getProfileDeletionAvailability(false).allowed).toBe(true);
  });
});

describe('recovery rotation confirmation', () => {
  it('consumes confirmation for each attempt regardless of its outcome', () => {
    const firstAttempt = consumeRecoveryRotationConfirmation(true);
    expect(firstAttempt).toEqual({ shouldRotate: true, nextConfirmed: false });

    expect(consumeRecoveryRotationConfirmation(firstAttempt.nextConfirmed)).toEqual({
      shouldRotate: false,
      nextConfirmed: false,
    });

    expect(consumeRecoveryRotationConfirmation(true)).toEqual({
      shouldRotate: true,
      nextConfirmed: false,
    });
  });
});
