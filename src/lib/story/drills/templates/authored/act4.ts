/**
 * 4막 수기 문항 — Ch10 리버 대면 두 문항(D-ACT)과 Ch12 졸업 SnG의 8BB 푸시/폴드 두 문항(D-SNG).
 *
 * 계약은 1~3막(`act1.ts`·`act2.ts`·`act3.ts`)과 같다: `source.kind: 'authored'`, 시드 무시,
 * 해설·힌트 전부 수기(AI 금지). 화자 tone은 Ch12 진행자 미야코 기준이고, 실행 시 speaker만 교사로 바뀐다.
 *
 * **캐시 프리플랍 임계(`open-thresholds.ts`)를 재사용하지 않는다.** 여기서 정답을 정하는 것은
 * "상위 몇 % 레인지인가"가 아니라 **명시된 콜 가정에서 나온 칩 EV의 부호**뿐이다.
 *
 * 근사 계약(문항 note에 그대로 적혀 있다):
 * - 폴드와 8BB 올인만 비교한다(일반 레이즈는 선택지에 없다). **칩 EV 기준, ICM 무시**.
 * - 각 좌석은 표시된 레인지로만 콜하고, 첫 콜러가 나오면 뒤에서 추가 콜은 없다.
 * - 좌석끼리의 카드 상관과 앞선 폴드가 주는 카드 정보는 무시하고 콜 확률을 독립으로 곱한다.
 * - 콜러는 전부 히어로 1,600을 커버한다(모든 상대 스택 ≥1,700).
 *
 * 콜 확률은 `rangeCombos(parseRange(range), hero).length / C(50,2)`로 통일한다("상위 X%" 표기 금지 —
 * 두 레인지는 각각 1326콤보 기준 10.86%·13.73%지만, 히어로 카드를 뺀 **라이브** 기준으로는 9.88%·14.45%다).
 *
 * **에퀴티는 실측값이다** — `estimateEquity(hero, [], parseRange(range), { samples: 100_000, rng: mulberry32(20260906) })`:
 * - A♠7♦ vs `77+, A9s+, KTs+, QJs, ATo+, KQo` → **0.33824** (라이브 콜 콤보 121/1225)
 * - 9♠4♦ vs `66+, A7s+, K9s+, QTs+, JTs, ATo+, KJo+` → **0.276075** (라이브 콜 콤보 177/1225)
 * 나머지(콜 확률·전원 폴드 확률·EV)는 모듈 로드 시 `pushFoldEv`로 파생하고, `r4-templates.test.ts`가
 * 같은 방법으로 재계산해 ±2%p·EV 부호·해설 문장의 숫자까지 고정한다.
 */
import { parseCards } from '@/lib/poker/card-notation';
import { computePotOdds, estimateEquity } from '@/lib/poker/learning';
import { rangeCombos, parseRange } from '@/lib/poker/range';
import { pushFoldEv } from '../../../sng-thresholds';
import { readRangeFacts } from '../../range-facts';
import type { DrillTemplate, DrillVillain } from '../../types';
import { round1 } from '../kit';

const SMALL_BLIND = 100;
const BIG_BLIND = 200;
/** 전원 폴드하면 가져오는 데드머니. */
const BLINDS_TOTAL = SMALL_BLIND + BIG_BLIND;
/** 히어로 유효 스택 = 8BB. 모든 상대가 이 스택을 커버한다. */
const HERO_STACK = 1600;
/** 히어로 두 장을 뺀 상대 홀카드 조합 수 — 콜 확률의 분모. */
const LIVE_COMBOS = (50 * 49) / 2;

/** 에퀴티 실측 조건 — 테스트가 같은 값으로 재계산한다. */
export const ACT4_EQUITY_SEED = 20_260_906;
export const ACT4_EQUITY_SAMPLES = 100_000;

export interface PushFoldInput {
  templateId: string;
  /** 히어로 홀카드 표기 */
  hero: string;
  /** 모든 좌석 공통 콜 레인지 (`parseRange` 표기) */
  range: string;
  /** 실측 에퀴티 (0~1) */
  equity: number;
  /** 히어로 뒤 액션 순서대로의 "이 좌석이 첫 콜러일 때 팟". */
  pots: readonly number[];
}

