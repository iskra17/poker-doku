/**
 * 1막 Ch3 「숫자는 거짓말을 안 해요」 — 하나 + 보스 드라코. 1막 마지막(노란띠).
 * 개념: 아우츠 · 2/4의 법칙 · 팟오즈 · 콜 결정 (A5-1).
 *
 * 집필 규약:
 * - 전부 수기(AI 생성 금지). 하나 = 분석가 존댓말, 호칭은 「당신」. 드라코 = 아기 드래곤, 보물·불 뿜기.
 * - **팟 정의 고정**(A4 D-ODDS · A13 골든 케이스): 「팟」 = 상대의 벳까지 포함해 지금 중앙에 있는 총액.
 *   따라서 필요 승률 = 콜 ÷ (팟 + 콜). "팟 150 + 벳 50 = 200 → 20%"로 읽히는 표기는 쓰지 말 것.
 * - ×4(두 장 기준)는 두 장을 다 보는 게 확정일 때만 유효하다고 카드·해설 양쪽에 명시한다.
 * - 검산: A♥K♥ / Q♥7♥2♣ → 남은 하트 9장, 턴 한 장 9/47 ≈ 19%(어림 18%), 두 장 어림 36%.
 *   드라코가 팟 60에 120(2배 오버벳) → 팟 180 · 콜 120 → 120 ÷ 300 = 40% → 폴드.
 */
import type { Chapter } from '../../types';

