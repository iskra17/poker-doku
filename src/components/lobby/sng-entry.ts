export {
  CASUAL_SNG_BUY_IN,
  CASUAL_SNG_ENTRY_FEE,
  CASUAL_SNG_ENTRY_COST,
} from '@/lib/economy/casual-sng';
import { CASUAL_SNG_ENTRY_COST } from '@/lib/economy/casual-sng';

export function getCasualSngEntryAvailability(balance: number | null): {
  cost: number;
  insufficient: boolean;
} {
  const knownBalance = Number.isSafeInteger(balance) && (balance as number) >= 0;
  return {
    cost: CASUAL_SNG_ENTRY_COST,
    insufficient: knownBalance && (balance as number) < CASUAL_SNG_ENTRY_COST,
  };
}
