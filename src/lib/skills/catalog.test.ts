import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSkillPoseArt } from '../assets/character-art';
import { getCharacterById } from '../characters';
import { PROGRESSION_CHARACTER_IDS } from '../progression/types';
import { getSkillDef } from './catalog';
import type { SkillReason } from './skill-trigger';

const REASONS: SkillReason[] = ['steal', 'showdown-win', 'big-pot', 'river-comeback', 'all-in-win', 'monster'];

describe('skill catalog', () => {
  it('히로인 6명 모두 6기술과 3단계 외침을 가진다', () => {
    for (const id of PROGRESSION_CHARACTER_IDS) {
      const def = getSkillDef(id);
      expect(def, id).not.toBeNull();
      expect(def!.characterId).toBe(id);
      expect(getCharacterById(id), id).toBeDefined();
      for (const reason of REASONS) expect(def!.moves[reason]?.name, `${id}/${reason}`).toBeTruthy();
      expect(Object.values(def!.shouts).every(Boolean), id).toBe(true);
      expect(def!.glyphs).toHaveLength(4);
    }
  });

  it('기술명은 캐릭터 안에서 겹치지 않고, 입자 모양은 캐릭터마다 다르다', () => {
    const particles = new Set<string>();
    for (const id of PROGRESSION_CHARACTER_IDS) {
      const def = getSkillDef(id)!;
      const names = REASONS.map(reason => def.moves[reason].name);
      expect(new Set(names).size, id).toBe(names.length);
      particles.add(def.particle);
    }
    expect(particles.size).toBe(PROGRESSION_CHARACTER_IDS.length);
  });

  it('모든 기술 포즈는 배치된 일러스트가 있다 (없으면 기본 표정으로 조용히 폴백하므로 여기서 잡는다)', () => {
    for (const id of PROGRESSION_CHARACTER_IDS) {
      const def = getSkillDef(id)!;
      for (const reason of REASONS) {
        for (const pose of def.moves[reason].poses ?? []) {
          if (!pose) continue;
          const src = getSkillPoseArt(id, pose);
          expect(src, `${id}/${pose}`).not.toBeNull();
          expect(existsSync(path.join(process.cwd(), 'public', src!)), `${src} 파일`).toBe(true);
        }
      }
    }
  });

  it('정의가 없는 캐릭터는 발동하지 않는다', () => {
    expect(getSkillDef('mochi')).toBeNull();
    expect(getSkillDef(null)).toBeNull();
  });
});
