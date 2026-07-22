import { describe, expect, it } from 'vitest';
import { BOT_CHARACTERS } from './index';
import {
  getPartnerLine,
  getPartnerTier,
  hasTieredPartnerScript,
  lobbyGreetingMoment,
  type PartnerMoment,
} from './partner-dialogue';

const MOMENTS: PartnerMoment[] = [
  'lobby-dawn', 'lobby-day', 'lobby-night', 'lobby-reunion', 'lobby-talk',
  'table-greeting', 'user-bigwin', 'user-bust', 'farewell',
];

describe('partner dialogue', () => {
  it('maps affinity level to tier at the dialogue-pack boundary (Lv5)', () => {
    expect(getPartnerTier(1)).toBe(1);
    expect(getPartnerTier(4)).toBe(1);
    expect(getPartnerTier(5)).toBe(2);
    expect(getPartnerTier(20)).toBe(2);
  });

  it('maps hours to lobby greeting moments', () => {
    expect(lobbyGreetingMoment(3)).toBe('lobby-dawn');
    expect(lobbyGreetingMoment(14)).toBe('lobby-day');
    expect(lobbyGreetingMoment(22)).toBe('lobby-night');
  });

  it('scripted characters change lines between tiers for every moment', () => {
    for (const characterId of ['sakura', 'ara', 'elena']) {
      expect(hasTieredPartnerScript(characterId)).toBe(true);
      for (const moment of MOMENTS) {
        const t1 = getPartnerLine(characterId, moment, 1, () => 0);
        const t2 = getPartnerLine(characterId, moment, 2, () => 0);
        expect(t1, `${characterId} ${moment} t1`).toBeTruthy();
        expect(t2, `${characterId} ${moment} t2`).toBeTruthy();
        expect(t2, `${characterId} ${moment} tier growth`).not.toBe(t1);
      }
    }
  });

  it('falls back to profile lines for every non-scripted roster character', () => {
    for (const character of BOT_CHARACTERS) {
      if (hasTieredPartnerScript(character.id)) continue;
      for (const moment of MOMENTS) {
        const line = getPartnerLine(character.id, moment, 2, () => 0);
        expect(line, `${character.id} ${moment}`).toBeTruthy();
      }
    }
  });

  it('returns null for unknown characters', () => {
    expect(getPartnerLine('nope', 'lobby-day', 1)).toBeNull();
  });
});