/**
 * 콜러별 팟 = 히어로 올인 1,600 × 2 + **콜하지 않은 블라인드**.
 * BB가 콜하면 SB 100이 데드 → 3,300 · SB가 콜하면 BB 200이 데드 → 3,400 ·
 * 비블라인드가 콜하면 블라인드 300이 전부 데드 → 3,500.
 */
export const ACT4_PUSH_FOLD_INPUTS: readonly PushFoldInput[] = Object.freeze<PushFoldInput[]>([
  {
    templateId: 'act-ch12-push-btn-8bb',
    hero: 'As 7d',
    range: '77+, A9s+, KTs+, QJs, ATo+, KQo',
    equity: 0.33824,
    pots: [3400, 3300], // SB → BB
  },
  {
    templateId: 'act-ch12-fold-utg-8bb',
    hero: '9s 4d',
    range: '66+, A7s+, K9s+, QTs+, JTs, ATo+, KJo+',
    equity: 0.276075,
    pots: [3500, 3500, 3500, 3400, 3300], // HJ → CO → BTN → SB → BB
  },
]);

export interface PushFoldFacts {
  range: string;
  /** 한 좌석의 콜 확률 % */
  callProbability: number;
  /** 전원 폴드 확률 % */
  pFoldAll: number;
  /** 콜을 맞았을 때 히어로 승률 % */
  equityIfCalled: number;
  /** 올인의 칩 EV (폴드 0 기준) */
  evPush: number;
}

/** 명시 가정 → facts. 해설 문장의 숫자는 전부 여기서 나온 값과 같아야 한다(테스트가 대조). */
export function pushFoldFacts(input: PushFoldInput): PushFoldFacts {
  const callProb = rangeCombos(parseRange(input.range), parseCards(input.hero)).length / LIVE_COMBOS;
  const result = pushFoldEv({
    heroStack: HERO_STACK,
    blindsTotal: BLINDS_TOTAL,
    callers: input.pots.map(potIfCalls => ({ callProb, potIfCalls })),
    equity: input.equity,
  });
  return {
    range: input.range,
    callProbability: round1(callProb * 100),
    pFoldAll: round1(result.pFoldAll * 100),
    equityIfCalled: round1(input.equity * 100),
    evPush: Math.round(result.evPush),
  };
}

const BTN_FACTS = pushFoldFacts(ACT4_PUSH_FOLD_INPUTS[0]);
const UTG_FACTS = pushFoldFacts(ACT4_PUSH_FOLD_INPUTS[1]);

const ASSUMPTIONS =
  '연습 가정 — 폴드와 8BB 올인만 비교(칩 EV 기준, ICM 무시), 표시된 레인지로만 콜하고 첫 콜러 뒤에는 추가 콜 없음, '
  + '좌석끼리의 카드 상관과 앞선 폴드가 주는 카드 정보는 무시, 상대는 모두 내 1,600을 커버.';

function villain(seatIndex: number, characterId: string, position: string, stackChips: number, range?: string): DrillVillain {
  return { seatIndex, characterId, position, stackChips, ...(range ? { range } : {}) };
}

// ---------------------------------------------------------------------------
// Ch10 — 리버 대면 두 문항 (D-ACT)
//
// 정답은 "상대의 진짜 패"가 아니라 **문항에 적힌 벳 레인지 가정**에서 나온다.
// 콤보는 `readRangeFacts`(내 카드·보드만 제거), 승률은 `estimateEquity`가 리버 보드에서
// 남은 콤보를 **완전 열거**한 값이다(무작위 없음). 필요 승률은 `computePotOdds`와 같은 정의 —
// 팟은 **상대 벳을 포함한 중앙 총액**이고 필요 승률 = 콜 / (팟 + 콜)이다.
// `r4-templates.test.ts`가 같은 방법으로 재계산해 아래 숫자와 해설 문장을 고정한다.

export interface RiverRangeInput {
  templateId: string;
  hero: string;
  board: string;
  /** 벳 레인지 가정 — 밸류와 블러프는 겹치지 않는다(`readRangeFacts`가 검증) */
  valueRange: string;
  bluffRange: string;
  /** 상대 벳을 포함한 리버 중앙 총액 */
  potChips: number;
  /** 콜에 내야 하는 금액 */
  toCallChips: number;
}

