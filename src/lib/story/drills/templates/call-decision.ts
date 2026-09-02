/**
 * D-CALL 생성 템플릿 — 콜/폴드 + 이유 4지선다.
 *
 * "한 장 남은 상황(턴 → 리버)"으로 고정해 2·4의 법칙 없이 바로 비교하게 한다.
 * 정답은 뜰 확률(완전 열거 에퀴티) vs 필요 승률(팟오즈)이며, 두 값이 4%p 이내로 붙으면
 * "정답이 하나"라고 말할 수 없어 리롤한다.
 */
import { computePotOdds, estimateEquity } from '@/lib/poker/learning';
import { pickOne } from '@/lib/poker/seeded-rng';
import type { GeneratedDrillDefinition } from './kit';
import { STREET_KO, formatBoard, formatRatio, numParam, round1, scaleChips } from './kit';
import { buildDrawSpot, drawSpotSituation } from './outs';

/** (팟 총액, 콜) — bb=20 기준. 드로우 에퀴티(약 9~20%)의 위아래를 모두 덮도록 넓게 잡는다. */
const CALL_POT_PAIRS: readonly (readonly [number, number])[] = [
  [400, 50], [450, 50], [600, 50], [700, 50],
  [150, 50], [200, 100], [300, 100], [160, 40], [100, 100], [240, 60],
];

/** 이 아래로 붙으면 "확률이 필요 승률보다 높다/낮다"를 단정할 수 없다. */
const DECISION_MARGIN = 4;

const OPTIONS = [
  '콜 — 뜰 확률이 필요 승률보다 높아요',
  '콜 — 팟이 크니까요',
  '폴드 — 뜰 확률이 필요 승률보다 낮아요',
  '폴드 — 드로우는 원래 폴드예요',
];

const callDecision: GeneratedDrillDefinition = {
  template: {
    id: 'call-decision',
    category: 'call-decision',
    title: '콜? 폴드?',
    difficulty: 2,
    hints: ['뜰 확률과 필요 승률을 따로 구해서 비교해요. 팟은 {potChips}, 콜은 {toCallChips}이에요.'],
    source: { kind: 'generated', params: { maxOuts: 9 } },
  },
  build: ({ rng, bigBlind, params }) => {
    // 리버 한 장만 남은 상황으로 단순화 (2·4의 법칙 없이 바로 비교).
    const spot = buildDrawSpot(rng, { street: 'turn', maxOuts: numParam(params, 'maxOuts', 9) });
    if (!spot) return null;

    const [basePot, baseCall] = pickOne(rng, CALL_POT_PAIRS);
    const potChips = scaleChips(basePot, bigBlind);
    const toCallChips = scaleChips(baseCall, bigBlind);
    if (toCallChips <= 0 || toCallChips >= potChips) return null;

    const odds = computePotOdds(toCallChips, potChips);
    const equity = estimateEquity(spot.hero, spot.board, spot.villain).equity * 100;
    if (Math.abs(equity - odds.pct) < DECISION_MARGIN) return null;

    const call = equity >= odds.pct;
    const { situation, villainName } = drawSpotSituation(rng, spot, bigBlind, {
      potChips,
      toCallChips,
    });
    situation.note = `팟 ${potChips}에는 ${villainName}의 벳 ${toCallChips}이 포함돼 있어요. 카드도 공개된 상태예요.`;

    return {
      situation,
      question: `${villainName}가 턴에서 ${toCallChips}을 벳했어요. 리버 한 장이 남았어요. 콜할까요, 폴드할까요?`,
      answerSpec: { kind: 'multiple-choice', options: [...OPTIONS], correctIndex: call ? 0 : 2 },
      facts: {
        outs: spot.outs,
        unseen: spot.unseen,
        equity: round1(equity),
        requiredEquity: round1(odds.pct),
        potChips,
        toCallChips,
        potAfterCall: potChips + toCallChips,
        ratio: formatRatio(odds.ratio),
        decision: call ? '콜' : '폴드',
        drawName: spot.drawName,
        villainHand: spot.villainHandName,
        villainName,
        street: STREET_KO[spot.street],
        board: formatBoard(spot.board),
      },
    };
  },
};

export const CALL_DECISION_TEMPLATES: readonly GeneratedDrillDefinition[] = [callDecision];
