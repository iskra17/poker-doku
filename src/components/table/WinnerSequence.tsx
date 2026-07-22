'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { onGameEvent } from '@/lib/events/game-events';
import { useGameStore } from '@/lib/store/game-store';
import { useChipFormatter } from '@/lib/hooks/use-chip-format';
import { getLayout, toDisplayIndex, TablePos } from './table-layout';
import { HAND_RANK_KO } from './HandStrengthBadge';
import Confetti from '../effects/Confetti';

/**
 * 승리 연출 오케스트레이터.
 * 타임라인: 0.4s 스포트라이트 → 0.7s 핸드명 배너 → 1.4s (빅윈) 컨페티 → 5.5s 클린업
 * (팟→승자 칩 비행은 AnimationLayer가 1.0s 시점에 처리)
 */

interface WinnerInfo {
  name: string;
  amount: number;
  /** 히어로 전용 순획득(팟 − 내 기여) — 남에겐 null (2026-07-22 유저 피드백) */
  netAmount: number | null;
  seatPos: TablePos;
}

interface DisplayState {
  winners: WinnerInfo[];
  handLabel: string;
  bigWin: boolean;
}

interface WinnerSequenceProps {
  isMobile: boolean;
}

export default function WinnerSequence({ isMobile }: WinnerSequenceProps) {
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const [phase, setPhase] = useState(0); // 1: 스포트라이트, 2: 배너, 3: 컨페티
  const formatChips = useChipFormatter();
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isMobileRef = useRef(isMobile);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  useEffect(() => {
    const clearTimers = () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };

    const unsubscribe = onGameEvent(event => {
      if (event.type === 'hand-start') {
        clearTimers();
        setDisplay(null);
        setPhase(0);
        return;
      }
      if (event.type !== 'winners') return;

      clearTimers();
      const layout = getLayout();
      // 내 좌석 기준 회전 (PokerTable의 좌석 배치와 일치)
      const storeState = useGameStore.getState();
      const mySeat = event.players.find(p => p.id === storeState.myPlayerId)?.seatIndex ?? -1;

      // 같은 플레이어가 메인팟+사이드팟으로 여러 번 등장할 수 있어 플레이어 단위로 합산.
      // 히어로는 "얻은 칩"(팟 − 이번 핸드 내 기여)을 표시 — 총팟 표기는 내 베팅이 섞여
      // 체감 획득보다 커 보인다는 유저 피드백 반영. 상대는 관례대로 팟 획득액 그대로.
      const winTotals = new Map<string, number>();
      for (const w of event.winners) {
        winTotals.set(w.playerId, (winTotals.get(w.playerId) ?? 0) + w.amount);
      }
      const winners: WinnerInfo[] = [...winTotals.entries()]
        .map(([playerId, amount]) => {
          const player = event.players.find(p => p.id === playerId);
          if (!player) return null;
          const isHero = playerId === storeState.myPlayerId;
          return {
            name: player.name,
            amount,
            netAmount: isHero ? amount - (player.totalContributed ?? 0) : null,
            seatPos: layout.seats[toDisplayIndex(player.seatIndex, mySeat)],
          };
        })
        .filter((w): w is WinnerInfo => w !== null);

      const bestHand = event.winners.find(w => w.hand)?.hand;
      const handLabel = bestHand ? HAND_RANK_KO[bestHand.rank] : '승리!';

      setDisplay({ winners, handLabel, bigWin: event.bigWin });
      setPhase(0);

      timersRef.current = [
        setTimeout(() => setPhase(1), 400),
        setTimeout(() => setPhase(2), 700),
        ...(event.bigWin ? [setTimeout(() => setPhase(3), 1400)] : []),
        setTimeout(() => {
          setDisplay(null);
          setPhase(0);
        }, 5500),
      ];
    });

    return () => {
      unsubscribe();
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  if (!display) return null;

  const single = display.winners.length === 1 ? display.winners[0] : null;

  return (
    <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
      {/* 스포트라이트: 단독 승자는 좌석에 구멍 뚫린 라디얼, 스플릿은 플랫 딤 */}
      <AnimatePresence>
        {phase >= 1 && (
          <motion.div
            key="spotlight"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
            style={{
              background: single
                ? `radial-gradient(circle at ${single.seatPos.x} ${single.seatPos.y}, transparent 0%, transparent 9%, rgba(4,2,12,0.55) 26%)`
                : 'rgba(4,2,12,0.45)',
            }}
          />
        )}
      </AnimatePresence>

      {/* 승자 좌석 골드 링 펄스 */}
      {phase >= 1 && display.winners.map((w, i) => (
        <motion.div
          key={`ring-${i}`}
          className="absolute rounded-full border-2 border-gilded"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0.9, 0.4, 0.9], scale: [1, 1.15, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          style={{
            left: w.seatPos.x,
            top: w.seatPos.y,
            width: isMobile ? 72 : 96,
            height: isMobile ? 72 : 96,
            x: '-50%',
            y: '-50%',
            boxShadow: '0 0 24px rgba(255,215,106,0.45)',
          }}
        />
      ))}

      {/* 핸드명 배너 */}
      <AnimatePresence>
        {phase >= 2 && (
          <motion.div
            key="banner"
            initial={{ opacity: 0, scale: 0.6, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="absolute left-1/2 top-[57%] -translate-x-1/2 -translate-y-1/2 text-center"
            style={{ x: '-50%', y: '-50%' }}
          >
            <div className="relative overflow-hidden px-6 py-1">
              <div
                className={`font-bold leading-tight ${isMobile ? 'text-4xl' : 'text-6xl'}`}
                style={{
                  fontFamily: 'var(--font-display)',
                  background: 'linear-gradient(135deg, #FFD76A 0%, #FF7EB6 55%, #A78BFA 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  filter: 'drop-shadow(0 2px 12px rgba(255,126,182,0.45))',
                }}
              >
                {display.handLabel}
              </div>
              {/* 샤인 스윕 */}
              <div
                className="absolute inset-y-0 w-14 bg-white/30 blur-sm"
                style={{ animation: 'shine-sweep 1.1s ease-out 0.15s 1 both' }}
              />
            </div>
            <div className={`mt-1 max-w-[92vw] font-bold text-gilded tabular ${isMobile ? 'text-sm' : 'text-lg'}`}>
              {/* 채팅 로그의 "팟 N 획득"(총액)과 숫자가 달라 혼동되지 않게 순수익임을 명시 */}
              {display.winners.map(w => (
                w.netAmount !== null
                  ? `${w.name} 순수익 ${w.netAmount >= 0 ? '+' : ''}${formatChips(w.netAmount)}`
                  : `${w.name} +${formatChips(w.amount)}`
              )).join('  ·  ')}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 빅윈 컨페티 */}
      {phase >= 3 && <Confetti particleCount={isMobile ? 50 : 80} />}
    </div>
  );
}
