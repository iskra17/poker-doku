/**
 * 2막 Ch4 「먼저 치는 사람」 — 아라.
 * 개념: 스틸 · 손익분기 폴드율 · c벳 · 폴드 에퀴티 (A5-1).
 *
 * 집필 규약:
 * - 전부 수기(AI 생성 금지). 아라 = LAG 츤데레 반말, 호칭은 「너」, 「흥」·「…」 버릇. 前 FPS 프로게이머.
 * - 성장축(A8): 에필로그에서 팀 해체 이야기를 처음 꺼낸다 — 이후 챕터가 이 고백을 전제로 삼지 말 것(2막은 비선형).
 * - 수치는 단일 소스와 같다: BTN 임계 35(`open-thresholds.ts`), 손익분기 = 벳 ÷ (벳 + 팟)(`breakeven.ts`),
 *   K♥T♣ 21.7%·9♠8♠ 10.6%(`handPercentile`). 2막 턴 시간 60초(A6).
 * - 2막은 1막 전체 완주(노란띠) 뒤 열리고, 2막 안에서는 비선형이다.
 */
import type { Chapter } from '../../types';
import { guidedSituation } from '../helpers';

export const ACT2_REQUIRES = ['act1-ch01', 'act1-ch02', 'act1-ch03'] as const;

