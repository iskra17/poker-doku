import { describe, expect, it } from 'vitest';
import { SKILL_TIERS } from './placement';
import { PLACEMENT_TIER_EXPLANATION, PLACEMENT_TIER_LABEL } from './placement-copy';

describe('placement copy', () => {
  it('모든 단계의 한국어 이름과 진행 차이를 설명한다', () => {
    expect(SKILL_TIERS.map(tier => PLACEMENT_TIER_LABEL[tier])).toEqual(['입문', '초급', '숙련']);
    expect(PLACEMENT_TIER_EXPLANATION.beginner).toContain('초보 안내를 켜요');
    expect(PLACEMENT_TIER_EXPLANATION.novice).toContain('초보 안내는 꺼요');
    expect(PLACEMENT_TIER_EXPLANATION.advanced).toContain('이야기와 문제·실전 대결은 그대로');
    expect(PLACEMENT_TIER_EXPLANATION.advanced).toContain('기초 레슨과 연습 테이블은 건너뛰고');
    expect(PLACEMENT_TIER_EXPLANATION.advanced).toContain('상대가 한 단계 강해져요');
  });
});
