/**
 * 보너스 이벤트 CG 50장 — 순수 데이터(카탈로그 생성기 + 해금 임계표 + 한국어 제목·캡션).
 *
 * 규약(기획 `docs/superpowers/plans/2026-09-06-bonus-cg-integration-plan.md`):
 * - 캐릭터 10명 × 장면 5종(casual → sing → yoga → gym → beach). 자산은 이미 배치돼 있다:
 *   `public/assets/story/cg/bonus-<subject>-<scene>.webp` + `video/bonus-<subject>-<scene>.{mp4,webm}`.
 * - 히로인 6명은 **인연 레벨**(4/8/12/16/20), 비히로인 4명(미야코·유즈키·린·잉그리드)은 **도장 레벨**
 *   (10/20/30/40/50)로 해금한다 — 트리거는 `affinity-level` / `dojo-level`.
 * - DB `story_reward_catalog.character_id` CHECK는 히로인 6명만 허용하므로 **비히로인은 characterId를 비운다**
 *   (패리티 유지). 화면 그룹핑은 `subjectId`가 담당한다.
 * - 캡션은 캐릭터 문체 그대로(사쿠라 말더듬 · 아라 반말 츤데레 · 하나 '당신' · 클로이 스트리머체 ·
 *   비비안 「자기」 · 엘레나 「…」 · 미야코 「~답니다♪」 · 유즈키 신탁 어조 · 린 차분한 존댓말 · 잉그리드 록 반말),
 *   포커 용어는 원어 표기 규칙을 따른다.
 *
 * 이 모듈은 `catalog.ts`에서 타입만 가져온다(런타임 순환 없음) — catalog가 이 목록을 spread한다.
 */
import type { StoryHeroineId } from '../types';
import type { StoryRewardDefinition } from './catalog';

/** 보너스 라인 표식 — 기존 스토리 보상에는 `line`이 없다(= 'story') */
export const BONUS_REWARD_LINE = 'bonus';

/** 장면 순서 = 해금 순서 */
export const BONUS_CG_SCENES = ['casual', 'sing', 'yoga', 'gym', 'beach'] as const;
export type BonusCgScene = typeof BONUS_CG_SCENES[number];

export const BONUS_CG_SCENE_LABEL: Readonly<Record<BonusCgScene, string>> = Object.freeze({
  casual: '일상',
  sing: '노래',
  yoga: '요가',
  gym: '헬스장',
  beach: '여름 해변',
});

/** 히로인 — 인연 레벨 임계 (최대 20) */
export const BONUS_CG_AFFINITY_LEVEL: Readonly<Record<BonusCgScene, number>> = Object.freeze({
  casual: 4, sing: 8, yoga: 12, gym: 16, beach: 20,
});

/** 비히로인 — 도장 레벨 임계 (최대 50) */
export const BONUS_CG_DOJO_LEVEL: Readonly<Record<BonusCgScene, number>> = Object.freeze({
  casual: 10, sing: 20, yoga: 30, gym: 40, beach: 50,
});

export const BONUS_CG_HEROINES: readonly StoryHeroineId[] = Object.freeze(['sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena']);
export const BONUS_CG_DOJO_SUBJECTS = ['miyako', 'yuzuki', 'lin', 'ingrid'] as const;
export type BonusCgDojoSubjectId = typeof BONUS_CG_DOJO_SUBJECTS[number];
export type BonusCgSubjectId = StoryHeroineId | BonusCgDojoSubjectId;

export const BONUS_CG_SUBJECTS: readonly BonusCgSubjectId[] = Object.freeze([
  ...BONUS_CG_HEROINES,
  ...BONUS_CG_DOJO_SUBJECTS,
]);

export const BONUS_CG_SUBJECT_NAME: Readonly<Record<BonusCgSubjectId, string>> = Object.freeze({
  sakura: '사쿠라',
  ara: '아라',
  hana: '하나',
  chloe: '클로이',
  vivian: '비비안',
  elena: '엘레나',
  miyako: '미야코',
  yuzuki: '유즈키',
  lin: '린',
  ingrid: '잉그리드',
});

