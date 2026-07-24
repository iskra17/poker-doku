import type { Player } from '@/lib/poker/types';

export type SeatVisualState = 'normal' | 'folded' | 'away' | 'busted';

type SeatVisualPlayer = Pick<
  Player,
  'status' | 'chips' | 'sitOutNext' | 'sitOutAuto'
>;

export interface SeatVisualClasses {
  portrait: string;
  cards: string;
  plate: string;
}

export function resolveSeatVisualState(player: SeatVisualPlayer): SeatVisualState {
  if (player.status === 'folded') return 'folded';
  if (player.chips <= 0 && player.status !== 'all-in') return 'busted';

  const isExplicitlyAway = player.status === 'sitting-out'
    || (!!player.sitOutNext && !player.sitOutAuto);

  return isExplicitlyAway ? 'away' : 'normal';
}

export function getSeatVisualClasses(state: SeatVisualState): SeatVisualClasses {
  switch (state) {
    case 'folded':
      return {
        portrait: 'opacity-35 grayscale',
        cards: 'opacity-25',
        plate: 'opacity-65',
      };
    case 'away':
    case 'busted':
      return {
        portrait: 'opacity-40 grayscale',
        cards: 'opacity-40 grayscale',
        plate: 'opacity-80',
      };
    case 'normal':
      return {
        portrait: '',
        cards: '',
        plate: '',
      };
  }
}
