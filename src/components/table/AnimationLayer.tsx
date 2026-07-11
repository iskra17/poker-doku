'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { onGameEvent } from '@/lib/events/game-events';
import { useGameStore } from '@/lib/store/game-store';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { getLayout, toDisplayIndex, TablePos } from './table-layout';
import ChipSVG, { CHIP_DENOMS, decomposeChips } from './ChipSVG';

/**
 * 칩/카드 비행 오버레이.
 * 테이블 컨테이너(% 좌표계) 안에 absolute로 깔리고, 게임 이벤트를 구독해
 * 좌석↔베팅↔팟↔덱 사이의 절대좌표 트윈 비행체를 스폰한다.
 */

interface Flight {
  id: number;
  kind: 'chip' | 'card';
  from: TablePos;
  to: TablePos;
  delayMs: number;
  durationMs: number;
  fadeOut?: boolean;
  denomIndex?: number;
}

let nextFlightId = 1;
const MAX_FLIGHTS = 24;

/** 비행용 미니 카드백 */
function MiniCardBack({ compact }: { compact: boolean }) {
  return (
    <div
      className={`${compact ? 'w-6 h-8' : 'w-8 h-11'} rounded-md border border-cyber/30 shadow-md`}
      style={{ background: 'linear-gradient(135deg, #c2477f 0%, #7d3ba8 60%, #4a2580 100%)' }}
    />
  );
}

interface AnimationLayerProps {
  isMobile: boolean;
}

export default function AnimationLayer({ isMobile }: AnimationLayerProps) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const isMobileRef = useRef(isMobile);
  const reduced = usePrefersReducedMotion();
  const reducedRef = useRef(reduced);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const spawn = (items: Omit<Flight, 'id'>[]) => {
      if (reducedRef.current || items.length === 0) return;
      setFlights(prev => {
        const added = items.map(item => ({ ...item, id: nextFlightId++ }));
        return [...prev, ...added].slice(-MAX_FLIGHTS);
      });
    };

    const unsubscribe = onGameEvent(event => {
      const layout = getLayout();
      const compact = isMobileRef.current;
      // 내 좌석 기준 회전 (PokerTable의 좌석 배치와 일치해야 함)
      const storeState = useGameStore.getState();
      const mySeat = storeState.gameState?.players.find(p => p.id === storeState.myPlayerId)?.seatIndex ?? -1;
      const seatPos = (seatIndex: number) => layout.seats[toDisplayIndex(seatIndex, mySeat)];
      const betPos = (seatIndex: number) => layout.betPositions[toDisplayIndex(seatIndex, mySeat)];

      switch (event.type) {
        // 베팅: 좌석 → 베팅 위치 칩 비행
        case 'action': {
          if (event.seatIndex < 0) break;
          if (event.actionType === 'call' || event.actionType === 'raise' || event.actionType === 'all-in') {
            const chips = decomposeChips(event.amount || 1, event.actionType === 'all-in' ? 3 : 2);
            spawn(chips.map((denom, i) => ({
              kind: 'chip' as const,
              from: seatPos(event.seatIndex),
              to: betPos(event.seatIndex),
              delayMs: i * 60,
              durationMs: 350,
              denomIndex: CHIP_DENOMS.indexOf(denom),
            })));
          }
          // 폴드: 좌석 → 덱 방향 카드 페이드아웃
          if (event.actionType === 'fold') {
            spawn([0, 1].map(i => ({
              kind: 'card' as const,
              from: seatPos(event.seatIndex),
              to: layout.deckPos,
              delayMs: i * 70,
              durationMs: 400,
              fadeOut: true,
            })));
          }
          break;
        }

        // 스트리트 전환: 각 베팅 위치 → 팟으로 수거
        case 'bets-collected': {
          spawn(event.bets.flatMap((bet, i) => {
            const chips = decomposeChips(bet.amount, 2);
            return chips.map((denom, j) => ({
              kind: 'chip' as const,
              from: betPos(bet.seatIndex),
              to: layout.potPos,
              delayMs: i * 40 + j * 50,
              durationMs: 400,
              fadeOut: true,
              denomIndex: CHIP_DENOMS.indexOf(denom),
            }));
          }));
          break;
        }

        // 홀카드 딜: 덱 → 착석 좌석 (딜 순서 스태거)
        case 'hand-start': {
          const players = useGameStore.getState().gameState?.players ?? [];
          const dealt = players.filter(p => p.status === 'active' || p.status === 'all-in');
          spawn(dealt.flatMap((p, i) => [0, 1].map(round => ({
            kind: 'card' as const,
            from: layout.deckPos,
            to: seatPos(p.seatIndex),
            delayMs: round * dealt.length * 90 + i * 90,
            durationMs: 300,
            fadeOut: true,
          }))));
          break;
        }

        // 커뮤니티 카드 딜: 덱 → 보드 슬롯
        case 'street-dealt': {
          const slotGap = compact ? 11 : 14; // 보드 슬롯 x 간격 (세로 컬럼 폭 % 기준)
          const baseX = parseFloat(layout.boardPos.x);
          const baseY = layout.boardPos.y;
          spawn(event.newCards.map((_, i) => {
            const slot = event.startIndex + i;
            return {
              kind: 'card' as const,
              from: layout.deckPos,
              to: { x: `${baseX + (slot - 2) * slotGap}%`, y: baseY },
              delayMs: i * 150,
              durationMs: 320,
              fadeOut: true,
            };
          }));
          break;
        }

        // 승자 푸시: 팟 → 승자 좌석 부챗살 (승리 시퀀스 1.0s 시점)
        case 'winners': {
          const flights: Omit<Flight, 'id'>[] = [];
          for (const win of event.winners) {
            const player = event.players.find(p => p.id === win.playerId);
            if (!player) continue;
            const chips = decomposeChips(win.amount, 6);
            chips.forEach((denom, i) => {
              flights.push({
                kind: 'chip',
                from: layout.potPos,
                to: seatPos(player.seatIndex),
                delayMs: 1000 + i * 60,
                durationMs: 600,
                fadeOut: true,
                denomIndex: CHIP_DENOMS.indexOf(denom),
              });
            });
          }
          spawn(flights);
          break;
        }
      }
    });

    return unsubscribe;
  }, []);

  const removeFlight = (id: number) => {
    setFlights(prev => prev.filter(f => f.id !== id));
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
      {flights.map(f => (
        <motion.div
          key={f.id}
          className="absolute"
          initial={{ left: f.from.x, top: f.from.y, opacity: 1, scale: 0.85 }}
          animate={{
            left: f.to.x,
            top: f.to.y,
            opacity: f.fadeOut ? [1, 1, 0] : 1,
            scale: 1,
          }}
          transition={{
            duration: f.durationMs / 1000,
            delay: f.delayMs / 1000,
            ease: 'easeOut',
          }}
          style={{ x: '-50%', y: '-50%' }}
          onAnimationComplete={() => removeFlight(f.id)}
        >
          {f.kind === 'chip' ? (
            <ChipSVG denom={CHIP_DENOMS[f.denomIndex ?? CHIP_DENOMS.length - 1]} size={isMobile ? 18 : 24} />
          ) : (
            <MiniCardBack compact={isMobile} />
          )}
        </motion.div>
      ))}
    </div>
  );
}