const SCENE_DESCRIPTION: Readonly<Record<BonusCgScene, string>> = Object.freeze({
  casual: '수련이 없는 날, 도장 밖에서 마주친 한 장면.',
  sing: '마이크를 잡은 밤 — 노래로 전하는 이야기.',
  yoga: '매트 위에서 호흡을 고르는 시간.',
  gym: '땀으로 채우는 오늘의 한 세트.',
  beach: '여름 바다에서 보낸 하루.',
});

interface BonusCgLine {
  /** 컷신 제목 — 캐릭터별 변주 */
  readonly title: string;
  /** 캐릭터 문체 한 줄 */
  readonly caption: string;
}

const LINES: Readonly<Record<BonusCgSubjectId, Readonly<Record<BonusCgScene, BonusCgLine>>>> = Object.freeze({
  sakura: {
    casual: { title: '벚꽃 골목의 오후', caption: '저, 저기… 오늘은 포커 얘기 말고, 그냥 같이 걸어도 될까요…?' },
    sing: { title: '떨리는 첫 소절', caption: '노, 노래는 아직 서툴러요… 그래도 당신 앞이라면 조금은 용기가 나요.' },
    yoga: { title: '숨을 고르는 시간', caption: '호흡을 세는 건… 좋은 자리를 기다리는 거랑 비슷해요. 조, 조급해지지 않으니까요.' },
    gym: { title: '작은 덤벨의 결심', caption: '무, 무겁지만… 조금씩 늘리면 언젠가 들 수 있대요. 핸드도 그렇겠죠?' },
    beach: { title: '파도에 뜬 벚꽃', caption: '바, 바다는 오랜만이에요… 저기, 물 튀기지 마세요! …그, 그래도 즐거워요.' },
  },
  ara: {
    casual: { title: '편의점 앞 벤치', caption: '…뭐야, 왜 봐. 그냥 지나가다 만난 거야. 흥, 앉든가.' },
    sing: { title: '마이크는 내가 잡아', caption: '노래방 왔으면 제대로 불러야지. …야, 딴 데 보지 마. 나만 봐.' },
    yoga: { title: '말 안 듣는 자세', caption: '이 자세 진짜 어렵거든? …웃지 마! 너도 해 보면 알 거야.' },
    gym: { title: '3세트만 더', caption: '…따라올 수 있겠어? 흥, 나 이래 봬도 체력은 자신 있어.' },
    beach: { title: '여름의 첫 파도', caption: '물 차갑다고 도망가기 없기. …흥, 나 먼저 들어간다.' },
  },
  hana: {
    casual: { title: '데이터 없는 오후', caption: '오늘은 통계를 잠깐 덮었어요. 당신과 있는 시간은 표본이 적어서 더 소중하거든요.' },
    sing: { title: '박자는 정확하게', caption: '당신 앞에서 부르는 건 처음이에요. 음정은 계산했는데… 심박수는 계산이 안 되네요.' },
    yoga: { title: '균형의 조건', caption: '균형은 힘이 아니라 정보예요. 무게가 어디 실렸는지 알면 흔들려도 무너지지 않아요.' },
    gym: { title: '기록되는 성장', caption: '오늘 기록을 남겼어요. 당신이 함께한 날은… 따로 표시해 뒀고요.' },
    beach: { title: '관측되지 않은 여름', caption: '여름 바다는 변수가 너무 많아요. 그래서 오늘은 예측을 그만두기로 했어요.' },
  },
  chloe: {
    casual: { title: '오프라인 데이', caption: '얘들아~ 오늘은 방송 껐어. 이 시간은 딱 한 사람 전용이거든?' },
    sing: { title: '여기서 하이라이트', caption: '지금 이 부분 클립 따야 되는데! …아, 카메라 없지. 그럼 네 기억에 저장해.' },
    yoga: { title: '밸런스 챌린지', caption: '구독자 요청으로 요가 도전! …어? 흔들려. 야, 웃지 말고 잡아 줘!' },
    gym: { title: '오늘의 벌크업', caption: '운동 브이로그 각인데~ 근데 오늘은 그냥 같이 땀 흘리는 걸로.' },
    beach: { title: '여름 특별 방송', caption: '비치 에피소드다! 파도 소리 들려? 이거 그냥 틀어 놔도 좋겠는데.' },
  },
  vivian: {
    casual: { title: '막이 내린 거리', caption: '자기, 무대 밖의 나는 이런 모습이야. 각본 없는 장면도… 꽤 마음에 들지 않아?' },
    sing: { title: '샹송 한 소절', caption: '이 노래는 관객이 한 명일 때만 부르는 거야. 오늘은 자기가 그 한 명이고.' },
    yoga: { title: '무대 뒤의 스트레칭', caption: '무대에 오르기 전엔 늘 이렇게 몸을 풀어. 긴장은… 우아하게 다스리는 거야, 자기.' },
    gym: { title: '배역을 위한 훈련', caption: '다음 배역은 체력이 필요하대. 자기, 내 상대역은 언제 맡아 줄 거야?' },
    beach: { title: '지중해의 오후', caption: '남프랑스의 여름은 이런 색이야. 자기한테 꼭 보여 주고 싶었어.' },
  },
  elena: {
    casual: { title: '말이 필요 없는 오후', caption: '…오늘은 아무 계획도 없어. 그냥 옆에 있어.' },
    sing: { title: '낮은 목소리로', caption: '…노래는 잘 못해. 그래도 네가 듣는다면 끝까지 부를게.' },
    yoga: { title: '고요한 균형', caption: '…호흡만 남기고 다 지워. 그게 제일 어려운 거야.' },
    gym: { title: '정확한 반복', caption: '…무게보다 자세. 매번 같은 동작이 결국 널 바꿔.' },
    beach: { title: '북쪽 사람의 여름', caption: '…이런 햇빛은 오랜만이야. 조금 더 있어도 될까.' },
  },
  miyako: {
    casual: { title: '도장 밖의 미야코', caption: '오늘은 딜러가 아니라 그냥 미야코랍니다♪ 편하게 불러 주셔도 돼요.' },
    sing: { title: '저녁 노래 한 곡', caption: '도장 문을 닫고 나면 이런 노래를 부른답니다♪ 앙코르는… 받아 드릴까요?' },
    yoga: { title: '아침의 정돈', caption: '몸을 정돈하면 마음도 정돈된답니다♪ 수련생님도 같이 해 보실래요?' },
    gym: { title: '사범의 체력 관리', caption: '테이블에 오래 서 있으려면 체력이 필요하답니다♪ 비밀로 해 주세요.' },
    beach: { title: '여름 휴가의 미야코', caption: '일 년에 한 번뿐인 휴가랍니다♪ 오늘만큼은 테이블 이야기는 없기예요.' },
  },
  yuzuki: {
    casual: { title: '신사 앞 골목', caption: '오늘의 점괘는… 좋은 만남. 보아라, 이미 맞지 않았느냐.' },
    sing: { title: '봉납의 노래', caption: '이 노래는 신께 바치는 것이다. …그대가 들어도 좋다.' },
    yoga: { title: '숨을 바로 하는 의식', caption: '숨이 흐트러지면 마음도 흐트러진다. 자, 나를 따라 하여라.' },
    gym: { title: '수행의 다른 이름', caption: '몸을 단련하는 것도 수행이다. …생각보다 힘들구나.' },
    beach: { title: '바다에 비친 신탁', caption: '파도 소리에 답이 섞여 있다. …들리느냐? 오늘은 그대에게 좋은 날이다.' },
  },
  lin: {
    casual: { title: '차 한 잔의 오후', caption: '차는 급하면 써져요. 오늘은 천천히 우려 볼게요.' },
    sing: { title: '찻집의 작은 무대', caption: '손님이 한 분뿐인 무대네요. 그래도 정성껏 부를게요.' },
    yoga: { title: '다도와 같은 호흡', caption: '호흡을 세는 건 차를 우리는 것과 닮았어요. 기다림이 맛을 정하거든요.' },
    gym: { title: '고요한 근력', caption: '천천히, 정확하게. 급하게 올린 힘은 금방 식어요.' },
    beach: { title: '여름 바다의 찻자리', caption: '바닷바람에는 우롱차가 어울려요. 한 잔 하시겠어요?' },
  },
  ingrid: {
    casual: { title: '리허설 끝난 골목', caption: '합주 끝났어. 야, 배고픈데 뭐 먹으러 갈래?' },
    sing: { title: '드러머의 보컬 데뷔', caption: '평소엔 뒤에서 치기만 하는데, 오늘은 앞에 서 볼게. 야유는 사절이야.' },
    yoga: { title: '스틱을 내려놓고', caption: '드럼만 치면 몸이 굳거든. 이런 것도 가끔 해 줘야 해.' },
    gym: { title: '네 박자 근력 운동', caption: '박자에 맞춰서 하면 덜 힘들어. 하나, 둘, 셋, 넷!' },
    beach: { title: '북유럽에 없는 햇빛', caption: '우리 동네는 여름에도 이렇게 안 뜨거워. 이거… 좀 좋은데?' },
  },
});

