'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import {
  getPartnerLine,
  getPartnerTier,
  type PartnerMoment,
} from '@/lib/characters/partner-dialogue';
import { onGameEvent } from '@/lib/events/game-events';
import { useGameStore } from '@/lib/store/game-store';
import { useProgressionStore } from '@/lib/store/progression-store';

/**
 * 파트너의 유저 상황 반응 — 내 빅팟 승리 / 파산 순간에 파트너(인연 캐릭터)가
 * 나에게만 보이는 말을 건다 (수기 스크립트, 방 브로드캐스트 아님).
 * 배드빗 직후 위로가 이 게임 최강의 애착 트리거라는 기획 합의의 구현체.
 * 파트너가 이 테이블에 앉아 있을 때만 발화한다 (없는 사람이 말하면 세계가 깨진다).
 */
export default function PartnerReactions() {
  const [line, setLine] = useState<{ text: string; mood: 'happy' | 'sad' } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetedRoomRef = useRef<string | null>(null);
  const bustNotifiedRef = useRef(false);

  useEffect(() => {
    const partnerAtTable = (): string | null => {
      const partnerId = useProgressionStore.getState().snapshot?.profile.selectedCharacterId;
      if (!partnerId) return null;
      const seated = useGameStore.getState().gameState?.players.some(
        p => p.type === 'bot' && (p.personalityId || p.avatar) === partnerId && !p.pendingRemoval,
      );
      return seated ? partnerId : null;
    };

    const speak = (moment: PartnerMoment, mood: 'happy' | 'sad', ms = 4_500) => {
      const partnerId = partnerAtTable();
      if (!partnerId) return;
      const level = useProgressionStore.getState().snapshot?.affinities
        .find(a => a.characterId === partnerId)?.level ?? 1;
      const text = getPartnerLine(partnerId, moment, getPartnerTier(level));
      if (!text) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      setLine({ text, mood });
      timerRef.current = setTimeout(() => setLine(null), ms);
    };

    const unsubscribe = onGameEvent(event => {
      const roomId = useGameStore.getState().currentRoomId;
      switch (event.type) {
        case 'hand-start': {
          // 방 입장 후 첫 핸드에서 한 번만 인사
          if (roomId && greetedRoomRef.current !== roomId) {
            greetedRoomRef.current = roomId;
            bustNotifiedRef.current = false;
            speak('table-greeting', 'happy', 4_000);
          }
          break;
        }
        case 'winners': {
          const myPlayerId = useGameStore.getState().myPlayerId;
          if (!myPlayerId) break;
          const iWonBig = event.bigWin
            && event.winners.some(winner => winner.playerId === myPlayerId);
          if (iWonBig) {
            speak('user-bigwin', 'happy');
            break;
          }
          break;
        }
        case 'hand-end': {
          // 파산 위로 — 핸드 종료 시점 내 칩 0 (한 세션에 한 번만, 리바이 후 재파산 대비 리셋 없음)
          const state = useGameStore.getState();
          const me = state.gameState?.players.find(p => p.id === state.myPlayerId);
          if (me && me.chips <= 0 && me.status !== 'all-in' && !bustNotifiedRef.current) {
            bustNotifiedRef.current = true;
            speak('user-bust', 'sad', 6_000);
          }
          break;
        }
      }
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const partnerId = useProgressionStore(state => state.snapshot?.profile.selectedCharacterId ?? null);
  const character = partnerId ? getCharacterById(partnerId) : null;
  if (!character) return null;

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-40 max-w-[min(78%,300px)]">
      <AnimatePresence>
        {line && (
          <motion.div
            key={line.text}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex items-start gap-2 rounded-xl border bg-panel/90 px-2.5 py-2 backdrop-blur-sm"
            style={{ borderColor: `${character.color}55` }}
          >
            <span className="block h-9 w-9 shrink-0 overflow-hidden rounded-full">
              <CharacterImage
                characterId={character.id}
                expression={line.mood}
                round
                className="h-full w-full text-lg"
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-bold" style={{ color: character.color }}>
                {character.name}
              </span>
              <span className="block text-[11px] leading-snug text-ink">{line.text}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
