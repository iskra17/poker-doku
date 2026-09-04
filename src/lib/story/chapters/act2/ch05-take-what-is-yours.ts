/**
 * 2막 Ch5 「받을 건 받아야죠」 — 클로이.
 * 개념: 상대 유형 입문(HUD 두 줄 규칙) · 밸류벳 · 사이징 · 씬 밸류 (A5-1).
 *
 * 집필 규약:
 * - 전부 수기(AI 생성 금지). 클로이 = 밝은 스트리머체 반말, 영어 한 스푼(「Let's go~」·「Easy, right?」), 호칭 「너」, 「~구!」.
 * - 성장축(A8): 에필로그에서 「폴드하는 것도 배워 볼까」를 처음 입에 올린다 — 실제로 폴드하는 클로이는 3막 이후.
 * - 유형 규칙(VPIP 40↑ 루스 · 22↓ 니트 · PFR ≥ VPIP×60% 어그레시브)은 `opponent-type.ts`의 상수와 같다.
 *   카피 HUD(VPIP 66 · PFR 4)는 `personalities.ts` 실측.
 */
import type { Chapter } from '../../types';
import { guidedSituation } from '../helpers';
import { ACT2_REQUIRES } from './ch04-first-strike';

export const CH05: Chapter = {
  id: 'act2-ch05',
  act: 2,
  order: 2,
  title: '받을 건 받아야죠',
  subtitle: '상대 유형 · 밸류벳 · 사이징',
  teacher: 'chloe',
  belt: 'yellow',
  requires: [...ACT2_REQUIRES],
  estimatedMinutes: 15,
  steps: [
    // ───────────────────────────────────────────── 프롤로그
    {
      kind: 'scene',
      id: 'act2-ch05:prologue',
      scene: {
        id: 'act2-ch05:prologue',
        lines: [
          {
            kind: 'say',
            speaker: 'miyako',
            text: '수련생님, 오늘은 클로이 씨 차례예요♪ …방송 카메라는 제가 잠시 맡아 두었답니다.',
            expression: 'happy',
            bg: 'dojo-table',
            music: 'story-calm',
            cg: 'act2-ch05-prologue',
          },
          {
            kind: 'say',
            speaker: 'chloe',
            text: '하이하이~! 오늘 선생님은 나, 클로이! 방송은… 미야코 씨가 안 된대서 못 켰어. Sad~',
            expression: 'happy',
            effect: 'flash',
          },
          {
            kind: 'say',
            speaker: 'chloe',
            text: '다들 나보고 콜링 스테이션이래. 맞아, 나 폴드 안 해. 궁금하니까! 근데 그거 알아? 나 같은 사람한테서 돈 못 받아 가는 사람이 진짜 많다는 거.',
            expression: 'confident',
          },
          {
            kind: 'say',
            speaker: 'chloe',
            text: '오늘 주제는 「받을 건 받기」. 상대가 누군지 읽고, 밸류벳은 크게, 블러프는 안 폴드하는 애한테는 안 하기. Easy, right?',
            expression: 'happy',
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 개념 카드 + 함께 풀기
    {
      kind: 'lesson',
      id: 'act2-ch05:lesson',
      title: '상대를 읽으면 크기가 보여',
      blocks: [
        {
          kind: 'text',
          speaker: 'chloe',
          text: '오케이~ 정리해 볼게! 같은 탑페어라도 상대가 누구냐에 따라 받을 수 있는 돈이 달라져. 그러니까 먼저 상대부터 봐!',
        },
        {
          kind: 'concept-card',
          title: 'HUD 두 줄 규칙',
          body: 'VPIP가 40 이상이면 루스, 22 이하면 타이트(니트)야. PFR이 VPIP의 60%를 넘으면 어그레시브고.',
        },
        {
          kind: 'concept-card',
          title: '유형 4종',
          body: '니트(타이트 패시브) · TAG(타이트 어그레시브) · 콜링 스테이션(루스 패시브) · 매니악(루스 어그레시브). 나는 스테이션이야, 헤헤.',
        },
        {
          kind: 'concept-card',
          title: '밸류벳은 상대가 정해',
          body: '스테이션한테 탑페어면 ¾ 팟으로 크게 받아 — 어차피 콜하니까. 빗나간 드로우(에어)는 체크야, 안 폴드하는 상대에게 블러프는 돈 버리기니까.',
        },
        {
          kind: 'concept-card',
          title: '씬 밸류',
          body: '상대가 콜할 더 나쁜 핸드가 있으면 벳이 밸류야. 그런 핸드가 없으면 체크하고 쇼다운을 보는 게 나아.',
        },
        {
          kind: 'guided',
          teacher: 'chloe',
          intro: '먼저 읽기 연습! 카피의 HUD를 볼게 — VPIP 66 · PFR 4. 이게 무슨 뜻일까?',
          situation: guidedSituation({
            heroPosition: 'BTN',
            potChips: 30,
            toCallChips: 0,
            villains: [{ seatIndex: 2, characterId: 'kapi', position: 'BB', stackChips: 2_000, rangeTag: 'VPIP 66 · PFR 4' }],
            note: '카피의 최근 200핸드 HUD',
          }),
          stages: [
            {
              prompt: 'VPIP 66은 40보다 크고, PFR 4는 66의 60%(약 40)에 한참 못 미쳐. 카피는 어떤 유형?',
              answer: { kind: 'multiple-choice', options: ['니트 (타이트 패시브)', 'TAG (타이트 어그레시브)', '콜링 스테이션 (루스 패시브)', '매니악 (루스 어그레시브)'], correctIndex: 2 },
              onCorrect: '딩동댕~ 루스 + 패시브 = 콜링 스테이션. 나랑 같은 부류야!',
              onWrong: '음~ VPIP 66은 루스, PFR이 낮으니까 패시브. 그래서 콜링 스테이션이야. 나랑 똑같지?',
            },
            {
              prompt: '그럼 카피한테는 어떻게 놀아야 할까?',
              answer: { kind: 'multiple-choice', options: ['블라인드를 넓게 스틸하고, 레이즈를 맞으면 폴드하기', '밸류는 크게 받고, 블러프는 하지 않기', '탑페어급으로 콜다운하고, 강한 핸드는 트랩', '포지션에서만 싸우고, 마지널 핸드는 피하기'], correctIndex: 1 },
              onCorrect: '그렇지! 안 폴드하는 애한테는 밸류 크게, 블러프 노! 이게 오늘의 전부야.',
              onWrong: '카피는 안 폴드해. 그러니까 블러프는 소용없고, 밸류벳을 크게 하는 게 답이야~',
            },
          ],
        },
        {
          kind: 'guided',
          teacher: 'chloe',
          intro: '이번엔 나랑! 네 핸드 A♥Q♦, 보드 Q♠9♣4♦7♥2♠ 리버. 플랍·턴 네가 벳하고 내가 콜했고, 리버에서 내가 체크했어.',
          situation: guidedSituation({
            hero: 'Ah Qd',
            board: 'Qs 9c 4d 7h 2s',
            heroPosition: 'BTN',
            potChips: 240,
            toCallChips: 0,
            villains: [{ seatIndex: 1, characterId: 'chloe', position: 'BB', stackChips: 1_880, rangeTag: '스테이션' }],
            note: '리버, 클로이가 체크. 팟 240',
          }),
          stages: [
            {
              prompt: '탑페어 탑키커야. 벳할까, 체크할까?',
              answer: { kind: 'multiple-choice', options: ['벳', '체크'], correctIndex: 0 },
              onCorrect: '맞아! 나는 Q 하나, 9 하나, 심지어 A하이로도 콜하거든. 체크는 돈을 두고 나오는 거야.',
              onWrong: '체크하면 내가 공짜로 쇼다운 보잖아~ 나는 더 나쁜 핸드로도 콜한다구. 벳!',
            },
            {
              prompt: '크기는? 팟이 240이야.',
              answer: { kind: 'multiple-choice', options: ['⅓ 팟 (80)', '¾ 팟 (180)'], correctIndex: 1 },
              onCorrect: '¾ 팟! 작게 벳해도 나는 똑같이 콜하는데, 너만 덜 받는 거잖아? Big value, let\'s go~!',
              onWrong: '80이든 180이든 나는 콜해. 그럼 180이 낫지? 스테이션한테는 크게!',
            },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────── 드릴 7문 (D-TYPE 3 · D-SIZE 2 · D-ACT 2)
    {
      kind: 'drill-set',
      id: 'act2-ch05:drills',
      title: '받아 내는 수련 문제',
      teacher: 'chloe',
      drills: [
        { templateId: 'type-from-hud', seedPolicy: 'per-run' },
        { templateId: 'size-river-value', seedPolicy: 'per-run' },
        { templateId: 'type-from-hud', seedPolicy: 'per-run' },
        { templateId: 'type-exploit', seedPolicy: 'per-run' },
        { templateId: 'size-river-value', seedPolicy: 'per-run' },
        { templateId: 'act-ch05-river-value', seedPolicy: 'fixed', fixedSeed: 0 },
        { templateId: 'act-ch05-river-air-check', seedPolicy: 'fixed', fixedSeed: 0 },
      ],
      hintPenalty: 0.5,
    },

    // ───────────────────────────────────────────── '연습' 프리셋 2핸드
    {
      kind: 'practice-table',
      id: 'act2-ch05:practice',
      tag: '연습',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'chloe', stackBB: 100, role: 'teacher' },
          { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 4, characterId: 'partner', stackBB: 100, role: 'partner' },
        ],
        difficulty: 'normal',
        turnTimeSec: 60,
        botThinkScale: 0.6,
        hints: 3,
      },
      scripts: [
        // ① A♥Q♦ + Q♠9♣4♦7♥2♠ — 클로이(좌석 1)는 Q♣8♦ 약한 탑페어로 끝까지 콜한다. 리버 큰 밸류벳 연습.
        { hero: 'Ah Qd', villains: { 1: 'Qc 8d' }, board: 'Qs 9c 4d 7h 2s' },
        // ② J♥T♥ + Q♥8♥3♣5♦2♠ — 플러시 드로우 미스. 클로이는 Q♦6♣ 탑페어. 리버 체크(블러프 금지) 연습.
        { hero: 'Jh Th', villains: { 1: 'Qd 6c' }, board: 'Qh 8h 3c 5d 2s' },
      ],
      perHandPrompt: '연습이야~ 첫 핸드는 A♥Q♦ — 리버까지 가면 크게 받아. 둘째 핸드는 J♥T♥ 드로우 — 빗나가면 체크! 나한테 블러프는 안 통해.',
    },

    // ───────────────────────────────────────────── 스파링 (미션형 · 최대 14핸드)
    {
      kind: 'sparring',
      id: 'act2-ch05:sparring',
      tag: '대결',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'chloe', stackBB: 100, role: 'teacher' },
          { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 3, characterId: 'yuzuki', stackBB: 100, role: 'neighbor' },
          { seatIndex: 4, characterId: 'partner', stackBB: 100, role: 'partner' },
        ],
        difficulty: 'normal',
        turnTimeSec: 60,
        botThinkScale: 0.6,
        hints: 3,
      },
      maxHands: 14,
      // 미션형: 리버 밸류벳 2회 + 에어 벳 ≤1 + 밸류 사이징 절반 이상을 채우면 6핸드부터 끝난다.
      minHands: 6,
      objectives: {
        primary: [
          { id: 'act2-ch05:value', kind: 'value-bet-river', label: '리버 탑페어+ 밸류벳 2번', target: 2 },
          { id: 'act2-ch05:no-air', kind: 'no-air-river-bet', label: '리버 에어 벳 1회 이하', maxCount: 1 },
          { id: 'act2-ch05:sizing', kind: 'value-bet-sizing', label: '밸류벳은 팟의 절반 이상', minRatio: 0.5, params: { minPct: 50 } },
        ],
        bonus: [
          { id: 'act2-ch05:showdown', kind: 'reach-showdown', label: '쇼다운 3번 보기', target: 3 },
          { id: 'act2-ch05:chips', kind: 'net-chips', label: '시작 스택 이상으로 끝내기', params: { minBB: 0 } },
        ],
      },
      interrupts: [
        {
          id: 'act2-ch05:int-first-turn',
          trigger: { kind: 'first-my-turn' },
          scene: {
            id: 'act2-ch05:int-first-turn',
            lines: [
              {
                kind: 'say',
                speaker: 'chloe',
                text: '네 차례야~ 상대가 누군지 먼저 봐. 나랑 카피는 안 폴드하고, 유즈키는 감으로 쳐. 그러니까 밸류는 크게!',
                expression: 'happy',
              },
              {
                kind: 'say',
                speaker: 'chloe',
                text: '그리고 빗나간 드로우로 리버 벳하지 마. 우리한텐 안 통해~ Never bluff a station!',
                expression: 'confident',
              },
            ],
          },
        },
        {
          id: 'act2-ch05:int-first-showdown',
          trigger: { kind: 'first-showdown' },
          scene: {
            id: 'act2-ch05:int-first-showdown',
            lines: [
              {
                kind: 'say',
                speaker: 'chloe',
                text: '오~ 쇼다운! 이겼든 졌든 상대 카드 봤지? 그게 HUD보다 확실한 정보야. 다음 핸드에 써먹어!',
                expression: 'happy',
                cg: 'act2-ch05-climax',
              },
            ],
          },
        },
      ],
    },

    // ───────────────────────────────────────────── 에필로그 (성장축: 「폴드하는 것도 배워 볼까」)
    {
      kind: 'scene',
      id: 'act2-ch05:epilogue',
      scene: {
        id: 'act2-ch05:epilogue',
        lines: [
          {
            kind: 'say',
            speaker: 'chloe',
            text: '끝~! 오늘 나한테서 칩 얼마나 뺏어갔어? …괜찮아, 나 원래 이래. 근데 받을 때 크게 받는 거 봤어. 그거면 합격!',
            expression: 'happy',
            bg: 'dojo-office',
            music: 'story-warm',
            cg: 'act2-ch05-epilogue',
          },
          {
            kind: 'say',
            speaker: 'chloe',
            text: '사실 방송 처음 시작했을 때, 채팅창에서 맨날 그랬거든. 「쟤 또 콜한다ㅋㅋ」. 근데 있잖아, 재밌으면 된 거 아냐?',
            expression: 'confident',
          },
          {
            kind: 'say',
            speaker: 'chloe',
            text: '…근데 가끔은, 폴드하는 것도 배워 볼까 생각해. 네가 오늘 벳하는 거 보니까.',
            expression: 'neutral',
            effect: 'zoom',
          },
          {
            kind: 'choice',
            choice: {
              id: 'reply',
              prompt: '클로이에게 —',
              options: [
                {
                  id: 'tease',
                  text: '「폴드하는 클로이는 상상이 안 돼요.」',
                  setFlags: { 'choice:act2-ch05:reply': 'tease' },
                  reply: [{
                    kind: 'say',
                    speaker: 'chloe',
                    text: '그치?! 나도! 헤헤, 그럼 안 폴드할래~ Never fold, never bored!',
                    expression: 'happy',
                  }],
                },
                {
                  id: 'fun',
                  text: '「그래도 오늘은 재밌었어요.」',
                  setFlags: { 'choice:act2-ch05:reply': 'fun' },
                  reply: [{
                    kind: 'say',
                    speaker: 'chloe',
                    text: '오마이갓, 그 말 완전 좋아. 다음에 또 놀자? 이번엔 진짜 방송 켜고!',
                    expression: 'surprised',
                  }],
                },
                {
                  id: 'thanks',
                  text: '「밸류벳 받아 줘서 고마워요.」',
                  setFlags: { 'choice:act2-ch05:reply': 'thanks' },
                  reply: [{
                    kind: 'say',
                    speaker: 'chloe',
                    text: '뭐야 그 인사~ 근데 좋다. 나한테 받은 칩으로 아라 수업 가서 3벳 해 봐. 걔가 뜨겁게 가르쳐 줄 거야.',
                    expression: 'confident',
                  }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'chloe',
            text: '아라의 3벳 수업엔 팽팽이 온대. 걔 진짜 차가워… 손 시릴지도 몰라~ 근데 재밌을 거야!',
            expression: 'happy',
          },
        ],
      },
    },

    { kind: 'result', id: 'act2-ch05:result' },
  ],
  rewards: {
    first: {
      dojoXpMilli: 200_000,
      affinity: [{ target: 'chloe', milli: 100_000 }],
      badgeId: 'story-value-artisan',
    },
    replay: { dojoXpMilli: 40_000 },
    gradeBonusMilli: { A: 40_000, S: 100_000 },
  },
};