export function isBonusCgDojoSubject(subjectId: BonusCgSubjectId): subjectId is BonusCgDojoSubjectId {
  return (BONUS_CG_DOJO_SUBJECTS as readonly string[]).includes(subjectId);
}

export function bonusCgRewardId(subjectId: BonusCgSubjectId, scene: BonusCgScene): string {
  return `story-bonus-cg-${subjectId}-${scene}`;
}

/** CG·영상 파일 stem — 원장 export가 쓴 이름 그대로 */
export function bonusCgAssetStem(subjectId: BonusCgSubjectId, scene: BonusCgScene): string {
  return `bonus-${subjectId}-${scene}`;
}

export function bonusCgArt(subjectId: BonusCgSubjectId, scene: BonusCgScene): string {
  return `/assets/story/cg/${bonusCgAssetStem(subjectId, scene)}.webp`;
}

/** 해금 임계 레벨 — 히로인은 인연, 비히로인은 도장 */
export function bonusCgUnlockLevel(subjectId: BonusCgSubjectId, scene: BonusCgScene): number {
  return isBonusCgDojoSubject(subjectId) ? BONUS_CG_DOJO_LEVEL[scene] : BONUS_CG_AFFINITY_LEVEL[scene];
}

const NONE: readonly never[] = Object.freeze([]) as readonly never[];

