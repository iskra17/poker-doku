/**
 * D-SIZE 생성 템플릿 2종 — 벳 사이징.
 *
 * 규칙은 2막 Ch4·Ch5 개념 카드와 같은 두 줄뿐이다:
 * - **c벳 크기는 보드가 정한다**: 드라이(레인보우·연결 없음·페어 없음) → ⅓ 팟, 웻(같은 수트 2장+ 또는 연결) → ¾ 팟.
 * - **리버 밸류는 상대가 정한다**: 스테이션 상대 탑페어+ → ¾ 팟 큰 밸류, 미스 드로우(에어) → 체크(블러프 안 함).
 * 질감이 애매한 플랍(드라이도 웻도 아닌 중간)은 출제하지 않는다 — 리롤.
 */
import { evaluateHand } from '@/lib/poker/evaluator';
import { handRankOrder } from '@/lib/poker/learning';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { Card, Suit } from '@/lib/poker/types';
import type { DrillFacts, GeneratedDrillDefinition } from './kit';
import {
  STACK_BB,
  SUITS,
  TABLE_SIZE,
  cardOf,
  cardValue,
  characterName,
  formatBoard,
  makeSeatLayout,
  makeVillain,
  pickSupportCharacters,
  scaleChips,
  valueRange,
} from './kit';

export const SIZE_OPTIONS = ['체크', '⅓ 팟', '½ 팟', '¾ 팟'] as const;
const CBET_OPTIONS = ['⅓ 팟', '½ 팟', '¾ 팟'] as const;

/** 스테이션 조연 — Ch5 밸류벳 문항의 상대. 히로인(클로이)은 출제자라 상대로 쓰지 않는다(kit 규약). */
const STATION_IDS: readonly string[] = ['kapi'];

export type FlopTexture = 'dry' | 'wet';

/**
 * 플랍 질감. 드라이 = 레인보우 + 페어 없음 + 어떤 두 장도 랭크 차이 3 이상. 웻 = 같은 수트 2장 이상이면서 두 장이 연결(차이 ≤ 2).
 * 그 사이(레인보우 연결, 투톤 비연결)는 null — 출제하지 않는다.
 */
export function classifyFlop(board: readonly Card[]): FlopTexture | null {
  if (board.length !== 3) return null;
  const values = board.map(cardValue).sort((a, b) => a - b);
  const suits = new Set(board.map(card => card.suit));
  const paired = new Set(values).size < 3;
  const gaps = [values[1] - values[0], values[2] - values[1]];
  const connected = gaps.some(gap => gap <= 2);
  const rainbow = suits.size === 3;
  if (rainbow && !paired && gaps.every(gap => gap >= 3)) return 'dry';
  if (!rainbow && !paired && connected) return 'wet';
  return null;
}

function otherSuit(rng: () => number, exclude: readonly Suit[]): Suit {
  return pickOne(rng, SUITS.filter(suit => !exclude.includes(suit)));
}

/** 히어로 = 보드 최고 랭크와 페어(탑페어) + A/K 키커. 보드와 수트가 겹치지 않게 뽑아 플러시 드로우 오해를 막는다. */
function topPairHero(rng: () => number, board: readonly Card[]): Card[] | null {
  const top = [...board].sort((a, b) => cardValue(b) - cardValue(a))[0];
  const kickers = [14, 13].filter(value => value > cardValue(top) && !board.some(card => cardValue(card) === value));
  if (kickers.length === 0) return null;
  const kickerValue = pickOne(rng, kickers);
  const pairCard = cardOf(cardValue(top), otherSuit(rng, [top.suit]));
  const kicker = cardOf(kickerValue, otherSuit(rng, [pairCard.suit]));
  return [pairCard, kicker];
}

