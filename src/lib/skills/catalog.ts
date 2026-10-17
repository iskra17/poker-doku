import type { Expression } from '../assets/character-art';
import type { SkillReason, SkillTier } from './skill-trigger';

/**
 * 파트너 필살기 카탈로그 — 캐릭터별 기술명·외침·표정·파티클.
 * 프로토타입은 사쿠라 1명. 정의가 없는 파트너는 발동하지 않는다 (다른 캐릭터를 대신 띄우지 않음).
 */

export type SkillParticle = 'petal';

export interface SkillDef {
  characterId: string;
  /** 발동 사유별 기술명 — 화면 중앙에 크게 찍힌다 */
  names: Record<SkillReason, string>;
  /** 단계별 짧은 외침 (캐릭터 말투 유지) */
  shouts: Record<SkillTier, string>;
  expressions: Record<SkillTier, Expression>;
  particle: SkillParticle;
}

const SKILLS: Record<string, SkillDef> = {
  sakura: {
    characterId: 'sakura',
    names: {
      'steal': '스틸 리프!',
      'showdown-win': '파워 코드!',
      'big-pot': '벚꽃 파워 코드!',
      'all-in-win': '스테이지 다이브!',
      'river-comeback': '리버 앙코르!',
      'monster': '벚꽃 폭풍 솔로!',
    },
    shouts: {
      small: '에, 엣헤헤…♪',
      medium: '느, 느낌 왔어!',
      big: '이, 이게 내 록이야——!',
    },
    expressions: { small: 'happy', medium: 'confident', big: 'confident' },
    particle: 'petal',
  },
};

export function getSkillDef(characterId: string | null | undefined): SkillDef | null {
  return characterId ? SKILLS[characterId] ?? null : null;
}

/** 설정 화면의 미리보기 요청 — 게임 화면의 SkillBurstLayer만 구독한다 (서버·다른 플레이어와 무관) */
type PreviewListener = (tier: SkillTier) => void;
const previewListeners = new Set<PreviewListener>();

export function onSkillPreview(listener: PreviewListener): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

export function requestSkillPreview(tier: SkillTier): void {
  for (const listener of previewListeners) listener(tier);
}
