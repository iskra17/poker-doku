import { onGameEvent } from './events/game-events';
import { useGameStore } from './store/game-store';

/**
 * 세션 리캡 집계 — 테이블 세션 동안의 하이라이트를 클라이언트에서 모아
 * 나가기 시 리캡 카드(피크엔드 통제)에 공급한다. 서버 왕복 없음.
 * GameRoomView 마운트 시 initSessionRecap() 1회(모듈 싱글턴), 방 입장마다 reset.
 */

export interface SessionRecapData {
  hands: number;
  wins: number;
  biggestPot: number;
}

let recap: SessionRecapData = { hands: 0, wins: 0, biggestPot: 0 };
let initialized = false;
let trackedRoomId: string | null = null;

export function resetSessionRecap(roomId: string | null): void {
  trackedRoomId = roomId;
  recap = { hands: 0, wins: 0, biggestPot: 0 };
}

/** 현재 집계 스냅샷 — 리캡 카드 표시용 (소비해도 리셋되지 않음) */
export function getSessionRecap(): SessionRecapData {
  return { ...recap };
}

export function initSessionRecap(): void {
  if (initialized) return;
  initialized = true;

  onGameEvent(event => {
    // 방이 바뀌면(재입장 포함) 게임 스토어 기준으로 자동 리셋
    const currentRoomId = useGameStore.getState().currentRoomId;
    if (currentRoomId !== trackedRoomId) resetSessionRecap(currentRoomId);

    switch (event.type) {
      case 'hand-start': {
        // 딜인된 핸드만 센다 — 자리비움 관전 핸드까지 "플레이한 핸드"로 집계되던 문제 (2026-07-22 QA).
        // 스토어는 emit 전에 새 핸드 상태를 반영하므로 여기서 내 좌석 상태를 읽으면 현재 핸드 기준이다.
        const { myPlayerId, gameState } = useGameStore.getState();
        const hero = gameState?.players.find(p => p.id === myPlayerId);
        if (hero && (hero.status === 'active' || hero.status === 'all-in')) recap.hands += 1;
        break;
      }
      case 'winners': {
        const myPlayerId = useGameStore.getState().myPlayerId;
        if (!myPlayerId) break;
        for (const winner of event.winners) {
          if (winner.playerId !== myPlayerId) continue;
          recap.wins += 1;
          if (winner.amount > recap.biggestPot) recap.biggestPot = winner.amount;
        }
        break;
      }
    }
  });
}
