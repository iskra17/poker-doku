/**
 * 1막 Ch1 「도장의 문」 — 미야코 + 파트너 동행.
 * 개념: 핸드 랭킹 · 네 가지 액션 · 네 개의 스트리트 · 포지션 이름 (A5-1).
 *
 * 구조(2026-10-24 파트너 중심 초반 — "미연시가 이유, 포커가 행동, 공부는 그 결과"):
 * - 사건 1: 프롤로그(파트너의 고민 — 도장 「짝 대국」에 나갈 짝이 없다) → 첫 핸드(파트너 훈수) → 소감 → 첫 핸드 복기 + 원페어 문항.
 * - 사건 2: 테이블의 언어 레슨(함께 풀기) → 드릴 2문(`rank-who-wins` · `pos-name`).
 * - 사건 3: 연습 2핸드 → 스파링 → 에필로그(파트너가 "짝, 해 줄래?" — 선택지) → 결산.
 * 필수 드릴은 4문(6 → 4). `rank-best-hand`는 필수에서 빠지고 `practicePool`로 「오늘의 수련」에만 나온다.
 *
 * 집필 규약:
 * - 전부 수기(AI 생성 금지). 미야코 호칭은 「수련생님」, 말끝에 ♪.
 * - 화자 'partner'는 런타임에 선택 파트너(히로인 6명 중 1명)로 해석된다. 기본 `text`는 파트너가 없을 때의 중립 말줄임체이고,
 *   `byPartner`가 히로인별 말투(사쿠라 말더듬 존댓말 · 아라 반말 츤데레 · 하나 '당신' 분석 존댓말 · 클로이 스트리머체 ·
 *   비비안 존댓말 「자기」 · 엘레나 「…」 짧은 반말)를 담는다 — 정본은 bond-scenes · coach-lines · drills/explain.
 * - 익명 닉을 직접 부르지 않는다(플레이스홀더 금지). 선택지는 정답이 없고 플래그만 남긴다.
 * - 에필로그 선택 `choice:act1-ch01:after`의 값(thanks/more/quiet)과 문구 일부는 Ch2 회상 씬이 인용한다 — 함께 바꿀 것.
 */
import type { Chapter, LiveTableSpec } from '../../types';
import { partnerVariants } from '../../partner-lines';
import { guidedSituation, guidedStageSituation } from '../helpers';
import { FIRST_DRILL_CLEAR_STEP_ID } from '../../story-milestones';

/** Ch1 연습 테이블 — 첫 핸드·본 연습·스파링이 같은 라인업을 쓴다 (스텝마다 새 객체) */
/**
 * Ch1 테이블. `coachOnly`(첫 핸드)는 파트너를 상대석에 앉히지 않는다 — 파트너는 훈수(PartnerCoach)로만 곁에 있다.
 * 아바타가 파트너와 같으면 파트너 좌석이 다른 히로인으로 바뀌어 "아라가 훈수를 두는데 사쿠라가 상대"가 됐다(2026-10-24 주행).
 */
