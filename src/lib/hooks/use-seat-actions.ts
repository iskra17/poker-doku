'use client';

import { useEffect, useState } from 'react';
import { onGameEvent } from '@/lib/events/game-events';
import { ActionType } from '@/lib/poker/types';

export interface SeatAction {
  type: ActionType;
  amount: number;
  isBet?: boolean; // 포스트플랍 첫 베팅 — '레이즈' 대신 '벳'으로 표시
}

/**
 * 좌석별 마지막 액션 맵.
 * gameState.lastAction은 전역 단일 필드라 마지막 액터 1명만 알 수 있으므로,
 * 이벤트 스트림에서 좌석별로 누적해 각 좌석에 액션 배지를 유지한다.
 * - action → 해당 좌석 갱신
 * - street-dealt / bets-collected → 폴드 제외 클리어 (새 스트리트의 액션만 표시)
 * - hand-start → 전체 클리어
 * (setState는 외부 이벤트 콜백에서만 — react-hooks 순수성 규칙 준수)
 */
export function useSeatActions(): Record<number, SeatAction> {
  const [actions, setActions] = useState<Record<number, SeatAction>>({});

  useEffect(() => {
    const unsubscribe = onGameEvent(event => {
      switch (event.type) {
        case 'action':
          if (event.seatIndex >= 0) {
            setActions(prev => ({
              ...prev,
              [event.seatIndex]: { type: event.actionType, amount: event.amount, isBet: event.isBet },
            }));
          }
          break;
        case 'street-dealt':
        case 'bets-collected':
          setActions(prev => {
            const next: Record<number, SeatAction> = {};
            for (const [seat, action] of Object.entries(prev)) {
              if (action.type === 'fold') next[Number(seat)] = action;
            }
            return next;
          });
          break;
        case 'hand-start':
          setActions({});
          break;
      }
    });
    return unsubscribe;
  }, []);

  return actions;
}
