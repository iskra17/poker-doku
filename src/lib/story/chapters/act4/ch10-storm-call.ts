import { STORY_CURRICULUM } from '../../curriculum';
import type { Chapter, LiveTableSpec, Scene } from '../../types';

/**
 * Ch10 「폭풍 속의 콜」 — 4막 1번, 교사 비비안.
 *
 * 배우는 것: ①MDF와 콜 필요 승률은 다른 숫자다 ②콜다운 조건(헤즈업·팟 이하 벳·홀카드 관여 톱페어+·
 * 이미 콜한 배럴) ③에어 리레이즈 금지 ④**이 챕터의 오버벳 가정은 폴라라이즈** — 원페어는 폴드,
 * 홀카드 관여 투페어+만 콜. 이 가정은 챕터 한정 채점 규약이고 `table.reviewPolicy`로 리뷰도 같은 규칙을 쓴다.
 * 문체는 Ch7과 같은 비비안(존댓말·「자기」·무대 은유).
 */
const scene = (id: string, lines: string[]): Scene => ({
  id,
  lines: lines.map(text => ({ kind: 'say', speaker: 'vivian', expression: 'confident', text })),
});

const table = (
  lineup: LiveTableSpec['lineup'],
  overrides: Partial<LiveTableSpec> = {},
): LiveTableSpec => ({
  blinds: { small: 10, big: 20 },
  heroSeat: 0,
  heroStackBB: 100,
  lineup,
  difficulty: 'normal',
  turnTimeSec: 60,
  botThinkScale: 0.6,
  hints: 3,
  ...overrides,
});

