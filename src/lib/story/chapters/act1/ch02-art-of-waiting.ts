/**
 * 1막 Ch2 「기다림의 미학」 — 사쿠라.
 * 개념: 4구간 레인지 · 포지션별 임계 · 림프 대신 레이즈/폴드 (A5-1).
 *
 * 집필 규약:
 * - 전부 수기(AI 생성 금지). 사쿠라 = 소심 · 말더듬 · 존댓말, 호칭은 「당신」.
 * - 성장축(A8): 통과 후 에필로그에서 말더듬이 눈에 띄게 줄어든다. 되돌리지 말 것.
 * - 임계 수치(UTG 15 · HJ 18 · CO 25 · BTN 35)는 A7 ③ 결정 리뷰 표와 같은 값이다 —
 *   바꾸려면 리뷰·드릴 해설과 함께 옮길 것.
 * - 백분위는 `hand-rankings.ts`의 `handPercentile` 실측값(A♠A♥ 0.23% / A♦J♦ 2.56% / J♣7♦ 69.68%).
 */
import type { Chapter, Scene, SceneSayLine, Step } from '../../types';
import { partnerVariants } from '../../partner-lines';
import { guidedSituation } from '../helpers';

/**
 * Ch1 에필로그 선택(`choice:act1-ch01:after`)을 파트너가 기억하는 회상 씬 (2026-10-19 A2).
 * 값마다 씬 1개 — 서버 `sceneMatches`가 맞지 않는 씬을 건너뛰므로 Ch1을 안 했으면 셋 다 건너뛴다(1막 비선형 유지).
 * 화자 'partner'의 기본 `text`는 중립 말줄임체, `byPartner`가 히로인별 말투다(2026-10-24).
 * 파트너가 이 챕터의 교사 사쿠라 본인일 수 있으므로 사쿠라 변주는 "오늘은 제가 가르치는 날"로 쓴다.
 */
const CH01_AFTER_FLAG = 'choice:act1-ch01:after';

function recallStep(value: 'thanks' | 'more' | 'quiet', lines: Array<Pick<SceneSayLine, 'text' | 'expression' | 'byPartner'>>): Step {
  const id = `act1-ch02:recall-${value}`;
  const scene: Scene = {
    id,
    requiresFlags: { [CH01_AFTER_FLAG]: value },
    lines: lines.map((line, index) => ({
      kind: 'say',
      speaker: 'partner',
      ...line,
      ...(index === 0 ? { bg: 'dojo-table' } : {}),
    })),
  };
  return { kind: 'scene', id, scene };
}

