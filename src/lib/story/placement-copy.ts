import type { SkillTier } from './placement';

export const PLACEMENT_TIER_LABEL: Readonly<Record<SkillTier, string>> = {
  beginner: '입문',
  novice: '초급',
  advanced: '숙련',
};

export const PLACEMENT_TIER_EXPLANATION: Readonly<Record<SkillTier, string>> = {
  beginner: '규칙부터 차근차근 배우고, 초보 안내를 켜요.',
  novice: '기본 흐름으로 진행하고, 초보 안내는 꺼요.',
  advanced: '빠른 진행: 이야기와 문제·실전 대결은 그대로, 기초 레슨과 연습 테이블은 건너뛰고 상대가 한 단계 강해져요.',
};