export const ACT4_RIVER_INPUTS: readonly RiverRangeInput[] = Object.freeze<RiverRangeInput[]>([
  {
    templateId: 'act-ch10-triple-barrel-call',
    hero: 'Kh Qs',
    board: 'Kc 9d 7s 4h 2c',
    valueRange: 'KJ+, 99, 77, 44',
    bluffRange: 'QJs, JTs, T8s',
    potChips: 900,
    toCallChips: 300,
  },
  {
    templateId: 'act-ch10-overbet-fold',
    hero: 'Ah 9s',
    board: 'Kc 9d 4s 2h 7c',
    valueRange: 'K9s, K9o, K7s, K7o, 99, 77, 44, 22',
    bluffRange: 'QJs, JTs, T8s',
    potChips: 1_800,
    toCallChips: 1_200,
  },
]);

export interface RiverRangeFacts {
  valueCombos: number;
  bluffCombos: number;
  /** 밸류 + 블러프 */
  combos: number;
  /** 그 레인지 대비 히어로 승률 % */
  equity: number;
  /** 콜 필요 승률 % */
  requiredEquity: number;
}

export function riverRangeFacts(input: RiverRangeInput): RiverRangeFacts {
  const hero = parseCards(input.hero);
  const board = parseCards(input.board);
  const range = `${input.valueRange}, ${input.bluffRange}`;
  const counted = readRangeFacts({ range, valueRange: input.valueRange, bluffRange: input.bluffRange, hero, board });
  const equity = estimateEquity(hero, board, parseRange(range)).equity;
  return {
    valueCombos: counted.valueCombos,
    bluffCombos: counted.bluffCombos,
    combos: counted.valueCombos + counted.bluffCombos,
    equity: round1(equity * 100),
    requiredEquity: round1(computePotOdds(input.toCallChips, input.potChips).pct),
  };
}

const CALL_FACTS = riverRangeFacts(ACT4_RIVER_INPUTS[0]);
const OVERBET_FACTS = riverRangeFacts(ACT4_RIVER_INPUTS[1]);

/** 리버 가정 문구 — 두 문항이 같은 규약을 쓴다(상대의 실제 패는 공개하지 않는다). */
function riverNote(input: RiverRangeInput, line: string): string {
  return `${line} 벳 레인지 가정 — 밸류 ${input.valueRange} · 미스 드로우 블러프 ${input.bluffRange}. `
    + '가정 밖 조합은 없다고 보고 계산해요. 상대의 실제 패는 공개하지 않아요.';
}

function riverVillain(characterId: string, input: RiverRangeInput): DrillVillain {
  return { seatIndex: 1, characterId, position: 'BB', stackChips: 4_000, range: `${input.valueRange}, ${input.bluffRange}` };
}

