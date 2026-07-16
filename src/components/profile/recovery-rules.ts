export interface ProfileDeletionAvailability {
  allowed: boolean;
  guidance: string;
}

export interface RecoveryRotationConfirmationAttempt {
  shouldRotate: boolean;
  nextConfirmed: false;
}

export function consumeRecoveryRotationConfirmation(
  confirmed: boolean,
): RecoveryRotationConfirmationAttempt {
  return {
    shouldRotate: confirmed,
    nextConfirmed: false,
  };
}

export function getProfileDeletionAvailability(
  hasActiveSeat: boolean,
): ProfileDeletionAvailability {
  if (hasActiveSeat) {
    return {
      allowed: false,
      guidance: '참가 중인 게임/좌석을 완전히 나가 칩을 정산한 뒤 삭제할 수 있어요.',
    };
  }
  return {
    allowed: true,
    guidance: '지갑과 진행 정보가 모두 사라집니다.',
  };
}