function buildBonusCgRewards(): StoryRewardDefinition[] {
  const out: StoryRewardDefinition[] = [];
  for (const subjectId of BONUS_CG_SUBJECTS) {
    for (const scene of BONUS_CG_SCENES) {
      const line = LINES[subjectId][scene];
      const name = BONUS_CG_SUBJECT_NAME[subjectId];
      const dojo = isBonusCgDojoSubject(subjectId);
      out.push(Object.freeze({
        id: bonusCgRewardId(subjectId, scene),
        kind: 'cg',
        line: BONUS_REWARD_LINE,
        subjectId,
        // DB CHECK가 히로인 6명만 허용한다 — 비히로인은 비워 두고 subjectId로 그룹핑
        ...(dojo ? {} : { characterId: subjectId as StoryHeroineId }),
        equipSlot: null,
        name: `${name} · ${line.title}`,
        description: SCENE_DESCRIPTION[scene],
        art: bonusCgArt(subjectId, scene),
        trigger: dojo
          ? { kind: 'dojo-level', level: BONUS_CG_DOJO_LEVEL[scene] }
          : { kind: 'affinity-level', characterId: subjectId as StoryHeroineId, level: BONUS_CG_AFFINITY_LEVEL[scene] },
        cutscene: { kind: 'event-cg', characterId: subjectId, title: line.title, caption: line.caption },
        gameplayModifiers: NONE,
      }) as StoryRewardDefinition);
    }
  }
  return out;
}

/** 보너스 CG 50항목 — `catalog.ts`가 그대로 spread한다 */
export const BONUS_CG_REWARDS: readonly StoryRewardDefinition[] = Object.freeze(buildBonusCgRewards());

/** 영상 매니페스트 등록용 — 보상 아이템 id → 파일 stem (`story-video.ts`) */
export const BONUS_CG_VIDEO_STEMS: ReadonlyMap<string, string> = new Map(
  BONUS_CG_SUBJECTS.flatMap(subjectId =>
    BONUS_CG_SCENES.map(scene => [bonusCgRewardId(subjectId, scene), bonusCgAssetStem(subjectId, scene)] as const),
  ),
);