export const CH03: Chapter = {
  id: 'act1-ch03',
  act: 1,
  order: 3,
  title: '숫자는 거짓말을 안 해요',
  subtitle: '아우츠 · 2/4의 법칙 · 팟오즈',
  teacher: 'hana',
  belt: 'yellow',
  requires: ['act1-ch02'],
  estimatedMinutes: 17,
  steps: [
    // ───────────────────────────────────────────── 프롤로그
    {
      kind: 'scene',
      id: 'act1-ch03:prologue',
      scene: {
        id: 'act1-ch03:prologue',
        lines: [
          {
            kind: 'say',
            speaker: 'hana',
            text: '앉으세요. 오늘은 감(感) 이야기를 한 마디도 하지 않을 거예요 — 숫자만 다룹니다.',
            expression: 'neutral',
            bg: 'dojo-study',
            music: 'story',
          },
          {
            kind: 'say',
            speaker: 'hana',
            text: '(화이트보드를 돌린다) 뒷산 보물창고의 드라코, 최근 40핸드 기록이에요. 드로우가 보이면 팟의 두 배를 던져요 — 예외 없이요.',
            expression: 'thinking',
          },
          {
            kind: 'say',
            speaker: 'draco',
            text: '보물이다!! 크게 던지면 크게 돌아온다구!! 그게 용의 방식이야!!',
            expression: 'confident',
          },
          {
            kind: 'say',
            speaker: 'hana',
            text: '…저 습관은 계산으로만 뚫려요. 아우츠를 세고, 필요 승률을 구하고, 둘을 비교하는 것 — 오늘 당신이 배울 건 그 셋뿐이에요.',
            expression: 'confident',
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 개념 카드 + 함께 풀기
    {
      kind: 'lesson',
      id: 'act1-ch03:lesson',
      title: '세고, 나누고, 비교한다',
      blocks: [
        {
          kind: 'text',
          speaker: 'hana',
          text: '외울 건 공식 하나뿐이에요. 나머지는 세는 연습이고요.',
        },
        {
          kind: 'concept-card',
          title: '아우츠',
          body: '아직 안 나온 카드 중 내 패를 이기게 만들어 주는 카드예요. 하트가 네 장 보이면 남은 하트는 아홉 장 — 이게 아우츠 9장이에요.',
        },
        {
          kind: 'concept-card',
          title: '2 · 4의 법칙',
          body: '아우츠 × 2 = 다음 한 장에서 뜰 확률(%)의 어림값이에요. × 4는 올인처럼 두 장을 다 보는 게 확정일 때만 쓰세요.',
        },
        {
          kind: 'concept-card',
          title: '팟오즈',
          body: '여기서 「팟」은 상대의 벳까지 포함해 지금 중앙에 놓인 총액이에요. 팟 150(상대 벳 50 포함)에 콜 50이면 50 ÷ (150 + 50) = 25%가 필요 승률이에요.',
          formula: '필요 승률 = 콜 ÷ (팟 + 콜)',
        },
        {
          kind: 'concept-card',
          title: '콜 결정',
          body: '내 뜰 확률이 필요 승률보다 높으면 콜, 낮으면 폴드예요. 결과가 아니라 이 비교를 제대로 했는지가 채점 기준이에요.',
        },
        {
          kind: 'guided',
          teacher: 'hana',
          intro: '같이 한 번 세어 볼까요. 당신 핸드는 A♥K♥, 보드는 Q♥ 7♥ 2♣예요.',
          stages: [
            {
              prompt: '먼저 아우츠예요. 하트는 열세 장인데 지금 네 장이 보이죠 — 하트가 몇 장 남았죠?',
              answer: { kind: 'numeric', correct: 9, tolerance: 0, unit: 'outs', min: 0, max: 21 },
              onCorrect: '정확해요. 13에서 보이는 네 장을 빼면 9장이에요.',
              onWrong: 'A♥ · K♥ · Q♥ · 7♥ 네 장이 이미 보여요. 13 − 4 = 9장이에요.',
            },
            {
              prompt: '턴 한 장이면 × 2죠. 9 × 2는 몇 %일까요?',
              answer: { kind: 'numeric', correct: 18, tolerance: 0, unit: '%', min: 0, max: 100 },
              onCorrect: '18%예요. 정확값은 19% 근처니까 어림으로 충분해요.',
              onWrong: '2의 법칙이에요. 9 × 2 = 18% — 정확값 19%와 거의 같죠.',
            },
          ],
        },
        {
          kind: 'guided',
          teacher: 'hana',
          intro: '이제 값을 매겨 봐요. 같은 핸드인데 드라코가 팟 60에 120을 던졌어요 — 중앙에는 180이 있고, 콜은 120이에요.',
          stages: [
            {
              prompt: '필요 승률은 몇 %일까요?',
              answer: { kind: 'numeric', correct: 40, tolerance: 1, unit: '%', min: 0, max: 100 },
              onCorrect: '40%예요. 콜 120을 팟 180에 더해 300으로 나눈 값이죠.',
              onWrong: '콜 금액도 팟에 더해야 해요. 120 ÷ (180 + 120) = 40%예요.',
            },
            {
              prompt: '아우츠는 18%, 필요 승률은 40%. 어떻게 할까요?',
              answer: { kind: 'multiple-choice', options: ['콜', '폴드'], correctIndex: 1 },
              onCorrect: '폴드예요. 턴 한 장이면 18%, 두 장을 다 본다 쳐도 36% — 어느 쪽도 40%에 못 미쳐요.',
              onWrong: '18%로 40%짜리 값을 살 수는 없어요. 여기는 폴드하는 자리예요 — 다음에 하트가 떠도 판단은 그대로 옳습니다.',
            },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────── 드릴 8문 (D-OUTS 3 · D-ODDS 2 · D-EQ 1 · D-CALL 2)
    {
      kind: 'drill-set',
      id: 'act1-ch03:drills',
      title: '숫자 수련 문제',
      teacher: 'hana',
      drills: [
        { templateId: 'outs-count', seedPolicy: 'per-run' },
        { templateId: 'outs-count', seedPolicy: 'per-run' },
        { templateId: 'odds-required-equity', seedPolicy: 'per-run' },
        { templateId: 'outs-count', seedPolicy: 'per-run' },
        { templateId: 'odds-ratio-choice', seedPolicy: 'per-run' },
        { templateId: 'equity-estimate', seedPolicy: 'per-run' },
        { templateId: 'call-decision', seedPolicy: 'per-run' },
        { templateId: 'call-decision', seedPolicy: 'per-run' },
      ],
      passRule: { minCorrect: 6 },
      hintPenalty: 0.5,
    },

    // ───────────────────────────────────────────── '연습' 프리셋 2핸드
    {
      kind: 'practice-table',
      id: 'act1-ch03:practice',
      tag: '연습',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'draco', stackBB: 100, role: 'boss' },
          { seatIndex: 2, characterId: 'choco', stackBB: 100, role: 'neighbor' },
        ],
        difficulty: 'easy',
        turnTimeSec: 90,
        botThinkScale: 0.6,
        hints: 3,
      },
      scripts: [
        // ① 넛 플러시 드로우(남은 하트 9장) vs 드라코의 셋 — 오버벳이 오면 필요 승률이 뜰 확률을 넘는다.
        //    실측(countOutsVsHand): 2♥는 드라코에게 풀하우스를 주므로 실질 8아우츠 → 폴드 결론은 더 분명해진다.
        { hero: 'Ah Kh', board: 'Qh 7h 2c', villains: { 1: 'Qs Qd' } },
        // ② 오픈엔디드(Q·7 8장) + 오버카드(J·T 6장) vs 초코의 톱페어 = 실측 14아우츠 — 작은 벳이면 값이 맞는다.
        { hero: 'Jc Tc', board: '9d 8s 2h', villains: { 2: 'Ad 9c' } },
      ],
      perHandPrompt: '연습이에요 — 핸드와 보드는 고정되어 있어요. 벳이 오면 아우츠부터 세고, 필요 승률과 비교하세요. 결과는 채점하지 않아요.',
    },

    // ───────────────────────────────────────────── 보스전 12핸드
    {
      kind: 'sparring',
      id: 'act1-ch03:sparring',
      tag: '대결',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'draco', stackBB: 100, role: 'boss' },
          { seatIndex: 2, characterId: 'choco', stackBB: 100, role: 'neighbor' },
        ],
        difficulty: 'easy',
        turnTimeSec: 90,
        botThinkScale: 0.6,
        hints: 3,
      },
      maxHands: 12,
      objectives: {
        // 통과는 「내 결정」만 본다 — 칩 결과는 bonus(등급·뱃지)로만(A5-2 통과 규약).
        primary: [
          { id: 'act1-ch03:odds', kind: 'correct-pot-odds-call', label: '오즈 위반 ⚠ 1회 이하', maxCount: 1 },
          { id: 'act1-ch03:played', kind: 'hands-played', label: '12핸드 완주하기', target: 12 },
        ],
        bonus: [
          { id: 'act1-ch03:chips', kind: 'net-chips', label: '드라코보다 많은 칩으로 끝내기', params: { minBB: 0 } },
          { id: 'act1-ch03:survive', kind: 'survive', label: '파산 없이 끝내기' },
        ],
      },
      interrupts: [
        {
          id: 'act1-ch03:int-first-turn',
          trigger: { kind: 'first-my-turn' },
          scene: {
            id: 'act1-ch03:int-first-turn',
            lines: [
              {
                kind: 'say',
                speaker: 'hana',
                text: '콜 버튼 위의 팟오즈 막대를 보세요. 그게 지금 필요한 승률이에요 — 당신 아우츠가 그 선을 넘는지만 확인하면 됩니다.',
                expression: 'neutral',
              },
              {
                kind: 'say',
                speaker: 'draco',
                text: '팟 두 배!! 이게 내 인사야!! 받을 거야, 안 받을 거야?!',
                expression: 'confident',
              },
            ],
          },
        },
        {
          id: 'act1-ch03:int-halfway',
          trigger: { kind: 'halfway' },
          scene: {
            id: 'act1-ch03:int-halfway',
            lines: [
              {
                kind: 'say',
                speaker: 'hana',
                text: '반환점이에요. 드라코의 오버벳은 대부분 드로우거나 이미 완성된 패 — 중간이 없어요.',
                expression: 'thinking',
              },
              {
                kind: 'say',
                speaker: 'hana',
                text: '값이 맞지 않으면 폴드하세요. 폴드해서 놓친 팟은 통계에 남지만, 값을 무시하고 낸 칩은 돌아오지 않아요.',
                expression: 'confident',
              },
            ],
          },
        },
      ],
    },

    // ───────────────────────────────────────────── 에필로그
    {
      kind: 'scene',
      id: 'act1-ch03:epilogue',
      scene: {
        id: 'act1-ch03:epilogue',
        lines: [
          {
            kind: 'say',
            speaker: 'draco',
            text: '으으… 왜 내 오버벳이 안 통해?! 다들 그냥 폴드하거나 그냥 콜했단 말이야…!',
            expression: 'sad',
            bg: 'dojo-study',
            music: 'story',
          },
          {
            kind: 'say',
            speaker: 'hana',
            text: '받을 값일 때만 받았으니까요. (화이트보드에 선을 긋는다) 오늘 당신의 드로우 결정, 값에 맞은 쪽이 훨씬 많았어요.',
            expression: 'happy',
          },
          {
            kind: 'say',
            speaker: 'hana',
            text: '…당신, 계산이 빨라졌네요. 처음 앉았을 때는 아우츠를 세는 데 한참 걸렸는데요.',
            expression: 'confident',
          },
          {
            kind: 'choice',
            choice: {
              id: 'study',
              prompt: '하나에게 —',
              options: [
                {
                  id: 'more-math',
                  text: '「더 어려운 것도 배우고 싶어요.」',
                  setFlags: { 'choice:act1-ch03:study': 'more-math' },
                  reply: [{
                    kind: 'say',
                    speaker: 'hana',
                    text: '…좋아요. 다음엔 에퀴티와 콤보를 볼 거예요. 화이트보드를 한 장 더 준비해 둘게요.',
                    expression: 'happy',
                  }],
                },
                {
                  id: 'head-hurts',
                  text: '「머리에서 김이 나요.」',
                  setFlags: { 'choice:act1-ch03:study': 'head-hurts' },
                  reply: [{
                    kind: 'say',
                    speaker: 'hana',
                    text: '정상이에요. 저도 처음엔 그랬어요 — 그 김이 식으면 남는 게 실력이고요.',
                    expression: 'neutral',
                  }],
                },
                {
                  id: 'about-draco',
                  text: '「드라코는 왜 계속 크게 던져요?」',
                  setFlags: { 'choice:act1-ch03:study': 'about-draco' },
                  reply: [{
                    kind: 'say',
                    speaker: 'hana',
                    text: '보물이 커 보이니까요. …사실 저 습관, 상대가 계산을 못 할 때는 굉장히 강해요. 당신은 이제 아니지만요.',
                    expression: 'thinking',
                  }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'miyako',
            text: '수고하셨어요, 수련생님♪ 이제 숫자로 테이블을 볼 수 있게 되셨네요. 1막의 세 수업을 모두 마치면 노란띠를 드린답니다.',
            expression: 'happy',
          },
        ],
      },
    },

    { kind: 'result', id: 'act1-ch03:result' },
  ],
  // 미통과 단축판(P4: 틀려도 그녀는 곁에 있다) — 인연·재도전에 불이익 없음.
  failScene: {
    id: 'act1-ch03:fail',
    lines: [
      {
        kind: 'say',
        speaker: 'hana',
        text: '오늘은 값이 몇 번 어긋났네요. 그런데 그건 실력이 아니라 순서 문제예요 — 세고, 나누고, 비교. 이 순서만 지키면 됩니다.',
        expression: 'neutral',
        bg: 'dojo-study',
      },
      {
        kind: 'say',
        speaker: 'hana',
        text: '드라코는 도망가지 않아요. 당신도요. …스파링만 다시 해도 괜찮으니, 이번엔 콜 버튼 위 막대만 보고 가세요.',
        expression: 'confident',
      },
    ],
  },
  rewards: {
    first: {
      dojoXpMilli: 150_000,
      affinity: [{ target: 'hana', milli: 100_000 }],
      badgeId: 'story-yellow-belt',
    },
    replay: { dojoXpMilli: 30_000 },
    gradeBonusMilli: { A: 30_000, S: 75_000 },
  },
};
