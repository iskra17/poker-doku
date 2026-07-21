import { describe, expect, it } from 'vitest';
import { BOT_CHARACTERS } from './index';
import {
  CHARACTER_UNLOCK_DOJO_LEVELS,
  STARTER_CHARACTER_IDS,
  getCharacterUnlockLevel,
  isCharacterUnlocked,
  isSelectableCharacter,
  isStarterCharacter,
} from './unlocks';

describe('character unlocks', () => {
  it('covers the entire bot roster — every character is starter or dojo-unlockable', () => {
    for (const character of BOT_CHARACTERS) {
      expect(
        isSelectableCharacter(character.id),
        `roster character ${character.id} has no unlock rule`,
      ).toBe(true);
    }
    // 규칙이 로스터에 없는 유령 캐릭터를 가리키지 않는지 (id 개편 드리프트 가드)
    const rosterIds = new Set(BOT_CHARACTERS.map(character => character.id));
    for (const id of STARTER_CHARACTER_IDS) {
      expect(rosterIds.has(id), `starter ${id} missing from roster`).toBe(true);
    }
    for (const id of Object.keys(CHARACTER_UNLOCK_DOJO_LEVELS)) {
      expect(rosterIds.has(id), `unlockable ${id} missing from roster`).toBe(true);
    }
  });

  it('starters are always unlocked, even at level 1', () => {
    for (const id of STARTER_CHARACTER_IDS) {
      expect(isStarterCharacter(id)).toBe(true);
      expect(getCharacterUnlockLevel(id)).toBeNull();
      expect(isCharacterUnlocked(id, 1)).toBe(true);
    }
  });

  it('unlockables are locked below threshold and unlocked at threshold', () => {
    for (const [id, level] of Object.entries(CHARACTER_UNLOCK_DOJO_LEVELS)) {
      expect(isStarterCharacter(id)).toBe(false);
      expect(getCharacterUnlockLevel(id)).toBe(level);
      expect(isCharacterUnlocked(id, level - 1)).toBe(false);
      expect(isCharacterUnlocked(id, level)).toBe(true);
      expect(isCharacterUnlocked(id, 50)).toBe(true);
    }
  });

  it('rejects unknown character ids regardless of level', () => {
    expect(isSelectableCharacter('miyako')).toBe(false);
    expect(isCharacterUnlocked('miyako', 50)).toBe(false);
    expect(isCharacterUnlocked('dealer', 50)).toBe(false);
    expect(getCharacterUnlockLevel('nope')).toBeUndefined();
  });
});
