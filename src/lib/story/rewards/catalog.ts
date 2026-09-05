import { getSceneCg } from '@/lib/assets/story-cgs';
import type { StoryCurriculum } from '../curriculum';
/**
 * 수련 스토리 보상 카탈로그 — **단일 소스**(서버 reconcile 지급·허브 미리보기·갤러리·결산 폴백이 함께 쓴다).
 * DB `story_reward_catalog`(v32 시드 + v33 2막 INSERT)는 이 목록의 사본이며 패리티 테스트(`database.test.ts`)로 고정한다 —
 * 새 보상은 여기와 다음 마이그레이션의 INSERT에 함께 추가한다(서비스는 카탈로그 행을 만들지 않는다).
 *
 * 규약(기획 Part T · 2026-09-03 사용자 결정):
 * - 가챠·랜덤 없음. 트리거는 durable 상태(챕터 완료·최고 등급·막 완주·플래그)에서만 파생 → 재조정(reconcile) 가능.
 * - 첫 완주 = {칭호|담당 의상|카드백} + 500칩, S = {CG|의상} + 300칩, 보스 챕터 첫 완주에 보스 CG,
 *   막 완주 = 띠 색 펠트 + 1,000칩. 실력 확인 통과는 첫 완주와 같은 트리거.
 * - `gameplayModifiers`는 `never[]` — 보상은 수치에 영향이 없다(collection 카탈로그 규약 답습).
 * - 카드백·펠트는 SVG/CSS(컨벤션: 이미지 생성은 캐릭터/배경/로고만) — `art` 없음, 클라가 id로 그린다.
 */
import type { Chapter, ChapterGrade, ChapterId, StoryAct, StoryHeroineId } from '../types';
import { isActCompleted } from '../unlocks';
import { ACT_TITLE, BELT_LABEL, ACT_BELT } from '../story-hub-rules';
import type { StoryRewardCutsceneView, StoryRewardItemView, StoryRewardKind, StoryRewardPreview, StoryRewardTrigger } from '../views';

export type StoryRewardEquipSlot = 'title' | 'card-back' | 'felt' | 'outfit';

export interface StoryRewardDefinition {
  readonly id: string;
  readonly kind: StoryRewardKind;
  readonly name: string;
  readonly description: string;
  readonly trigger: StoryRewardTrigger;
  /** outfit 필수, 히로인 CG 선택 */
  readonly characterId?: StoryHeroineId;
  readonly equipSlot: StoryRewardEquipSlot | null;
  /** kind 'chips' */
  readonly chipAmount?: number;
  /** CG 원본 경로 (kind 'cg') */
  readonly art?: string;
  /** kind 'outfit' — character-art 매니페스트의 의상 id */
  readonly outfitId?: string;
  /** kind 'cg' — 결산 풀스크린 컷신 문구 */
  readonly cutscene?: Omit<StoryRewardCutsceneView, 'id' | 'art'>;
  readonly gameplayModifiers: readonly never[];
}

const NONE: readonly never[] = Object.freeze([]) as readonly never[];

function def(item: Omit<StoryRewardDefinition, 'gameplayModifiers'>): StoryRewardDefinition {
  return Object.freeze({ ...item, gameplayModifiers: NONE });
}

const first = (chapterId: ChapterId): StoryRewardTrigger => ({ kind: 'chapter-first-clear', chapterId });
const gradeS = (chapterId: ChapterId): StoryRewardTrigger => ({ kind: 'chapter-grade', chapterId, grade: 'S' });
const act = (value: StoryAct): StoryRewardTrigger => ({ kind: 'act-complete', act: value });

/** 컷신 우선순위 — 보스 > 띠 > 에필로그 (결산은 새 CG 중 하나만 풀스크린으로) */
const CUTSCENE_PRIORITY: Readonly<Record<StoryRewardCutsceneView['kind'], number>> = { 'boss-win': 0, belt: 1, 'event-cg': 2 };