export const CH04: Chapter = {
  id: 'act2-ch04',
  act: 2,
  order: 1,
  title: '먼저 치는 사람',
  subtitle: '스틸 · 손익분기 폴드율 · c벳',
  teacher: 'ara',
  belt: 'yellow',
  requires: [...ACT2_REQUIRES],
  estimatedMinutes: 15,
  steps: [
    // ───────────────────────────────────────────── 프롤로그
    {
      kind: 'scene',
      id: 'act2-ch04:prologue',
      scene: {
        id: 'act2-ch04:prologue',
        lines: [
          {
            kind: 'say',
            speaker: 'miyako',
            text: '수련생님, 오늘 담당은 아라 씨예요♪ …조금 시끄러울지도 모르지만, 「공격」은 이분이 제일 잘 가르치거든요.',
            expression: 'happy',
            bg: 'dojo-table',
            music: 'story-calm',
            cg: 'act2-ch04-prologue',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '흥, 네가 그 노란띠? 하나한테 숫자는 배웠다며. 그럼 이제 그 숫자로 「먼저 치는 법」을 배울 차례야.',
            expression: 'confident',
            effect: 'zoom',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '포커에서 돈은 쇼다운에서만 버는 게 아니야. 상대가 폴드할 때도 벌어. 아니, 사실 그쪽이 더 많아.',
            expression: 'neutral',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '오늘 배울 건 세 가지. 스틸, c벳, 그리고 「몇 % 폴드해야 본전인가」. 그거면 넌 먼저 치는 사람이 돼.',
            expression: 'confident',
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 개념 카드 + 함께 풀기
    {
      kind: 'lesson',
      id: 'act2-ch04:lesson',
      title: '먼저 치면 판이 내 것',
      blocks: [
        {
          kind: 'text',
          speaker: 'ara',
          text: '잘 들어. 레이즈는 두 가지로 이겨. 상대가 폴드하거나, 쇼다운에서 이기거나. 콜은 한 가지로만 이기고.',
        },
        {
          kind: 'concept-card',
          title: '스틸 — 뒤에 블라인드뿐이면',
          body: '앞이 전부 폴드하고 CO나 BTN에 앉아 있으면, 뒤에 남은 건 블라인드 둘뿐이야. 임계 안 핸드면 그냥 오픈 레이즈해서 블라인드 1½BB를 가져와.',
        },
        {
          kind: 'concept-card',
          title: '손익분기 폴드율',
          body: '블러프가 본전이 되는 상대 폴드율은 벳 ÷ (벳 + 팟)이야. 팟은 벳을 넣기 전 금액이고.',
          formula: '필요 폴드율 = 벳 ÷ (벳 + 팟)',
        },
        {
          kind: 'concept-card',
          title: 'c벳 — 어그레서의 권리',
          body: '프리플랍에 레이즈한 사람은 플랍에서 한 번 더 치는 게 기본이야. 상대는 대부분 플랍을 못 맞추니까.',
        },
        {
          kind: 'concept-card',
          title: '크기는 보드가 정해',
          body: '드라이 보드(레인보우·연결 없음)면 팟의 ⅓만 벳해도 충분히 폴드해. 웻 보드(같은 수트·연결)면 ¾ 팟으로 드로우 값을 나쁘게 만들어.',
        },
        {
          kind: 'guided',
          teacher: 'ara',
          intro: '먼저 스틸. 앞이 다 폴드했고 넌 BTN, 핸드는 K♥T♣. 뒤엔 블라인드 둘뿐이야.',
          situation: guidedSituation({
            hero: 'Kh Tc',
            heroPosition: 'BTN',
            potChips: 30,
            toCallChips: 20,
            villains: [
              { seatIndex: 1, characterId: 'mochi', position: 'SB', stackChips: 2_000 },
              { seatIndex: 2, characterId: 'kapi', position: 'BB', stackChips: 2_000 },
            ],
            note: '앞자리는 전부 폴드 — 언오픈 팟이 버튼까지 왔어요',
          }),
          stages: [
            {
              prompt: 'K♥T♣는 상위 22% 근처, BTN 임계는 35%야. 어떻게 할래?',
              answer: { kind: 'multiple-choice', options: ['2.5BB 오픈 레이즈', '림프', '폴드'], correctIndex: 0 },
              onCorrect: '그래, 오픈 레이즈. 임계 안이고 뒤엔 둘뿐이야 — 이게 스틸이야.',
              onWrong: '아니. 22%는 35% 안쪽이고, 림프는 주도권을 버리는 거야. 2.5BB로 열어.',
            },
            {
              prompt: '2.5BB를 걸어서 1.5BB를 가져오는 거야. 둘 다 최소 몇 % 폴드해야 본전일까?',
              answer: { kind: 'numeric', correct: 63, tolerance: 5, unit: '%', min: 0, max: 100 },
              onCorrect: '2.5 ÷ (2.5 + 1.5) = 62.5%. 실제론 그보다 훨씬 자주 폴드해. 그래서 스틸이 돈이 돼.',
              onWrong: '벳 ÷ (벳 + 팟). 2.5 ÷ 4 = 62.5%야. 둘이 그보다 자주 폴드하면 카드랑 상관없이 이득이야.',
            },
          ],
        },
        {
          kind: 'guided',
          teacher: 'ara',
          intro: '이번엔 c벳. 네가 CO에서 A♠K♦로 오픈, 카피(BB)만 콜. 플랍 K♣7♦2♠에서 카피가 체크했어.',
          situation: guidedSituation({
            hero: 'As Kd',
            board: 'Kc 7d 2s',
            heroPosition: 'CO',
            potChips: 140,
            toCallChips: 0,
            villains: [{ seatIndex: 1, characterId: 'kapi', position: 'BB', stackChips: 1_940, rangeTag: '스테이션' }],
            note: '내가 프리플랍 어그레서, 카피가 체크',
          }),
          stages: [
            {
              prompt: 'K♣7♦2♠ — 이 보드는 드라이야, 웻이야?',
              answer: { kind: 'multiple-choice', options: ['드라이', '웻'], correctIndex: 0 },
              onCorrect: '레인보우에 연결도 없어. 카피가 맞췄을 만한 게 별로 없다는 뜻이야.',
              onWrong: '수트가 다 다르고(레인보우) K-7-2는 이어지지도 않아. 이런 게 드라이 보드야.',
            },
            {
              prompt: '탑페어 탑키커야. c벳 크기는?',
              answer: { kind: 'multiple-choice', options: ['⅓ 팟 (약 50)', '¾ 팟 (약 105)'], correctIndex: 0 },
              onCorrect: '드라이 보드는 작게. 폴드할 애는 ⅓에도 폴드하고, 카피처럼 안 폴드하는 애한텐 싸게 밸류를 쌓아.',
              onWrong: '드라이 보드에서 ¾은 낭비야. 상대가 맞춘 게 없으면 ⅓에도 폴드해 — 크기는 보드가 정한다니까.',
            },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────── 드릴 7문 (D-BE 2 · D-SIZE 2 · D-ACT 3)
    {
      kind: 'drill-set',
      id: 'act2-ch04:drills',
      title: '먼저 치는 수련 문제',
      teacher: 'ara',
      drills: [
        { templateId: 'breakeven-fold-pct', seedPolicy: 'per-run' },
        { templateId: 'size-cbet-texture', seedPolicy: 'per-run' },
        { templateId: 'breakeven-choice', seedPolicy: 'per-run' },
        { templateId: 'size-cbet-texture', seedPolicy: 'per-run' },
        // 수기 문항은 시드 고정 — 상황이 매번 같아야 해설이 성립한다.
        { templateId: 'act-ch04-steal-btn', seedPolicy: 'fixed', fixedSeed: 0 },
        { templateId: 'act-ch04-cbet-dry', seedPolicy: 'fixed', fixedSeed: 0 },
        { templateId: 'act-ch04-iso-sb', seedPolicy: 'fixed', fixedSeed: 0 },
      ],
      hintPenalty: 0.5,
    },

    // ───────────────────────────────────────────── '연습' 프리셋 2핸드
    {
      kind: 'practice-table',
      id: 'act2-ch04:practice',
      tag: '연습',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'mochi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 4, characterId: 'partner', stackBB: 100, role: 'partner' },
        ],
        difficulty: 'normal',
        turnTimeSec: 60,
        botThinkScale: 0.6,
        hints: 3,
      },
      scripts: [
        // ① K♥T♣(상위 21.7%) — 언오픈으로 오면 CO/BTN/SB 임계 안(25/35/25). 스틸 연습.
        { hero: 'Kh Tc' },
        // ② A♠K♦ + K♣7♦2♠ 드라이 플랍 — 카피(좌석 2)는 Q♦J♣로 아무것도 없다. c벳 연습.
        { hero: 'As Kd', villains: { 2: 'Qd Jc' }, board: 'Kc 7d 2s 9h 4s' },
      ],
      perHandPrompt: '연습이야. 첫 핸드는 K♥T♣ — 앞이 폴드하면 열어. 둘째 핸드는 A♠K♦, 플랍이 드라이하면 ⅓ 팟 c벳이야.',
    },

    // ───────────────────────────────────────────── 스파링 (미션형 · 최대 14핸드)
    {
      kind: 'sparring',
      id: 'act2-ch04:sparring',
      tag: '대결',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 2, characterId: 'mochi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 3, characterId: 'sakura', stackBB: 100, role: 'neighbor' },
          { seatIndex: 4, characterId: 'partner', stackBB: 100, role: 'partner' },
        ],
        difficulty: 'normal',
        turnTimeSec: 60,
        botThinkScale: 0.6,
        hints: 3,
      },
      maxHands: 14,
      // 미션형: 스틸 2회 + c벳 기회 ⅔ + 림프 0을 채우면 6핸드부터 끝난다.
      minHands: 6,
      objectives: {
        // 스틸·c벳은 "기회 중 실행"(A5-2 목표 규약) — 기회가 안 오면 판정 불가로 빠진다.
        primary: [
          { id: 'act2-ch04:steal', kind: 'steal-open', label: 'CO/BTN 스틸 기회에 오픈 레이즈 2번', target: 2 },
          { id: 'act2-ch04:cbet', kind: 'cbet-when-aggressor', label: '어그레서 플랍 c벳 기회 중 ⅔ 이상', minRatio: 2 / 3 },
          { id: 'act2-ch04:no-limp', kind: 'no-limp', label: '림프 0', maxCount: 0 },
        ],
        bonus: [
          { id: 'act2-ch04:chips', kind: 'net-chips', label: '시작 스택 이상으로 끝내기', params: { minBB: 0 } },
          { id: 'act2-ch04:survive', kind: 'survive', label: '파산 없이 끝내기' },
        ],
      },
      interrupts: [
        {
          id: 'act2-ch04:int-first-turn',
          trigger: { kind: 'first-my-turn' },
          scene: {
            id: 'act2-ch04:int-first-turn',
            lines: [
              {
                kind: 'say',
                speaker: 'ara',
                text: '네 차례야. 앞이 다 폴드했고 네가 CO나 BTN이면 — 임계 안이면 그냥 오픈 레이즈해. 망설이면 늦어.',
                expression: 'confident',
              },
              {
                kind: 'say',
                speaker: 'ara',
                text: '그리고 네가 레이즈한 팟이면 플랍에서 한 번 더 쳐. 드라이면 작게, 웻하면 크게.',
                expression: 'neutral',
              },
            ],
          },
        },
        {
          id: 'act2-ch04:int-halfway',
          trigger: { kind: 'halfway' },
          scene: {
            id: 'act2-ch04:int-halfway',
            lines: [
              {
                kind: 'say',
                speaker: 'ara',
                text: '반 왔네. 스틸은 몇 번 했어? 림프는 안 했지? …그래, 그거면 됐어. 계속 먼저 쳐.',
                expression: 'happy',
                cg: 'act2-ch04-climax',
              },
            ],
          },
        },
      ],
    },

    // ───────────────────────────────────────────── 에필로그 (성장축: 팀 해체 고백)
    {
      kind: 'scene',
      id: 'act2-ch04:epilogue',
      scene: {
        id: 'act2-ch04:epilogue',
        lines: [
          {
            kind: 'say',
            speaker: 'ara',
            text: '…끝. 뭐, 나쁘지 않았어. 스틸할 때 손 안 떨더라?',
            expression: 'happy',
            bg: 'dojo-garden-night',
            music: 'story-warm',
            cg: 'act2-ch04-epilogue',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '나 예전에 FPS 할 때, 먼저 쏘는 쪽이 이긴다고 배웠거든. 포커도 똑같아. 먼저 치는 쪽이 판을 정해.',
            expression: 'confident',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '…팀이 해체됐을 때, 아무도 먼저 안 움직였어. 그래서 내가 여기 온 거야. 먼저 치려고.',
            expression: 'neutral',
            effect: 'zoom',
          },
          {
            kind: 'choice',
            choice: {
              id: 'reply',
              prompt: '아라에게 —',
              options: [
                {
                  id: 'praise',
                  text: '「먼저 쳐 줘서 고마워요.」',
                  setFlags: { 'choice:act2-ch04:reply': 'praise' },
                  reply: [{
                    kind: 'say',
                    speaker: 'ara',
                    text: '뭐, 뭐야 갑자기… 흥, 당연한 걸 가지고. …다음에도 내가 가르쳐 줄게. 네가 원하면.',
                    expression: 'surprised',
                  }],
                },
                {
                  id: 'ask',
                  text: '「지는 게 그렇게 싫어요?」',
                  setFlags: { 'choice:act2-ch04:reply': 'ask' },
                  reply: [{
                    kind: 'say',
                    speaker: 'ara',
                    text: '싫어. 죽어도 싫어. …그러니까 너도 지지 마. 내가 가르친 거니까.',
                    expression: 'confident',
                  }],
                },
                {
                  id: 'joke',
                  text: '「스틸당하는 기분은 어때요?」',
                  setFlags: { 'choice:act2-ch04:reply': 'joke' },
                  reply: [{
                    kind: 'say',
                    speaker: 'ara',
                    text: '…하하. 너 지금 나한테 스틸하려는 거야? 다음 수업에서 두고 봐. 3벳으로 갚아 줄 테니까.',
                    expression: 'happy',
                  }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '클로이 수업도 들어 봐. 걘 절대 폴드 안 해. …그래서 배울 게 있지. 「받을 건 받아야 한다」는 거.',
            expression: 'neutral',
          },
        ],
      },
    },

    { kind: 'result', id: 'act2-ch04:result' },
  ],
  rewards: {
    first: {
      dojoXpMilli: 200_000,
      affinity: [{ target: 'ara', milli: 100_000 }],
      badgeId: 'story-first-steal',
    },
    replay: { dojoXpMilli: 40_000 },
    gradeBonusMilli: { A: 40_000, S: 100_000 },
  },
};
