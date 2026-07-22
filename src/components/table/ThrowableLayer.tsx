'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { onGameEvent, emitGameEvent } from '@/lib/events/game-events';
import { useGameStore } from '@/lib/store/game-store';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { THROWABLE_MAP, THROW_FLIGHT_MS, type ThrowableDefinition } from '@/lib/throwables/catalog';
import { getLayout, toDisplayIndex, TablePos } from './table-layout';

/**
 * 투척물 비행 + 스플랫 오버레이.
 * AnimationLayer(칩/카드)와 분리된 전용 레이어 — 칩 비행 슬롯을 잠식하지 않고,
 * 포물선·회전·스플랫 체인은 Flight 계약과 이질적이라서다.
 * z-[25]: 좌석(z-10) 위, 말풍선(z-30) 아래.
 *
 * throwable-thrown을 구독해 비행을 스폰하고, 비행 종료 시점에 throwable-impact를
 * 단일 발행한다 — 표정/이모트/사운드 소비자는 impact만 구독하면 명중 타이밍이 맞는다.
 * prefers-reduced-motion이면 연출은 생략하되 impact는 즉시 발행해 체인 일관성을 지킨다.
 */

interface ActiveThrow {
  key: string; // throwId
  def: ThrowableDefinition;
  from: TablePos;
  to: TablePos;
  midX: string;
  peakY: string;
}

interface SplatParticle {
  dx: number;
  dy: number;
  rotate: number;
}

interface ActiveSplat {
  key: string;
  def: ThrowableDefinition;
  pos: TablePos;
  particles: SplatParticle[];
}

const MAX_THROWS = 6;
const SPLAT_LIFETIME_MS = 1_400;

function burstParticles(): SplatParticle[] {
  // 방사형 5조각 — 각도 균등 + 소량 랜덤 지터 (연출 전용이라 Math.random 허용)
  return Array.from({ length: 5 }, (_, i) => {
    const angle = (i / 5) * Math.PI * 2 + Math.random() * 0.6;
    const dist = 22 + Math.random() * 14;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      rotate: Math.random() * 240 - 120,
    };
  });
}