export const CH10: Chapter = {
  id: 'act4-ch10',
  act: 4,
  order: 1,
  title: '폭풍 속의 콜',
  subtitle: 'MDF · 콜다운 · 오버벳 대응',
  teacher: 'vivian',
  belt: 'brown',
  requires: [...STORY_CURRICULUM[3]],
  estimatedMinutes: 22,
  steps: [
    { kind: 'scene', id: 'ch10-intro', scene: scene('ch10-intro', [
      '어서 와요, 자기. 오늘 무대에는 비바람이 몰아쳐요. 벳이 세 번, 네 번 연달아 오는 밤이죠.',
      '그럴 때 사람들은 두 가지를 해요. 전부 믿고 폴드하거나, 화가 나서 다시 걸거나. 둘 다 대사가 아니에요.',
      '우리는 가격표를 봐요. 이 콜에 필요한 승률이 얼마인지, 그 레인지에 내가 이기는 조합이 몇 개인지.',
      '마지막 막에서는 팟보다 큰 벳도 만나요. 그때는 규칙이 하나 더 붙는답니다 — 오늘 같이 정해 두어요.',
    ]) },
    { kind: 'lesson', id: 'ch10-lesson', title: '가격표를 든 관객', blocks: [
      { kind: 'concept-card', title: 'MDF와 필요 승률은 다른 숫자', body: '레인지가 얼마나 방어해야 하는가(MDF)와 이 핸드로 콜할 때 필요한 승률은 서로 다른 값이에요. 팟 P에 벳 B면 MDF = P / (P + B), 콜 필요 승률 = B / (P + 2B)예요. 둘을 같은 칸에 적지 마세요.', formula: 'MDF = P / (P + B) · 필요 승률 = B / (P + 2B)' },
      { kind: 'concept-card', title: '콜다운의 네 조건', body: '헤즈업이고, 벳이 벳 전 팟을 넘지 않고, 내 스택이 콜보다 많고, 홀카드가 관여한 톱페어 이상이고, 이미 앞 스트리트에서 그 사람의 벳을 콜했다면 — 마지막 벳도 콜이 기본이에요. 앞에서 콜해 놓고 리버만 폴드하면 배럴이 늘 이겨요.' },
      { kind: 'concept-card', title: '에어로 다시 걸지 않기', body: '벳을 맞았을 때 톱페어도 스트레이트도 아니고 아우츠도 8장이 안 되면 레이즈는 대사가 없는 애드리브예요. 강한 드로우(8아우츠 이상)의 세미블러프는 예외예요.' },
      { kind: 'concept-card', title: '이 챕터의 오버벳 가정: 폴라라이즈', body: '벳이 벳 전 팟을 넘으면 상대 레인지를 아주 강한 밸류와 미스 드로우로 나눠 놓고 판단해요. 이 가정에서는 원페어를 폴드하고, 홀카드가 관여한 투페어 이상만 콜해요. 보드만 투페어에 키커만 얹은 핸드는 관여가 아니에요.' },
      { kind: 'concept-card', title: '기회가 없으면 미측정', body: '카드가 콜다운 자리를 만들어 주지 않으면 그 목표는 점수에서 빠져요. 실제로 온 기회만 세니까, 없는 자리를 억지로 만들지 마세요.' },
      { kind: 'guided', teacher: 'vivian', intro: '먼저 가격표부터 읽어 보아요, 자기. 리버에 팟 600, 벳 300이 왔어요.', situation: {
        hero: [{ rank: 'K', suit: 'hearts' }, { rank: 'Q', suit: 'spades' }],
        board: [
          { rank: 'K', suit: 'clubs' }, { rank: '9', suit: 'diamonds' }, { rank: '7', suit: 'spades' },
          { rank: '4', suit: 'hearts' }, { rank: '2', suit: 'clubs' },
        ],
        potChips: 900,
        toCallChips: 300,
        bigBlind: 20,
        heroStackChips: 2_400,
        heroPosition: 'BTN',
        street: 'river',
        villains: [{ seatIndex: 1, characterId: 'ingrid', position: 'BB', stackChips: 4_000 }],
        note: '벳 전 팟 600에 300 벳 — 중앙은 900, 콜은 300이에요.',
      }, stages: [
        {
          prompt: '이 콜에 필요한 승률은 몇 %일까요?',
          answer: { kind: 'numeric', correct: 25, tolerance: 1, unit: '%', min: 0, max: 100 },
          onCorrect: '맞아요. 300 ÷ (900 + 300) = 25%예요.',
          onWrong: '콜을 콜과 중앙 총액의 합으로 나눠요 — 300 ÷ (900 + 300)이에요.',
        },
        {
          prompt: '같은 벳에 대한 MDF(레인지가 방어해야 하는 비율)는 몇 %일까요?',
          answer: { kind: 'numeric', correct: 67, tolerance: 2, unit: '%', min: 0, max: 100 },
          onCorrect: '그렇죠. 600 ÷ (600 + 300) ≈ 67% — 필요 승률 25%와는 전혀 다른 숫자랍니다.',
          onWrong: '벳 전 팟을 벳 전 팟 + 벳으로 나눠요 — 600 ÷ (600 + 300)이에요. 필요 승률과 헷갈리지 마세요.',
        },
      ] },
    ] },
    { kind: 'drill-set', id: 'ch10-drills', title: '가격과 조합', teacher: 'vivian', hintPenalty: 0.5, drills: [
      { templateId: 'breakeven-fold-pct', seedPolicy: 'per-run' },
      { templateId: 'breakeven-choice', seedPolicy: 'per-run' },
      { templateId: 'mdf-defend-pct', seedPolicy: 'per-run' },
      { templateId: 'mdf-vs-call-equity', seedPolicy: 'per-run' },
      { templateId: 'call-decision', seedPolicy: 'per-run' },
      { templateId: 'call-river-range', seedPolicy: 'per-run' },
      { templateId: 'act-ch10-triple-barrel-call', seedPolicy: 'fixed', fixedSeed: 0 },
      { templateId: 'act-ch10-overbet-fold', seedPolicy: 'fixed', fixedSeed: 0 },
    ] },
    { kind: 'practice-table', id: 'ch10-calldown-practice', tag: '연습',
      table: table([{ seatIndex: 1, characterId: 'ingrid', stackBB: 100, role: 'neighbor' }]),
      scripts: [{ hero: 'Kh Qs', villains: { 1: 'Jh Td' }, board: 'Kc 9d 7s 4h 2c' }],
      perHandPrompt: '잉그리드는 배럴을 이어서 걸어요. 앞 스트리트를 콜해 두었고 벳이 팟을 넘지 않는다면, 톱페어로 마지막까지 콜해 보아요. 실제 액션이 다르면 현재 가격부터 다시 읽어요.' },
    { kind: 'practice-table', id: 'ch10-overbet-practice', tag: '연습',
      table: table([{ seatIndex: 1, characterId: 'draco', stackBB: 100, role: 'neighbor' }]),
      scripts: [{ hero: 'Ah 9s', villains: { 1: 'Kd Kh' }, board: 'Kc 9d 4s 2h 7c' }],
      perHandPrompt: '드라코가 팟을 넘는 벳을 걸면 폴라라이즈 가정으로 봐요. 두 번째 페어는 내려놓아요 — 홀카드가 관여한 투페어 이상만 콜해요.' },
    { kind: 'sparring', id: 'ch10-sparring', tag: '대결',
      table: table([
        { seatIndex: 1, characterId: 'ingrid', stackBB: 100, role: 'neighbor' },
        { seatIndex: 2, characterId: 'draco', stackBB: 100, role: 'neighbor' },
      ], { reviewPolicy: 'act4-overbet-v1' }),
      maxHands: 12, minHands: 6,
      objectives: { primary: [
        { id: 'ch10-calldown', kind: 'topair-calldown', label: '팟 이하 리버 벳에 홀카드 관여 톱페어+ 콜다운 2회 · 최종 실제 기회 한정', target: 2, finalOpportunityCap: true },
        { id: 'ch10-air', kind: 'no-air-reraise', label: '벳을 맞고 에어로 레이즈 0회 (8아우츠 이상 세미블러프는 예외)', maxCount: 0 },
      ], bonus: [{ id: 'ch10-survive', kind: 'survive', label: '파산 없이 마무리' }] },
      interrupts: [] },
    { kind: 'scene', id: 'ch10-analysis', scene: scene('ch10-analysis', [
      '좋아요, 자기. 배럴 앞에서 손이 떨리지 않았어요. 이제 무대를 좁혀 볼게요.',
      '다음은 저와 둘이서예요. 저는 팟보다 큰 벳을 즐겨요 — 아주 강하거나, 아무것도 없거나.',
      '원페어로 큰 숫자를 받아 주지 마세요. 대신 홀카드가 관여한 투페어 이상이면 물러서지 말고요.',
    ]) },
    { kind: 'sparring', id: 'ch10-boss', tag: '대결',
      table: table([{ seatIndex: 1, characterId: 'vivian', stackBB: 100, role: 'boss' }],
        { reviewPolicy: 'act4-overbet-v1' }),
      maxHands: 20,
      objectives: { primary: [
        { id: 'ch10-overbet', kind: 'overbet-decision', label: '팟을 넘는 오버벳 대면에서 폴라라이즈 가정의 정답 50% 이상 (기회 없으면 미측정)', minRatio: 0.5 },
        { id: 'ch10-air-hu', kind: 'no-air-reraise', label: '헤즈업에서도 에어 리레이즈 0회', maxCount: 0 },
      ], bonus: [
        { id: 'ch10-hu-chips', kind: 'net-chips', label: '헤즈업을 본전 이상으로 마무리', target: 0, params: { bb: 20 } },
      ] },
      interrupts: [] },
    { kind: 'scene', id: 'ch10-epilogue', scene: scene('ch10-epilogue', [
      '비바람이 지나갔네요, 자기. 오늘 자기는 큰 숫자에 반응하지 않고 가격을 봤어요.',
      '무대에서 제일 어려운 건 크게 말하는 게 아니라, 크게 말하는 사람 앞에서 조용히 있는 거예요.',
      '다음에도 제 오버벳을 받아 줄 건가요? …그 대답은 카드가 정하게 두죠. 오늘은 여기까지예요.',
    ]) },
    { kind: 'result', id: 'ch10-result' },
  ],
  failScene: scene('ch10-failure', [
    '괜찮아요, 자기. 폭풍 속에서 대사를 놓치는 밤도 있는 법이죠.',
    '배럴을 맞은 자리와 오버벳을 맞은 자리를 나눠서 다시 보아요. 앞에서 콜했다면 리버도 같은 이유로 콜이에요.',
    '다시 하면 카드는 새로 깔려요. 지난 패를 외우지 말고, 이번 가격표를 읽어요.',
  ]),
  rewards: {
    first: { dojoXpMilli: 300_000, affinity: [{ target: 'vivian', milli: 100_000 }], badgeId: 'story-title-storm-caller' },
    replay: { dojoXpMilli: 50_000 },
    gradeBonusMilli: { A: 50_000, S: 120_000 },
  },
};
