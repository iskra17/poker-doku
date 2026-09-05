/**
 * 4막 수기 문항 (D-SNG) — Ch12 졸업 SnG의 8BB 푸시/폴드 두 문항.
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
import { rangeCombos, parseRange } from '@/lib/poker/range';
import { pushFoldEv } from '../../../sng-thresholds';
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

export const ACT4_AUTHORED_DRILLS: readonly DrillTemplate[] = Object.freeze<DrillTemplate[]>([
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
