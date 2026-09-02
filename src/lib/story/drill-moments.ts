/**
 * 드릴 순간 보상 — 콤보·퍼펙트·재출제 오답 순간의 표정·대사·연출 판정(순수 함수).
 * `DrillCard`가 서버 뷰(StoryDrillView + DrillResult)에서 파생해 그린다 — 이벤트 이중 구독 없음.
 * 대사는 수기·원어 규칙(폴드·핸드), 교사에 줄이 없으면 미야코로 폴백.
 */
import type { Expression } from '@/lib/assets/character-art';
import type { StoryTeacherId } from './types';

export type DrillMoment = 'drill-combo-3' | 'drill-combo-5' | 'drill-perfect' | 'drill-wrong-again' | 'belt';

export interface DrillMomentPick {
  moment: DrillMoment;
  expression: Expression;
  /** 대형 스탬프 문구 (없으면 null) */
  stamp: string | null;
  /** 파티클 버스트 */
  burst: boolean;
}

export interface DrillMomentInput {
  correct: boolean;
  /** 이번 답 뒤의 연속 정답 수 */
  streak: number;
  /** 재출제 패스인가 */
  isRetry: boolean;
  /** 첫 패스 마지막 문항이었고 세트 전체가 첫 시도 정답·힌트 0인가 */
  perfectSet: boolean;
}

/** 표정 에스컬레이션: 정답 streak<3 happy / 3~4 confident / ≥5 surprised. 오답 thinking, 재출제 오답 sad. */
export function expressionForResult(correct: boolean, streak: number, isRetry: boolean): Expression {
  if (!correct) return isRetry ? 'sad' : 'thinking';
  if (streak >= 5) return 'surprised';
  if (streak >= 3) return 'confident';
  return 'happy';
}

/** 우선순위: perfect > combo-5 > combo-3 > wrong-again. 해당 없으면 null. */
export function pickDrillMoment(input: DrillMomentInput): DrillMomentPick | null {
  const expression = expressionForResult(input.correct, input.streak, input.isRetry);
  if (input.correct && input.perfectSet) return { moment: 'drill-perfect', expression: 'surprised', stamp: '퍼펙트', burst: true };
  if (input.correct && input.streak === 5) return { moment: 'drill-combo-5', expression, stamp: '🔥5 COMBO', burst: true };
  if (input.correct && input.streak === 3) return { moment: 'drill-combo-3', expression, stamp: '🔥3 COMBO', burst: false };
  if (!input.correct && input.isRetry) return { moment: 'drill-wrong-again', expression, stamp: null, burst: false };
  return null;
}

const LINES: Readonly<Record<StoryTeacherId, Partial<Record<DrillMoment, readonly string[]>>>> = Object.freeze({
  miyako: {
    'drill-combo-3': ['세 문제 연속이에요♪ 수련생님, 리듬이 붙었답니다.', '연속 정답♪ 이 흐름 그대로 가요.'],
    'drill-combo-5': ['다섯 연속! 후후, 오늘은 제가 배워야겠는걸요♪'],
    'drill-perfect': ['전부 정답 — 퍼펙트랍니다♪ 도장 문이 활짝 열린 기분이에요.'],
    'drill-wrong-again': ['괜찮아요, 복습 노트에 적어 두었답니다. 다음에 다시 만나요♪'],
    belt: ['후후, 이제 {belt}랍니다♪ 어울리는걸요.'],
  },
  sakura: {
    'drill-combo-3': ['세, 세 문제 연속…! 당신, 대단해요…'],
    'drill-combo-5': ['다섯 문제나… 저, 저도 못 하는 건데… 당신은 정말…'],
    'drill-perfect': ['저, 전부… 맞혔어요…! 이런 거, 처음 봐요…'],
    'drill-wrong-again': ['괘, 괜찮아요… 저도 이 문제, 세 번 틀렸어요…'],
  },
  ara: {
    'drill-combo-3': ['오, 3연속? …뭐, 이 정도는 기본이지.'],
    'drill-combo-5': ['5연속이라고?! …야, 잘하잖아. 칭찬은 여기까지야.'],
    'drill-perfect': ['전부 정답… 인정. 오늘만이야, 착각하지 마.'],
    'drill-wrong-again': ['…또 틀렸네. 됐어, 노트에 적어 뒀으니까 다음에 갚아.'],
  },
  hana: {
    'drill-combo-3': ['3연속 정답. 정확도 추세가 올라가고 있어요.'],
    'drill-combo-5': ['5연속… 데이터가 예상 범위를 벗어났어요. 좋은 쪽으로요.'],
    'drill-perfect': ['오답 0. …당신, 이 유형은 이제 제 설명이 필요 없겠네요.'],
    'drill-wrong-again': ['두 번 어긋났어요. 실력이 아니라 순서 문제예요 — 노트로 보낼게요.'],
  },
  chloe: {
    'drill-combo-3': ['3콤보! 지금 채팅창 난리 났어~ 다음 문제 가자!'],
    'drill-combo-5': ['5콤보?! 클립 따야 돼, 이건!'],
    'drill-perfect': ['올 클리어! 오늘 방송 하이라이트는 너야!'],
    'drill-wrong-again': ['에이, 또 틀렸네~ 괜찮아, 편집점 잡아 둘게. 다음 문제!'],
  },
  vivian: {
    'drill-combo-3': ['세 번 연속… 관객이 숨을 죽이는 순간이군.'],
    'drill-combo-5': ['다섯 번. 이건 즉흥이 아니라 연기야 — 좋은 의미로.'],
    'drill-perfect': ['완벽한 막이었어. 커튼콜을 받을 자격이 있어.'],
    'drill-wrong-again': ['대사를 두 번 놓쳤군. …리허설로 돌리자. 무대는 도망가지 않아.'],
  },
  elena: {
    'drill-combo-3': ['…셋. 나쁘지 않아.'],
    'drill-combo-5': ['…다섯. …예상 밖이야.'],
    'drill-perfect': ['…전부. …놀라진 않았어. 조금은.'],
    'drill-wrong-again': ['…또. …괜찮아. 노트에 남겨 둬.'],
  },
});

export const DRILL_MOMENT_TEACHERS: readonly StoryTeacherId[] = Object.freeze(Object.keys(LINES) as StoryTeacherId[]);

/** 교사×moment 대사 — 여러 줄이면 seed로 결정론 선택, 교사에 없으면 미야코 폴백 */
export function drillMomentLine(teacherId: StoryTeacherId, moment: DrillMoment, seed = 0): string {
  const pool = LINES[teacherId]?.[moment] ?? LINES.miyako[moment] ?? [];
  if (pool.length === 0) return '';
  return pool[Math.abs(seed) % pool.length];
}

/** 모든 수기 대사 (원어 규칙 테스트용) */
export function allDrillMomentLines(): string[] {
  return DRILL_MOMENT_TEACHERS.flatMap(teacher => Object.values(LINES[teacher]).flatMap(lines => [...(lines ?? [])]));
}
