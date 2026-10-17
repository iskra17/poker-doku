import type { Expression } from '../assets/character-art';
import type { SkillReason, SkillTier } from './skill-trigger';

/**
 * 파트너 필살기 카탈로그 — 캐릭터별 기술(이름·연출 모티프·표정 연기)과 외침.
 * 히로인 6명(사쿠라·아라·하나·클로이·비비안·엘레나)이 각자 6기술을 가진다.
 * 정의가 없는 파트너는 발동하지 않는다 (다른 캐릭터를 대신 띄우지 않음).
 */

/**
 * 기술별 연출 모양 — 같은 단계라도 기술마다 다르게 보이게 한다. 다른 캐릭터도 재사용할 수 있는 형식이다.
 * swipe: 빠른 사선 스윕(소) · soundwave: 음파 링·음표(소) · band: 사선 띠+집중선 · wave: 물결이 뒤집히는 역전 ·
 * dive: 위에서 떨어져 착지 충격 · storm: 꽃잎 소용돌이
 */
export type SkillMotif = 'swipe' | 'soundwave' | 'band' | 'wave' | 'dive' | 'storm';

/**
 * 흩날리는 입자 모양 — 캐릭터 상징 (모티프와 별개로 모든 장면의 꽃잎 자리에 쓰인다).
 * petal 벚꽃잎 · ember 불씨 · spark 마름모 데이터 조각 · star 별 · rose 장미 꽃잎 · snow 눈 결정
 */
export type SkillParticle = 'petal' | 'ember' | 'spark' | 'star' | 'rose' | 'snow';

export interface SkillMove {
  /** 화면에 크게 찍히는 기술명 */
  name: string;
  motif: SkillMotif;
  /** 표정 연기 — 시작 표정에서 끝 표정으로 바뀐다 (예: 놀람 → 자신감). 포즈 아트가 없을 때의 폴백 */
  acting: [Expression, Expression];
  /**
   * 기술 전용 포즈 아트 id (`getSkillPoseArt`) — [시작, 끝]. null이면 그 구간은 acting 표정을 쓴다.
   * 포즈가 하나뿐인 기술은 [같은 id, 같은 id]로 처음부터 끝까지 그 포즈를 쓴다 — 기본 표정에서 전용 포즈로
   * 갈아타면 화풍·구도가 다른 두 그림이 컷으로 바뀌어 어색하다. 두 포즈가 다를 때(역전 전 눈물 → 앙코르)만 교차 페이드.
   */
  poses?: [string | null, string | null];
}

export interface SkillDef {
  characterId: string;
  moves: Record<SkillReason, SkillMove>;
  /** 단계별 짧은 외침 (캐릭터 말투 유지) */
  shouts: Record<SkillTier, string>;
  particle: SkillParticle;
  /** soundwave 미니 컷인에서 떠오르는 글자 4개 (사쿠라는 음표) */
  glyphs: readonly [string, string, string, string];
}