export default function ThrowableLayer({ isMobile }: { isMobile: boolean }) {
  const [throws, setThrows] = useState<ActiveThrow[]>([]);
  const [splats, setSplats] = useState<ActiveSplat[]>([]);
  const reduced = usePrefersReducedMotion();
  const reducedRef = useRef(reduced);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const timers = timersRef.current;
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    const unsubscribe = onGameEvent(event => {
      if (event.type !== 'throwable-thrown') return;
      const def = THROWABLE_MAP[event.itemId];
      if (!def) return;

      const impact = () => emitGameEvent({
        type: 'throwable-impact',
        throwId: event.throwId,
        itemId: event.itemId,
        targetPlayerId: event.targetPlayerId,
        targetSeatIndex: event.targetSeatIndex,
      });

      if (reducedRef.current) {
        // 모션 생략 시에도 impact 체인(표정/이모트/사운드)은 즉시 이어간다.
        // 이벤트 디스패치 중 재진입을 피하려고 다음 틱으로 미룬다.
        later(impact, 0);
        return;
      }

      const layout = getLayout();
      const storeState = useGameStore.getState();
      const mySeat = storeState.gameState?.players.find(p => p.id === storeState.myPlayerId)?.seatIndex ?? -1;
      const from = layout.seats[toDisplayIndex(event.fromSeatIndex, mySeat)];
      const to = layout.seats[toDisplayIndex(event.targetSeatIndex, mySeat)];
      if (!from || !to) {
        later(impact, 0);
        return;
      }

      const fx = parseFloat(from.x);
      const tx = parseFloat(to.x);
      const fy = parseFloat(from.y);
      const ty = parseFloat(to.y);
      const item: ActiveThrow = {
        key: event.throwId,
        def,
        from,
        to,
        midX: `${(fx + tx) / 2}%`,
        // 포물선 근사 — 두 좌석 중 높은 쪽보다 12% 위를 정점으로
        peakY: `${Math.max(4, Math.min(fy, ty) - 12)}%`,
      };
      setThrows(prev => [...prev, item].slice(-MAX_THROWS));

      later(() => {
        setThrows(prev => prev.filter(t => t.key !== event.throwId));
        impact();
        const splat: ActiveSplat = {
          key: event.throwId,
          def,
          pos: to,
          particles: def.splat === 'burst' ? burstParticles() : [],
        };
        setSplats(prev => [...prev, splat].slice(-MAX_THROWS));
        later(() => {
          setSplats(prev => prev.filter(s => s.key !== event.throwId));
        }, SPLAT_LIFETIME_MS);
      }, THROW_FLIGHT_MS);
    });

    return () => {
      unsubscribe();
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  const projectileSize = isMobile ? 'text-2xl' : 'text-3xl';

  return (
    <div className="absolute inset-0 pointer-events-none z-[25] overflow-hidden">
      {/* 비행체 — 포물선 키프레임 + 회전 */}
      {throws.map(t => (
        <motion.div
          key={t.key}
          className="absolute"
          initial={{ left: t.from.x, top: t.from.y, scale: 0.7, rotate: 0 }}
          animate={{
            left: [t.from.x, t.midX, t.to.x],
            top: [t.from.y, t.peakY, t.to.y],
            scale: [0.7, 1.15, 1],
            rotate: 540,
          }}
          transition={{
            duration: THROW_FLIGHT_MS / 1000,
            times: [0, 0.5, 1],
            ease: 'easeIn',
          }}
          style={{ x: '-50%', y: '-50%' }}
        >
          {t.def.sprite ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.def.sprite} alt={t.def.name} className={isMobile ? 'w-8 h-8' : 'w-10 h-10'} />
          ) : (
            <span className={`${projectileSize} drop-shadow-lg`}>{t.def.emoji}</span>
          )}
        </motion.div>
      ))}

      {/* 스플랫 — 아이템별 명중 이펙트. 내부 모션이 opacity 0까지 끝난 뒤 상태에서 제거되므로
          AnimatePresence 없이도 퇴장이 어색하지 않다 */}
      {splats.map(s => (
          <div
            key={s.key}
            className="absolute"
            style={{ left: s.pos.x, top: s.pos.y }}
          >
            {s.def.splat === 'burst' ? (
              <>
                {/* 퍼지는 얼룩 원 */}
                <motion.div
                  className="absolute rounded-full"
                  initial={{ scale: 0.3, opacity: 0.85 }}
                  animate={{ scale: 1.25, opacity: 0 }}
                  transition={{ duration: SPLAT_LIFETIME_MS / 1000, ease: 'easeOut' }}
                  style={{
                    x: '-50%',
                    y: '-50%',
                    width: isMobile ? 64 : 84,
                    height: isMobile ? 64 : 84,
                    background: 'radial-gradient(circle, rgba(220,58,48,0.55) 0%, rgba(190,40,34,0.3) 45%, transparent 70%)',
                  }}
                />
                {/* 방사형 조각 */}
                {s.particles.map((p, i) => (
                  <motion.span
                    key={i}
                    className="absolute text-sm"
                    initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 0.9 }}
                    animate={{
                      x: `calc(-50% + ${p.dx}px)`,
                      y: `calc(-50% + ${p.dy}px)`,
                      opacity: 0,
                      scale: 0.5,
                      rotate: p.rotate,
                    }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                  >
                    {s.def.splatEmoji}
                  </motion.span>
                ))}
              </>
            ) : (
              <>
                {/* wrap — 아바타를 가로지르는 리본 */}
                {[-14, 2, 16].map((offset, i) => (
                  <motion.div
                    key={i}
                    className="absolute rounded-sm bg-white/85 shadow-sm"
                    initial={{ x: '-50%', y: '-50%', scaleX: 0, opacity: 0.95, rotate: i % 2 === 0 ? -10 : 8 }}
                    animate={{ scaleX: 1, opacity: [0.95, 0.95, 0] }}
                    transition={{ duration: SPLAT_LIFETIME_MS / 1000, times: [0, 0.7, 1], delay: i * 0.07 }}
                    style={{
                      top: offset,
                      width: isMobile ? 58 : 76,
                      height: isMobile ? 7 : 9,
                    }}
                  />
                ))}
                <motion.span
                  className="absolute text-lg"
                  initial={{ x: '-50%', y: '-50%', scale: 1.3, opacity: 1 }}
                  animate={{ scale: [1.3, 0.95, 1], y: ['-50%', '-64%', '-50%'], opacity: [1, 1, 0] }}
                  transition={{ duration: SPLAT_LIFETIME_MS / 1000, times: [0, 0.4, 1] }}
                >
                  {s.def.splatEmoji}
                </motion.span>
              </>
            )}
        </div>
      ))}
    </div>
  );
}
