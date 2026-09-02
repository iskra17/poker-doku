/**
 * 1막 Ch1 「도장의 문」 — 미야코 + 파트너 동행.
 * 개념: 핸드 랭킹 · 네 가지 액션 · 네 개의 스트리트 · 포지션 이름 (A5-1).
 *
 * 집필 규약:
 * - 전부 수기(AI 생성 금지). 미야코 호칭은 「수련생님」, 말끝에 ♪.
 * - 화자 'partner'는 런타임에 선택 파트너(히로인 6명 중 1명)로 해석된다 —
 *   6명 누구여도 어색하지 않게 종결어미를 피하고 체언·말줄임으로 쓴다(파트너별 변주는 Phase 2).
 * - 익명 닉을 직접 부르지 않는다(플레이스홀더 금지). 선택지는 정답이 없고 플래그만 남긴다.
 */
import type { Chapter } from '../../types';
import { guidedSituation, guidedStageSituation } from '../helpers';

export const CH01: Chapter = {
  id: 'act1-ch01',
  act: 1,
  order: 1,
  title: '도장의 문',
  subtitle: '룰 · 핸드 랭킹 · 자리 이름',
  teacher: 'miyako',
  belt: 'white',
  requires: [],
  estimatedMinutes: 12,
  steps: [
    // ───────────────────────────────────────────── 프롤로그
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
            music: 'story',
          },
          {
            kind: 'say',
            speaker: 'miyako',
            text: '이 도장에서는 칩을 따는 법보다 카드를 읽는 법을 먼저 배워요. 오늘 배울 건 네 가지 — 족보 순서, 네 가지 액션, 네 개의 스트리트, 그리고 자리 이름이에요.',
            expression: 'neutral',
            bg: 'dojo-table',
          },
          {
            kind: 'say',
            speaker: 'miyako',
            text: '그리고 첫날은 혼자 앉히지 않는 게 우리 도장 규칙이랍니다♪ 수련생님 옆자리에 앉아 줄 분을 소개할게요.',
            expression: 'happy',
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '…옆자리, 여기. 오늘은 같이 앉는 걸로.',
            expression: 'neutral',
          },
          {
            kind: 'choice',
            choice: {
              id: 'greet',
              prompt: '옆자리의 그 사람에게 —',
              options: [
                {
                  id: 'polite',
                  text: '「잘 부탁드립니다.」',
                  setFlags: { 'choice:act1-ch01:greet': 'polite' },
                  reply: [{ kind: 'say', speaker: 'partner', text: '…정중하네. 응, 이쪽도.', expression: 'neutral' }],
                },
                {
                  id: 'eager',
                  text: '「빨리 카드 만져보고 싶어요!」',
                  setFlags: { 'choice:act1-ch01:greet': 'eager' },
                  reply: [{ kind: 'say', speaker: 'partner', text: '의욕은 충분… 그럼 손목 힘 빼는 것부터.', expression: 'happy' }],
                },
                {
                  id: 'nervous',
                  text: '「사실… 좀 긴장돼요.」',
                  setFlags: { 'choice:act1-ch01:greet': 'nervous' },
                  reply: [{ kind: 'say', speaker: 'partner', text: '긴장은 당연한 거. 손, 여기 놓고 천천히.', expression: 'neutral' }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'miyako',
            text: '후후, 좋은 자리네요♪ 그럼 수련생님, 첫 수업을 시작할게요.',
            expression: 'happy',
          },
        ],
      },
    },

    // ───────────────────────────────────────────── 개념 카드 + 함께 풀기
    {
      kind: 'lesson',
      id: 'act1-ch01:lesson',
      title: '포커의 첫 네 가지',
      blocks: [
        {
          kind: 'text',
          speaker: 'miyako',
          text: '카드 네 장만 기억하면 돼요. 외우려 하지 마시고, 그냥 눈에 익히세요♪',
        },
        {
          kind: 'concept-card',
          title: '족보의 순서',
          body: '다섯 장으로 만든 족보의 높낮이를 겨루는 게임이에요. 로열 스트레이트 플러시 → 스트레이트 플러시 → 포카드 → 풀하우스 → 플러시 → 스트레이트 → 트리플 → 투페어 → 원페어 → 하이카드 순이랍니다.',
        },
        {
          kind: 'concept-card',
          title: '네 가지 액션',
          body: '낼 칩이 없으면 체크, 상대 벳에 맞추면 콜, 더 올리면 레이즈, 포기하면 폴드예요. 포커에서 할 수 있는 일은 이 넷이 전부랍니다.',
        },
        {
          kind: 'concept-card',
          title: '네 개의 스트리트',
          body: '홀카드 두 장을 받는 프리플랍 → 보드 세 장이 깔리는 플랍 → 한 장 더 놓는 턴 → 마지막 한 장 리버 순으로 흘러가요. 스트리트마다 베팅이 한 바퀴씩 돌아요.',
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

    // ───────────────────────────────────────────── 드릴 6문 (D-RANK 5 · D-POS 1)
    {
      kind: 'drill-set',
      id: 'act1-ch01:drills',
      title: '첫 수련 문제',
      teacher: 'miyako',
      drills: [
        { templateId: 'rank-who-wins', seedPolicy: 'per-run' },
        { templateId: 'rank-who-wins', seedPolicy: 'per-run' },
        { templateId: 'rank-best-hand', seedPolicy: 'per-run' },
        { templateId: 'rank-who-wins', seedPolicy: 'per-run' },
        { templateId: 'rank-best-hand', seedPolicy: 'per-run' },
        { templateId: 'pos-name', seedPolicy: 'per-run' },
      ],
      hintPenalty: 0.5,
    },

    // ───────────────────────────────────────────── '연습' 프리셋 2핸드
    {
      kind: 'practice-table',
      id: 'act1-ch01:practice',
      tag: '연습',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
          { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 3, characterId: 'choco', stackBB: 100, role: 'neighbor' },
        ],
        difficulty: 'easy',
        turnTimeSec: 90,
        botThinkScale: 0.6,
        hints: 1,
      },
      scripts: [
        // ① A♠K♠ on A♥K♦7♣2♦9♠ — 투페어(A·K) 밸류. 카피의 Q♥Q♦는 원페어에 그친다.
        { hero: 'As Ks', board: 'Ah Kd 7c 2d 9s', villains: { 2: 'Qh Qd' } },
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
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
          { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
          { seatIndex: 3, characterId: 'choco', stackBB: 100, role: 'neighbor' },
        ],
        difficulty: 'easy',
        turnTimeSec: 90,
        botThinkScale: 0.6,
        hints: 1,
      },
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
              },
              {
                kind: 'say',
                speaker: 'partner',
                text: '…이 순간이 제일 좋아. 카드가 전부 뒤집히는 순간.',
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
            music: 'story',
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '처음엔 다들 족보부터 헷갈려. 그런데 아까, 보드를 한 번 더 보고 나서 버튼을 눌렀지.',
            expression: 'neutral',
          },
          {
            kind: 'say',
            speaker: 'partner',
            text: '…그거, 꽤 어려운 거야. 오늘은 그거 하나만 기억해도 충분.',
            expression: 'confident',
          },
          {
            kind: 'choice',
            choice: {
              id: 'after',
              prompt: '첫 수련이 끝났다 —',
              options: [
                {
                  id: 'thanks',
                  text: '「옆에 있어 줘서 고마웠어요.」',
                  setFlags: { 'choice:act1-ch01:after': 'thanks' },
                  reply: [{ kind: 'say', speaker: 'partner', text: '…고맙다는 말, 이쪽이 할 말인데. 뭐, 됐어.', expression: 'happy' }],
                },
                {
                  id: 'more',
                  text: '「한 핸드 더 하고 싶어요.」',
                  setFlags: { 'choice:act1-ch01:after': 'more' },
                  reply: [{ kind: 'say', speaker: 'partner', text: '욕심 많네. …그런 사람이 늘긴 해.', expression: 'confident' }],
                },
                {
                  id: 'quiet',
                  text: '(말없이 카드를 정리한다)',
                  setFlags: { 'choice:act1-ch01:after': 'quiet' },
                  reply: [{ kind: 'say', speaker: 'partner', text: '…정리하는 손, 조심스럽네. 그런 거, 잘 보여.', expression: 'neutral' }],
                },
              ],
            },
          },
          {
            kind: 'say',
            speaker: 'miyako',
            text: '수고하셨어요, 수련생님♪ 오늘부터 백띠예요 — 도장의 문을 지나오셨다는 뜻이랍니다.',
            expression: 'happy',
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
      affinity: [{ target: 'partner', milli: 30_000 }],
      badgeId: 'story-white-belt',
    },
    replay: { dojoXpMilli: 20_000 },
    gradeBonusMilli: { A: 20_000, S: 50_000 },
  },
};