const SKILLS: Record<string, SkillDef> = {
  sakura: {
    characterId: 'sakura',
    particle: 'petal',
    glyphs: ['♪', '♫', '♪', '♬'],
    moves: {
      'steal': { name: '스틸 리프!', motif: 'swipe', acting: ['thinking', 'happy'], poses: ['steal', 'steal'] },
      'showdown-win': { name: '파워 코드!', motif: 'soundwave', acting: ['confident', 'happy'], poses: ['powerchord', 'powerchord'] },
      'big-pot': { name: '벚꽃 파워 코드!', motif: 'band', acting: ['surprised', 'confident'], poses: ['bigpot', 'bigpot'] },
      'river-comeback': { name: '리버 앙코르!', motif: 'wave', acting: ['surprised', 'confident'], poses: ['encore-tearful', 'encore'] },
      'all-in-win': { name: '스테이지 다이브!', motif: 'dive', acting: ['surprised', 'happy'], poses: ['dive', 'dive'] },
      'monster': { name: '벚꽃 폭풍 솔로!', motif: 'storm', acting: ['surprised', 'confident'], poses: ['storm', 'storm'] },
    },
    shouts: {
      small: '에, 엣헤헤…♪',
      medium: '느, 느낌 왔어!',
      big: '이, 이게 내 록이야——!',
    },
  },
  // 前 FPS 프로 「서울의 불꽃」 — 게임 용어와 불꽃
  ara: {
    characterId: 'ara',
    particle: 'ember',
    glyphs: ['!', '!!', '!?', '!'],
    moves: {
      'steal': { name: '헤드샷!', motif: 'swipe', acting: ['confident', 'happy'], poses: ['headshot', 'headshot'] },
      'showdown-win': { name: '클러치!', motif: 'soundwave', acting: ['confident', 'happy'], poses: ['clutch', 'clutch'] },
      'big-pot': { name: '서울의 불꽃!', motif: 'band', acting: ['surprised', 'confident'], poses: ['blaze', 'blaze'] },
      'river-comeback': { name: '역전 리스폰!', motif: 'wave', acting: ['sad', 'confident'], poses: ['respawn-tense', 'respawn'] },
      'all-in-win': { name: '풀스로틀 러시!', motif: 'dive', acting: ['surprised', 'happy'], poses: ['rush', 'rush'] },
      'monster': { name: '홍련 난무!', motif: 'storm', acting: ['surprised', 'confident'], poses: ['inferno', 'inferno'] },
    },
    shouts: {
      small: '흥, 당연하지.',
      medium: '봤지? 이게 실력이야!',
      big: '전부 불태워 주겠어——!',
    },
  },
  // 수학과 대학원생 TAG — 계산과 데이터
  hana: {
    characterId: 'hana',
    particle: 'spark',
    glyphs: ['%', '∑', 'π', '√'],
    moves: {
      'steal': { name: '폴드 에퀴티!', motif: 'swipe', acting: ['thinking', 'confident'], poses: ['equity', 'equity'] },
      'showdown-win': { name: '계산 완료.', motif: 'soundwave', acting: ['thinking', 'confident'], poses: ['calculated', 'calculated'] },
      'big-pot': { name: '기대값 최대화!', motif: 'band', acting: ['thinking', 'confident'], poses: ['ev', 'ev'] },
      'river-comeback': { name: '확률의 역습!', motif: 'wave', acting: ['thinking', 'happy'], poses: ['odds-tense', 'odds'] },
      'all-in-win': { name: '올인 EV 플러스!', motif: 'dive', acting: ['surprised', 'happy'], poses: ['allin', 'allin'] },
      'monster': { name: '솔버 각성!', motif: 'storm', acting: ['thinking', 'confident'], poses: ['solver', 'solver'] },
    },
    shouts: {
      small: '예상 범위 안이에요.',
      medium: '수치가 말해 주네요.',
      big: '이게 바로 최적해예요——!',
    },
  },
  // LA 스트리머 콜링 스테이션 — 방송 리액션과 별
  chloe: {
    characterId: 'chloe',
    particle: 'star',
    glyphs: ['★', '☆', '♥', '★'],
    moves: {
      'steal': { name: '럭키 스틸~☆', motif: 'swipe', acting: ['happy', 'happy'], poses: ['wink', 'wink'] },
      'showdown-win': { name: '히어로 콜!', motif: 'soundwave', acting: ['surprised', 'happy'], poses: ['herocall', 'herocall'] },
      'big-pot': { name: '구독 폭발!', motif: 'band', acting: ['surprised', 'happy'], poses: ['hype', 'hype'] },
      'river-comeback': { name: '리버의 기적~!', motif: 'wave', acting: ['sad', 'surprised'], poses: ['miracle-tense', 'miracle'] },
      'all-in-win': { name: '올인 하이라이트!', motif: 'dive', acting: ['surprised', 'happy'], poses: ['jump', 'jump'] },
      'monster': { name: '전설의 클립!', motif: 'storm', acting: ['surprised', 'confident'], poses: ['legend', 'legend'] },
    },
    shouts: {
      small: '헤헤~ 럭키☆',
      medium: 'OMG! 채팅창 난리 났어~!',
      big: '이건 완전 레전드 클립이야——!',
    },
  },
  // 前 연극 배우 매니악 — 무대와 가면
  vivian: {
    characterId: 'vivian',
    particle: 'rose',
    glyphs: ['♠', '♥', '♦', '♣'],
    moves: {
      'steal': { name: '가면무도회!', motif: 'swipe', acting: ['confident', 'happy'], poses: ['mask', 'mask'] },
      'showdown-win': { name: '커튼콜!', motif: 'soundwave', acting: ['confident', 'happy'], poses: ['bow', 'bow'] },
      'big-pot': { name: '제2막 개막!', motif: 'band', acting: ['surprised', 'confident'], poses: ['act2', 'act2'] },
      'river-comeback': { name: '극적인 반전!', motif: 'wave', acting: ['sad', 'confident'], poses: ['twist-tense', 'twist'] },
      'all-in-win': { name: '그랑 피날레!', motif: 'dive', acting: ['surprised', 'happy'], poses: ['finale', 'finale'] },
      'monster': { name: '브라비시모!', motif: 'storm', acting: ['surprised', 'confident'], poses: ['bravo', 'bravo'] },
    },
    shouts: {
      small: '훌륭한 연기였지?',
      medium: '자, 막이 오른다!',
      big: '이것이 나의 무대다——!',
    },
  },
  // 「설원의 여왕」 밸런스드 프로 — 침묵과 얼음
  elena: {
    characterId: 'elena',
    particle: 'snow',
    glyphs: ['✻', '·', '✼', '·'],
    moves: {
      'steal': { name: '침묵의 압박.', motif: 'swipe', acting: ['neutral', 'confident'], poses: ['silent', 'silent'] },
      'showdown-win': { name: '예상 범위.', motif: 'soundwave', acting: ['neutral', 'confident'], poses: ['chipflip', 'chipflip'] },
      'big-pot': { name: '빙결 밸류!', motif: 'band', acting: ['thinking', 'confident'], poses: ['frost', 'frost'] },
      'river-comeback': { name: '설원의 역습.', motif: 'wave', acting: ['thinking', 'happy'], poses: ['thaw-tense', 'thaw'] },
      'all-in-win': { name: '눈사태!', motif: 'dive', acting: ['surprised', 'confident'], poses: ['avalanche', 'avalanche'] },
      'monster': { name: '설원의 여왕.', motif: 'storm', acting: ['neutral', 'confident'], poses: ['queen', 'queen'] },
    },
    shouts: {
      small: '…예상대로야.',
      medium: '…이 정도는 읽었어.',
      big: '…전부, 얼어붙어——.',
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
  /** 미리볼 캐릭터 (미리보기 페이지 전용). 없으면 내 파트너 → 사쿠라 순 */
  characterId?: string;
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
