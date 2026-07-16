'use client';

import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import { getBalance, milliToUiUnits } from '@/lib/progression/balance';
import { PROGRESSION_CHARACTER_IDS } from '@/lib/progression/types';
import { useProgressionStore } from '@/lib/store/progression-store';

export default function AffinityTab() {
  const snapshot = useProgressionStore(state => state.snapshot);
  const action = useProgressionStore(state => state.action);
  const selectCharacter = useProgressionStore(state => state.selectCharacter);
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
        return (
          <button
            key={characterId}
            type="button"
            aria-pressed={selected}
            disabled={action !== null}
            onClick={() => void selectCharacter(characterId)}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${selected ? 'border-blossom bg-blossom/10' : 'border-mystic/20 bg-elevated/50'}`}
          >
            <CharacterImage characterId={characterId} round className="h-11 w-11 shrink-0 text-xl" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink">{character?.name ?? characterId} · 인연 {level}</span>
              <span className="block text-[10px] text-ink-dim">{threshold === 0 ? '최고 레벨' : `${milliToUiUnits(affinity?.xpMilli ?? 0)} / ${milliToUiUnits(threshold)} XP`}</span>
            </span>
            <span className="text-[10px] font-bold text-blossom">{selected ? '선택됨' : '선택'}</span>
          </button>
        );
      })}
    </div>
  );
}
