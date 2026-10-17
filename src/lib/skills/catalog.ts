import type { Expression } from '../assets/character-art';
import type { SkillReason, SkillTier } from './skill-trigger';

/**
 * 파트너 필살기 카탈로그 — 캐릭터별 기술(이름·연출 모티프·표정 연기)과 외침.
 * 프로토타입은 사쿠라 1명. 정의가 없는 파트너는 발동하지 않는다 (다른 캐릭터를 대신 띄우지 않음).
 */

/**
 * 기술별 연출 모양 — 같은 단계라도 기술마다 다르게 보이게 한다. 다른 캐릭터도 재사용할 수 있는 형식이다.
 * swipe: 빠른 사선 스윕(소) · soundwave: 음파 링·음표(소) · band: 사선 띠+집중선 · wave: 물결이 뒤집히는 역전 ·
 * dive: 위에서 떨어져 착지 충격 · storm: 꽃잎 소용돌이
 */
export type SkillMotif = 'swipe' | 'soundwave' | 'band' | 'wave' | 'dive' | 'storm';

export interface SkillMove {
  /** 화면에 크게 찍히는 기술명 */
  name: string;
  motif: SkillMotif;
  /** 표정 연기 — 시작 표정에서 끝 표정으로 바뀐다 (예: 놀람 → 자신감). 포즈 아트가 없을 때의 폴백 */
  acting: [Expression, Expression];
  /**
   * 기술 전용 포즈 아트 id (`getSkillPoseArt`) — [시작, 끝]. null이면 그 구간은 acting 표정을 쓴다.
   * 기술마다 표정·제스처가 달라야 같은 단계라도 다른 기술로 보인다.
   */
  poses?: [string | null, string | null];
}

export interface SkillDef {
  characterId: string;
  moves: Record<SkillReason, SkillMove>;
  /** 단계별 짧은 외침 (캐릭터 말투 유지) */
  shouts: Record<SkillTier, string>;
}

const SKILLS: Record<string, SkillDef> = {
  sakura: {
    characterId: 'sakura',
    moves: {
      'steal': { name: '스틸 리프!', motif: 'swipe', acting: ['thinking', 'happy'], poses: [null, 'steal'] },
      'showdown-win': { name: '파워 코드!', motif: 'soundwave', acting: ['confident', 'happy'], poses: [null, 'powerchord'] },
      'big-pot': { name: '벚꽃 파워 코드!', motif: 'band', acting: ['surprised', 'confident'], poses: [null, 'bigpot'] },
      'river-comeback': { name: '리버 앙코르!', motif: 'wave', acting: ['surprised', 'confident'], poses: ['encore-tearful', 'encore'] },
      'all-in-win': { name: '스테이지 다이브!', motif: 'dive', acting: ['surprised', 'happy'], poses: [null, 'dive'] },
      'monster': { name: '벚꽃 폭풍 솔로!', motif: 'storm', acting: ['surprised', 'confident'], poses: [null, 'storm'] },
    },
    shouts: {
      small: '에, 엣헤헤…♪',
      medium: '느, 느낌 왔어!',
      big: '이, 이게 내 록이야——!',
    },
  },
};

export function getSkillDef(characterId: string | null | undefined): SkillDef | null {
  return characterId ? SKILLS[characterId] ?? null : null;
}

/**
 * 미리보기 요청 — 설정 화면 버튼·연출 미리보기 페이지(/preview/skill-burst)가 보내고
 * SkillBurstLayer만 구독한다 (서버·다른 플레이어와 무관). reason/bb를 생략하면 단계별 대표값을 쓴다.
 */
export interface SkillPreviewRequest {
  tier: SkillTier;
  reason?: SkillReason;
  bb?: number;
  /** 연출 검토용 슬로 모션 배율 (미리보기 페이지 전용, 기본 1) */
  timeScale?: number;
}

type PreviewListener = (request: SkillPreviewRequest) => void;
const previewListeners = new Set<PreviewListener>();

export function onSkillPreview(listener: PreviewListener): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

export function requestSkillPreview(request: SkillTier | SkillPreviewRequest): void {
  const normalized = typeof request === 'string' ? { tier: request } : request;
  for (const listener of previewListeners) listener(normalized);
}
