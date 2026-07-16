import type { GameEvent } from './game-events';

export interface HandEconomySummary {
  handNumber: number;
  endingStack: number;
  delta: number;
  handRake: number;
  economyMode: Extract<GameEvent, { type: 'winners' }>['economyMode'];
}

export function buildHandEconomySummary(
  event: Extract<GameEvent, { type: 'winners' }>,
  playerId: string,
): HandEconomySummary | null {
  const player = event.players.find(candidate => candidate.id === playerId);
  if (
    !player
    || !Number.isSafeInteger(player.chips)
    || !Number.isSafeInteger(player.handStartChips)
    || !Number.isSafeInteger(event.handRake)
    || event.handRake < 0
  ) return null;
  const delta = player.chips - (player.handStartChips as number);
  if (!Number.isSafeInteger(delta)) return null;
  return {
    handNumber: event.handNumber,
    endingStack: player.chips,
    delta,
    handRake: event.handRake,
    economyMode: event.economyMode,
  };
}

export function formatChipDelta(delta: number): string {
  if (!Number.isSafeInteger(delta)) return '0';
  if (delta > 0) return `+${delta.toLocaleString('ko-KR')}`;
  return delta.toLocaleString('ko-KR');
}
