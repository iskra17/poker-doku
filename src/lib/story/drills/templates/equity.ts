/**
 * D-EQ 생성 템플릿 — 2·4의 법칙으로 어림한 뒤 정확한 승률을 맞힌다.
 *
 * 상황은 `outs.ts`의 드로우 스팟 생성기를 그대로 재사용한다(같은 구성 = 같은 학습 맥락).
 * 정확값은 `estimateEquity`의 **완전 열거**(플랍 990 · 턴 44) — 몬테카를로가 아니라
 * 결정론이라 같은 시드면 같은 정답이 나온다.
 */
import { estimateEquity, ruleOfTwoAndFour } from '@/lib/poker/learning';
import { pickOne } from '@/lib/poker/seeded-rng';
import type { GeneratedDrillDefinition } from './kit';
import { STREET_KO, formatBoard, numParam, round1 } from './kit';
import { buildDrawSpot, drawSpotSituation } from './outs';

const equityEstimate: GeneratedDrillDefinition = {
  template: {
    id: 'equity-estimate',
    category: 'equity',
    title: '2·4의 법칙',
    difficulty: 2,
    hints: ['아우츠에 {ruleMultiplier}를 곱하면 어림값이에요. 못 본 카드는 {unseen}장이고요.'],
    source: { kind: 'generated', params: { maxOuts: 9 } },
  },
  build: ({ rng, bigBlind, params }) => {
    const spot = buildDrawSpot(rng, { street: 'any', maxOuts: numParam(params, 'maxOuts', 9) });
    if (!spot) return null;

    const result = estimateEquity(spot.hero, spot.board, spot.villain);
    const exact = round1(result.equity * 100);
    const correct = Math.round(result.equity * 100);
    const rule24 = ruleOfTwoAndFour(spot.outs, spot.cardsToCome);

    const potChips = pickOne(rng, [8, 10, 12, 16]) * bigBlind;
    const { situation, villainName } = drawSpotSituation(rng, spot, bigBlind, {
      potChips,
      toCallChips: 0,
    });
    situation.note = `${villainName}의 카드는 공개돼 있어요.`;

    const remaining = spot.cardsToCome === 2 ? '리버까지 두 장' : '리버 한 장';
    return {
      situation,
      question: `${STREET_KO[spot.street]}이에요. ${remaining}이 남았어요. 2·4의 법칙으로 어림한 뒤, 내가 이길 확률(%)을 답해 주세요.`,
      answerSpec: { kind: 'numeric', correct, tolerance: 5, unit: '%', min: 0, max: 100 },
      facts: {
        outs: spot.outs,
        unseen: spot.unseen,
        cardsToCome: spot.cardsToCome,
        ruleMultiplier: spot.cardsToCome === 2 ? 4 : 2,
        rule24,
        exact,
        gap: round1(Math.abs(rule24 - exact)),
        drawName: spot.drawName,
        villainHand: spot.villainHandName,
        villainName,
        street: STREET_KO[spot.street],
        board: formatBoard(spot.board),
      },
    };
  },
};

export const EQUITY_TEMPLATES: readonly GeneratedDrillDefinition[] = [equityEstimate];
