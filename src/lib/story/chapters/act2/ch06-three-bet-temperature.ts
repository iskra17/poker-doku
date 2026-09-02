/**
 * 2막 Ch6 「3벳의 온도」 — 아라 · 보스 팽팽(HU 50BB).
 * 개념: 3벳 레인지(프리미엄 6%) · 오픈을 맞았을 때 3구간 · 3벳을 맞았을 때 3구간 · 4벳 = 프리미엄 (A5-1).
 *
 * 집필 규약:
 * - 전부 수기(AI 생성 금지). 아라 = LAG 츤데레 반말 「너」, 팽팽 = 「…」 + 남극·얼음 비유, 콜을 「미지근하다」고 한다.
 * - 구간 수치는 `open-thresholds.ts`(3벳 6 / 콜 12 · 4벳 3.5 / 콜 8)와 같다. 백분위는 실측(AA 0.2 · ATo 19.3 · TT 4.1).
 * - 승급(파란띠)은 결산 `beltAwarded`가 알린다 — 에필로그에 승급·순서를 가정한 문장을 두지 않는다(2막 비선형).
 * - 보스전 미통과 시 `failScene` 단축판 → [스파링만 재도전].
 */
import type { Chapter } from '../../types';
import { guidedSituation } from '../helpers';
import { ACT2_REQUIRES } from './ch04-first-strike';

