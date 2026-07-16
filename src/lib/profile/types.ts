export interface PublicProfile {
  id: string;
  alias: string;
  avatarId: string;
  wallet: { balance: number; activeEscrow: number };
}

export type RescueIneligibilityReason =
  | 'balance-threshold'
  | 'active-escrow'
  | 'cooldown'
  | 'daily-limit';

export interface EconomyStatus {
  daily: {
    claimed: boolean;
    grantAmount: number;
    availableAt: number;
  };
  rescue: {
    eligible: boolean;
    grantAmount: number;
    remainingToday: number;
    availableAt: number | null;
    reason: RescueIneligibilityReason | null;
  };
}

export type ProfileBootstrap =
  | { state: 'anonymous' }
  | { state: 'ready'; profile: PublicProfile; economy: EconomyStatus };
