import { CASUAL_SNG_ENTRY_COST } from '@/lib/economy/casual-sng';

interface RoomEntryAvailabilityInput {
  mode: string | undefined;
  economyMode: 'practice' | 'wallet' | 'arena' | undefined;
  buyIn: number;
  balance: number | null;
  isRebuy?: boolean;
}

export interface RoomEntryAvailability {
  cost: number;
  walletRequired: boolean;
  insufficient: boolean;
}

export function getRoomEntryAvailability({
  mode,
  economyMode,
  buyIn,
  balance,
}: RoomEntryAvailabilityInput): RoomEntryAvailability {
  const isSng = mode === 'sng';
  const walletRequired = isSng || economyMode === 'wallet';
  const cost = isSng ? CASUAL_SNG_ENTRY_COST : buyIn;
  const knownBalance = Number.isSafeInteger(balance) && (balance as number) >= 0;
  const validCost = Number.isSafeInteger(cost) && cost >= 0;
  return {
    cost,
    walletRequired,
    insufficient: walletRequired
      && knownBalance
      && validCost
      && (balance as number) < cost,
  };
}
