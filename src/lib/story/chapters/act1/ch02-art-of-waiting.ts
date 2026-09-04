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
import type { Chapter } from '../../types';
import { guidedSituation } from '../helpers';

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
          title: '상위 %로 보는 손',
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
              prompt: '이 핸드는 상위 몇 % 근처일까요? 어림으로 괜찮아요.',
              answer: { kind: 'numeric', correct: 70, tolerance: 10, unit: '%', min: 0, max: 100 },
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

    // ───────────────────────────────────────────── 드릴 7문 (D-RANGE 4 · D-POS 2 · D-ACT 1)
    {
      kind: 'drill-set',
      id: 'act1-ch02:drills',
      title: '기다림의 수련 문제',
      teacher: 'sakura',
      drills: [
        { templateId: 'range-open-decision', seedPolicy: 'per-run' },
        { templateId: 'range-open-decision', seedPolicy: 'per-run' },
        { templateId: 'range-percentile', seedPolicy: 'per-run' },
        { templateId: 'pos-name', seedPolicy: 'per-run' },
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

    // ───────────────────────────────────────────── 에필로그 (성장축: 말더듬 감쇠)
    {
      kind: 'scene',
      id: 'act1-ch02:epilogue',
      scene: {
        id: 'act1-ch02:epilogue',
        lines: [
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
            text: '사실 저, 오늘 아침까지 「가르칠 수 있을까」 하고 계속 떨었어요. 그런데 지금은… 이상하게 안 떨리네요.',
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
        ],
      },
    },

    { kind: 'result', id: 'act1-ch02:result' },
  ],
  rewards: {
    first: {
      dojoXpMilli: 150_000,
      affinity: [{ target: 'sakura', milli: 100_000 }],
      badgeId: 'story-patience-sprout',
    },
    replay: { dojoXpMilli: 30_000 },
    gradeBonusMilli: { A: 30_000, S: 75_000 },
  },
};
