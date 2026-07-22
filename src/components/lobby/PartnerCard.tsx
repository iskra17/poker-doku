'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import CharacterShowcaseModal from '@/components/characters/CharacterShowcaseModal';
import { getCharacterById } from '@/lib/characters';
import {
  getPartnerLine,
  getPartnerTier,
  hasTieredPartnerScript,
  lobbyGreetingMoment,
} from '@/lib/characters/partner-dialogue';
import { useGameStore } from '@/lib/store/game-store';
import { useProfileStore } from '@/lib/store/profile-store';
import { useProgressionStore } from '@/lib/store/progression-store';

const LAST_VISIT_PREFIX = 'poker-doku-last-visit:';
const REUNION_GAP_MS = 3 * 24 * 60 * 60 * 1000;

function readAndTouchLastVisit(profileId: string, now: number): number | null {
  const key = `${LAST_VISIT_PREFIX}${profileId}`;
  try {
    const raw = window.localStorage.getItem(key);
    window.localStorage.setItem(key, String(now));
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 로비 파트너 상주 카드 — "함께할 캐릭터" 약속의 이행 (2026-07-22 리텐션 기획 1주차).
 * 시간대/재회 인사, 말 걸기(탭 순환), [수련 시작] 원탭 CTA(혼자 연습 방 즉시 입장).
 * 대사는 전부 수기 스크립트 (partner-dialogue) — AI 미사용.
 */
export default function PartnerCard() {
  const profile = useProfileStore(state => state.profile);
  const progression = useProgressionStore(state => state.snapshot);
  const rooms = useGameStore(state => state.rooms);
  const pendingRoomId = useGameStore(state => state.pendingRoomId);
  const [talkLine, setTalkLine] = useState<string | null>(null);
  const [showcaseOpen, setShowcaseOpen] = useState(false);

  const partnerId = progression?.profile.selectedCharacterId ?? profile?.avatarId ?? null;
  const affinityLevel = progression?.affinities.find(a => a.characterId === partnerId)?.level ?? 1;
  const tier = getPartnerTier(affinityLevel);

  // 인사말은 마운트 시 1회 결정 — 시간대/재회(3일+) 판정. 렌더 중 Date.now() 금지 규칙에 따라
  // useMemo(외부 시스템 읽기)로 1회만 계산한다.
  const greeting = useMemo(() => {
    if (!partnerId || !profile || typeof window === 'undefined') return null;
    const now = Date.now();
    const lastVisit = readAndTouchLastVisit(profile.id, now);
    const moment = lastVisit !== null && now - lastVisit >= REUNION_GAP_MS
      ? 'lobby-reunion' as const
      : lobbyGreetingMoment(new Date(now).getHours());
    return getPartnerLine(partnerId, moment, tier);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 방문 인사는 세션당 1회 고정
  }, [partnerId, profile?.id]);

  if (!profile || !partnerId) return null;
  const character = getCharacterById(partnerId);
  if (!character) return null;

  // CTA: 보존 좌석이 있으면 복귀 우선, 없으면 혼자 연습(bots) 방 원탭 입장
  const preservedRoom = rooms.find(room => room.mySeat && (room.mode === 'sng' || room.mySeat.chips > 0));
  const practiceRoom = rooms.find(room => room.tableType === 'bots' && !room.locked);
  const firstTime = (progression?.profile.completedHands ?? 0) === 0;

  const handleCta = () => {
    if (pendingRoomId) return;
    if (preservedRoom) {
      useGameStore.getState().joinRoom(preservedRoom.id, 0, 0);
      return;
    }
    if (practiceRoom) {
      // 연습 경제(지갑 무관) — 기본 100BB 바이인으로 모달 없이 즉시 착석
      const buyIn = (practiceRoom.bigBlind ?? 20) * 100;
      useGameStore.getState().joinRoom(practiceRoom.id, buyIn, 0);
    }
  };

  const speech = talkLine ?? greeting;

  return (
    <section className="mx-auto mb-2 w-full max-w-4xl px-3 md:px-4" aria-label="파트너">
      <div className="rounded-2xl border border-blossom/25 bg-panel/85 p-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
        {/* 파트너 일러스트 — 탭하면 말을 건다(대사 순환), 길게 보고 싶으면 쇼케이스 */}
        <motion.button
          type="button"
          onClick={() => setTalkLine(getPartnerLine(partnerId, 'lobby-talk', tier))}
          onDoubleClick={() => setShowcaseOpen(true)}
          aria-label={`${character.name}에게 말 걸기`}
          title="탭: 말 걸기 · 더블탭: 크게 보기"
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border"
          style={{ borderColor: `${character.color}55` }}
          animate={{ y: [0, -2, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <CharacterImage
            characterId={partnerId}
            expression={talkLine ? 'happy' : 'neutral'}
            round={false}
            skinId={progression?.equipment.skin}
            className="h-full w-full text-3xl"
          />
        </motion.button>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: character.color }}>
            {character.name}
            <span className="rounded-full bg-blossom/15 px-1.5 py-px text-[9px] font-bold text-blossom">
              인연 Lv.{affinityLevel}
            </span>
            {hasTieredPartnerScript(partnerId) && tier === 2 && (
              <span className="rounded-full bg-gilded/15 px-1.5 py-px text-[9px] font-bold text-gilded">단짝</span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={handleCta}
          disabled={!!pendingRoomId || (!preservedRoom && !practiceRoom)}
          className="shrink-0 rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2.5 text-sm font-bold text-white shadow-lg transition-transform hover:scale-[1.03] disabled:opacity-50"
        >
          {pendingRoomId
            ? '입장 중…'
            : preservedRoom
              ? '게임 복귀'
              : firstTime
                ? '첫 수련 시작'
                : '수련 시작'}
        </button>
        </div>

        {/* 대사 — 카드 전체 폭 사용 (좁은 화면에서 1줄 말줄임되던 문제: 행 분리로 폭 2배 확보,
            자연 줄바꿈 + 극단 케이스만 3줄 클램프) */}
        {speech && (
          <motion.p
            key={speech}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink"
          >
            “{speech}”
          </motion.p>
        )}
      </div>

      <CharacterShowcaseModal
        characterId={showcaseOpen ? partnerId : null}
        onClose={() => setShowcaseOpen(false)}
      />
    </section>
  );
}
