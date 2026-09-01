/**
 * 드릴 해설 문장 생성 — **풀이 본문**(정답 도출 과정)을 교사 말투로 만든다.
 *
 * 계약:
 * - 정답/오답 공통 본문이다. 정답 칭찬 한 줄·오답 위로는 코디네이터가 앞에 붙인다.
 * - 숫자는 전부 `facts`에서만 온다 — 여기서 다시 계산하지 않는다(채점과 해설이 갈리는 사고 방지).
 * - AI 미사용. 말투 3종(미야코·사쿠라·하나)은 지금 구현하고, 나머지 히로인은 중립 존댓말 폴백
 *   (Phase 2에서 캐릭터별 확장 — 폴백도 반드시 '~요' 존댓말을 유지한다).
 */
import type { StoryTeacherId } from '../types';
import type { DrillFacts } from './templates/kit';
import type { DrillExplanation } from './types';

type CoreBuilder = (facts: DrillFacts) => string[];

function has(facts: DrillFacts, ...keys: string[]): boolean {
  return keys.every(key => facts[key] !== undefined && facts[key] !== null && facts[key] !== '');
}

function v(facts: DrillFacts, key: string): string {
  const value = facts[key];
  return value === undefined || value === null ? '?' : String(value);
}

// ---------------------------------------------------------------------------
// 템플릿별 풀이 본문

const oddsCore: CoreBuilder = f => [
  `팟 ${v(f, 'potChips')}에는 ${v(f, 'villainName')}의 벳 ${v(f, 'villainBet')}이 이미 포함돼 있어요.`,
  `콜하면 팟이 ${v(f, 'potChips')} + ${v(f, 'toCallChips')} = ${v(f, 'potAfterCall')}이 되니까, ` +
    `필요 승률은 ${v(f, 'toCallChips')} ÷ ${v(f, 'potAfterCall')} = ${v(f, 'requiredEquity')}%예요.`,
  `팟오즈로 읽으면 ${v(f, 'ratio')}이에요.`,
];

const CORES: Readonly<Record<string, CoreBuilder | undefined>> = Object.freeze({
  'rank-who-wins': f => [
    `보드는 ${v(f, 'board')}이고, 각자 홀카드 두 장을 더해 가장 좋은 다섯 장을 만들어요.`,
    `내 최고 조합은 ${v(f, 'heroHand')}, ${v(f, 'villain1Name')}의 최고 조합은 ${v(f, 'villain1Hand')}, ` +
      `${v(f, 'villain2Name')}의 최고 조합은 ${v(f, 'villain2Hand')}예요.`,
    `그래서 이 팟의 승자는 ${v(f, 'winner')}예요.`,
  ],
  'rank-best-hand': f => [
    `내 카드 ${v(f, 'hero')}와 보드 ${v(f, 'board')}, 일곱 장에서 다섯 장을 고르는 문제예요.`,
    `가장 좋은 다섯 장은 ${v(f, 'hand')} 조합이에요.`,
  ],
  'rank-nuts': f => [
    `보드 ${v(f, 'board')}에 남은 카드로 두 장을 고르는 ${v(f, 'combos')}가지를 전부 맞춰 봐요.`,
    `그중 최강, 그러니까 이 보드의 넛츠는 ${v(f, 'nuts')} 조합이에요.`,
  ],
  'pos-name': f => [
    `딜러 버튼이 ${v(f, 'dealerSeatNo')}번 자리니까, 그 다음이 SB, 그 다음이 BB예요.`,
    `${v(f, 'heroSeatNo')}번인 내 자리는 버튼에서 ${v(f, 'offset')}칸 뒤, 그러니까 ${v(f, 'position')} 자리예요.`,
    `${v(f, 'position')}에서는 프리플랍에 뒤로 ${v(f, 'seatsAfter')}명이 남아 있어요.`,
  ],
  'pos-first-to-act': f => [
    f.street === '프리플랍'
      ? 'SB와 BB는 이미 돈을 냈으니, 프리플랍은 그 다음 자리인 UTG부터 시작해요.'
      : '플랍부터는 버튼 왼쪽인 SB부터 시작하고, 버튼이 마지막에 말해요.',
    `그래서 ${v(f, 'street')}의 첫 액션은 ${v(f, 'first')}예요.`,
  ],
  'range-open-decision': f => [
    `${v(f, 'hand')}는 169가지 시작 핸드 중 상위 ${v(f, 'pct')}% 정도예요.`,
    `${v(f, 'position')} 오픈 기준은 상위 ${v(f, 'threshold')}%, 뒤에는 아직 ${v(f, 'seatsAfter')}명이 남아 있고요.`,
    `${v(f, 'pct')}%와 ${v(f, 'threshold')}%를 견주면 ${v(f, 'decision')} 쪽이에요.`,
  ],
  'range-percentile': f => [
    'AA가 0%에 가깝고 72o가 100%에 가까운 눈금이에요.',
    `${v(f, 'hand')}는 그 눈금에서 상위 ${v(f, 'pct')}% 자리고요.`,
  ],
  'outs-count': f => [
    `내 손은 ${v(f, 'drawName')}, ${v(f, 'villainName')}는 ${v(f, 'villainHand')}예요.`,
    `못 본 카드가 ${v(f, 'unseen')}장인데, 그중 나를 앞서게 하는 카드는 ${v(f, 'outs')}장이에요.`,
    `${v(f, 'outs')} ÷ ${v(f, 'unseen')} ≈ ${v(f, 'pct')}%가 다음 한 장으로 이길 확률이고요.`,
  ],
  'odds-required-equity': oddsCore,
  'odds-ratio-choice': oddsCore,
  'equity-estimate': f => [
    `${v(f, 'drawName')}라서 아우츠는 ${v(f, 'outs')}장이에요.`,
    `2·4의 법칙으로는 ${v(f, 'outs')} × ${v(f, 'ruleMultiplier')} = ${v(f, 'rule24')}% 정도로 어림돼요.`,
    `남은 카드를 전부 돌려 본 정확한 승률은 ${v(f, 'exact')}% — 어림값과 ${v(f, 'gap')}%p 차이예요.`,
  ],
  'call-decision': f => [
    `필요 승률은 ${v(f, 'toCallChips')} ÷ (${v(f, 'potChips')} + ${v(f, 'toCallChips')}) = ${v(f, 'requiredEquity')}%예요.`,
    `내 아우츠는 ${v(f, 'outs')}장, 리버 한 장으로 이길 확률은 ${v(f, 'equity')}%고요.`,
    `${v(f, 'equity')}%와 ${v(f, 'requiredEquity')}%를 견주면 여기서는 ${v(f, 'decision')} 하는 게 맞아요.`,
  ],
});