export const CH02: Chapter = {
  id: 'act1-ch02',
  act: 1,
  order: 2,
  title: '기다림의 미학',
  subtitle: '레인지 · 포지션별 임계 · 폴드하는 용기',
  teacher: 'sakura',
  belt: 'white',
  // 1막은 비선형 — 어느 수업부터 들어도 된다(2026-09-03 피드백 ②). 선수 과목은 허브 추천으로만 안내한다.
  requires: [],
  estimatedMinutes: 15,
  steps: [
    // ───────────────────────────────────────────── Ch1 마지막 한마디 회상 (플래그가 맞는 1개만 재생)
    recallStep('thanks', [
      {
        text: '…지난번 그 말, 아직 기억하고 있어. 「옆에 있어 줘서 고마웠어요」.',
        expression: 'happy',
        byPartner: partnerVariants({
          sakura: '지, 지난번 그 말… 아직 기억해요. 「옆에 있어 줘서 고마웠어요」.',
          ara: '야, 지난번 그 말. 「옆에 있어 줘서 고마웠어요」? …아직 기억하고 있거든.',
          hana: '지난번 당신이 한 말, 기록해 뒀어요. 「옆에 있어 줘서 고마웠어요」.',
          chloe: '지난번에 네가 한 말 있지? 「옆에 있어 줘서 고마웠어요」! 나 그거 클립으로 저장할 뻔했어~',
          vivian: '지난번 그 대사, 아직 귓가에 남아 있어요. 「옆에 있어 줘서 고마웠어요」.',
          elena: '…지난번 그 말. 「옆에 있어 줘서 고마웠어요」. …기억하고 있어.',
        }),
      },
      {
        text: '그런 말 들으면… 오늘도 옆자리는 비워 둘 수밖에.',
        expression: 'happy',
        byPartner: partnerVariants({
          sakura: '그, 그래서… 오늘은 제가 가르치는 날인데도, 옆자리는 당신 자리로 비워 뒀어요.',
          ara: '그러니까 오늘도 옆자리 비워 뒀어. …딴 데 앉기만 해 봐.',
          hana: '그래서 오늘도 옆자리는 당신 몫으로 비워 뒀어요. 합리적인 배정이죠.',
          chloe: '그래서 오늘도 옆자리 찜! 우리 짝이잖아~',
          vivian: '그래서 오늘도 제 옆자리는 자기 거예요. 짝이니까요.',
          elena: '…그래서 오늘도, 옆자리는 비워 뒀어.',
        }),
      },
    ]),
    recallStep('more', [
      {
        text: '「한 핸드 더」라고 했던 거, 기억나. 그래서 오늘도 왔지.',
        expression: 'confident',
        byPartner: partnerVariants({
          sakura: '「한 핸드 더」라고 하셨던 거… 기억나요. 그, 그래서 오늘 기다리고 있었어요.',
          ara: '「한 핸드 더」라던 거, 기억나? 그래서 오늘 또 왔잖아. 약속 지키는 건 좋네.',
          hana: '「한 핸드 더」 — 지난번 당신 요청이었죠. 그래서 오늘 표본을 더 준비했어요.',
          chloe: '「한 핸드 더」라고 했던 거 기억나지? 그래서 오늘은 연장 방송이야~!',
          vivian: '「한 핸드 더」 — 지난번 자기의 앙코르, 잊지 않았어요. 그래서 오늘 막을 다시 올렸죠.',
          elena: '…「한 핸드 더」라고 했지. …그래서 왔어.',
        }),
      },
      {
        text: '좋아. 오늘은 그 한 핸드를 언제 치고 언제 넘기는지부터.',
        expression: 'neutral',
        byPartner: partnerVariants({
          sakura: '오, 오늘은 그 한 핸드를 언제 치고 언제 넘기는지… 제, 제가 알려 드릴게요.',
          ara: '좋아. 오늘은 그 한 핸드를 언제 치고 언제 넘기는지부터야.',
          hana: '오늘의 주제는 그 한 핸드를 언제 치고 언제 넘길지예요. 기준이 있어요.',
          chloe: '근데 오늘은 그 한 핸드를 언제 치고 언제 넘기는지 배운대! 꿀팁 각이야~',
          vivian: '오늘은 그 한 핸드를 언제 연기하고 언제 쉬는지 배우는 날이에요.',
          elena: '…오늘은 그 한 핸드를 언제 치고, 언제 넘기는지부터.',
        }),
      },
    ]),
    recallStep('quiet', [
      {
        text: '지난번, 말없이 카드 정리하던 손… 아직 눈에 남아 있어.',
        expression: 'neutral',
        byPartner: partnerVariants({
          sakura: '지, 지난번 말없이 카드 정리하던 손… 아직 눈에 선해요.',
          ara: '지난번에 말없이 카드 정리하던 거… 뭐, 아직 기억은 나.',
          hana: '지난번 말없이 카드를 정리하던 손, 기억해요. 순서가 정확했어요.',
          chloe: '지난번에 말없이 카드 정리하던 손! 완전 조심조심~ 그거 아직 기억나.',
          vivian: '지난번 말없이 카드를 정리하던 손… 대사 없는 연기가 제일 어렵거든요. 기억해요.',
          elena: '…지난번, 말없이 카드 정리하던 손. …아직 눈에 남아 있어.',
        }),
      },
      {
        text: '오늘 수업은 그런 손에 잘 맞을 거야. 기다리는 법이니까.',
        expression: 'happy',
        byPartner: partnerVariants({
          sakura: '오, 오늘은 제가 가르치는 날인데… 그런 손이라면 잘 맞을 거예요. 기다리는 법이니까요.',
          ara: '오늘 수업, 너한테 딱일걸. 기다리는 법이거든.',
          hana: '오늘 수업은 그런 성향에 잘 맞아요. 기다리는 법이니까요.',
          chloe: '오늘 수업 너한테 찰떡일걸? 기다리는 법이래!',
          vivian: '오늘 수업은 그런 손에 어울려요. 기다리는 법이거든요, 자기.',
          elena: '…오늘 수업은 그런 손에 맞아. 기다리는 법이니까.',
        }),
      },
    ]),

    // ───────────────────────────────────────────── 프롤로그
    {
      kind: 'scene',
      id: 'act1-ch02:prologue',
      scene: {
        id: 'act1-ch02:prologue',
        lines: [
          {
            kind: 'say',
            speaker: 'miyako',
            text: '사쿠라 씨, 오늘 수련생님을 부탁해요♪ 이 도장에서 「기다리는 법」은 이분이 제일 잘 가르치거든요.',
            expression: 'happy',
            bg: 'dojo-table',
            music: 'story-calm',
            cg: 'act1-ch02-prologue',
          },
          {
            kind: 'say',
            speaker: 'sakura',
            text: '아… 네, 네. 저, 저는 사쿠라예요. 오, 오늘 수업을 제가… 마, 맡게 됐어요.',
            expression: 'surprised',
            effect: 'shake',
            // 파트너가 사쿠라 본인이면 자기소개 대신 "짝에게 가르치는" 긴장으로
            byPartner: { sakura: { text: '아… 네, 네. 오, 오늘은 제가 선생님이에요. 짜, 짝인 당신한테 가르치려니… 더 떨려요.', expression: 'surprised' } },
          },
          {
            kind: 'say',
            speaker: 'sakura',
            // 에필로그의 "지금은 안 떨리네요"가 회수하는 고민 — 프롤로그에서 먼저 꺼낸다(2026-10-24)
            text: '사, 사실… 누군가를 가르치는 건 처음이에요. 「가르칠 수 있을까」… 아침부터 계속 떨렸어요.',
            expression: 'sad',
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '(작게) …첫 수업이래. 끝까지 잘 들어 주면 돼.',
            expression: 'neutral',
            byPartner: partnerVariants({
              // 파트너 = 사쿠라 본인: 자신을 제3자처럼 말하지 않고 짝에게 직접 건네는 한마디
              sakura: { text: '그, 그래도… 당신이 제 짝이라서 다행이에요. 아는 얼굴이 앞에 있으면… 조금 덜 떨리니까요.', expression: 'happy' },
              ara: { text: '(속닥) 사쿠라 씨 첫 수업이래. …제대로 들어 줘. 떨어도 실력은 진짜거든.', expression: 'neutral' },
              hana: { text: '(작게) 사쿠라 씨의 첫 수업이에요. 긴장도는 높지만 내용은 정확할 거예요. 제가 보장해요.', expression: 'neutral' },
              chloe: { text: '(속닥속닥) 사쿠라 씨 첫 수업이래! 우리 리액션 크게 해 주자~ 응원 모드 ON!', expression: 'happy' },
              vivian: { text: '(작게) 첫 무대의 떨림이에요, 자기. 우리가 좋은 관객이 되어 주면 돼요.', expression: 'neutral' },
              elena: { text: '(작게) …첫 수업이래. …끝까지 들어 줘.', expression: 'neutral' },
            }),
          },
          {
            kind: 'say',
            speaker: 'sakura',
            text: '저는… 세지 않아요. 빠르지도 않고요. 대신 기다릴 수 있어요 — 몇 시간이든요.',
            expression: 'neutral',
          },
          {
            kind: 'say',
            speaker: 'sakura',
            text: '포커에서 제일 많이 하는 일은 사실 「폴드」예요. 당신이 오늘 배울 건, 어떤 핸드를 폴드하고 어떤 핸드로 오픈 레이즈하는지… 그 선을 긋는 법이에요.',
            expression: 'confident',
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 개념 카드 + 함께 풀기
    {
      kind: 'lesson',
      id: 'act1-ch02:lesson',
      title: '어디까지 들어갈까요',
      blocks: [
        {
          kind: 'text',
          speaker: 'sakura',
          text: '카, 카드가 좋아서 이기는 게 아니에요… 나쁜 카드를 안 잡아서 이기는 거예요.',
        },
        {
          kind: 'concept-card',
          title: '상위 %로 보는 핸드',
          body: '169가지 스타팅 핸드를 강한 순서로 줄 세우면, 내 핸드가 상위 몇 %인지가 나와요. A♠A♥는 1%도 안 되는 맨 앞, J♣7♦는 70% 근처랍니다.',
        },
        {
          title: '자리마다 다른 임계',
          kind: 'concept-card',
          body: '앞자리일수록 뒤에 남은 사람이 많아서 오픈 레이즈 레인지를 더 좁게 잡아야 해요. 기준은 UTG 15% · HJ 18% · CO 25% · BTN 35%예요.',
        },
        {
          kind: 'concept-card',
          title: '림프는 하지 않아요',
          body: '그냥 콜로 들어가면 팟도 못 키우고 주도권도 못 가져요. 열 거면 레이즈, 아니면 폴드예요.',
        },
        {
          kind: 'concept-card',
          title: '폴드하는 용기',
          body: '폴드는 지는 게 아니라, 다음 좋은 자리를 위해 칩을 남기는 일이에요. 한 바퀴에 한두 번만 들어가도 충분해요.',
        },
        {
          kind: 'guided',
          teacher: 'sakura',
          intro: '머, 먼저 당신 핸드가 어느 정도인지부터 볼게요. J♣7♦, 자리는 UTG예요.',
          situation: guidedSituation({ hero: 'Jc 7d', heroPosition: 'UTG', potChips: 30, toCallChips: 20, note: '프리플랍, 뒤에 다섯 명이 남아 있어요' }),
          stages: [
            {
              prompt: '이 핸드는 상위 몇 % 근처일까요? 어림으로 골라 보세요.',
              // 숫자 키패드 대신 보기 선택(2026-10-24 — 숫자 입력이 시험지처럼 느껴졌다)
              answer: { kind: 'multiple-choice', options: ['상위 10% 근처', '상위 40% 근처', '상위 70% 근처'], correctIndex: 2 },
              onCorrect: '마, 맞아요… 70% 근처예요. 강한 쪽 절반에도 못 드는 핸드예요.',
              onWrong: '아… J랑 7은 사이가 너무 멀어서요. 이 핸드는 상위 70% 근처, 한참 뒤쪽 핸드예요.',
            },
            {
              prompt: 'UTG의 임계는 15%였죠. 그럼 여기서는 어떻게 할까요?',
              answer: { kind: 'multiple-choice', options: ['2.5BB로 오픈', '그냥 콜(림프)', '폴드'], correctIndex: 2 },
              onCorrect: '네… 폴드예요. 70%는 15%보다 한참 뒤에 있으니까요.',
              onWrong: '아, 아니에요… 70%는 15%를 한참 넘어요. 뒤에 다섯 명이나 남아 있어서… 조, 조금만 더 기다리는 게 좋아요.',
            },
          ],
        },
        {
          kind: 'guided',
          teacher: 'sakura',
          intro: '이번엔 반대예요. A♦J♦, 자리는 BTN이에요.',
          situation: guidedSituation({ hero: 'Ad Jd', heroPosition: 'BTN', potChips: 30, toCallChips: 20, note: '프리플랍, 앞사람들은 모두 폴드했어요' }),
          stages: [
            {
              prompt: 'A♦J♦는 상위 3% 근처예요. BTN 임계 35%와 비교하면 어느 쪽일까요?',
              answer: { kind: 'multiple-choice', options: ['임계 안 — 참여', '임계 밖 — 폴드'], correctIndex: 0 },
              onCorrect: '마, 맞아요! 3%는 35% 안쪽이니까… 이건 오픈 레이즈하는 핸드예요.',
              onWrong: '3%는 35%보다 훨씬 앞이에요… 이건 폴드하면 아까운 핸드예요.',
            },
            {
              prompt: '그럼 어떻게 열까요?',
              answer: { kind: 'multiple-choice', options: ['그냥 콜(림프)', '2~3BB 레이즈', '올인'], correctIndex: 1 },
              onCorrect: '네, 2~3BB요. 리, 림프는 주도권을 버리는 거라서요.',
              onWrong: '어… 림프는 주도권을 버리는 거고, 올인은 너무 커요. 2~3BB가 알맞아요.',
            },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────── 드릴 4문 (D-RANGE 2 · D-POS 1 · D-ACT 1)
    // 2026-10-24: 7 → 4. 숫자 입력 `range-percentile`과 Ch1에서 다룬 `pos-name`은 복습 노트·오늘의 수련에서만 나온다.
    {
      kind: 'drill-set',
      id: 'act1-ch02:drills',
      title: '기다림의 수련 문제',
      teacher: 'sakura',
      drills: [
        { templateId: 'range-open-decision', seedPolicy: 'per-run' },
        { templateId: 'pos-first-to-act', seedPolicy: 'per-run' },
        { templateId: 'range-open-decision', seedPolicy: 'per-run' },
        // 수기 문항은 시드 고정 — 상황이 매번 같아야 해설이 성립한다.
        // 짝 문항 'act-ch02-open-btn'은 복습 노트·오늘의 수련 출제용으로 남겨 둔다.
        { templateId: 'act-ch02-fold-utg', seedPolicy: 'fixed', fixedSeed: 0 },
      ],
      hintPenalty: 0.5,
    },

    // ───────────────────────────────────────────── '연습' 프리셋 2핸드
    {
      kind: 'practice-table',
      id: 'act1-ch02:practice',
      tag: '연습',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'chloe', stackBB: 100, role: 'neighbor' },
          { seatIndex: 2, characterId: 'mochi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 3, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 4, characterId: 'partner', stackBB: 100, role: 'partner' },
        ],
        difficulty: 'easy',
        turnTimeSec: 90,
        botThinkScale: 0.6,
        hints: 1,
      },
      scripts: [
        // ① J♣7♦(상위 69.7%) — 6-max 어느 자리에서도 임계(최대 BTN 35%) 밖이라 버튼 위치와 무관하게 오픈 레이즈하지 않는 핸드.
        { hero: 'Jc 7d' },
        // ② A♦J♦(상위 2.6%) — 반대로 어느 자리에서도 임계 안이라 오픈 레이즈하는 핸드.
        { hero: 'Ad Jd' },
      ],
      perHandPrompt: '이건 연습이에요… 핸드는 정해져 있어요. 첫 핸드는 J♣7♦, 둘째 핸드는 A♦J♦. 당신 포지션 이름을 먼저 확인하고, 임계와 비교해 보세요.',
    },

    // ───────────────────────────────────────────── 스파링 (미션형 · 최대 15핸드)
    {
      kind: 'sparring',
      id: 'act1-ch02:sparring',
      tag: '대결',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'chloe', stackBB: 100, role: 'neighbor' },
          { seatIndex: 2, characterId: 'mochi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 3, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 4, characterId: 'partner', stackBB: 100, role: 'partner' },
        ],
        difficulty: 'easy',
        turnTimeSec: 90,
        botThinkScale: 0.6,
        hints: 1,
      },
      maxHands: 15,
      // 미션형: 약한 핸드 폴드 3회 + 오픈 레이즈 기회 실행 1회를 채우면 6핸드부터 끝난다(2026-09-03 피드백 ③).
      minHands: 6,
      objectives: {
        // 카드 분포에 좌우되는 절대 비율(VPIP 등)은 통과 조건으로 쓰지 않는다(A5-2 목표 규약).
        // open-raise는 "기회 중 실행" — 임계 안 핸드가 한 번도 안 오면 판정 불가로 빠진다.
        primary: [
          { id: 'act1-ch02:fold-junk', kind: 'fold-preflop-junk', label: '약한 핸드 폴드 3번', target: 3 },
          {
            id: 'act1-ch02:no-junk',
            kind: 'no-junk-entry',
            label: '약한 핸드로 들어가지 않기',
            maxCount: 0,
            params: { belowPercentile: 40 },
          },
          { id: 'act1-ch02:open', kind: 'open-raise', label: '임계 안 핸드가 오면 오픈 레이즈', target: 1 },
        ],
        bonus: [{ id: 'act1-ch02:survive', kind: 'survive', label: '파산 없이 끝내기' }],
      },
      interrupts: [
        {
          id: 'act1-ch02:int-first-turn',
          trigger: { kind: 'first-my-turn' },
          scene: {
            id: 'act1-ch02:int-first-turn',
            lines: [
              {
                kind: 'say',
                speaker: 'sakura',
                text: '다, 당신 차례예요. 홀카드를 보기 전에 포지션 이름부터 확인해요 — 그다음에 임계와 비교하는 순서예요.',
                expression: 'thinking',
              },
              {
                kind: 'say',
                speaker: 'sakura',
                text: '홀카드 테두리 색이 도와줄 거예요. 초록은 넉넉하고, 빨강이면… 저, 폴드해요.',
                expression: 'neutral',
              },
            ],
          },
        },
        {
          id: 'act1-ch02:int-halfway',
          trigger: { kind: 'halfway' },
          scene: {
            id: 'act1-ch02:int-halfway',
            lines: [
              {
                kind: 'say',
                speaker: 'sakura',
                text: '반이 지났어요. 계속 폴드하고 있어도… 괘, 괜찮아요. 저도 한 바퀴에 한두 번밖에 안 들어가요.',
                expression: 'happy',
                cg: 'act1-ch02-climax',
              },
            ],
          },
        },
      ],
    },

    // 수련 뒤 테이블 정리 → 서재 → 정원 → 비를 피한 툇마루. 기존 밤 에필로그로 이어진다.
    {
      kind: 'scene',
      id: 'act1-ch02:epilogue',
      scene: {
        id: 'act1-ch02:epilogue',
        lines: [
          {
            kind: 'say', speaker: 'sakura', expression: 'happy',
            bg: 'dojo-table', music: 'story-warm', cg: 'act1-ch02-victory',
            text: '후후… 이제 칩을 정리해도 되겠네요. 오늘은 저도 작은 승리를 한 기분이에요. 끝까지 제 설명을 들어 줘서 고마워요.',
          },
          {
            kind: 'say', speaker: 'sakura', expression: 'neutral',
            bg: 'dojo-study', cg: 'act1-ch02-library',
            text: '정리를 마쳤으니 서재에 잠깐 들를까요? 여기, 제가 처음 수련할 때 읽던 책이 있어요. 모르는 부분마다 표시를 남겨 뒀더니… 거의 모든 장에 흔적이 남았네요.',
          },
          {
            kind: 'say', speaker: 'sakura', expression: 'thinking',
            text: '지금 다시 읽으면 그때 놓쳤던 질문이 보여요. 같은 페이지도 기다렸다가 돌아오면 조금 다르게 읽히더라고요.',
          },
          {
            kind: 'say', speaker: 'sakura', expression: 'happy',
            bg: 'dojo-gate', cg: 'act1-ch02-garden-walk',
            text: '책을 빌렸으니 정원 쪽으로 돌아가요. 이 길의 벚꽃은 조금 늦게 피어요. 매일 지나가다 보니, 오늘 핀 가지를 알아볼 수 있게 됐어요.',
          },
          {
            kind: 'say', speaker: 'sakura', expression: 'thinking',
            cg: 'act1-ch02-rain-veranda',
            text: '어, 비가 오네요. 이쪽 툇마루에서 잠깐 피해요. 책도 젖지 않게 안쪽에 놓고요. 조금 전까지 맑았는데… 빗소리도 나쁘지 않네요.',
          },
          {
            kind: 'say', speaker: 'sakura', expression: 'neutral',
            text: '비가 그치기를 기다리는 사이 해가 졌네요. 저기 정원에 불이 들어왔어요. 돌아가기 전에, 오늘 수련 이야기를 조금만 더 나눠도 될까요?',
          },
          // 기존 밤 에필로그와 선택 반응을 그대로 이어 붙인다.
          {
            kind: 'say',
            speaker: 'sakura',
            text: '…끝났네요. 당신, 약한 핸드가 올 때마다 망설임 없이 폴드했죠.',
            expression: 'neutral',
            bg: 'dojo-garden-night',
            music: 'story-warm',
            cg: 'act1-ch02-epilogue',
          },
          {
            kind: 'say',
            speaker: 'sakura',
            text: '지루했을 텐데 한 번도 흔들리지 않았어요. 그게… 제일 어려운 부분이거든요.',
            expression: 'happy',
          },
          {
            kind: 'say',
            speaker: 'sakura',
            // 프롤로그에서 꺼낸 고민의 회수
            text: '아침엔 「가르칠 수 있을까」 하고 그렇게 떨었는데요. 지금은… 이상하게 안 떨리네요.',
            expression: 'confident',
            effect: 'zoom',
          },
          {
            kind: 'choice',
            choice: {
              id: 'reply',
              prompt: '사쿠라에게 —',
              options: [
                {
                  id: 'praise',
                  text: '「좋은 선생님이었어요.」',
                  setFlags: { 'choice:act1-ch02:reply': 'praise' },
                  reply: [{
                    kind: 'say',
                    speaker: 'sakura',
                    text: '서, 선생님이라니… 그런 말 처음 들어요. …다음에도, 제가 봐도 될까요?',
                    expression: 'surprised',
                  }],
                },
                {
                  id: 'boring',
                  text: '「폴드가 이렇게 힘든 줄 몰랐어요.」',
                  setFlags: { 'choice:act1-ch02:reply': 'boring' },
                  reply: [{
                    kind: 'say',
                    speaker: 'sakura',
                    text: '그렇죠…? 저도 그래요. 그래서 폴드할 때마다 「지금 칩을 벌고 있다」고 생각하기로 했어요.',
                    expression: 'happy',
                  }],
                },
                {
                  id: 'ask',
                  text: '「몇 시간이나 기다려 본 적 있어요?」',
                  setFlags: { 'choice:act1-ch02:reply': 'ask' },
                  reply: [{
                    kind: 'say',
                    speaker: 'sakura',
                    text: '네 시간이요. 그날 딱 세 번 들어가서… 세 번 다 이겼어요. 그날 이후로 기다리는 게 무섭지 않아요.',
                    expression: 'confident',
                  }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'sakura',
            text: '다음엔 하나 씨 수업도 들어 보세요. 그분은… 숫자로 이야기해요. 저랑은 정반대지만, 당신에게는 둘 다 필요할 거예요.',
            expression: 'neutral',
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '…사쿠라 씨 수업, 좋았어. 짝 대국 전에 들어 둬서 다행.',
            expression: 'happy',
            byPartner: partnerVariants({
              // 파트너 = 사쿠라 본인: 자기 수업을 칭찬하지 않고 짝에게 고마움을 전한다
              sakura: { text: '…다, 당신이 제 짝이라서, 오늘 끝까지 가르칠 수 있었던 것 같아요. 고마워요.', expression: 'happy' },
              ara: { text: '사쿠라 씨 수업, 생각보다 괜찮았지? …짝 대국 전에 폴드 배운 거, 나한테도 이득이야.', expression: 'confident' },
              hana: { text: '사쿠라 씨의 수업, 실전 효율이 높았어요. 짝 대국 준비로도 좋은 하루였어요.', expression: 'happy' },
              chloe: { text: '사쿠라 씨 수업 완전 힐링이었어~ 짝 대국 전에 폴드 마스터했다, 우리!', expression: 'happy' },
              vivian: { text: '사쿠라 씨, 오늘 무대 훌륭했어요. 짝 대국 전에 좋은 공연을 봤네요, 자기.', expression: 'happy' },
              elena: { text: '…사쿠라 씨 수업, 좋았어. …짝 대국 전에 들어 둬서 다행이야.', expression: 'happy' },
            }),
          },
        ],
      },
    },

    { kind: 'result', id: 'act1-ch02:result' },
  ],
  rewards: {
    first: {
      dojoXpMilli: 150_000,
      affinity: [{ target: 'sakura', milli: 100_000 }, { target: 'partner', milli: 20_000 }],
      badgeId: 'story-patience-sprout',
    },
    replay: { dojoXpMilli: 30_000 },
    gradeBonusMilli: { A: 30_000, S: 75_000 },
  },
};
