import { GameState, Player, RoomDifficulty } from '../poker/types';
import { PokerEngine } from '../poker/engine';
import { BotDecision, decideBotAction } from './bot-ai';
import type { OpponentAggro } from './aggro-tracker';
import {
  getCharacterById,
  getRandomBotCharacter,
  type CharacterProfile,
} from '../characters';

let botIdCounter = 0;

function buildBot(
  character: CharacterProfile,
  seatIndex: number,
  buyIn: number,
  skill?: RoomDifficulty,
): Player {
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
    botSkill: skill,
  };
}

export function createBot(
  seatIndex: number,
  buyIn: number,
  excludeCharacterIds: string[] = [],
  skill?: RoomDifficulty,
): Player {
  return buildBot(getRandomBotCharacter(excludeCharacterIds), seatIndex, buyIn, skill);
}

/** 특정 캐릭터로 봇 생성 — 파트너 우선 착석용. 로스터에 없거나 딜러면 null */
export function createBotWithCharacter(
  seatIndex: number,
  buyIn: number,
  characterId: string,
  skill?: RoomDifficulty,
): Player | null {
  const character = getCharacterById(characterId);
  if (!character || character.id === 'dealer') return null;
  return buildBot(character, seatIndex, buyIn, skill);
}

export function getUsedCharacterIds(engine: PokerEngine): string[] {
  // 봇 성향 + 휴먼 프로필 아바타 모두 제외 대상 — 같은 캐릭터가 테이블에 중복 착석하지 않게
  return engine.state.players
    .map(p => (p.type === 'bot' ? p.personalityId : p.avatar) || '')
    .filter(Boolean);
}

export function fillEmptySeats(
  engine: PokerEngine,
  minPlayers: number = 3,
  botStack?: number,
  difficulty?: RoomDifficulty,
): void {
  const occupiedSeats = new Set(engine.state.players.map(p => p.seatIndex));
  const usedCharacters = getUsedCharacterIds(engine);

  // MTT 가변 정원(최대 9)을 지원하기 위해 좌석 탐색 상한을 목표 인원까지 확장
  for (let seat = 0; seat < Math.max(6, minPlayers) && engine.state.players.length < minPlayers; seat++) {
    if (!occupiedSeats.has(seat)) {
      const bot = createBot(seat, botStack ?? engine.state.bigBlind * 100, usedCharacters, difficulty);
      if (engine.addPlayer(bot)) {
        usedCharacters.push(bot.personalityId || '');
      }
    }
  }
}

/**
 * 결정·상황 기반 사고 시간 — 뻔한 액션은 짧게, 큰 결정은 길게.
 * 공짜 체크/프리플랍 폴드는 즉답에 가깝고, 팟 대비 큰 콜이나 레이즈는 고민하는 척한다.
 */
export function botThinkDelay(decision: BotDecision, player: Player, state: GameState): number {
  const pot = state.pots.reduce((s, p) => s + p.amount, 0);
  const callAmount = Math.max(0, state.currentBet - player.currentBet);
  const jitter = (base: number, spread: number) => base + Math.random() * spread;

  if (decision.action === 'check') return jitter(450, 500);
  if (decision.action === 'fold') {
    // 걸린 게 적은 폴드(프리플랍/스몰벳)는 즉답
    if (state.street === 'preflop' || callAmount <= state.bigBlind * 2) return jitter(500, 600);
    return jitter(800, 900);
  }
  if (decision.action === 'call' && callAmount <= state.bigBlind * 2) return jitter(700, 700);

  // 큰 결정일수록 오래 고민 — 콜 금액이 팟 대비 클 때 가산
  const bigness = pot > 0 ? Math.min(1, callAmount / pot) : 0;
  const base = decision.action === 'raise' || decision.action === 'all-in' ? 1300 : 1000;
  return jitter(base + bigness * 700, 1000);
}

export async function processBotTurn(
  engine: PokerEngine,
  /** 사고 지연 중 루프가 교체됐는지 확인 — true면 액션 없이 중단 (stale 이중 액션 방지) */
  isCancelled?: () => boolean,
  /** 상대 공격성 조회 (aggro-tracker) — 현재 어그레서의 최근 쇼브/레이즈 수. 휴먼만 반환할 것 */
  aggroOf?: (playerId: string) => OpponentAggro | undefined,
  /** 사고 시간 배율 (서버 런타임 설정 주입, 1 = 기본) — 결정 난이도별 형태는 유지, 전체 속도만 조절 */
  thinkDelayScale = 1,
): Promise<{ acted: boolean; action?: ReturnType<typeof decideBotAction> }> {
  const activePlayer = engine.state.players[engine.state.activePlayerIndex];
  if (!activePlayer || activePlayer.type !== 'bot') {
    return { acted: false };
  }

  const validActions = engine.getValidActions(activePlayer);
  const aggressorId = engine.state.lastAggressorId;
  const aggro = aggressorId && aggressorId !== activePlayer.id
    ? aggroOf?.(aggressorId)
    : undefined;
  const decision = decideBotAction(activePlayer, engine.state, validActions, Math.random, aggro);

  await new Promise(resolve => setTimeout(
    resolve,
    Math.max(0, Math.round(botThinkDelay(decision, activePlayer, engine.state) * thinkDelayScale)),
  ));

  if (isCancelled?.()) return { acted: false };

  const result = engine.processAction({
    playerId: activePlayer.id,
    type: decision.action,
    amount: decision.amount,
  });

  // 결정이 거부되면(사고 지연 중 상태 변화 등) 체크/폴드로 강제 진행 — 무한 재시도 교착 방지
  if (!result.valid) {
    const canCheck = activePlayer.currentBet >= engine.state.currentBet;
    engine.processAction({
      playerId: activePlayer.id,
      type: canCheck ? 'check' : 'fold',
      amount: 0,
    });
  }

  return { acted: true, action: decision };
}
