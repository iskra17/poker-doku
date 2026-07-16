export interface PublicProfile {
  id: string;
  alias: string;
  avatarId: string;
  wallet: { balance: number; activeEscrow: number };
}

export type ProfileBootstrap =
  | { state: 'anonymous' }
  | { state: 'ready'; profile: PublicProfile };
