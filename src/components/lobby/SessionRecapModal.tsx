'use client';

import { useMemo } from 'react';
import Modal from '@/components/ui/Modal';
import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import {
  getPartnerLine,
  getPartnerTier,
} from '@/lib/characters/partner-dialogue';
import { useProgressionStore } from '@/lib/store/progression-store';
import type { SessionRecapData } from '@/lib/session-recap';

interface SessionRecapModalProps {
  recap: SessionRecapData | null;
  onClose: () => void;
}

/**
 * 오늘의 수련 리캡 — 테이블을 떠난 직후 로비에서 세션 하이라이트 + 파트너 작별 인사.
 * 세션의 마지막 30초를 게임이 통제하는 피크엔드 장치 (2026-07-22 리텐션 기획 3주차 항목 선행).
 */
export default function SessionRecapModal({ recap, onClose }: SessionRecapModalProps) {
  const partnerId = useProgressionStore(state => state.snapshot?.profile.selectedCharacterId ?? null);
  const affinityLevel = useProgressionStore(state =>
    state.snapshot?.affinities.find(a => a.characterId === state.snapshot?.profile.selectedCharacterId)?.level ?? 1,
  );
  const character = partnerId ? getCharacterById(partnerId) : null;
  const farewell = useMemo(
    () => (partnerId ? getPartnerLine(partnerId, 'farewell', getPartnerTier(affinityLevel)) : null),
    [partnerId, affinityLevel],
  );

  if (!recap) return null;
  return (
    <Modal isOpen onClose={onClose} title="오늘의 수련">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-3">
            <p className="text-lg font-bold text-ink tabular-nums">{recap.hands}</p>
            <p className="text-[10px] text-ink-dim">플레이한 핸드</p>
          </div>
          <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-3">
            <p className="text-lg font-bold text-gilded tabular-nums">{recap.wins}</p>
            <p className="text-[10px] text-ink-dim">가져온 팟</p>
          </div>
          <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-3">
            <p className="text-lg font-bold text-blossom tabular-nums">
              {recap.biggestPot > 0 ? recap.biggestPot.toLocaleString('ko-KR') : '—'}
            </p>
            <p className="text-[10px] text-ink-dim">최대 획득 팟</p>
          </div>
        </div>

        {character && farewell && (
          <div
            className="flex items-start gap-2.5 rounded-xl border bg-elevated/50 p-3"
            style={{ borderColor: `${character.color}44` }}
          >
            <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-full">
              <CharacterImage characterId={character.id} expression="happy" round className="h-full w-full text-xl" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold" style={{ color: character.color }}>{character.name}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink">“{farewell}”</p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white"
        >
          다음에 또 만나요
        </button>
      </div>
    </Modal>
  );
}