const cbetTexture: GeneratedDrillDefinition = {
  template: {
    id: 'size-cbet-texture',
    category: 'sizing',
    title: 'c벳은 얼마나?',
    difficulty: 2,
    hints: ['보드가 {texture}이에요. 드라이면 작게, 웻하면 크게 — 크기는 보드가 정해요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const ranks = shuffleWith(rng, valueRange(2, 14)).slice(0, 3);
    const suitPlan = pickOne(rng, ['rainbow', 'twotone'] as const);
    const suits = shuffleWith(rng, SUITS);
    const board = ranks.map((value, index) => cardOf(value, suitPlan === 'rainbow' ? suits[index] : suits[index === 2 ? 1 : 0]));
    const texture = classifyFlop(board);
    if (!texture) return null;
    const hero = topPairHero(rng, board);
    if (!hero) return null;
    if (handRankOrder(evaluateHand(hero, board).rank) !== handRankOrder('one-pair')) return null;

    const layout = makeSeatLayout(rng);
    const [villainId] = pickSupportCharacters(rng, 1);
    const villainName = characterName(villainId);
    const stackChips = STACK_BB * bigBlind;
    const heroSeat = pickOne(rng, valueRange(0, TABLE_SIZE - 1));
    const villainSeat = (heroSeat + 1 + Math.floor(rng() * (TABLE_SIZE - 1))) % TABLE_SIZE;
    const potChips = scaleChips(pickOne(rng, [130, 150, 170]), bigBlind);
    const size = texture === 'dry' ? '⅓ 팟' : '¾ 팟';
    const textureKo = texture === 'dry' ? '드라이' : '웻';

    return {
      situation: {
        hero,
        board,
        potChips,
        toCallChips: 0,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: layout.positions[heroSeat],
        street: 'flop',
        villains: [makeVillain(layout, villainSeat, villainId, { stackChips })],
        note: `내가 프리플랍 어그레서, ${villainName}와 헤즈업이에요. ${villainName}가 체크했어요.`,
      },
      question: `탑페어예요. 이 보드에서 c벳 크기는 얼마가 좋을까요?`,
      answerSpec: { kind: 'multiple-choice', options: [...CBET_OPTIONS], correctIndex: CBET_OPTIONS.indexOf(size) },
      facts: {
        board: formatBoard(board),
        texture: textureKo,
        size,
        villainName,
        reason: texture === 'dry' ? '상대가 맞춘 게 적어서 작은 벳으로도 폴드를 유도할 수 있어요' : '드로우가 많아서 크게 받아야 값을 나쁘게 만들어요',
      } satisfies DrillFacts,
    };
  },
};

/**
 * 리버 밸류벳 vs 스테이션 — 히어로가 탑페어+면 큰 밸류(¾ 팟), 미스 드로우(에어)면 체크.
 * 상대는 콜링 스테이션(카피 / 교사가 클로이가 아니면 클로이)이고 rangeTag '스테이션'을 단다.
 */
const riverValue: GeneratedDrillDefinition = {
  template: {
    id: 'size-river-value',
    category: 'sizing',
    title: '리버, 얼마나 받을까',
    difficulty: 2,
    hints: ['{villainName}는 스테이션이에요. 스테이션한테는 밸류는 크게, 블러프는 안 해요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const mode = pickOne(rng, ['value', 'air'] as const);
    const suit: Suit = pickOne(rng, SUITS);
    const others = SUITS.filter(candidate => candidate !== suit);
    const ranks = shuffleWith(rng, valueRange(2, 14));

    let hero: Card[];
    let board: Card[];
    if (mode === 'air') {
      // 미스 플러시 드로우: 홀카드 같은 수트 2장, 보드에 그 수트 2장, 랭크는 전부 다르다.
      hero = ranks.slice(0, 2).map(value => cardOf(value, suit));
      const boardRanks = ranks.slice(2, 7);
      board = shuffleWith(rng, [
        cardOf(boardRanks[0], suit), cardOf(boardRanks[1], suit),
        cardOf(boardRanks[2], others[0]), cardOf(boardRanks[3], others[1]), cardOf(boardRanks[4], others[2]),
      ]);
      if (handRankOrder(evaluateHand(hero, board).rank) >= handRankOrder('straight')) return null;
    } else {
      // 탑페어 + A/K 키커. 보드는 레인보우에 가깝게(플러시 없음), 보드 페어 없음.
      const boardRanks = ranks.slice(0, 5);
      const boardSuits = shuffleWith(rng, [...SUITS, ...SUITS]).slice(0, 5);
      board = boardRanks.map((value, index) => cardOf(value, boardSuits[index]));
      if (new Set(board.map(card => card.suit)).size < 3) return null;
      const top = [...board].sort((a, b) => cardValue(b) - cardValue(a))[0];
      const kickerValue = [14, 13].find(value => value > cardValue(top) && !boardRanks.includes(value));
      if (kickerValue === undefined) return null;
      hero = [cardOf(cardValue(top), otherSuit(rng, [top.suit])), cardOf(kickerValue, otherSuit(rng, []))];
      const order = handRankOrder(evaluateHand(hero, board).rank);
      if (order < handRankOrder('one-pair') || order >= handRankOrder('straight')) return null;
    }

    const villainId = pickOne(rng, STATION_IDS);
    const villainName = characterName(villainId);
    const layout = makeSeatLayout(rng);
    const stackChips = STACK_BB * bigBlind;
    const heroSeat = pickOne(rng, valueRange(0, TABLE_SIZE - 1));
    const villainSeat = (heroSeat + 1 + Math.floor(rng() * (TABLE_SIZE - 1))) % TABLE_SIZE;
    const potChips = scaleChips(pickOne(rng, [200, 240, 300]), bigBlind);
    const size = mode === 'value' ? '¾ 팟' : '체크';

    return {
      situation: {
        hero,
        board,
        potChips,
        toCallChips: 0,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: layout.positions[heroSeat],
        street: 'river',
        villains: [makeVillain(layout, villainSeat, villainId, { stackChips, rangeTag: '스테이션' })],
        note: `리버, ${villainName}(콜링 스테이션)가 체크했어요. ${mode === 'value' ? '내 핸드는 탑페어예요.' : '내 플러시 드로우는 빗나갔어요.'}`,
      },
      question: mode === 'value'
        ? `${villainName}가 체크했어요. 탑페어로 얼마나 벳할까요?`
        : `${villainName}가 체크했어요. 빗나간 드로우로 어떻게 할까요?`,
      answerSpec: { kind: 'multiple-choice', options: [...SIZE_OPTIONS], correctIndex: SIZE_OPTIONS.indexOf(size) },
      facts: {
        board: formatBoard(board),
        villainName,
        villainType: '스테이션',
        handKind: mode === 'value' ? '탑페어' : '에어(미스 드로우)',
        size,
        reason: mode === 'value' ? '스테이션은 약한 핸드로도 콜하니까 크게 받아요' : '폴드하지 않는 상대에게 블러프는 돈을 버리는 거예요',
      } satisfies DrillFacts,
    };
  },
};

export const SIZING_TEMPLATES: readonly GeneratedDrillDefinition[] = [cbetTexture, riverValue];