function ch01Table({ coachOnly = false }: { coachOnly?: boolean } = {}): LiveTableSpec {
  return {
    blinds: { small: 10, big: 20 },
    heroSeat: 0,
    heroStackBB: 100,
    lineup: [
      coachOnly
        ? { seatIndex: 1, characterId: 'mochi', stackBB: 100, role: 'neighbor' }
        : { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
      { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
      { seatIndex: 3, characterId: 'choco', stackBB: 100, role: 'neighbor' },
    ],
    difficulty: 'easy',
    turnTimeSec: 90,
    botThinkScale: 0.6,
    // 첫 핸드는 계산 패널(필요 승률 등) 없이 파트너 훈수만 — 숫자는 Ch3에서 배운다
    hints: coachOnly ? 0 : 1,
  };
}

export const CH01: Chapter = {
  id: 'act1-ch01',
  act: 1,
  order: 1,
  title: '도장의 문',
  subtitle: '첫 핸드 · 핸드 랭킹 · 자리 이름',
  teacher: 'miyako',
  belt: 'white',
  requires: [],
  // 필수 드릴에서 뺀 내 최고 족보 반복 — 「오늘의 수련」에서만 나온다 (2026-10-24 회의 합의)
  practicePool: ['rank-best-hand'],
  estimatedMinutes: 10,
  steps: [
    // ───────────────────────────────────────────── 프롤로그 — 파트너의 사건 (6~8줄, 건너뛰기 허용)
    {
      kind: 'scene',
      id: 'act1-ch01:prologue',
      scene: {
        id: 'act1-ch01:prologue',
        lines: [
          {
            kind: 'say',
            speaker: 'miyako',
            text: '어서 오세요, 수련생님♪ 여기가 「포커 도장」이에요. 신발은 그대로 두셔도 돼요 — 대신 카드는 소중히 다뤄 주세요.',
            expression: 'happy',
            bg: 'dojo-gate',
            music: 'story-calm',
            cg: 'act1-ch01-prologue',
          },
          {
            kind: 'say',
            speaker: 'narrator',
            text: '안쪽 수련 테이블. 아무도 없는 자리에서, 누군가 혼자 카드를 섞고 있다.',
            bg: 'dojo-table',
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '…아. 미야코 씨가 말한 새 수련생.',
            expression: 'surprised',
            byPartner: partnerVariants({
              sakura: { text: '아, 앗…! 미, 미야코 씨가 말한 새 수련생분이죠…? 저, 카드 섞는 연습 중이었어요…', expression: 'surprised' },
              ara: { text: '어? 미야코 씨가 말한 신입이 너야? …흥, 셔플 연습 구경하러 왔어?', expression: 'confident' },
              hana: { text: '새 수련생이군요. 미야코 씨에게 들었어요. …셔플은 하루 이백 번, 제 루틴이에요.', expression: 'neutral' },
              chloe: { text: '오! 뉴페이스다~! 미야코 씨가 말한 신입 맞지? 하이~☆', expression: 'happy' },
              vivian: { text: '어머, 새 얼굴이네요. 미야코 씨가 말한 그 수련생이죠, 자기? 막이 오르기 전에 딱 맞춰 왔어요.', expression: 'happy' },
              elena: { text: '…미야코 씨가 말한 신입. …앉아.', expression: 'neutral' },
            }),
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '다음 달 도장 「짝 대국」 — 두 사람이 한 조로 나가는 연습 대회. …아직, 짝이 없어.',
            expression: 'sad',
            byPartner: partnerVariants({
              sakura: { text: '저, 저기… 다음 달에 도장 「짝 대국」이 있어요. 두 사람이 한 조로 나가는 연습 대회인데… 저, 아직 짝이 없어서요. 마, 말을 못 걸겠어서…', expression: 'sad' },
              ara: { text: '다음 달에 도장 「짝 대국」 있거든. 2인 1조 연습 대회. …내 짝? 아직 없어. 다들 나랑 치면 피곤하대나 뭐래나.', expression: 'sad' },
              hana: { text: '다음 달 도장 「짝 대국」은 2인 1조 연습 대회예요. 문제는 하나 — 제 짝 칸이 비어 있어요. 확률로는 안 풀리는 문제라서요.', expression: 'thinking' },
              chloe: { text: '근데 있잖아, 다음 달에 도장 「짝 대국」 한대! 2인 1조 연습 대회! 방송각 완전 좋은데… 나 아직 짝이 없어. Sad~', expression: 'sad' },
              vivian: { text: '다음 달 도장 「짝 대국」, 2인 1조 연습 대회예요. 주연은 정해졌는데… 상대역이 비어 있어요. 무대에 혼자 설 수는 없잖아요, 자기.', expression: 'thinking' },
              elena: { text: '…다음 달, 도장 「짝 대국」. 2인 1조 연습 대회야. …짝은, 아직 없어.', expression: 'neutral' },
            }),
          },
          {
            kind: 'choice',
            choice: {
              id: 'greet',
              prompt: '카드를 섞던 손이 멈췄다 —',
              options: [
                {
                  id: 'polite',
                  text: '「제가 도울 수 있는 게 있을까요?」',
                  setFlags: { 'choice:act1-ch01:greet': 'polite' },
                  reply: [{
                    kind: 'say',
                    speaker: 'partner',
                    text: '…돕는다니. 그럼 우선, 카드부터 같이.',
                    expression: 'neutral',
                    byPartner: partnerVariants({
                      sakura: { text: '도, 도와주신다고요…? 그, 그럼… 우선 같이 카드를 만져 봐 주실래요?', expression: 'surprised' },
                      ara: { text: '돕는다고? 네가? …풉. 좋아, 그 말 잊지 마.', expression: 'confident' },
                      hana: { text: '제안 고마워요. 그럼 먼저 당신 실력부터 측정해 볼게요.', expression: 'neutral' },
                      chloe: { text: '진짜?! 와, 착하다~! 그럼 일단 같이 놀자!', expression: 'happy' },
                      vivian: { text: '어머, 대사를 고를 줄 아네요. 좋아요 — 오디션부터 볼까요, 자기?', expression: 'happy' },
                      elena: { text: '…도와준다. …그 말, 기억해 둘게.', expression: 'neutral' },
                    }),
                  }],
                },
                {
                  id: 'eager',
                  text: '「짝 대국, 재밌겠는데요!」',
                  setFlags: { 'choice:act1-ch01:greet': 'eager' },
                  reply: [{
                    kind: 'say',
                    speaker: 'partner',
                    text: '재밌을 거야. …그 의욕, 마음에 들어.',
                    expression: 'happy',
                    byPartner: partnerVariants({
                      sakura: { text: '그, 그렇죠…?! 저도 사실 조금 두근거려요… 헤헤.', expression: 'happy' },
                      ara: { text: '오, 말 통하네? 재밌지, 당연히. 내가 나가는 대회인데.', expression: 'happy' },
                      hana: { text: '흥미 표현, 확인했어요. 의욕은 학습 속도를 꽤 올려 주죠.', expression: 'happy' },
                      chloe: { text: '그치그치?! 너 뭘 좀 아는구나~ 우리 잘 맞겠다☆', expression: 'happy' },
                      vivian: { text: '그 눈빛, 좋아요. 무대 체질이네요, 자기.', expression: 'confident' },
                      elena: { text: '…재밌다라. …응. 나도, 그렇게 생각해.', expression: 'happy' },
                    }),
                  }],
                },
                {
                  id: 'nervous',
                  text: '「저는 오늘 처음이라… 포커를 잘 몰라요.」',
                  setFlags: { 'choice:act1-ch01:greet': 'nervous' },
                  reply: [{
                    kind: 'say',
                    speaker: 'partner',
                    text: '처음은 다 그래. 손, 여기 놓고 천천히.',
                    expression: 'neutral',
                    byPartner: partnerVariants({
                      sakura: { text: '괘, 괜찮아요…! 저도 처음엔 칩 하나 내는 것도 떨렸어요… 처, 천천히 해요.', expression: 'happy' },
                      ara: { text: '처음이면 처음인 거지, 뭐. 대신 금방 배워. 내가 옆에 있으니까.', expression: 'neutral' },
                      hana: { text: '처음이라는 건 데이터가 깨끗하다는 뜻이에요. 나쁜 습관이 없죠.', expression: 'neutral' },
                      chloe: { text: '괜찮아괜찮아~ 나도 처음엔 폴드 버튼이 어딨는지도 몰랐어! 진짜로!', expression: 'happy' },
                      vivian: { text: '첫 무대는 누구나 떨려요, 자기. 그 떨림이 연기를 진짜로 만들어요.', expression: 'neutral' },
                      elena: { text: '…처음은 누구나 그래. …천천히 하면 돼.', expression: 'neutral' },
                    }),
                  }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '…일단 한 핸드, 같이 쳐 보는 걸로. 규칙은 치면서.',
            expression: 'confident',
            byPartner: partnerVariants({
              sakura: { text: '그, 그럼… 일단 한 핸드 같이 쳐 봐요. 규칙은 치면서 옆에서 알려 드릴게요…!', expression: 'happy' },
              ara: { text: '말보다 카드야. 일단 한 핸드 같이 쳐 보자. 규칙은 치면서 옆에서 알려 줄게.', expression: 'confident' },
              hana: { text: '이론보다 표본이 먼저예요. 일단 한 핸드 같이 쳐 봐요. 설명은 옆에서 하면서 할게요.', expression: 'confident' },
              chloe: { text: '좋아, 일단 한 핸드 같이 쳐 보자! 규칙은 치면서 내가 옆에서 알려 줄게~ Let\'s go!', expression: 'happy' },
              vivian: { text: '그럼 리허설부터예요. 일단 한 핸드 같이 쳐 봐요, 자기. 대사는 제가 옆에서 불러 줄게요.', expression: 'confident' },
              elena: { text: '…일단 한 핸드, 같이 치자. 규칙은 옆에서 알려 줄게.', expression: 'confident' },
            }),
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 첫 핸드 — 규칙보다 카드를 먼저 (2026-10-18 플레이테스트)
    // 결과가 정해진 핸드는 이 1개뿐이고, 뒤의 연습·스파링은 결과를 보장하지 않는다(사용자 결정 2026-10-19).
    // 2026-10-24: 액션은 직접 고른다 — 이 스텝에서만 파트너 실시간 훈수(`partnerCoach`)가 옆에서 거든다.
    {
      kind: 'practice-table',
      id: 'act1-ch01:first-hand',
      tag: '연습',
      partnerCoach: true,
      table: ch01Table({ coachOnly: true }),
      scripts: [
        // A♠K♠ on A♥K♦7♣2♦9♠ — 투페어(A·K). 쇼다운까지 가면 **반드시** 이기는 첫 핸드(사용자 결정 2026-10-19):
        // 상대 셋 모두 카드를 고정한다 — 비워 두면 랜덤 포켓 페어(77·99·22)가 셋을 만들어 진다.
        // 모찌 J♣T♥는 Q가 없어 스트레이트 불가, 카피 Q♥Q♦는 원페어, 초코 5♠4♣는 하이카드.
        // 보드 다이아 2장 + 상대 다이아 0장이라 플러시도 없다 (회귀: act1.test.ts 평가기 검산).
        // 수기 복기 문항 `act-ch01-first-hand-recap`이 같은 카드를 쓴다 — 함께 바꿀 것.
        { hero: 'As Ks', board: 'Ah Kd 7c 2d 9s', villains: { 1: 'Jc Th', 2: 'Qh Qd', 3: '5s 4c' } },
      ],
      perHandPrompt: '이번 핸드는 직접 골라 봐요 — 옆에서 파트너가 거들어요. 모르겠으면 파트너 말대로 눌러도 괜찮아요♪',
    },
    {
      kind: 'scene',
      id: 'act1-ch01:first-hand-after',
      // 방금 친 첫 핸드의 소감 — 빠른 진행은 첫 핸드를 건너뛰므로 이 씬도 함께 건너뛴다
      fastModeSkip: true,
      scene: {
        id: 'act1-ch01:first-hand-after',
        lines: [
          {
            kind: 'say',
            speaker: 'partner',
            text: '…첫 핸드, 끝. 카드 쥐는 손, 생각보다 침착했어.',
            expression: 'happy',
            bg: 'dojo-table',
            byPartner: partnerVariants({
              sakura: { text: '처, 첫 핸드 끝났어요…! 당신, 저보다 훨씬 침착했어요…', expression: 'happy' },
              ara: { text: '첫 핸드 치고는 나쁘지 않네. …흥, 손은 안 떨던데?', expression: 'happy' },
              hana: { text: '첫 핸드 종료. 결정까지 걸린 시간, 처음치고 안정적이었어요.', expression: 'happy' },
              chloe: { text: '첫 핸드 클리어~! 와, 너 손 하나도 안 떨던데? 대박!', expression: 'happy' },
              vivian: { text: '첫 장면, 무사히 끝났어요. 데뷔 무대치고 훌륭했어요, 자기.', expression: 'happy' },
              elena: { text: '…첫 핸드, 끝. …침착했어.', expression: 'happy' },
            }),
          },
          {
            kind: 'say',
            speaker: 'miyako',
            text: '첫 핸드 수고하셨어요, 수련생님♪ 마지막 장면을 한 번만 같이 펼쳐 볼까요? 누가 왜 이기는지 보면, 족보가 금방 눈에 들어온답니다.',
            expression: 'happy',
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 첫 드릴 2문 — 첫 핸드 복기 + 원페어 vs 하이카드 (D-RANK)
    {
      kind: 'drill-set',
      id: 'act1-ch01:drills',
      title: '첫 핸드 복기',
      teacher: 'miyako',
      drills: [
        // 첫 문항은 방금 친 첫 핸드 그대로(수기) — 낯선 생성 3파전 대신 "내가 이긴 장면"을 다시 읽는다(2026-10-24)
        { templateId: 'act-ch01-first-hand-recap', seedPolicy: 'fixed', fixedSeed: 0 },
        // 둘째는 수기 2인 문항(원페어 vs 하이카드) — "A를 들어도 짝이 없으면 진다"(2026-10-18 플레이테스트)
        { templateId: 'act-ch01-pair-beats-high', seedPolicy: 'fixed', fixedSeed: 0 },
      ],
      hintPenalty: 0.5,
    },

    // ───────────────────────────────────────────── 첫 드릴 완료 — 서버가 세트를 닫은 뒤에만 진입
    {
      kind: 'scene',
      id: FIRST_DRILL_CLEAR_STEP_ID,
      scene: {
        id: FIRST_DRILL_CLEAR_STEP_ID,
        lines: [
          {
            kind: 'say',
            speaker: 'miyako',
            text: '첫 핸드를 다시 읽고 족보 문제까지 끝까지 풀었어요♪ 이제 누가 더 높은지 읽는 감각이 생겼네요. 다음은 테이블에서 쓰는 언어예요.',
            expression: 'happy',
            bg: 'dojo-table',
            effect: 'sfx:reward',
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 테이블의 언어 — 족보 순서 + 액션 + 스트리트 + 자리, 함께 풀기
    {
      kind: 'lesson',
      id: 'act1-ch01:lesson-table-language',
      title: '테이블의 언어',
      blocks: [
        {
          kind: 'text',
          speaker: 'miyako',
          text: '전부 외우지 않아도 돼요. 족보 순서와 액션, 스트리트, 자리를 한 번에 연결만 해 볼게요♪',
        },
        {
          kind: 'concept-card',
          title: '홀카드 2장과 보드 5장 중 가장 좋은 5장',
          body: '홀카드 2장과 공용 카드인 보드 5장 중 가장 좋은 5장으로 겨뤄요. 같은 숫자 둘은 원페어, 두 쌍은 투페어, 셋은 트리플이고, 연속 다섯 장은 스트레이트, 같은 무늬 다섯 장은 플러시예요.',
          formula: '낮음 → 높음: 하이카드 → 원페어 → 투페어 → 트리플 → 스트레이트 → 플러시 → 풀하우스 → 포카드 → 스트레이트 플러시 → 로열 스트레이트 플러시',
        },
        {
          kind: 'concept-card',
          title: '네 가지 액션',
          body: '낼 칩이 없으면 체크, 상대 벳에 맞추면 콜, 더 올리면 레이즈, 포기하면 폴드예요. 홀카드 두 장을 받는 프리플랍 → 플랍(보드 세 장) → 턴 → 리버 순으로, 스트리트마다 베팅이 한 바퀴씩 돌아요.',
        },
        {
          kind: 'concept-card',
          title: '자리에는 이름이 있어요',
          body: '딜러 버튼(BTN)에서 시계 방향으로 SB · BB · UTG · HJ · CO 순이에요. 뒤에 앉을수록 남의 액션을 먼저 보고 정할 수 있어 유리하답니다.',
        },
        {
          kind: 'guided',
          teacher: 'miyako',
          intro: '그럼 보드를 함께 읽어 볼까요♪ 보드는 K♠ K♥ 7♦ 4♣ 2♠예요.',
          // 보드만 읽는 1단계는 내 카드 없이, 2단계에서 홀카드 K♦3♣ 공개 — 카드는 상황 패널이 상시 보여 준다
          situation: guidedSituation({ board: 'Ks Kh 7d 4c 2s', note: '리버까지 다 깔린 보드예요' }),
          stages: [
            {
              prompt: '보드에 K가 두 장 있죠. 이 보드에서 누군가 만들 수 있는 가장 높은 족보는 무엇일까요?',
              answer: { kind: 'multiple-choice', options: ['포카드', '스트레이트', '플러시'], correctIndex: 0 },
              onCorrect: '정답이에요♪ 보드에 페어가 있으면 포카드와 풀하우스의 문이 열린답니다.',
              onWrong: '이 보드로는 스트레이트도 플러시도 만들 수 없어요 — 숫자가 흩어져 있고 같은 무늬는 두 장뿐이니까요. 페어가 있으니 포카드까지 가능하답니다♪',
            },
            {
              prompt: '그럼 홀카드가 K♦ 3♣인 사람의 족보는 무엇일까요?',
              situation: guidedStageSituation({ hero: 'Kd 3c', note: '이 사람의 홀카드를 내 자리에 놓고 볼게요' }),
              answer: { kind: 'multiple-choice', options: ['트리플', '풀하우스', '투페어'], correctIndex: 0 },
              onCorrect: '맞아요♪ 보드의 K 두 장과 합쳐 K가 셋 — 트리플이에요.',
              onWrong: 'K는 셋이 모였지만 짝지어 줄 다른 페어가 없어요. 그래서 풀하우스가 아니라 트리플이랍니다♪',
            },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────── 테이블의 언어 드릴 2문 (D-RANK 1 · D-POS 1)
    {
      kind: 'drill-set',
      id: 'act1-ch01:drills-follow-up',
      title: '테이블의 언어 · 수련 문제',
      teacher: 'miyako',
      drills: [
        { templateId: 'rank-who-wins', seedPolicy: 'per-run' },
        { templateId: 'pos-name', seedPolicy: 'per-run' },
      ],
      hintPenalty: 0.5,
    },

    // ───────────────────────────────────────────── '연습' 프리셋 2핸드
    {
      kind: 'practice-table',
      id: 'act1-ch01:practice',
      tag: '연습',
      table: ch01Table(),
      scripts: [
        // ① J♥J♦ on J♠8♣3♦5♥K♣ — 트리플(J) 밸류. 카피의 A♥K♦는 K 원페어에 그친다(첫 핸드의 A·K와 겹치지 않게).
        { hero: 'Jh Jd', board: 'Js 8c 3d 5h Kc', villains: { 2: 'Ah Kd' } },
        // ② 7♦2♣ — 첫 폴드를 손에 익히는 핸드(보드는 랜덤).
        { hero: '7d 2c' },
      ],
      perHandPrompt: '이건 연습이에요 — 정해진 상황에서 배운 걸 써 보세요♪ 첫 핸드는 끝까지 갈 핸드, 둘째 핸드는 폴드할 핸드랍니다.',
    },

    // ───────────────────────────────────────────── 스파링 (미션형 · 최대 12핸드)
    {
      kind: 'sparring',
      id: 'act1-ch01:sparring',
      tag: '대결',
      table: ch01Table(),
      maxHands: 12,
      // 미션형: 쇼다운 1회 + 폴드 1회를 채우면 4핸드부터 끝난다 — "10핸드 채우기"는 숙제가 된다(2026-09-03 피드백 ③).
      minHands: 4,
      objectives: {
        // 통과 조건은 행동만 — 결과(칩·승패)는 bonus로만 둔다(A5-2 통과 규약).
        primary: [
          { id: 'act1-ch01:showdown', kind: 'reach-showdown', label: '쇼다운까지 가 보기', target: 1 },
          { id: 'act1-ch01:fold', kind: 'fold-hands', label: '폴드해 보기', target: 1 },
        ],
        bonus: [
          { id: 'act1-ch01:win', kind: 'win-hands', label: '팟 하나 이상 가져오기', target: 1 },
          { id: 'act1-ch01:survive', kind: 'survive', label: '파산 없이 끝내기' },
        ],
      },
      interrupts: [
        {
          id: 'act1-ch01:int-first-turn',
          trigger: { kind: 'first-my-turn' },
          scene: {
            id: 'act1-ch01:int-first-turn',
            lines: [
              {
                kind: 'say',
                speaker: 'miyako',
                text: '수련생님 차례예요♪ 아래 버튼이 지금 고를 수 있는 액션 전부랍니다 — 못 하는 선택지는 아예 보이지 않으니 마음 편히 고르세요.',
                expression: 'happy',
              },
              {
                kind: 'say',
                speaker: 'miyako',
                text: '자리 위의 D는 딜러 버튼, SB와 BB는 블라인드를 미리 낸 자리예요. 오늘은 이기고 지는 것보다 쇼다운까지 한 번 가 보고, 폴드도 한 번 해 보는 게 목표랍니다.',
                expression: 'neutral',
              },
            ],
          },
        },
        {
          id: 'act1-ch01:int-first-showdown',
          trigger: { kind: 'first-showdown' },
          scene: {
            id: 'act1-ch01:int-first-showdown',
            lines: [
              {
                kind: 'say',
                speaker: 'miyako',
                text: '쇼다운이에요♪ 마지막까지 남은 사람끼리 카드를 열고, 배운 족보 순서대로 높은 쪽이 팟을 가져간답니다.',
                expression: 'happy',
                cg: 'act1-ch01-climax',
                effect: 'flash',
              },
              {
                kind: 'say',
                speaker: 'partner',
                text: '…이 순간이 제일 좋아. 카드가 전부 뒤집히는 순간.',
                expression: 'confident',
                effect: 'sfx:flip',
                byPartner: partnerVariants({
                  sakura: { text: '이, 이 순간이 제일 두근거려요… 카드가 전부 뒤집히는 순간이요.', expression: 'happy' },
                  ara: { text: '이 순간이지! 카드 다 까는 순간. 심장 뛰지?', expression: 'confident' },
                  hana: { text: '쇼다운은 모든 추론의 답안지예요. 저는 이 순간이 제일 좋아요.', expression: 'confident' },
                  chloe: { text: '쇼다운 타임~! 카드 뒤집힐 때가 제일 짜릿하다니까!', expression: 'happy' },
                  vivian: { text: '클라이맥스예요, 자기. 모든 가면이 벗겨지는 순간이죠.', expression: 'confident' },
                  elena: { text: '…이 순간이 좋아. 카드가 전부 뒤집히는 순간.', expression: 'confident' },
                }),
              },
            ],
          },
        },
      ],
    },

    // ───────────────────────────────────────────── 에필로그 — 짝 대국의 짝 (선택지는 모두 수락, 정답 없음)
    {
      kind: 'scene',
      id: 'act1-ch01:epilogue',
      scene: {
        id: 'act1-ch01:epilogue',
        lines: [
          {
            kind: 'say',
            speaker: 'partner',
            text: '끝났네. …나쁘지 않은 첫날.',
            expression: 'happy',
            bg: 'dojo-garden-night',
            music: 'story-warm',
            // 인물 없는 정원 CG — 파트너가 6명 중 누구여도 어색하지 않다
            cg: 'act1-ch01-epilogue',
            byPartner: partnerVariants({
              sakura: { text: '끄, 끝났네요… 첫날인데, 정말 잘하셨어요.', expression: 'happy' },
              ara: { text: '끝! …뭐, 첫날치고는 봐줄 만했어.', expression: 'happy' },
              hana: { text: '첫날 종료. 오늘 데이터, 기대 이상이었어요.', expression: 'happy' },
              chloe: { text: '오늘 수련 끝~! 첫날인데 완전 잘했잖아!', expression: 'happy' },
              vivian: { text: '오늘의 막이 내렸네요. 데뷔 무대로는 훌륭했어요, 자기.', expression: 'happy' },
              elena: { text: '…끝났네. …나쁘지 않은 첫날.', expression: 'happy' },
            }),
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '처음엔 다들 족보부터 헷갈려. 그런데 아까, 보드를 한 번 더 보고 나서 버튼을 눌렀지.',
            expression: 'neutral',
            byPartner: partnerVariants({
              sakura: { text: '저, 저는 처음에 족보도 막 헷갈렸어요… 그런데 당신은 보드를 한 번 더 보고 나서 버튼을 눌렀죠. 그, 그거 봤어요.', expression: 'neutral' },
              ara: { text: '다들 처음엔 족보부터 헷갈려. 근데 너, 보드 한 번 더 보고 나서 버튼 눌렀지? …봤어.', expression: 'neutral' },
              hana: { text: '초보자의 첫 실수는 대개 족보 혼동이에요. 그런데 당신은 버튼을 누르기 전에 보드를 한 번 더 확인했어요.', expression: 'thinking' },
              chloe: { text: '나 처음엔 족보 완전 헷갈렸거든? 근데 너는 보드 한 번 더 보고 버튼 눌렀잖아. 그거 진짜 프로 무브야!', expression: 'confident' },
              vivian: { text: '처음엔 누구나 족보를 헷갈려요. 그런데 자기는 버튼을 누르기 전에 보드를 한 번 더 봤죠. 좋은 배우는 대본을 두 번 읽어요.', expression: 'confident' },
              elena: { text: '…다들 처음엔 족보를 헷갈려. 넌 버튼 누르기 전에 보드를 한 번 더 봤어. …그거면 돼.', expression: 'confident' },
            }),
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '…저기. 아까 말한 짝 대국. 짝, 해 줄래?',
            expression: 'thinking',
            byPartner: partnerVariants({
              sakura: { text: '저, 저기… 아까 말한 짝 대국 말인데요… 제, 제 짝이 되어 주실래요…?', expression: 'thinking' },
              ara: { text: '그, 그래서 말인데. 짝 대국… 내 짝 해. …싫으면 말고! 진짜로!', expression: 'confident' },
              hana: { text: '본론이에요. 짝 대국, 제 짝이 되어 주세요. 근거는… 오늘 당신을 보면서 충분히 모았어요.', expression: 'thinking' },
              chloe: { text: '있잖아, 짝 대국! 내 짝 해 줄래? 제발~ 우리 완전 좋은 팀 될 거야!', expression: 'happy' },
              vivian: { text: '자, 이제 캐스팅 시간이에요. 짝 대국 — 제 상대역, 맡아 줄래요, 자기?', expression: 'confident' },
              elena: { text: '…짝 대국. …네가 짝이면, 좋겠어.', expression: 'neutral' },
            }),
          },
          {
            kind: 'choice',
            choice: {
              id: 'after',
              prompt: '대답을 기다리는 눈빛 —',
              options: [
                {
                  id: 'thanks',
                  // Ch2 회상(recall-thanks)이 「옆에 있어 줘서 고마웠어요」를 인용한다
                  text: '「옆에 있어 줘서 고마웠어요. 짝, 할게요.」',
                  setFlags: { 'choice:act1-ch01:after': 'thanks' },
                  reply: [{
                    kind: 'say',
                    speaker: 'partner',
                    text: '…고맙다는 말, 이쪽이 할 말인데. …응. 짝, 결정.',
                    expression: 'happy',
                    byPartner: partnerVariants({
                      sakura: { text: '고, 고마운 건 저예요…! 짝… 정말요? 다, 다행이다…', expression: 'happy' },
                      ara: { text: '고맙긴 뭘. …좋아, 이제 물리기 없기다. 짝 결정!', expression: 'happy' },
                      hana: { text: '감사 인사는 제가 해야 하는데요. …짝 결정. 오늘 가장 좋은 결과예요.', expression: 'happy' },
                      chloe: { text: '꺄~ 진짜?! 짝 결정! 고마운 건 나야, 바보~♥', expression: 'happy' },
                      vivian: { text: '어머, 대사가 너무 근사해서 제가 할 말을 잃었네요. 캐스팅 확정이에요, 자기.', expression: 'happy' },
                      elena: { text: '…고맙다는 말, 내가 해야 하는데. …짝, 결정이야.', expression: 'happy' },
                    }),
                  }],
                },
                {
                  id: 'more',
                  // Ch2 회상(recall-more)이 「한 핸드 더」를 인용한다
                  text: '「좋아요! 대국 전까지 한 핸드 더 쳐요.」',
                  setFlags: { 'choice:act1-ch01:after': 'more' },
                  reply: [{
                    kind: 'say',
                    speaker: 'partner',
                    text: '욕심 많네. …그런 사람이 늘긴 해. 짝, 결정.',
                    expression: 'confident',
                    byPartner: partnerVariants({
                      sakura: { text: '하, 한 핸드 더요…? 헤헤… 네, 좋아요. 이제 짝이니까요.', expression: 'happy' },
                      ara: { text: '하, 욕심 많네? 마음에 들어. 그런 녀석이 늘거든. 짝 결정!', expression: 'confident' },
                      hana: { text: '추가 표본 요청, 승인할게요. 연습량이 많은 짝은 효율이 좋으니까요.', expression: 'confident' },
                      chloe: { text: '좋아좋아~ 연장 방송 간다! 우리 짝 결정이다~☆', expression: 'happy' },
                      vivian: { text: '앙코르를 먼저 외치다니, 좋은 관객이자 좋은 배우네요. 짝 결정이에요, 자기.', expression: 'confident' },
                      elena: { text: '…욕심 많네. …그런 사람이 늘어. 짝, 결정.', expression: 'confident' },
                    }),
                  }],
                },
                {
                  id: 'quiet',
                  // Ch2 회상(recall-quiet)이 "말없이 카드 정리하던 손"을 기억한다
                  text: '(말없이 고개를 끄덕이고, 흩어진 카드를 정리한다)',
                  setFlags: { 'choice:act1-ch01:after': 'quiet' },
                  reply: [{
                    kind: 'say',
                    speaker: 'partner',
                    text: '…정리하는 손, 조심스럽네. 그 대답, 잘 알아들었어.',
                    expression: 'neutral',
                    byPartner: partnerVariants({
                      sakura: { text: '…고, 고개 끄덕여 준 거 맞죠…? 카드 정리하는 손이 조심스러워서… 좋아요.', expression: 'happy' },
                      ara: { text: '…그냥 말로 하지. 뭐, 끄덕인 거 봤으니까 됐어. 짝 결정.', expression: 'neutral' },
                      hana: { text: '고개를 끄덕였네요. 기록했어요 — 말보다 확실한 답이에요.', expression: 'neutral' },
                      chloe: { text: '앗, 끄덕끄덕! 그거 예스 맞지? 맞지?! 짝 결정~!', expression: 'happy' },
                      vivian: { text: '말없는 대답이라니, 아주 우아한 연출이에요. 알아들었어요, 자기.', expression: 'neutral' },
                      elena: { text: '…끄덕임으로 충분해. …카드 정리하는 손, 조심스럽네.', expression: 'neutral' },
                    }),
                  }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'miyako',
            text: '수고하셨어요, 수련생님♪ 오늘부터 백띠예요 — 도장의 문을 지나오셨다는 뜻이랍니다. 짝 대국 명단은 1막 수업을 다 마치면 받아 둘게요.',
            expression: 'happy',
            effect: 'sfx:level-up',
          },
          {
            kind: 'say',
            speaker: 'miyako',
            text: '다음은 사쿠라 씨 수업을 추천해요. 「기다림」이 왜 무기가 되는지, 그분보다 잘 아는 사람은 없거든요. 물론 어느 수업부터 들어도 괜찮답니다♪',
            expression: 'neutral',
          },
        ],
      },
    },

    { kind: 'result', id: 'act1-ch01:result' },
  ],
  rewards: {
    first: {
      dojoXpMilli: 100_000,
      // 50 = 인연 Lv2 문턱(40)을 넘겨 Ch1 결산에서 첫 인연 씬이 열린다 (2026-10-19 A6)
      affinity: [{ target: 'partner', milli: 50_000 }],
      badgeId: 'story-white-belt',
    },
    replay: { dojoXpMilli: 20_000 },
    gradeBonusMilli: { A: 20_000, S: 50_000 },
  },
};