export const CH06: Chapter = {
  id: 'act2-ch06',
  act: 2,
  order: 3,
  title: '3벳의 온도',
  subtitle: '3벳 레인지 · 3벳 대면 3구간 · 보스 팽팽',
  teacher: 'ara',
  belt: 'blue',
  requires: [...ACT2_REQUIRES],
  estimatedMinutes: 18,
  steps: [
    // ───────────────────────────────────────────── 프롤로그
    {
      kind: 'scene',
      id: 'act2-ch06:prologue',
      scene: {
        id: 'act2-ch06:prologue',
        lines: [
          {
            kind: 'say',
            speaker: 'miyako',
            text: '수련생님, 오늘은 특별 손님이 와 계세요♪ 남극에서 오신 팽팽 님 — 이 도장에서 3벳을 제일 많이 하는 분이랍니다.',
            expression: 'happy',
            bg: 'dojo-study',
            music: 'story-calm',
            cg: 'act2-ch06-prologue',
          },
          {
            kind: 'say',
            speaker: 'paeng',
            text: '…왔군. 남극식으로 하지. 미지근한 콜은 없다. 레이즈, 혹은 폴드. 그 사이는 없다.',
            expression: 'neutral',
            effect: 'shake',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '팽팽은 콜이 없어. 레이즈 아니면 폴드. 그러니까 3벳을 배우기엔 최고의 상대지. …맞으면서 배우는 거지만.',
            expression: 'confident',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '오늘 배울 건 「3벳의 온도」. 어떤 핸드는 뜨겁게 3벳하고, 어떤 핸드는 차갑게 폴드하고, 그 사이는 콜. 3구간이야.',
            expression: 'neutral',
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 개념 카드 + 함께 풀기
    {
      kind: 'lesson',
      id: 'act2-ch06:lesson',
      title: '뜨거운 핸드, 차가운 핸드',
      blocks: [
        {
          kind: 'text',
          speaker: 'ara',
          text: '잘 들어. 오픈 레이즈 레인지랑 3벳 레인지는 달라. 오픈은 넓고, 3벳은 좁고, 4벳은 더 좁아. 온도가 올라갈수록 핸드는 좁아져.',
        },
        {
          kind: 'concept-card',
          title: '3벳은 프리미엄',
          body: '앞에서 오픈이 들어오면 상위 6%(TT+·AK·AQ·AJs·KQs·JTs 근처)로 3벳해. 크기는 오픈의 3배.',
        },
        {
          kind: 'concept-card',
          title: '오픈을 맞았을 때 3구간',
          body: '상위 6% 안이면 3벳, 12%까지는 콜, 그 밖은 폴드야. 경계에 걸리면 포지션이 좋을 때만 콜.',
        },
        {
          kind: 'concept-card',
          title: '3벳을 맞았을 때 3구간',
          body: '내 오픈이 3벳을 맞으면 상위 3½%(QQ+·AK·AQs)만 4벳, 8%까지는 콜, 그 밖은 폴드야. 오픈했다고 콜할 의무는 없어.',
        },
        {
          kind: 'concept-card',
          title: '하위 4벳은 없다',
          body: '4벳은 프리미엄만. 하위 핸드로 4벳하면 팽팽 같은 애한테 5벳 올인을 맞고 그냥 죽어.',
        },
        {
          kind: 'guided',
          teacher: 'ara',
          intro: '먼저 뜨거운 쪽. 모찌(UTG)가 3BB로 오픈했고, 넌 BTN에 A♠A♥. HJ·CO는 폴드.',
          situation: guidedSituation({
            hero: 'As Ah',
            heroPosition: 'BTN',
            potChips: 90,
            toCallChips: 60,
            villains: [
              { seatIndex: 1, characterId: 'luna', position: 'SB', stackChips: 2_000 },
              { seatIndex: 2, characterId: 'gumi', position: 'BB', stackChips: 2_000 },
              { seatIndex: 3, characterId: 'mochi', position: 'UTG', stackChips: 1_940, rangeTag: '오픈 3BB' },
            ],
            note: '모찌 3BB 오픈, 나까지 다른 사람은 폴드',
          }),
          stages: [
            {
              prompt: 'AA는 상위 0.2%야. 3벳 구간(상위 6%) 안이야, 밖이야?',
              answer: { kind: 'multiple-choice', options: ['안 — 3벳', '밖 — 콜'], correctIndex: 0 },
              onCorrect: '당연히 안이지. 최강 핸드로 콜하는 건 팟을 작게 만드는 거야. 뜨겁게 가.',
              onWrong: '0.2%는 6% 안쪽 맨 앞이야. 콜로 숨기면 팟만 작아지고 뒤 블라인드가 싸게 들어와. 3벳.',
            },
            {
              prompt: '3벳 크기는? 오픈이 3BB야.',
              answer: { kind: 'multiple-choice', options: ['6BB', '9BB', '30BB'], correctIndex: 1 },
              onCorrect: '오픈의 3배, 9BB. 모찌가 폴드하면 팟 먹고, 콜하면 큰 팟에 AA로 가는 거야.',
              onWrong: '3벳은 오픈의 3배가 기본이야 — 9BB. 6BB는 너무 싸서 다 콜하고, 30BB는 AA만 들키는 크기야.',
            },
          ],
        },
        {
          kind: 'guided',
          teacher: 'ara',
          intro: '이번엔 차가운 쪽. 네가 CO에서 A♦T♣로 3BB 오픈했는데, 팽팽(BTN)이 9BB로 3벳. 블라인드는 폴드.',
          situation: guidedSituation({
            hero: 'Ad Tc',
            heroPosition: 'CO',
            potChips: 270,
            toCallChips: 120,
            heroStackChips: 1_940,
            villains: [
              { seatIndex: 1, characterId: 'paeng', position: 'BTN', stackChips: 1_820, rangeTag: '3벳 9BB' },
              { seatIndex: 2, characterId: 'luna', position: 'SB', stackChips: 2_000 },
              { seatIndex: 3, characterId: 'gumi', position: 'BB', stackChips: 2_000 },
            ],
            note: '내 오픈 3BB, 팽팽 3벳 9BB — 콜하려면 120 더',
          }),
          stages: [
            {
              prompt: 'A♦T♣는 상위 19%야. 3벳을 맞았을 때 콜 구간(상위 8%까지) 안이야?',
              answer: { kind: 'multiple-choice', options: ['안 — 콜', '밖 — 폴드'], correctIndex: 1 },
              onCorrect: '밖이야. CO 오픈(25%)엔 들지만 3벳을 받는 구간은 훨씬 좁아. 포지션 없이 약한 A로 큰 팟은 없어.',
              onWrong: '19%는 8% 밖이야. 오픈했다고 콜할 의무는 없어 — 3BB 잃고 끝내는 게 이기는 거야.',
            },
            {
              prompt: '그럼 4벳으로 팽팽을 밀어낼까?',
              answer: { kind: 'multiple-choice', options: ['4벳', '폴드'], correctIndex: 1 },
              onCorrect: '폴드. 4벳은 3.5% 안 프리미엄만이야. ATo로 4벳하면 팽팽은 5벳 올인으로 답해.',
              onWrong: '팽팽은 미지근한 게 없어. ATo 4벳엔 5벳 올인이 돌아와. 차갑게 폴드해.',
            },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────── 드릴 7문 (D-RANGE(3벳) 3 · D-BE 1 · D-ACT 3)
    {
      kind: 'drill-set',
      id: 'act2-ch06:drills',
      title: '온도를 재는 수련 문제',
      teacher: 'ara',
      drills: [
        { templateId: 'range-3bet-decision', seedPolicy: 'per-run' },
        { templateId: 'range-vs-3bet', seedPolicy: 'per-run' },
        { templateId: 'range-3bet-decision', seedPolicy: 'per-run' },
        { templateId: 'breakeven-fold-pct', seedPolicy: 'per-run' },
        { templateId: 'act-ch06-3bet-aa', seedPolicy: 'fixed', fixedSeed: 0 },
        { templateId: 'act-ch06-fold-vs-3bet', seedPolicy: 'fixed', fixedSeed: 0 },
        { templateId: 'act-ch06-call-3bet-tt', seedPolicy: 'fixed', fixedSeed: 0 },
      ],
      hintPenalty: 0.5,
    },

    // ───────────────────────────────────────────── '연습' 프리셋 2핸드
    {
      kind: 'practice-table',
      id: 'act2-ch06:practice',
      tag: '연습',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'mochi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 2, characterId: 'paeng', stackBB: 100, role: 'boss' },
          { seatIndex: 4, characterId: 'partner', stackBB: 100, role: 'partner' },
        ],
        difficulty: 'normal',
        turnTimeSec: 60,
        botThinkScale: 0.6,
        hints: 2,
      },
      scripts: [
        // ① A♠A♥ — 모찌(좌석 1)는 K♦Q♦로 오픈할 만한 핸드. 오픈이 오면 3벳, 안 오면 오픈. 뜨거운 쪽 연습.
        { hero: 'As Ah', villains: { 1: 'Kd Qd' } },
        // ② A♦T♣ — 팽팽(좌석 2)은 Q♠Q♣로 3벳한다. 오픈 뒤 3벳을 맞으면 폴드. 차가운 쪽 연습.
        { hero: 'Ad Tc', villains: { 2: 'Qs Qc' } },
      ],
      perHandPrompt: '연습이야. 첫 핸드 A♠A♥는 뜨겁게 — 오픈이 오면 3벳. 둘째 핸드 A♦T♣는 오픈은 되지만 3벳을 맞으면 차갑게 폴드.',
    },

    // ───────────────────────────────────────────── 보스전 팽팽 HU 50BB (미션형 · 최대 15핸드)
    {
      kind: 'sparring',
      id: 'act2-ch06:sparring',
      tag: '대결',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 50,
        lineup: [{ seatIndex: 1, characterId: 'paeng', stackBB: 50, role: 'boss' }],
        difficulty: 'normal',
        turnTimeSec: 60,
        botThinkScale: 0.6,
        hints: 2,
      },
      maxHands: 15,
      // 미션형: 프리미엄 3벳 1회 + 하위 폴드 70% + 하위 4벳 0을 채우면 8핸드부터 끝난다.
      minHands: 8,
      objectives: {
        // 통과는 「온도」만 본다 — 팽팽보다 많은 칩은 bonus(등급·뱃지)로만(A5-2 통과 규약).
        primary: [
          { id: 'act2-ch06:premium', kind: 'premium-3bet', label: '프리미엄으로 3벳 1번', target: 1 },
          { id: 'act2-ch06:fold-junk', kind: 'fold-vs-3bet-junk', label: '3벳 맞은 하위 핸드 폴드 70% 이상', minRatio: 0.7 },
          { id: 'act2-ch06:no-4bet', kind: 'no-junk-4bet', label: '하위 4벳 0', maxCount: 0 },
        ],
        bonus: [
          { id: 'act2-ch06:chips', kind: 'net-chips', label: '팽팽보다 많은 칩으로 끝내기', params: { minBB: 0 } },
          { id: 'act2-ch06:survive', kind: 'survive', label: '파산 없이 끝내기' },
        ],
      },
      interrupts: [
        {
          id: 'act2-ch06:int-first-turn',
          trigger: { kind: 'first-my-turn' },
          scene: {
            id: 'act2-ch06:int-first-turn',
            lines: [
              {
                kind: 'say',
                speaker: 'ara',
                text: '헤즈업이야. 팽팽은 오픈 레인지가 좁고 3벳은 넓어. 네가 오픈했는데 3벳이 오면 — 3구간, 기억해.',
                expression: 'confident',
              },
              {
                kind: 'say',
                speaker: 'paeng',
                text: '…시작하지. 망설이면 얼어 죽는다.',
                expression: 'neutral',
              },
            ],
          },
        },
        {
          id: 'act2-ch06:int-halfway',
          trigger: { kind: 'halfway' },
          scene: {
            id: 'act2-ch06:int-halfway',
            lines: [
              {
                kind: 'say',
                speaker: 'ara',
                text: '반 지났어. 하위로 4벳 안 했지? …좋아. 프리미엄이 오면 그땐 뜨겁게 가.',
                expression: 'neutral',
              },
            ],
          },
        },
      ],
    },

    // ───────────────────────────────────────────── 에필로그 (성장축: 「네가 처음이야」)
    {
      kind: 'scene',
      id: 'act2-ch06:epilogue',
      scene: {
        id: 'act2-ch06:epilogue',
        lines: [
          {
            kind: 'say',
            speaker: 'paeng',
            text: '…흠. 온도를 아는 자로군. 남극식으로 인정하지. 빙산의 일각이었다.',
            expression: 'neutral',
            bg: 'dojo-gate',
            music: 'story-warm',
            cg: 'act2-ch06-epilogue',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '봤지? 3벳 맞고 폴드할 땐 차갑게, 프리미엄은 뜨겁게. 온도만 맞으면 팽팽도 별거 아니야.',
            expression: 'happy',
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '…근데 있잖아. 나, 원래 남한테 뭐 가르치는 거 안 해. 네가 처음이야.',
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
                  id: 'why',
                  text: '「왜 저한테는 가르쳐 줬어요?」',
                  setFlags: { 'choice:act2-ch06:reply': 'why' },
                  reply: [{
                    kind: 'say',
                    speaker: 'ara',
                    text: '…글쎄. 네가 지는 걸 싫어하는 얼굴이었으니까. 나랑 똑같이.',
                    expression: 'neutral',
                  }],
                },
                {
                  id: 'hot',
                  text: '「아라 씨도 꽤 뜨거웠어요.」',
                  setFlags: { 'choice:act2-ch06:reply': 'hot' },
                  reply: [{
                    kind: 'say',
                    speaker: 'ara',
                    text: '뜨, 뜨겁긴 뭐가! …흥. 다음엔 내가 3벳 상대야. 각오해.',
                    expression: 'surprised',
                  }],
                },
                {
                  id: 'paeng',
                  text: '「팽팽이랑 친해요?」',
                  setFlags: { 'choice:act2-ch06:reply': 'paeng' },
                  reply: [{
                    kind: 'say',
                    speaker: 'ara',
                    text: '친하긴. …남극에서 온 첫날부터 나한테 3벳하더라고. 그래서 마음에 들었어.',
                    expression: 'happy',
                  }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'ara',
            text: '오늘 수업은 여기까지. 다음 막은 「읽는 법」이래. 비비안이 가르친다던데… 그 여자는 조심해.',
            expression: 'confident',
          },
        ],
      },
    },

    { kind: 'result', id: 'act2-ch06:result' },
  ],
  failScene: {
    id: 'act2-ch06:fail',
    lines: [
      {
        kind: 'say',
        speaker: 'ara',
        text: '오늘은 온도가 좀 어긋났네. 3벳 맞고 콜한 하위 핸드가 있었어. …괜찮아, 팽팽은 도망 안 가.',
        expression: 'neutral',
        bg: 'dojo-study',
      },
      {
        kind: 'say',
        speaker: 'paeng',
        text: '…다시 오지. 얼음은 녹지 않는다.',
        expression: 'neutral',
      },
      {
        kind: 'say',
        speaker: 'ara',
        text: '스파링만 다시 해. 이번엔 3구간만 봐 — 프리미엄은 뜨겁게, 하위는 차갑게, 사이는 콜.',
        expression: 'confident',
      },
    ],
  },
  rewards: {
    first: {
      dojoXpMilli: 250_000,
      affinity: [{ target: 'ara', milli: 100_000 }],
      badgeId: 'story-blue-belt',
    },
    replay: { dojoXpMilli: 50_000 },
    gradeBonusMilli: { A: 50_000, S: 120_000 },
  },
};