/** 템플릿별 필수 facts — 하나라도 없으면 숫자가 '?'로 새므로 일반 문장으로 물러선다. */
const REQUIRED_FACTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'rank-who-wins': ['board', 'heroHand', 'villain1Name', 'villain1Hand', 'villain2Name', 'villain2Hand', 'winner'],
  'rank-best-hand': ['hero', 'board', 'hand'],
  'rank-nuts': ['board', 'combos', 'nuts'],
  'pos-name': ['dealerSeatNo', 'heroSeatNo', 'offset', 'position', 'seatsAfter'],
  'pos-first-to-act': ['street', 'first'],
  'range-open-decision': ['hand', 'pct', 'position', 'threshold', 'seatsAfter', 'decision'],
  'range-percentile': ['hand', 'pct'],
  'outs-count': ['drawName', 'villainName', 'villainHand', 'unseen', 'outs', 'pct'],
  'odds-required-equity': ['potChips', 'villainName', 'villainBet', 'toCallChips', 'potAfterCall', 'requiredEquity', 'ratio'],
  'odds-ratio-choice': ['potChips', 'villainName', 'villainBet', 'toCallChips', 'potAfterCall', 'requiredEquity', 'ratio'],
  'equity-estimate': ['drawName', 'outs', 'ruleMultiplier', 'rule24', 'exact', 'gap'],
  'call-decision': ['toCallChips', 'potChips', 'requiredEquity', 'outs', 'equity', 'decision'],
});

function genericCore(facts: DrillFacts): string[] {
  const numbers = Object.entries(facts)
    .filter(([, value]) => typeof value === 'number')
    .map(([, value]) => String(value));
  return numbers.length > 0
    ? [`이 문제의 핵심 수치는 ${numbers.join(', ')}예요.`, '숫자를 순서대로 놓고 보면 답이 보여요.']
    : ['상황을 순서대로 놓고 보면 답이 보여요.'];
}

// ---------------------------------------------------------------------------
// 교사 말투

/**
 * 말투는 캐릭터 모듈(`src/lib/characters/index.ts`)의 기존 대사 톤을 따른다.
 * - 미야코: 진행자 존댓말 + 「~답니다♪」
 * - 사쿠라: 소심한 존댓말, 말더듬, 호칭 '당신'
 * - 하나  : 분석가 존댓말, 건조한 정리 + 호칭 '당신'
 */
function speak(teacher: StoryTeacherId, sentences: readonly string[]): string {
  const body = sentences.join(' ');
  switch (teacher) {
    case 'miyako':
      return `${body} 이렇게 하나씩 짚어 보면 어렵지 않답니다♪`;
    case 'sakura':
      return `아, 저기… ${body} 조, 조금만 천천히 보면… 당신도 금방 익숙해질 거예요…`;
    case 'hana':
      return `정리해 볼게요. ${body} …당신, 이런 계산은 이제 익숙해졌네요.`;
    default:
      // ara / chloe / vivian / elena — Phase 2에서 캐릭터별로 확장한다.
      return `${body} 여기까지가 이 문제의 풀이예요.`;
  }
}

// ---------------------------------------------------------------------------

export function buildExplanation(
  templateId: string,
  facts: DrillFacts,
  teacher: StoryTeacherId,
): DrillExplanation {
  const core = CORES[templateId];
  const required = REQUIRED_FACTS[templateId] ?? [];
  const sentences = core && has(facts, ...required) ? core(facts) : genericCore(facts);
  return { text: speak(teacher, sentences), speaker: teacher, facts: { ...facts } };
}

/** 힌트/문항 문구의 `{key}` 자리에 facts를 끼워 넣는다 (없는 키는 그대로 둔다). */
export function fillFacts(text: string, facts: DrillFacts): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(facts, key) ? String(facts[key]) : match,
  );
}
