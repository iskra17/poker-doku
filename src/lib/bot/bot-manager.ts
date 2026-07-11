import { Player } from '../poker/types';
import { PokerEngine } from '../poker/engine';
import { decideBotAction } from './bot-ai';
import { getRandomBotCharacter } from '../characters';

let botIdCounter = 0;

export function createBot(seatIndex: number, buyIn: number, excludeCharacterIds: string[] = []): Player {
  const character = getRandomBotCharacter(excludeCharacterIds);
  botIdCounter++;
  return {
    id: `bot-${character.id}-${botIdCounter}`,
    name: character.name,
    type: 'bot',
    avatar: character.id,
    chips: buyIn,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
    personalityId: character.id,
  };
}

export function getUsedCharacterIds(engine: PokerEngine): string[] {
  // 봇 성향 + 휴먼 프로필 아바타 모두 제외 대상 — 같은 캐릭터가 테이블에 중복 착석하지 않게
  return engine.state.players
    .map(p => (p.type === 'bot' ? p.personalityId : p.avatar) || '')
    .filter(Boolean);
}

export function fillEmptySeats(engine: PokerEngine, minPlayers: number = 3, botStack?: number): void {
  const occupiedSeats = new Set(engine.state.players.map(p => p.seatIndex));
  const usedCharacters = getUsedCharacterIds(engine);

  for (let seat = 0; seat < 6 && engine.state.players.length < minPlayers; seat++) {
    if (!occupiedSeats.has(seat)) {
      const bot = createBot(seat, botStack ?? engine.state.bigBlind * 100, usedCharacters);
      if (engine.addPlayer(bot)) {
        usedCharacters.push(bot.personalityId || '');
      }
    }
  }
}

export async function processBotTurn(engine: PokerEngine): Promise<{ acted: boolean; action?: ReturnType<typeof decideBotAction> }> {
  const activePlayer = engine.state.players[engine.state.activePlayerIndex];
  if (!activePlayer || activePlayer.type !== 'bot') {
    return { acted: false };
  }

  const validActions = engine.getValidActions(activePlayer);
  const decision = decideBotAction(activePlayer, engine.state, validActions);

  // Add a small delay to simulate thinking
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

  engine.processAction({
    playerId: activePlayer.id,
    type: decision.action,
    amount: decision.amount,
  });

  return { acted: true, action: decision };
}
