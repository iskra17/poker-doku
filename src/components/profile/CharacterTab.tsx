'use client';

import CharacterImage from '@/components/characters/CharacterImage';
import { BOT_CHARACTERS } from '@/lib/characters';
import {
  getCharacterUnlockLevel,
  isCharacterUnlocked,
} from '@/lib/characters/unlocks';
import { useProfileStore } from '@/lib/store/profile-store';
import { useProgressionStore } from '@/lib/store/progression-store';

/**
 * 좌석 아바타 선택 — 스타터 6명 + 도장 레벨 해금 캐릭터.
 * 해금 검증은 서버(/api/profile/avatar)가 최종 판정, 여기선 도장 레벨로 잠금 표시만.
 * 인연(파트너) 선택과는 별개 축 — 아바타는 테이블 좌석/로비에 보이는 내 캐릭터.
 */
export default function CharacterTab() {
  const profile = useProfileStore(state => state.profile);
  const action = useProfileStore(state => state.action);
  const error = useProfileStore(state => state.error);
  const changeAvatar = useProfileStore(state => state.changeAvatar);
  const dojoLevel = useProgressionStore(state => state.snapshot?.profile.dojoLevel ?? 1);
  if (!profile) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-dim">
        테이블 좌석에 보일 내 캐릭터예요. 🔒 캐릭터는 도장 레벨을 올리면 해금돼요.
        <span className="ml-1 font-bold text-mystic">현재 도장 Lv.{dojoLevel}</span>
      </p>
      <div className="grid grid-cols-3 gap-3">
        {BOT_CHARACTERS.map(character => {
          const unlocked = isCharacterUnlocked(character.id, dojoLevel);
          const unlockLevel = getCharacterUnlockLevel(character.id);
          const current = profile.avatarId === character.id;
          return (
            <button
              type="button"
              key={character.id}
              disabled={!unlocked || current || action !== null}
              onClick={() => void changeAvatar(character.id)}
              className={`rounded-xl border p-2 transition-colors ${
                current
                  ? 'border-blossom bg-blossom/10'
                  : unlocked
                    ? 'border-mystic/20 bg-elevated/50 hover:bg-elevated'
                    : 'cursor-not-allowed border-white/10 bg-elevated/30'
              } ${action !== null ? 'opacity-60' : ''}`}
            >
              <span className={`mx-auto block h-16 w-16 overflow-hidden rounded-full ${unlocked ? '' : 'opacity-40 grayscale'}`}>
                <CharacterImage characterId={character.id} round className="h-full w-full text-3xl" />
              </span>
              <span className={`mt-1 block text-xs ${current ? 'font-bold text-blossom' : unlocked ? 'text-ink' : 'text-ink-dim/70'}`}>
                {character.name}
              </span>
              <span className={`block text-[10px] ${current ? 'text-blossom' : unlocked ? 'text-mystic' : 'text-ink-dim/70'}`}>
                {current ? '사용 중' : unlocked ? '선택' : `🔒 도장 Lv.${unlockLevel}`}
              </span>
            </button>
          );
        })}
      </div>
      {action === 'avatar' && (
        <p role="status" className="text-center text-xs text-mystic">캐릭터를 변경하는 중…</p>
      )}
      {error && <p role="alert" className="text-center text-xs text-blossom">{error}</p>}
    </div>
  );
}
