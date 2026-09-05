import { STORY_CURRICULUM } from '../../curriculum';
import { HEROINE_FILL_SEAT, REVIEW_SLOT_TEMPLATE_ID, type Chapter, type Scene } from '../../types';

/**
 * Ch11 「종합 수련」 — 4막 2번, 교사는 선택 파트너.
 *
 * 드릴 여덟 문항은 전부 **동적 복습 슬롯**(`*review`)이다 — 내 복습 노트의 유형을 먼저 내고, 모자라면
 * 1~3막 생성 템플릿 풀에서 채운다(seed는 항상 새로 뽑아 같은 문제를 다시 내지 않는다).
 * 대결은 30핸드 고정이고, 통과 조건은 **실행 1회 + 체크리스트 5항목 중 3개**다. 카드가 만들어 주지 않은
 * 기회는 미측정으로 빠지므로 체크리스트 요구치도 판정 가능한 항목 수까지만 내려간다.
 *
 * 파트너 라인은 특정 히로인 말투를 가정하지 않는 중립 문장으로 쓴다(런타임에 누구든 될 수 있다).
 */
const partnerScene = (id: string, lines: string[]): Scene => ({
  id,
  lines: lines.map(text => ({ kind: 'say', speaker: 'partner', expression: 'happy', text })),
});

const hanaScene = (id: string, lines: string[]): Scene => ({
  id,
  lines: lines.map(text => ({ kind: 'say', speaker: 'hana', expression: 'neutral', text })),
});

/** 1~3막에서 배운 **생성** 템플릿 전부 — 동적 복습 슬롯의 후보 풀(수기 문항은 복습이 되지 않아 제외). */
export const CH11_REVIEW_POOL: readonly string[] = Object.freeze([
  'rank-best-hand', 'rank-nuts', 'rank-who-wins',
  'pos-first-to-act', 'pos-name',
  'range-open-decision', 'range-percentile',
  'outs-count',
  'odds-required-equity', 'odds-ratio-choice',
  'equity-estimate',
  'call-decision', 'call-river-range',
  'breakeven-fold-pct', 'breakeven-choice',
  'size-cbet-texture', 'size-river-value',
  'type-from-hud', 'type-exploit',
  'range-3bet-decision', 'range-vs-3bet',
  'combo-count', 'combo-blockers', 'combo-paired-board',
  'read-value-combos', 'read-bluff-combos', 'read-removed-combos',
  'nuts-unique-combo', 'nuts-blocked-combo',
]);