export const ACT4_AUTHORED_DRILLS: readonly DrillTemplate[] = Object.freeze<DrillTemplate[]>([
  {
    id: 'act-ch10-triple-barrel-call',
    category: 'action-judgment',
    title: '3배럴 끝의 톱페어',
    difficulty: 3,
    hints: ['필요 승률을 먼저 구하고, 가정한 레인지에서 내가 이기는 조합을 세어 보아요.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards(ACT4_RIVER_INPUTS[0].hero),
          board: parseCards(ACT4_RIVER_INPUTS[0].board),
          potChips: ACT4_RIVER_INPUTS[0].potChips,
          toCallChips: ACT4_RIVER_INPUTS[0].toCallChips,
          bigBlind: 20,
          heroStackChips: 2_400,
          heroPosition: 'BTN',
          street: 'river',
          villains: [riverVillain('ingrid', ACT4_RIVER_INPUTS[0])],
          note: riverNote(
            ACT4_RIVER_INPUTS[0],
            '프리플랍 팟 120에서 잉그리드가 플랍 60(½팟)·턴 180(¾팟)을 벳하고 내가 둘 다 콜했어요. '
            + '리버 시작 팟 600에 300(½팟) 벳 — 중앙은 900, 콜은 300이에요.',
          ),
        },
        question: '헤즈업 리버, 톱페어로 3배럴의 마지막 벳을 맞았어요. 가정한 레인지와 가격으로만 볼 때 폴드·콜·레이즈 중 무엇일까요?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'call', 'raise'], correct: ['call'] },
        hint: '필요 승률을 먼저 구하고, 가정한 레인지에서 내가 이기는 조합을 세어 보아요.',
        explanation: {
          text:
            `필요 승률은 300 ÷ (900 + 300) = ${CALL_FACTS.requiredEquity}%예요. `
            + `가정한 벳 레인지는 밸류 ${CALL_FACTS.valueCombos}콤보 + 미스 드로우 ${CALL_FACTS.bluffCombos}콤보 = ${CALL_FACTS.combos}콤보죠. `
            + `K♥Q♠는 블러프를 전부 이기고 KJ에도 앞서며 KQ와는 무승부라 승률이 ${CALL_FACTS.equity}%예요. `
            + `${CALL_FACTS.requiredEquity}%만 있으면 되는 자리니까 콜이 편하게 맞아요. `
            + '레이즈는 아니에요 — 톱페어는 밸류로 다시 걸 만큼 세지 않고, 콜해 주는 건 나보다 강한 조합뿐이거든요. '
            + '벳이 세 번 왔다고 늘 강한 건 아니에요, 자기. 3막을 크게 연기하는 미스 드로우도 레인지에 남아 있답니다.',
          speaker: 'vivian',
          facts: { ...CALL_FACTS },
        },
      },
    },
  },
  {
    id: 'act-ch10-overbet-fold',
    category: 'action-judgment',
    title: '팟을 넘는 오버벳',
    difficulty: 3,
    hints: ['오버벳은 필요 승률을 크게 올려요. 원페어가 이기는 조합이 그만큼 되는지 세어 보아요.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards(ACT4_RIVER_INPUTS[1].hero),
          board: parseCards(ACT4_RIVER_INPUTS[1].board),
          potChips: ACT4_RIVER_INPUTS[1].potChips,
          toCallChips: ACT4_RIVER_INPUTS[1].toCallChips,
          bigBlind: 20,
          heroStackChips: 3_000,
          heroPosition: 'BTN',
          street: 'river',
          villains: [riverVillain('draco', ACT4_RIVER_INPUTS[1])],
          note: riverNote(
            ACT4_RIVER_INPUTS[1],
            '리버 시작 팟 600에 드라코가 1,200(2배 팟) 오버벳 — 중앙은 1,800, 콜은 1,200이에요.',
          ),
        },
        question: '헤즈업 리버, 두 번째 페어로 2배 팟 오버벳을 맞았어요. 가정한 레인지와 가격으로만 볼 때 폴드와 콜 중 무엇일까요?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'call'], correct: ['fold'] },
        hint: '오버벳은 필요 승률을 크게 올려요. 원페어가 이기는 조합이 그만큼 되는지 세어 보아요.',
        explanation: {
          text:
            `팟을 넘는 벳이라 필요 승률이 1,200 ÷ (1,800 + 1,200) = ${OVERBET_FACTS.requiredEquity}%까지 올라가요. `
            + `가정한 오버벳 레인지는 투페어+ 밸류 ${OVERBET_FACTS.valueCombos}콤보 + 미스 드로우 ${OVERBET_FACTS.bluffCombos}콤보 = ${OVERBET_FACTS.combos}콤보죠. `
            + `A♥9♠는 블러프에만 이기니까 승률은 ${OVERBET_FACTS.equity}%뿐 — ${OVERBET_FACTS.requiredEquity}%에 한참 못 미쳐요. 폴드예요. `
            + '폴라라이즈된 오버벳 앞에서는 원페어를 내려놓고, 홀카드가 관여한 투페어 이상만 콜해요. '
            + '큰 숫자를 보면 궁금해지죠. 하지만 무대에서 목소리를 키우는 쪽이 늘 강한 건 아니랍니다, 자기.',
          speaker: 'vivian',
          facts: { ...OVERBET_FACTS },
        },
      },
    },
  },
  {
    id: 'act-ch12-push-btn-8bb',
    category: 'sng-math',
    title: 'BTN 8BB, A♠7♦',
    difficulty: 3,
    hints: ['전원이 폴드할 확률부터 세어 보세요. 남은 사람이 둘뿐이면 그 확률이 꽤 높아요.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'sng-math',
        situation: {
          hero: parseCards('As 7d'),
          board: [],
          potChips: BLINDS_TOTAL,
          toCallChips: BIG_BLIND,
          bigBlind: BIG_BLIND,
          heroStackChips: HERO_STACK,
          heroPosition: 'BTN',
          street: 'preflop',
          villains: [
            villain(1, 'mochi', 'SB', 2400, BTN_FACTS.range),
            villain(2, 'luna', 'BB', 3000, BTN_FACTS.range),
            villain(3, 'choco', 'UTG', 2100),
            villain(4, 'kapi', 'HJ', 1800),
            villain(5, 'draco', 'CO', 2700),
          ],
          note: `블라인드 ${SMALL_BLIND}/${BIG_BLIND}(앤티 없음), 앞자리 셋은 전부 폴드. ${ASSUMPTIONS}`,
        },
        question: '앞이 모두 폴드했고 BTN, 내 스택은 8BB예요. 명시된 콜 가정과 칩 EV로만 계산할 때 폴드와 올인 중 무엇이 맞을까요?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'all-in'], correct: ['all-in'] },
        hint: '전원이 폴드할 확률부터 세어 보세요. 남은 사람이 둘뿐이면 그 확률이 꽤 높아요.',
        explanation: {
          text:
            '앞이 전부 폴드했으니 남은 건 SB와 BB 둘이에요. 두 사람이 표시된 레인지로만 콜한다고 보면 각자 콜 확률은 9.9%, '
            + '둘 다 폴드할 확률은 81.2%예요. 그때는 블라인드 300을 그대로 가져와요. '
            + '콜을 맞으면 A♠7♦의 승률은 33.8%인데, 팟이 3,300~3,400이라 그 갈래만 보면 손해예요. '
            + '두 갈래를 콜 확률로 가중해 더하면 올인의 칩 EV는 +156, 폴드는 0이니까 답은 올인이에요. '
            + '다만 이건 칩 EV만 본 계산이라, 실제 SnG의 상금 구조(ICM)를 넣으면 답이 달라질 수 있답니다.',
          speaker: 'miyako',
          facts: { ...BTN_FACTS },
        },
      },
    },
  },
  {
    id: 'act-ch12-fold-utg-8bb',
    category: 'sng-math',
    title: 'UTG 8BB, 9♠4♦',
    difficulty: 3,
    hints: ['같은 8BB라도 뒤에 남은 사람이 다섯이에요. 전원이 폴드할 확률이 얼마나 남을까요.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'sng-math',
        situation: {
          hero: parseCards('9s 4d'),
          board: [],
          potChips: BLINDS_TOTAL,
          toCallChips: BIG_BLIND,
          bigBlind: BIG_BLIND,
          heroStackChips: HERO_STACK,
          heroPosition: 'UTG',
          street: 'preflop',
          villains: [
            villain(1, 'choco', 'HJ', 2000, UTG_FACTS.range),
            villain(2, 'kapi', 'CO', 2600, UTG_FACTS.range),
            villain(3, 'draco', 'BTN', 1900, UTG_FACTS.range),
            villain(4, 'mochi', 'SB', 2400, UTG_FACTS.range),
            villain(5, 'luna', 'BB', 3000, UTG_FACTS.range),
          ],
          note: `블라인드 ${SMALL_BLIND}/${BIG_BLIND}(앤티 없음), 내가 첫 액션(UTG). ${ASSUMPTIONS}`,
        },
        question: 'UTG에서 첫 액션이고 내 스택은 8BB예요. 명시된 콜 가정과 칩 EV로만 계산할 때 폴드와 올인 중 무엇이 맞을까요?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'all-in'], correct: ['fold'] },
        hint: '같은 8BB라도 뒤에 남은 사람이 다섯이에요. 전원이 폴드할 확률이 얼마나 남을까요.',
        explanation: {
          text:
            'UTG라 뒤에 다섯 명이 남아 있어요. 각자 콜 확률이 14.4%면 다섯 명이 모두 폴드할 확률은 45.8%까지 내려가요. '
            + '콜을 맞았을 때 9♠4♦의 승률은 27.6%뿐이고, 팟이 3,300~3,500이어도 걸어 놓은 1,600을 되찾지 못해요. '
            + '두 갈래를 더하면 올인의 칩 EV는 −213이라 폴드(0)보다 나쁜 선택이에요. '
            + '같은 8BB라도 자리가 다르면 답이 뒤집힌답니다 — 뒤에 남은 사람 수가 곧 폴드 확률이니까요. '
            + '이 계산도 칩 EV 기준이라 ICM은 넣지 않았어요.',
          speaker: 'miyako',
          facts: { ...UTG_FACTS },
        },
      },
    },
  },
]);
