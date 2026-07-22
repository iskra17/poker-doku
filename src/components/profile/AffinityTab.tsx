'use client';

import { useState } from 'react';
import CharacterImage from '@/components/characters/CharacterImage';
import BondSceneModal from '@/components/characters/BondSceneModal';
import { getCharacterById } from '@/lib/characters';
import {
  getBondSceneArt,
  getBondScenes,
  isBondSceneUnlocked,
  type BondScene,
} from '@/lib/characters/bond-scenes';
import { getBalance, milliToUiUnits } from '@/lib/progression/balance';
import { PROGRESSION_CHARACTER_IDS } from '@/lib/progression/types';
import { useProgressionStore } from '@/lib/store/progression-store';

export default function AffinityTab() {
  const snapshot = useProgressionStore(state => state.snapshot);
  const action = useProgressionStore(state => state.action);
  const selectCharacter = useProgressionStore(state => state.selectCharacter);
  const [viewingScene, setViewingScene] = useState<BondScene | null>(null);
  if (!snapshot) return null;
  const balance = getBalance(snapshot.profile.balanceVersion);
  return (
    <div className="space-y-2">
      {PROGRESSION_CHARACTER_IDS.map(characterId => {
        const character = getCharacterById(characterId);
        const affinity = snapshot.affinities.find(value => value.characterId === characterId);
        const selected = snapshot.profile.selectedCharacterId === characterId;
        const level = affinity?.level ?? 1;
        const threshold = level >= balance.affinityMaxLevel ? 0 : balance.affinityForNextLevel(level);
        const scenes = getBondScenes(characterId);
        return (
          <div
            key={characterId}
            className={`rounded-xl border p-3 transition-colors ${selected ? 'border-blossom bg-blossom/10' : 'border-mystic/20 bg-elevated/50'}`}
          >
            <button
              type="button"
              aria-pressed={selected}
              disabled={action !== null}
              onClick={() => void selectCharacter(characterId)}
              className="flex w-full items-center gap-3 text-left disabled:opacity-50"
            >
              <CharacterImage characterId={characterId} round className="h-11 w-11 shrink-0 text-xl" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">{character?.name ?? characterId} · 인연 {level}</span>
                <span className="block text-[10px] text-ink-dim">{threshold === 0 ? '최고 레벨' : `${milliToUiUnits(affinity?.xpMilli ?? 0)} / ${milliToUiUnits(threshold)} XP`}</span>
              </span>
              <span className="text-[10px] font-bold text-blossom">{selected ? '선택됨' : '선택'}</span>
            </button>

            {/* 인연 씬 갤러리 — 마일스톤(5/10/15/20) 해금 이벤트 CG 다시보기 */}
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {scenes.map(scene => {
                const unlocked = isBondSceneUnlocked(scene, level);
                return unlocked ? (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => setViewingScene(scene)}
                    aria-label={`인연 씬 보기 — ${scene.title}`}
                    className="group relative aspect-[2/3] overflow-hidden rounded-lg border border-white/15"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getBondSceneArt(scene)}
                      alt={scene.title}
                      draggable={false}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-abyss/80 to-transparent px-1 pb-0.5 pt-2 text-left text-[8px] font-bold text-white">
                      {scene.title}
                    </span>
                  </button>
                ) : (
                  <div
                    key={scene.id}
                    aria-label={`잠긴 인연 씬 — 인연 Lv.${scene.level} 해금`}
                    className="flex aspect-[2/3] flex-col items-center justify-center rounded-lg border border-white/10 bg-abyss/60 text-center"
                  >
                    <span className="text-sm">🔒</span>
                    <span className="mt-0.5 text-[8px] text-ink-dim">Lv.{scene.level}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <BondSceneModal scene={viewingScene} onClose={() => setViewingScene(null)} />
    </div>
  );
}
