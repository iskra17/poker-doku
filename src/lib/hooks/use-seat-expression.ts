'use client';

import { useEffect, useRef, useState } from 'react';
import { onGameEvent } from '../events/game-events';
import { Expression } from '../assets/character-art';

/**
 * 좌석 캐릭터 표정 드라이버.
 * 승리→happy(5s), 폴드/쇼다운 패배→sad, 레이즈/올인→confident, 내 턴→thinking, 이후 neutral 복귀.
 */
export function useSeatExpression(playerId: string | undefined, isActive: boolean): Expression {
  const [expression, setExpression] = useState<Expression>('neutral');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playerId) return;

    const setTemporary = (expr: Expression, ms: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setExpression(expr);
      timerRef.current = setTimeout(() => setExpression('neutral'), ms);
    };

    const unsubscribe = onGameEvent(event => {
      switch (event.type) {
        case 'action':
          if (event.playerId !== playerId) break;
          if (event.actionType === 'raise' || event.actionType === 'all-in') {
            setTemporary('confident', 3000);
          } else if (event.actionType === 'fold') {
            setTemporary('sad', 3000);
          }
          break;

        case 'winners': {
          const won = event.winners.some(w => w.playerId === playerId);
          if (won) {
            setTemporary('happy', 5000);
          } else {
            // 쇼다운까지 갔는데 패배한 경우만 sad
            const player = event.players.find(p => p.id === playerId);
            if (player && (player.status === 'active' || player.status === 'all-in')) {
              setTemporary('sad', 4000);
            }
          }
          break;
        }

        case 'hand-start':
          if (timerRef.current) clearTimeout(timerRef.current);
          setExpression('neutral');
          break;
      }
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playerId]);

  return expression === 'neutral' && isActive ? 'thinking' : expression;
}