export const STORY_REWARD_CATALOG: readonly StoryRewardDefinition[] = Object.freeze([
  // ── Ch1 도장의 문
  def({ id: 'story-title-white-belt', kind: 'title', equipSlot: 'title', name: '백띠 수련생', description: '도장의 문을 지나온 사람의 칭호.', trigger: first('act1-ch01') }),
  def({ id: 'story-chips-act1-ch01-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '첫 수련 축하금', description: '첫 챕터 완주 기념 연습 칩 500.', trigger: first('act1-ch01') }),
  def({
    id: 'story-cg-act1-belt-white', kind: 'cg', equipSlot: null, name: '백띠 수여', description: '미야코가 백띠를 건네는 순간.',
    trigger: first('act1-ch01'), art: '/assets/story/cg/act1-belt-white.webp',
    cutscene: { kind: 'belt', characterId: 'miyako', title: '백띠 수여', caption: '수련생님, 오늘부터 백띠예요♪ 도장의 문을 지나오신 기념이랍니다.' },
  }),
  def({ id: 'story-cardback-dojo-crest', kind: 'card-back', equipSlot: 'card-back', name: '도장 문장 카드백', description: '도장 문장이 새겨진 카드 뒷면.', trigger: gradeS('act1-ch01') }),
  def({ id: 'story-chips-act1-ch01-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '도장의 문 S등급 연습 칩 300.', trigger: gradeS('act1-ch01') }),
  // ── Ch2 기다림의 미학
  def({ id: 'story-outfit-sakura-dojo', kind: 'outfit', equipSlot: 'outfit', characterId: 'sakura', outfitId: 'dojo', name: '사쿠라 · 도복', description: '벚꽃 자수가 놓인 흰 도복. 로비·스토리 화면에서 입어요.', trigger: first('act1-ch02') }),
  def({ id: 'throwable-bouquet', kind: 'throwable', equipSlot: null, name: '꽃다발', description: '테이블 투척 아이템 — 축하할 때 던져요.', trigger: first('act1-ch02') }),
  def({ id: 'story-chips-act1-ch02-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '기다림의 보상', description: '기다림의 미학 완주 연습 칩 500.', trigger: first('act1-ch02') }),
  def({
    id: 'story-cg-act1-sakura-garden', kind: 'cg', equipSlot: null, characterId: 'sakura', name: '기다림의 뜰', description: '정원의 밤, 사쿠라가 카드 한 장을 내민다.',
    trigger: gradeS('act1-ch02'), art: '/assets/story/cg/act1-sakura-garden.webp',
    cutscene: { kind: 'event-cg', characterId: 'sakura', title: '기다림의 뜰', caption: '이, 이 카드… 오늘 당신이 폴드한 핸드들이에요. 저, 전부 세어 봤어요…' },
  }),
  def({ id: 'story-chips-act1-ch02-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '기다림의 미학 S등급 연습 칩 300.', trigger: gradeS('act1-ch02') }),
  // ── Ch3 숫자는 거짓말을 안 해요 (보스 드라코)
  def({
    id: 'story-cg-act1-draco-boss', kind: 'cg', equipSlot: null, characterId: 'hana', name: '오즈로 겜블러를 잡다', description: '칩 더미 앞에서 시무룩한 드라코, 그 뒤의 하나.',
    trigger: first('act1-ch03'), art: '/assets/story/cg/act1-draco-boss.webp',
    cutscene: { kind: 'boss-win', characterId: 'hana', title: '오즈로 겜블러를 잡다', caption: '값이 맞을 때만 콜했죠. 드라코의 오버벳은 통계에 남았고, 당신 칩은 남았어요.' },
  }),
  def({ id: 'story-cardback-yellow-belt', kind: 'card-back', equipSlot: 'card-back', name: '노란띠 카드백', description: '노란띠 무늬의 카드 뒷면.', trigger: first('act1-ch03') }),
  def({ id: 'story-chips-act1-ch03-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '보스 격파 상금', description: '드라코를 오즈로 잡은 기념 연습 칩 500.', trigger: first('act1-ch03') }),
  def({ id: 'story-outfit-hana-lab', kind: 'outfit', equipSlot: 'outfit', characterId: 'hana', outfitId: 'lab', name: '하나 · 연구실 가운', description: '머리를 묶고 가운을 걸친 연구 모드. 로비·스토리 화면에서 입어요.', trigger: gradeS('act1-ch03') }),
  def({ id: 'story-chips-act1-ch03-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '숫자는 거짓말을 안 해요 S등급 연습 칩 300.', trigger: gradeS('act1-ch03') }),
  // ── 1막 완주
  def({ id: 'story-felt-yellow-belt', kind: 'felt', equipSlot: 'felt', name: '노란띠 도장 펠트', description: '노란띠 색으로 물든 수련 테이블 펠트.', trigger: act(1) }),
  def({ id: 'story-chips-act1-complete', kind: 'chips', equipSlot: null, chipAmount: 1_000, name: '1막 수료금', description: '1막 세 수업 완주 연습 칩 1,000.', trigger: act(1) }),
  def({
    id: 'story-cg-act1-belt-yellow', kind: 'cg', equipSlot: null, name: '노란띠 승급', description: '도장 문 앞 석양, 미야코와 노란띠.',
    trigger: act(1), art: '/assets/story/cg/act1-belt-yellow.webp',
    cutscene: { kind: 'belt', characterId: 'miyako', title: '노란띠 승급', caption: '1막 세 수업을 모두 마치셨네요♪ 오늘부터 노란띠 — 숫자로 테이블을 보는 사람의 띠랍니다.' },
  }),
  // ── Ch4 먼저 치는 사람 (2막, 2026-09-03 — v33)
  def({ id: 'story-title-first-steal', kind: 'title', equipSlot: 'title', name: '첫 스틸', description: '블라인드를 처음 훔친 사람의 칭호.', trigger: first('act2-ch04') }),
  def({ id: 'story-chips-act2-ch04-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '스틸 상금', description: '먼저 치는 사람 완주 연습 칩 500.', trigger: first('act2-ch04') }),
  def({ id: 'story-outfit-ara-jersey', kind: 'outfit', equipSlot: 'outfit', characterId: 'ara', outfitId: 'jersey', name: '아라 · 게이밍 저지', description: '프로게이머 시절의 팀 저지와 헤드셋. 로비·스토리 화면에서 입어요.', trigger: gradeS('act2-ch04') }),
  def({ id: 'story-chips-act2-ch04-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '먼저 치는 사람 S등급 연습 칩 300.', trigger: gradeS('act2-ch04') }),
  // ── Ch5 받을 건 받아야죠
  def({ id: 'story-title-value-artisan', kind: 'title', equipSlot: 'title', name: '밸류 장인', description: '받을 건 받아 내는 사람의 칭호.', trigger: first('act2-ch05') }),
  def({ id: 'story-chips-act2-ch05-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '밸류 상금', description: '받을 건 받아야죠 완주 연습 칩 500.', trigger: first('act2-ch05') }),
  def({ id: 'story-outfit-chloe-stream', kind: 'outfit', equipSlot: 'outfit', characterId: 'chloe', outfitId: 'stream', name: '클로이 · 스트리머 후디', description: '고양이 귀 헤드폰과 후디 — 방송 켤 때 입는 옷. 로비·스토리 화면에서 입어요.', trigger: gradeS('act2-ch05') }),
  def({ id: 'story-chips-act2-ch05-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '받을 건 받아야죠 S등급 연습 칩 300.', trigger: gradeS('act2-ch05') }),
  // ── Ch6 3벳의 온도 (보스 팽팽)
  def({
    id: 'story-cg-act2-paeng-boss', kind: 'cg', equipSlot: null, characterId: 'ara', name: '얼음을 녹이다', description: '칩 더미 위에서 시무룩한 팽팽, 그 뒤의 아라.',
    trigger: first('act2-ch06'), art: '/assets/story/cg/act2-paeng-boss.webp',
    cutscene: { kind: 'boss-win', characterId: 'ara', title: '얼음을 녹이다', caption: '온도만 맞으면 팽팽도 별거 아니야. …봤지? 3벳은 이렇게 하는 거야.' },
  }),
  def({ id: 'story-cardback-blue-belt', kind: 'card-back', equipSlot: 'card-back', name: '파란띠 카드백', description: '파란띠 무늬의 카드 뒷면.', trigger: first('act2-ch06') }),
  def({ id: 'story-chips-act2-ch06-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '보스 격파 상금', description: '팽팽을 온도로 잡은 기념 연습 칩 500.', trigger: first('act2-ch06') }),
  def({
    id: 'story-cg-act2-ara-victory', kind: 'cg', equipSlot: null, characterId: 'ara', name: '서울의 불꽃', description: '옥상 야경 아래, 저지를 입은 아라의 승리 포즈.',
    trigger: gradeS('act2-ch06'), art: '/assets/story/cg/act2-ara-victory.webp',
    cutscene: { kind: 'event-cg', characterId: 'ara', title: '서울의 불꽃', caption: '…뭐야, 왜 봐. 흥, 오늘은 네가 잘한 거야. 다음엔 내가 이겨.' },
  }),
  def({ id: 'story-chips-act2-ch06-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '3벳의 온도 S등급 연습 칩 300.', trigger: gradeS('act2-ch06') }),
  // ── 2막 완주
  def({ id: 'story-felt-blue-belt', kind: 'felt', equipSlot: 'felt', name: '파란띠 도장 펠트', description: '파란띠 색으로 물든 수련 테이블 펠트.', trigger: act(2) }),
  def({ id: 'story-chips-act2-complete', kind: 'chips', equipSlot: null, chipAmount: 1_000, name: '2막 수료금', description: '2막 세 수업 완주 연습 칩 1,000.', trigger: act(2) }),
  def({
    id: 'story-cg-act2-belt-blue', kind: 'cg', equipSlot: null, name: '파란띠 승급', description: '저녁 도장 문 앞, 미야코와 파란띠.',
    trigger: act(2), art: '/assets/story/cg/act2-belt-blue.webp',
    cutscene: { kind: 'belt', characterId: 'miyako', title: '파란띠 승급', caption: '2막 세 수업을 모두 마치셨네요♪ 오늘부터 파란띠 — 먼저 치는 사람의 띠랍니다.' },
  }),
  // Ch7: no third-act reward until Ch8 and Ch9 are both registered and completed.
  // 3막 Ch8~9 / v36. Ch8의 S 전용 아트는 실제 공급 뒤 추가한다.
  def({ id: 'story-title-bluff-catcher', kind: 'title', equipSlot: 'title', name: '블러프 캐처', description: '호기심 대신 콜의 가격을 확인하는 수련생.', trigger: first('act3-ch08') }),
  def({ id: 'story-chips-act3-ch08-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '리딩 수료금', description: '궁금하면 콜 첫 완주 연습 칩 500.', trigger: first('act3-ch08') }),
  def({ id: 'story-chips-act3-ch08-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '궁금하면 콜 S등급 연습 칩 300.', trigger: gradeS('act3-ch08') }),
  def({ id: 'story-title-shadow-reader', kind: 'title', equipSlot: 'title', name: '그림자 읽는 사람', description: '액션의 순서와 남은 조합으로 함정을 읽는다.', trigger: first('act3-ch09') }),
  def({ id: 'story-chips-act3-ch09-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '함정 돌파 상금', description: '그림자와 함정 첫 완주 연습 칩 500.', trigger: first('act3-ch09') }),
  def({ id: 'story-cg-act3-luna-analysis', kind: 'cg', equipSlot: null, characterId: 'elena', name: '칩 앞의 침묵', description: '루나와의 결정들을 엘레나와 다시 놓아 보는 시간.', trigger: first('act3-ch09'), art: getSceneCg('act3-ch09-analysis')?.src, cutscene: { kind: 'boss-win', characterId: 'elena', title: '함정 뒤의 이유', caption: '…결과를 지우면 네 선택이 보여. 오늘은 그 이유가 들렸어.' } }),
  def({ id: 'story-cg-act3-elena-snow', kind: 'cg', equipSlot: null, characterId: 'elena', name: '창밖의 흰 여백', description: '계절이 바뀐 도장의 창가, 엘레나와 첫눈을 바라본다.', trigger: gradeS('act3-ch09'), art: getSceneCg('act3-ch09-snow-window')?.src, cutscene: { kind: 'event-cg', characterId: 'elena', title: '창밖의 흰 여백', caption: '…다음 패가 없어도 조금 더 앉아 있고 싶었어.' } }),
  def({ id: 'story-chips-act3-ch09-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '그림자와 함정 S등급 연습 칩 300.', trigger: gradeS('act3-ch09') }),
  def({ id: 'story-felt-brown-belt', kind: 'felt', equipSlot: 'felt', name: '갈색띠 도장 펠트', description: '3막 읽기 수련을 마친 갈색띠 테이블 펠트.', trigger: act(3) }),
  def({ id: 'story-chips-act3-complete', kind: 'chips', equipSlot: null, chipAmount: 1_000, name: '3막 수료금', description: '3막 세 수업 완주 연습 칩 1,000.', trigger: act(3) }),
  def({ id: 'story-title-unmasker', kind: 'title', equipSlot: 'title', name: '가면 벗기기', description: '상대의 행동을 관찰하고 가면 퀴즈를 마쳤다.', trigger: first('act3-ch07') }),
  def({ id: 'story-chips-act3-ch07-first', kind: 'chips', equipSlot: null, chipAmount: 500, name: '관찰 수료금', description: '가면무도회 첫 완주 연습 칩 500.', trigger: first('act3-ch07') }),
  def({ id: 'story-outfit-vivian-masquerade', kind: 'outfit', equipSlot: 'outfit', characterId: 'vivian', outfitId: 'masquerade', name: '비비안 · 가면무도회', description: '관찰의 밤을 기념하는 비비안의 무도회 의상.', trigger: gradeS('act3-ch07') }),
  def({ id: 'story-chips-act3-ch07-s', kind: 'chips', equipSlot: null, chipAmount: 300, name: 'S등급 보너스', description: '가면무도회 S등급 연습 칩 300.', trigger: gradeS('act3-ch07') }),
  // ── 플래그
  def({ id: 'story-title-perfect', kind: 'title', equipSlot: 'title', name: '퍼펙트', description: '드릴 세트를 첫 시도 무오답·힌트 없이 끝냈다.', trigger: { kind: 'flag', key: 'badge:perfect-set', label: '드릴 세트 퍼펙트' } }),
  def({ id: 'story-title-empty-note', kind: 'title', equipSlot: 'title', name: '빈 노트', description: '복습 노트를 졸업으로 비웠다.', trigger: { kind: 'flag', key: 'badge:empty-note', label: '복습 노트 비우기' } }),
]);

const BY_ID: ReadonlyMap<string, StoryRewardDefinition> = new Map(STORY_REWARD_CATALOG.map(item => [item.id, item]));

export function getStoryRewardDefinition(id: string): StoryRewardDefinition | undefined {
  return BY_ID.get(id);
}

/** 자격 판정 입력 — 전부 durable 상태에서 온다(런·등급 계산 결과가 아니라 저장된 것) */
export interface StoryRewardState {
  curriculum: StoryCurriculum;
  completed: ReadonlySet<ChapterId>;
  bestGrade: ReadonlyMap<ChapterId, ChapterGrade>;
  flags: Readonly<Record<string, string>>;
  chapters: readonly Chapter[];
}

export function isStoryRewardEntitled(item: StoryRewardDefinition, state: StoryRewardState): boolean {
  const trigger = item.trigger;
  switch (trigger.kind) {
    case 'chapter-first-clear':
      return state.completed.has(trigger.chapterId);
    case 'chapter-grade':
      return state.bestGrade.get(trigger.chapterId) === trigger.grade;
    case 'act-complete':
      return isActCompleted(state.chapters, trigger.act, state.completed, state.curriculum);
    case 'flag':
      return state.flags[trigger.key] === '1';
  }
}

/** 조건 문구 — 허브 칩·갤러리 잠금 힌트·결산 「다음 보상」 */
export function storyRewardRequirement(item: StoryRewardDefinition, chapters: readonly Chapter[]): string {
  const trigger = item.trigger;
  const titleOf = (chapterId: ChapterId): string => chapters.find(chapter => chapter.id === chapterId)?.title ?? chapterId;
  switch (trigger.kind) {
    case 'chapter-first-clear':
      return `${titleOf(trigger.chapterId)} 첫 완주`;
    case 'chapter-grade':
      return `${titleOf(trigger.chapterId)} ${trigger.grade}등급`;
    case 'act-complete':
      return `${ACT_TITLE[trigger.act]} 완주 (${BELT_LABEL[ACT_BELT[trigger.act]]})`;
    case 'flag':
      return trigger.label;
  }
}

export function toStoryRewardItemView(item: StoryRewardDefinition): StoryRewardItemView {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    description: item.description,
    ...(item.characterId ? { characterId: item.characterId } : {}),
    ...(item.art ? { art: item.art } : {}),
    ...(item.outfitId ? { outfitId: item.outfitId } : {}),
    ...(item.chipAmount !== undefined ? { chipAmount: item.chipAmount } : {}),
  };
}

export function toStoryRewardCutscene(item: StoryRewardDefinition): StoryRewardCutsceneView | null {
  if (item.kind !== 'cg' || !item.cutscene || !item.art) return null;
  return { id: item.id, art: item.art, ...item.cutscene };
}

/** 새로 지급된 CG 중 결산 컷신으로 띄울 하나 (보스 > 띠 > 에필로그, 그 안에서는 카탈로그 순) */
export function pickStoryCutscene(items: readonly StoryRewardItemView[]): StoryRewardCutsceneView | null {
  const candidates = items
    .map(item => getStoryRewardDefinition(item.id))
    .filter((item): item is StoryRewardDefinition => !!item && item.kind === 'cg' && !!item.cutscene)
    .sort((a, b) => CUTSCENE_PRIORITY[a.cutscene!.kind] - CUTSCENE_PRIORITY[b.cutscene!.kind]);
  return candidates.length > 0 ? toStoryRewardCutscene(candidates[0]) : null;
}

/** 카탈로그 전체 미리보기 — 획득 여부는 `granted`(영수증 집합)가 소스, 자격은 표시용 힌트에만 쓴다 */
export function listStoryRewardPreview(
  chapters: readonly Chapter[],
  granted: ReadonlySet<string>,
): StoryRewardPreview[] {
  return STORY_REWARD_CATALOG.map(item => ({
    ...toStoryRewardItemView(item),
    trigger: item.trigger,
    requirement: storyRewardRequirement(item, chapters),
    granted: granted.has(item.id),
  }));
}

/** 결산 「다음 보상」 — 이 챕터의 미획득 보상 + 이 챕터 막의 막 완주 보상 (칩 제외, 최대 3) */
export function nextStoryRewards(
  chapters: readonly Chapter[],
  granted: ReadonlySet<string>,
  chapterId: ChapterId,
  limit = 3,
): StoryRewardPreview[] {
  const chapter = chapters.find(candidate => candidate.id === chapterId);
  const relevant = STORY_REWARD_CATALOG.filter(item => {
    if (item.kind === 'chips' || granted.has(item.id)) return false;
    const trigger = item.trigger;
    if (trigger.kind === 'chapter-first-clear' || trigger.kind === 'chapter-grade') return trigger.chapterId === chapterId;
    if (trigger.kind === 'act-complete') return chapter?.act === trigger.act;
    return false;
  });
  return relevant.slice(0, limit).map(item => ({
    ...toStoryRewardItemView(item),
    trigger: item.trigger,
    requirement: storyRewardRequirement(item, chapters),
    granted: false,
  }));
}

/** 자격은 있는데 아직 지급되지 않은 보상 — 서버 reconcile의 입력 */
export function listStoryRewardsDue(state: StoryRewardState, granted: ReadonlySet<string>): StoryRewardDefinition[] {
  return STORY_REWARD_CATALOG.filter(item => !granted.has(item.id) && isStoryRewardEntitled(item, state));
}
