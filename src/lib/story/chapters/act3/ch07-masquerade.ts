import type { Chapter, Scene } from '../../types';
import { STORY_CURRICULUM } from '../../curriculum';
const scene = (id: string, lines: string[]): Scene => ({ id, lines: lines.map(text => ({ kind: 'say', speaker: 'vivian', expression: 'confident', text })) });

export const CH07: Chapter = {
  id: 'act3-ch07', act: 3, order: 1, title: '가면무도회', subtitle: '관찰 · 상대 유형 · 대응', teacher: 'vivian', belt: 'blue', estimatedMinutes: 17,
  requires: [...STORY_CURRICULUM[2]],
  steps: [
    { kind: 'scene', id: 'ch07-intro', scene: scene('ch07-intro', [
      '어서 와요, 자기. 오늘 테이블에서는 얼굴보다 행동을 보아야 해요.',
      '가면 A부터 D까지. 누가 콜을 좋아하고, 누가 공격을 아끼는지 관찰해 보아요.',
      '열두 핸드는 짧은 표본이에요. 한 번의 블러프나 승리로 사람을 단정하면 안 되죠.',
      '네 질문을 모두 마치면 정체를 함께 공개할게요. 틀려도 다시 관찰할 기회는 있어요.',
    ]) },
    { kind: 'lesson', id: 'ch07-lesson', title: '가면 뒤의 습관', blocks: [
      { kind: 'concept-card', title: '표본을 먼저 봐요', body: '관찰 노트는 실제 참여·레이즈·콜 횟수예요. 열두 핸드만으로 정확한 빈도를 확정할 수는 없어요.' },
      { kind: 'concept-card', title: '네 가지 경향', body: '슈퍼 니트는 참여를 아끼고 ABC 정직파는 강할 때 주로 공격해요. 블러프 아티스트는 공격에 블러프를 섞고 콜링 스테이션은 넓게 콜해요.' },
      { kind: 'concept-card', title: '콜을 좋아하면 밸류', body: '콜링 스테이션과 헤즈업 리버에서 톱페어+이고 벳을 맞지 않았다면 밸류벳 기회예요. 에어 블러프와 구분해요.' },
      { kind: 'concept-card', title: '공격의 의미', body: '정직한 상대의 ⅓~¾팟 리버 벳에는 약한 핸드를 폴드해요. 블러프가 잦은 상대의 같은 크기 벳에는 톱페어+ 콜을 고려해요.' },
      { kind: 'concept-card', title: '측정하지 않는 상황', body: '다중 상대·오버벳·애매한 가격은 이번 점수에서 제외해요. 기회가 없으면 행동 목표는 미측정이지만 가면 퀴즈 네 문제는 꼭 마쳐야 해요.' },
    ] },
    { kind: 'drill-set', id: 'ch07-drills', title: '행동에서 읽는 단서', teacher: 'vivian', hintPenalty: 0.5, drills: [
      { templateId: 'type-from-hud', seedPolicy: 'per-run' }, { templateId: 'type-exploit', seedPolicy: 'per-run' },
      { templateId: 'type-from-hud', seedPolicy: 'per-run' }, { templateId: 'type-exploit', seedPolicy: 'per-run' },
      { templateId: 'type-from-hud', seedPolicy: 'per-run' },
      { templateId: 'act-ch05-river-value', seedPolicy: 'fixed', fixedSeed: 0 },
      { templateId: 'act-ch05-river-air-check', seedPolicy: 'fixed', fixedSeed: 0 },
    ] },
    { kind: 'sparring', id: 'ch07-masked-table', tag: '대결', maxHands: 22, minHands: 14,
      table: { blinds: { small: 10, big: 20 }, heroSeat: 0, heroStackBB: 100,
        lineup: [1,2,3,4].map(seatIndex => ({ seatIndex, characterId: 'story-mask', stackBB: 100 })),
        masquerade: { id: 'masquerade-v1', seats: [1,2,3,4], observeHands: 12, revealedMinHands: 2, revealedMaxHands: 10 },
        difficulty: 'normal', turnTimeSec: 60, botThinkScale: 0.6, hints: 3 },
      objectives: { primary: [
        { id: 'ch07-quiz', kind: 'quiz-accuracy', label: '가면 퀴즈 4문항을 마치고 3문항 이상 정답', minRatio: 0.75, params: { required: 4 } },
        { id: 'ch07-response', kind: 'opponent-response', label: '공개 후 상대 유형 대응 기회 중 좋은 결정 50% 이상', minRatio: 0.5 },
      ], bonus: [{ id: 'ch07-survive', kind: 'survive', label: '파산 없이 마무리' }] }, interrupts: [] },
    { kind: 'scene', id: 'ch07-epilogue', scene: scene('ch07-epilogue', [
      '가면을 벗기려면 칩 더미보다 선택을 봐야 하죠. 자기, 잘 관찰했어요.',
      '내가 웃고 있어도 항상 강한 핸드는 아니에요. 물론 그 반대도 마찬가지고요.',
      '오늘 배운 건 사람을 단정하는 법이 아니라, 새로운 행동을 보고 생각을 고치는 법이에요.',
    ]) },
    { kind: 'result', id: 'ch07-result' },
  ],
  failScene: scene('ch07-failure', ['괜찮아요, 자기. 가면은 한 번에 다 읽히지 않는 법이죠.', '정답과 관찰한 행동을 비교해 보아요. 다시 도전하면 가면의 자리는 새로 정해져요.', '칩을 땄는지는 중요하지 않아요. 네 질문과 실제 결정 기회를 차분히 살펴보아요.']),
  rewards: { first: { dojoXpMilli: 250_000, affinity: [{ target: 'vivian', milli: 100_000 }], badgeId: 'story-title-unmasker' },
    replay: { dojoXpMilli: 50_000 }, gradeBonusMilli: { A: 50_000, S: 120_000 } },
};
