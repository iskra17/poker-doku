import type { PublicGameState } from '../poker/types';

/**
 * 파트너 실시간 훈수를 보여 줘도 되는 방인지 — 순수 함수 (회귀: `coach-eligibility.test.ts`).
 *
 * 훈수는 **혼자 연습 테이블에서만** 켠다. 다른 사람과 겨루는 자리에서 실시간으로 수를 알려 주면
 * 보조 도구(RTA)가 되므로 금지다. 방 종류는 로비 목록의 `tableType === 'bots'`(서버가 휴먼 1명으로 제한)로
 * 판정하고, 스냅샷으로도 다른 휴먼이 앉아 있지 않은지 한 번 더 확인한다.
 * - 수련 스토리 방은 자체 CoachPanel이 있어 제외
 * - 주간 도장(리더보드 경쟁)·토너먼트(Sit & Go/MTT)·아레나는 제외
 */
export interface CoachEligibilityInput {
  /** 설정 `partnerCoach` */
  enabled: boolean;
  gameState: Pick<PublicGameState, 'players' | 'weeklyDojo' | 'tournament' | 'economyMode'> | null;
  myPlayerId: string | null;
  /** 현재 방의 로비 목록 항목 `tableType` — 목록에 없으면 undefined (안전하게 끈다) */
  roomTableType: 'bots' | 'mixed' | 'humans' | undefined;
  /** `useStoryLive().active` */
  inStoryRoom: boolean;
}

export function isPartnerCoachEligible(input: CoachEligibilityInput): boolean {
  const { enabled, gameState, myPlayerId, roomTableType, inStoryRoom } = input;
  if (!enabled || !gameState || !myPlayerId) return false;
  if (roomTableType !== 'bots') return false;
  if (inStoryRoom) return false;
  if (gameState.weeklyDojo) return false;
  if (gameState.tournament) return false;
  if (gameState.economyMode === 'arena') return false;
  if (!gameState.players.some(player => player.id === myPlayerId)) return false;
  return gameState.players.every(player => player.id === myPlayerId || player.type === 'bot');
}
