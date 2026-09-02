import { describe, expect, it } from 'vitest';
import { getArenaSeasonRewardItems } from '@/lib/collection/catalog';
import { STORY_REWARD_CATALOG } from '@/lib/story/rewards/catalog';
import { resolveTitle, TITLE_TIER_LABEL } from './titles';

describe('resolveTitle', () => {
  it('도장 레벨 칭호 4종을 등급·문양과 함께 해석한다', () => {
    expect(resolveTitle('dojo-title-sprout-challenger')).toMatchObject({ name: '새싹 도전자', tier: 'common', glyph: 'sprout', belt: null, source: 'collection' });
    expect(resolveTitle('dojo-title-steady-trainee')).toMatchObject({ tier: 'rare', glyph: 'laurel' });
    expect(resolveTitle('dojo-title-advanced-student')).toMatchObject({ tier: 'epic', glyph: 'crest' });
    expect(resolveTitle('dojo-title-battle-tested')).toMatchObject({ name: '백전연마', tier: 'legend', glyph: 'flame' });
  });

  it('수련 스토리 칭호를 해석한다 — 좌석에서 사라지던 백띠 수련생 회귀', () => {
    expect(resolveTitle('story-title-white-belt')).toMatchObject({ name: '백띠 수련생', tier: 'common', glyph: 'belt', belt: 'white', source: 'story' });
    expect(resolveTitle('story-title-perfect')).toMatchObject({ name: '퍼펙트', tier: 'epic', glyph: 'star', belt: null });
    expect(resolveTitle('story-title-empty-note')).toMatchObject({ name: '빈 노트', tier: 'rare', glyph: 'note' });
    // 카탈로그의 모든 칭호는 해석돼야 한다(새 칭호를 추가하면 여기서 잡힌다)
    for (const item of STORY_REWARD_CATALOG.filter(entry => entry.kind === 'title')) {
      expect(resolveTitle(item.id)?.name).toBe(item.name);
    }
  });

  it('아레나 시즌 칭호는 접미로 판정한다 — 1~3위 전설 왕관, 4~10위 영웅 왕관, TOP 100 영웅 월계', () => {
    const items = getArenaSeasonRewardItems('arena-v1-1').filter(item => item.kind === 'title');
    expect(items.length).toBeGreaterThanOrEqual(11);
    const byName = new Map(items.map(item => [item.name, item.id]));
    expect(resolveTitle(byName.get('시즌 1위'))).toMatchObject({ tier: 'legend', glyph: 'crown' });
    expect(resolveTitle(byName.get('시즌 3위'))).toMatchObject({ tier: 'legend', glyph: 'crown' });
    expect(resolveTitle(byName.get('시즌 4위'))).toMatchObject({ tier: 'epic', glyph: 'crown' });
    expect(resolveTitle(byName.get('시즌 10위'))).toMatchObject({ tier: 'epic', glyph: 'crown' });
    expect(resolveTitle(byName.get('TOP 100'))).toMatchObject({ tier: 'epic', glyph: 'laurel' });
  });

  it('없는 id·칭호가 아닌 아이템·빈 값은 null', () => {
    expect(resolveTitle('nope-title')).toBeNull();
    expect(resolveTitle('dojo-frame-golden')).toBeNull();
    expect(resolveTitle('story-cardback-dojo-crest')).toBeNull();
    expect(resolveTitle(null)).toBeNull();
    expect(resolveTitle(undefined)).toBeNull();
    expect(resolveTitle('')).toBeNull();
  });

  it('등급 라벨은 4종이다', () => {
    expect(Object.keys(TITLE_TIER_LABEL)).toEqual(['common', 'rare', 'epic', 'legend']);
  });
});
