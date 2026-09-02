/**
 * 1막 수기 문항 (D-ACT) — 생성기가 만들 수 없는 "최선의 액션 + 이유"를 사람이 쓴다.
 *
 * 계약:
 * - `source.kind: 'authored'` — 생성기를 타지 않고 instance를 그대로 쓴다(seed는 슬롯의 fixedSeed).
 * - 해설·힌트는 전부 수기(AI 금지). 출제자 말투는 담당 히로인(Ch2 = 사쿠라: 소심·말더듬·존댓말, 호칭 '당신').
 * - 백분위(facts.percentile)는 `hand-rankings.ts`의 `handPercentile`로 실측한 값이다
 *   (J♣7♦ 69.68% → 69.7 / A♦J♦ 2.56% → 2.6). 임계는 A7 ③의 포지션별 값(UTG 15 · BTN 35).
 */
import { parseCards } from '@/lib/poker/card-notation';
import type { DrillTemplate, DrillVillain } from '../../types';

const BIG_BLIND = 20;
const STACK = 2000;

function villains(entries: Array<[number, string, string]>): DrillVillain[] {
  return entries.map(([seatIndex, characterId, position]) => ({
    seatIndex,
    characterId,
    position,
    stackChips: STACK,
  }));
}

export const ACT1_AUTHORED_DRILLS: readonly DrillTemplate[] = Object.freeze([
  {
    id: 'act-ch02-fold-utg',
    category: 'action-judgment',
    title: 'UTG의 J♣7♦',
    difficulty: 1,
    hints: ['뒤에 아직 다섯 명이 남아 있어요. 그 다섯 명이 전부 나보다 좋은 핸드일 수도 있죠.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('Jc 7d'),
          board: [],
          potChips: 30,
          toCallChips: BIG_BLIND,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK,
          heroPosition: 'UTG',
          street: 'preflop',
          villains: villains([
            [1, 'mochi', 'HJ'],
            [2, 'choco', 'CO'],
            [3, 'kapi', 'BTN'],
            [4, 'luna', 'SB'],
            [5, 'gumi', 'BB'],
          ]),
          note: '언오픈 팟 — 아직 아무도 레이즈하지 않았어요.',
        },
        question: '가장 앞자리(UTG)입니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'raise'], correct: ['fold'] },
        hint: '뒤에 아직 다섯 명이 남아 있어요. 그 다섯 명이 전부 나보다 좋은 핸드일 수도 있죠.',
        explanation: {
          text:
            'J♣7♦는 상위 70% 근처… 강한 쪽 절반에도 못 드는 핸드예요. '
            + 'UTG 임계는 15%인데 한참 뒤에 있고, 뒤에는 다섯 명이나 남아 있어서요… '
            + '다, 당신이 여기서 폴드하는 건 지는 게 아니에요. 칩을 아끼는 거예요.',
          speaker: 'sakura',
          facts: { percentile: 69.7, threshold: 15 },
        },
      },
    },
  },
  {
    id: 'act-ch02-open-btn',
    category: 'action-judgment',
    title: 'BTN의 A♦J♦',
    difficulty: 1,
    hints: ['버튼은 마지막에 말하는 자리예요. 임계가 가장 넓은 자리이기도 하고요.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('Ad Jd'),
          board: [],
          potChips: 30,
          toCallChips: BIG_BLIND,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK,
          heroPosition: 'BTN',
          street: 'preflop',
          villains: villains([
            [1, 'luna', 'SB'],
            [2, 'gumi', 'BB'],
            [3, 'mochi', 'UTG'],
            [4, 'choco', 'HJ'],
            [5, 'kapi', 'CO'],
          ]),
          note: '앞자리는 모두 폴드 — 버튼까지 언오픈으로 넘어왔어요.',
        },
        question: '앞이 모두 폴드하고 버튼(BTN)까지 왔습니다. 최선의 액션은?',
        answerSpec: {
          kind: 'action-pick',
          options: ['fold', 'call', 'raise'],
          correct: ['raise'],
          sizingBB: { min: 2, max: 3 },
        },
        hint: '버튼은 마지막에 말하는 자리예요. 임계가 가장 넓은 자리이기도 하고요.',
        explanation: {
          text:
            'A♦J♦는 상위 3% 근처예요. BTN 임계 35% 안쪽이니까… 오, 오픈 레이즈가 맞아요. '
            + '크기는 2~3BB. 그냥 콜(림프)로 들어가면 팟도 못 키우고 주도권도 못 가져요 — '
            + '들어갈 거면 오픈 레이즈, 아니면 폴드예요 — 림프는 없어요.',
          speaker: 'sakura',
          facts: { percentile: 2.6, threshold: 35 },
        },
      },
    },
  },
]);