export const CH11: Chapter = {
  id: 'act4-ch11',
  act: 4,
  order: 2,
  title: '종합 수련',
  subtitle: '복습 · 실행 · 체크리스트',
  teacher: 'partner',
  belt: 'brown',
  requires: [...STORY_CURRICULUM[3]],
  estimatedMinutes: 28,
  steps: [
    { kind: 'scene', id: 'ch11-intro', scene: partnerScene('ch11-intro', [
      '오늘은 새로 배우는 게 없어요. 지금까지 한 걸 한자리에 놓고 보는 날이에요.',
      '문제는 여덟 개인데, 전부 당신이 틀렸던 유형에서 먼저 나와요. 부족한 게 없으면 그동안 배운 것 중에서 뽑고요.',
      '대결은 서른 핸드예요. 길게 앉아 있으면 좋은 습관도 나쁜 습관도 다 나오거든요.',
      '잘하려고 하지 말고, 하던 대로 해요. 오늘은 그걸 보러 온 거예요.',
    ]) },
    { kind: 'lesson', id: 'ch11-lesson', title: '오늘의 체크리스트', blocks: [
      { kind: 'concept-card', title: '다섯 가지 중 세 가지', body: '오늘의 통과 조건은 체크리스트예요. 하위 레인지로 들어가지 않기 · 림프하지 않기 · 어그레서일 때 c벳 · 리버 밸류벳 · 벳 대면 가격 결정. 이 다섯 중 세 개를 지키면 돼요. 전부 완벽할 필요는 없어요.' },
      { kind: 'concept-card', title: '기회가 없으면 미측정', body: '카드가 그 상황을 만들어 주지 않으면 그 항목은 점수에서 빠져요. 판정할 수 있는 항목이 세 개보다 적으면 요구치도 그만큼 내려가고요. 없는 기회를 억지로 만들면 오히려 다른 항목이 무너져요.' },
      { kind: 'concept-card', title: '실행은 한 번이라도', body: '따로 하나 더 있어요 — 오픈 레이즈·c벳·리버 밸류벳 중 기회가 왔을 때 최소 한 번은 실제로 걸어야 해요. 서른 핸드를 전부 폴드로 흘려보내면 안전해 보여도 배운 걸 쓰지 않은 거예요.' },
      { kind: 'concept-card', title: '레이즈는 레이즈여야 해요', body: '숏스택 올인이 현재 벳보다 작으면 그건 사실상 콜이에요. 실행으로 세는 건 테이블 벳을 넘기는 레이즈·올인뿐이에요.' },
      { kind: 'concept-card', title: '서른 핸드는 표본이에요', body: '한 판의 결과로 오늘을 판단하지 마세요. 결과가 아니라 결정을 봐요 — 진 핸드도 이유가 맞았으면 그대로 집계돼요.' },
    ] },
    { kind: 'drill-set', id: 'ch11-drills', title: '내 노트에서 나온 여덟 문제', teacher: 'partner', hintPenalty: 0.5,
      drills: Array.from({ length: 8 }, () => ({ templateId: REVIEW_SLOT_TEMPLATE_ID, seedPolicy: 'per-run' as const })),
      reviewPool: CH11_REVIEW_POOL },
    { kind: 'sparring', id: 'ch11-sparring', tag: '대결',
      table: {
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 100,
        lineup: [
          { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
          { seatIndex: 2, characterId: HEROINE_FILL_SEAT, stackBB: 100 },
          { seatIndex: 3, characterId: HEROINE_FILL_SEAT, stackBB: 100 },
          { seatIndex: 4, characterId: HEROINE_FILL_SEAT, stackBB: 100 },
          { seatIndex: 5, characterId: HEROINE_FILL_SEAT, stackBB: 100 },
        ],
        difficulty: 'normal',
        turnTimeSec: 60,
        botThinkScale: 0.6,
        hints: 2,
      },
      maxHands: 30,
      objectives: { primary: [
        { id: 'ch11-execute', kind: 'executed-any', label: '실제 오픈·c벳·밸류 기회 중 1회 이상 실행', target: 1 },
      ], bonus: [{ id: 'ch11-survive', kind: 'survive', label: '파산 없이 마무리' }] },
      checklist: {
        id: 'ch11-checklist',
        label: '체크리스트 3/5',
        k: 3,
        items: [
          { id: 'ch11-no-junk', kind: 'no-junk-entry', label: '하위 레인지로 참여 0회', maxCount: 0 },
          { id: 'ch11-no-limp', kind: 'no-limp', label: '림프 0회', maxCount: 0 },
          { id: 'ch11-cbet', kind: 'cbet-when-aggressor', label: '어그레서일 때 c벳 67% 이상', minRatio: 0.67 },
          { id: 'ch11-value', kind: 'value-bet-river', label: '리버 밸류벳 기회 중 67% 이상 실행', minRatio: 0.67 },
          { id: 'ch11-odds', kind: 'correct-pot-odds-call', label: '벳 대면 가격 결정 오답 2회 이하', maxCount: 2 },
        ],
      },
      interrupts: [] },
    { kind: 'scene', id: 'ch11-review', scene: hanaScene('ch11-review', [
      '수고하셨어요. 기록을 같이 볼까요? 저는 결과보다 어떤 자리에서 어떤 결정을 했는지를 봅니다.',
      '체크리스트는 세 개면 충분해요. 다섯 개를 전부 채우는 사람은 사실 거의 없거든요 — 카드가 기회를 다 주지 않으니까요.',
      '당신의 기록에서 가장 눈에 띄는 건 실행 쪽이에요. 기회가 왔을 때 실제로 걸었는지, 아니면 안전하게 흘려보냈는지.',
      '지금까지의 수련은 여기까지 왔어요. 남은 건 배운 걸 한 자리에서 끝까지 쓰는 일이고요.',
    ]) },
    { kind: 'scene', id: 'ch11-epilogue', scene: partnerScene('ch11-epilogue', [
      '어땠어요? 서른 핸드는 생각보다 길죠. 그래서 습관이 드러나는 거예요.',
      '오늘 당신은 배운 걸 꺼내서 썼어요. 그거면 이 수업의 목적은 다 한 거예요.',
      '다음엔 더 긴 자리가 기다리고 있어요. …그때도 옆에 앉아 있을게요.',
    ]) },
    { kind: 'result', id: 'ch11-result' },
  ],
  failScene: partnerScene('ch11-failure', [
    '괜찮아요. 서른 핸드 중 몇 자리가 어긋난 것뿐이에요.',
    '체크리스트를 다시 봐요. 다섯 개를 다 지키려다 오히려 무리한 자리가 있었는지, 아니면 기회를 흘려보냈는지.',
    '다시 하면 카드는 새로 깔려요. 이번엔 한 번이라도 먼저 걸어 봐요.',
  ]),
  rewards: {
    first: {
      dojoXpMilli: 350_000,
      affinity: [{ target: 'partner', milli: 100_000 }, { target: 'hana', milli: 20_000 }],
      badgeId: 'story-title-all-rounder',
    },
    replay: { dojoXpMilli: 50_000 },
    gradeBonusMilli: { A: 50_000, S: 120_000 },
  },
};
