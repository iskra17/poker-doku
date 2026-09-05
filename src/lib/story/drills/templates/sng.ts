/**
 * D-SNG 생성 템플릿 6종 — SnG의 "칩이 아니라 BB로 세는" 산술.
 *
 * 공통 스팟: 6-max SnG의 어느 시점, 프리플랍, 보드 없음. 블라인드는 실제 `SNG_BLIND_SCHEDULE`
 * 레벨에서 뽑고 `situation.bigBlind`가 그 레벨의 BB다 (`ctx.bigBlind`는 쓰지 않는다 —
 * 상황 카드의 `BB {bigBlind}` 표기가 곧 문제의 레벨이어야 한다).
 *
 * 표기 계약:
 * - `potChips` = SB + BB (+ 앤티 합) — 히어로가 액션하기 전 중앙에 있는 데드머니.
 * - `toCallChips` = 히어로가 블라인드 좌석이 아니면 BB, BB 좌석이면 0. note에 명시한다.
 * - 히어로 카드 두 장은 상황 카드를 채우기 위한 것이고 **정답과 무관**하다 (묻는 것은 스택·블라인드·인원).
 * - 앤티 변형은 **개인 앤티(매 핸드 각자 a칩)** 연습 가정이다 — 기본 게임의 BB 앤티 방식과 다르므로 note에 못박는다.
 *
 * 구간·EV 임계는 `src/lib/story/sng-thresholds.ts`가 단일 소스다 (Ch12 레슨이 같은 모듈을 인용).
 */
import { positionLabels } from '@/lib/poker/hand-history';
import { SNG_BLIND_SCHEDULE, SNG_PRIZE_SPLIT } from '@/lib/poker/blind-schedule';
import { pickOne, randomInt, shuffleWith } from '@/lib/poker/seeded-rng';
import { PUSH_FOLD_MAX_BB, SHORT_STACK_MAX_BB, STACK_ZONE_LABEL, STACK_ZONE_ORDER, stackZone } from '../../sng-thresholds';
import type { DrillSituation } from '../types';
import type { DrillFacts, GeneratedDrillDefinition, SeatLayout } from './kit';
import { drawCards, makeVillain, pickSupportCharacters, round1, valueRange } from './kit';

/** 레벨 인덱스는 여기까지만 출제한다 (그 위는 실전에서 거의 안 나오는 초고액 구간). */
const MAX_LEVEL_INDEX = 8;
/** 상금권 인원 — `SNG_PRIZE_SPLIT`(1~3위 50/30/20%)에서 파생한다. 테스트·Ch12 레슨이 같은 값을 본다. */
export const SNG_PAID_PLACES = SNG_PRIZE_SPLIT.length;
const PAID_PLACES = SNG_PAID_PLACES;
/** 상대 스택 후보 (100 단위). */
const VILLAIN_STACKS: readonly number[] = valueRange(4, 40).map(step => step * 100);

interface SngSpot {
  situation: DrillSituation;
  levelIndex: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  players: number;
  heroStack: number;
  heroPosition: string;
  /** 한 오르빗(= 남은 인원 핸드) 동안 자동으로 나가는 비용. */
  orbitCost: number;
}

/** 남은 인원 k명짜리 좌석 배치 — 6-max 고정인 `makeSeatLayout`과 달리 k에 맞는 포지션 라벨을 쓴다. */
function sngLayout(rng: () => number, players: number): SeatLayout {
  const dealerSeat = randomInt(rng, players);
  const labels = positionLabels(players);
  const positions: string[] = new Array<string>(players);
  for (let seat = 0; seat < players; seat++) {
    positions[seat] = labels[(seat - dealerSeat + players) % players];
  }
  return { dealerSeat, positions };
}

/** 앤티는 BB의 10~12.5% 정수 — 그 범위에 정수가 없으면 앤티 없는 변형으로 떨어진다. */
function anteFor(rng: () => number, bigBlind: number): number {
  const low = Math.ceil(bigBlind * 0.1);
  const high = Math.floor(bigBlind * 0.125);
  if (high < low) return 0;
  return low + randomInt(rng, high - low + 1);
}

interface SpotOptions {
  /** 남은 인원 후보 (기본 3~6). */
  playerChoices?: readonly number[];
  /** 앤티를 붙일지 — 미지정이면 앤티 없음. */
  withAnte?: boolean;
  /** 레벨 인덱스 상한 (기본 `MAX_LEVEL_INDEX`). */
  maxLevelIndex?: number;
  /** 히어로 스택 결정 — 레벨·오르빗 비용을 받고 정하지 못하면 null(리롤). */
  heroStack: (input: { smallBlind: number; bigBlind: number; ante: number; players: number; orbitCost: number; rng: () => number }) => number | null;
}

function buildSpot(rng: () => number, options: SpotOptions): SngSpot | null {
  const maxLevelIndex = options.maxLevelIndex ?? MAX_LEVEL_INDEX;
  const levelIndex = randomInt(rng, maxLevelIndex + 1);
  const { smallBlind, bigBlind } = SNG_BLIND_SCHEDULE[levelIndex];
  const players = pickOne(rng, options.playerChoices ?? [3, 4, 5, 6]);
  const ante = options.withAnte ? anteFor(rng, bigBlind) : 0;
  if (options.withAnte && ante <= 0) return null;

  const orbitCost = smallBlind + bigBlind + ante * players;
  const heroStack = options.heroStack({ smallBlind, bigBlind, ante, players, orbitCost, rng });
  if (heroStack === null || heroStack <= 0) return null;

  const layout = sngLayout(rng, players);
  const seats = shuffleWith(rng, valueRange(0, players - 1));
  // 히어로는 블라인드가 아닌 좌석 우선 — 콜 금액이 BB로 딱 떨어져 상황 카드가 단순해진다.
  const heroSeat = seats.find(seat => layout.positions[seat] !== 'SB' && layout.positions[seat] !== 'BB') ?? seats[0];
  const villainSeats = seats.filter(seat => seat !== heroSeat);
  const heroPosition = layout.positions[heroSeat];
  const toCallChips = heroPosition === 'BB' ? 0 : heroPosition === 'SB' ? bigBlind - smallBlind : bigBlind;

  const characterIds = pickSupportCharacters(rng, villainSeats.length);
  const villains = villainSeats.map((seat, index) =>
    makeVillain(layout, seat, characterIds[index], { stackChips: pickOne(rng, VILLAIN_STACKS) }),
  );

  const anteNote = ante > 0
    ? `앤티 ${ante} (연습 가정: 매 핸드 각자 ${ante}칩 앤티 — 개인 앤티 방식이라 기본 게임의 BB 앤티와 달라요)`
    : '앤티 없음';
  const callNote = toCallChips > 0 ? `콜 ${toCallChips}` : '콜 0 (BB 좌석이라 체크 가능)';

  return {
    levelIndex,
    smallBlind,
    bigBlind,
    ante,
    players,
    heroStack,
    heroPosition,
    orbitCost,
    situation: {
      hero: drawCards(rng, 2),
      board: [],
      potChips: smallBlind + bigBlind + ante * players,
      toCallChips,
      bigBlind,
      heroStackChips: heroStack,
      heroPosition,
      street: 'preflop',
      villains,
      note:
        `레벨 ${levelIndex + 1} (${smallBlind}/${bigBlind}), ${anteNote}, 남은 인원 ${players}/6, `
        + `상금은 ${PAID_PLACES}위까지, ${callNote}. 내 카드는 이 문제의 정답과 상관없어요.`,
    },
  };
}

function baseFacts(spot: SngSpot): DrillFacts {
  return {
    level: spot.levelIndex + 1,
    smallBlind: spot.smallBlind,
    bigBlind: spot.bigBlind,
    ante: spot.ante,
    players: spot.players,
    heroStack: spot.heroStack,
    paidPlaces: PAID_PLACES,
  };
}

// ---------------------------------------------------------------------------

const stackBb: GeneratedDrillDefinition = {
  template: {
    id: 'sng-stack-bb',
    category: 'sng-math',
    title: '내 스택은 몇 BB',
    difficulty: 1,
    hints: ['지금 레벨의 BB는 {bigBlind}이에요. 스택 {heroStack}을 그 값으로 나눠 보세요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng }) => {
    const spot = buildSpot(rng, {
      // 정확히 나눠떨어지는 4~40BB — "몇 BB인가"에 반올림 논쟁이 없어야 한다.
      heroStack: ({ bigBlind, rng: inner }) => bigBlind * (4 + randomInt(inner, 37)),
    });
    if (!spot) return null;
    const correct = spot.heroStack / spot.bigBlind;
    return {
      situation: spot.situation,
      question: `내 스택은 ${spot.heroStack}이고 지금 블라인드는 ${spot.smallBlind}/${spot.bigBlind}이에요. 내 스택은 몇 BB일까요?`,
      answerSpec: { kind: 'numeric', correct, tolerance: 1, unit: 'bb', min: 0, max: 200 },
      facts: { ...baseFacts(spot), stackBb: correct },
    };
  },
};

const mRatio: GeneratedDrillDefinition = {
  template: {
    id: 'sng-m-ratio',
    category: 'sng-math',
    title: 'M — 몇 오르빗 버티나',
    difficulty: 3,
    hints: ['한 오르빗 비용 {orbitCost}으로 스택 {heroStack}을 나눠 보세요 (SB + BB에, 앤티가 있으면 인원수만큼 더한 값이에요).'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng }) => {
    // 앤티 있는 변형을 절반보다 넉넉히 — M은 앤티가 붙었을 때 체감이 크다.
    const withAnte = rng() < 0.6;
    const spot = buildSpot(rng, {
      withAnte,
      heroStack: ({ orbitCost, rng: inner }) => {
        // M이 소수 첫째 자리로 떨어지도록 (스택은 정수 칩이어야 한다).
        const tenths = shuffleWith(inner, valueRange(25, 200)).find(value => (orbitCost * value) % 10 === 0);
        return tenths === undefined ? null : (orbitCost * tenths) / 10;
      },
    });
    if (!spot) return null;
    const exact = spot.heroStack / spot.orbitCost;
    const correct = round1(exact);
    return {
      situation: spot.situation,
      question:
        `남은 인원 ${spot.players}명, 블라인드 ${spot.smallBlind}/${spot.bigBlind}, `
        + `${spot.ante > 0 ? `앤티 각자 ${spot.ante}칩` : '앤티 없음'}. `
        + `내 스택 ${spot.heroStack}의 M은 얼마일까요?`,
      answerSpec: { kind: 'numeric', correct, tolerance: 0.5, unit: 'x', min: 0, max: 100 },
      facts: { ...baseFacts(spot), orbitCost: spot.orbitCost, m: correct, mExact: round1(exact) },
    };
  },
};

const nextLevelBb: GeneratedDrillDefinition = {
  template: {
    id: 'sng-next-level-bb',
    category: 'sng-math',
    title: '다음 레벨이면 몇 BB',
    difficulty: 2,
    hints: ['다음 레벨의 BB는 {nextBigBlind}이에요. 칩은 그대로고 나누는 수만 커져요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng }) => {
    const spot = buildSpot(rng, {
      // 마지막 레벨은 "다음 레벨"이 없다.
      maxLevelIndex: MAX_LEVEL_INDEX - 1,
      heroStack: ({ bigBlind, rng: inner }) => bigBlind * (6 + randomInt(inner, 35)),
    });
    if (!spot) return null;
    const next = SNG_BLIND_SCHEDULE[spot.levelIndex + 1];
    const currentBb = spot.heroStack / spot.bigBlind;
    const exact = spot.heroStack / next.bigBlind;
    const correct = Math.round(exact);
    // 반올림 정답이 둘로 갈리는 x.5는 내지 않는다.
    if (Math.abs(exact - correct) > 0.49) return null;
    return {
      situation: spot.situation,
      question:
        `지금은 레벨 ${spot.levelIndex + 1} (${spot.smallBlind}/${spot.bigBlind})이고, `
        + `다음 레벨은 ${next.smallBlind}/${next.bigBlind}이에요. `
        + `내 스택 ${spot.heroStack}은 다음 레벨에서 몇 BB가 될까요?`,
      answerSpec: { kind: 'numeric', correct, tolerance: 1, unit: 'bb', min: 0, max: 200 },
      facts: {
        ...baseFacts(spot),
        nextLevel: spot.levelIndex + 2,
        nextSmallBlind: next.smallBlind,
        nextBigBlind: next.bigBlind,
        currentBb: round1(currentBb),
        nextBb: correct,
        nextBbExact: round1(exact),
        dropBb: round1(currentBb - exact),
      },
    };
  },
};

const orbitCost: GeneratedDrillDefinition = {
  template: {
    id: 'sng-orbit-cost',
    category: 'sng-math',
    title: '한 오르빗에 나가는 칩',
    difficulty: 2,
    hints: ['남은 인원이 {players}명이면 한 오르빗은 {players}핸드예요. SB·BB는 각각 한 번씩 내요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng }) => {
    const withAnte = rng() < 0.6;
    const spot = buildSpot(rng, {
      withAnte,
      heroStack: ({ bigBlind, rng: inner }) => bigBlind * (8 + randomInt(inner, 33)),
    });
    if (!spot) return null;
    return {
      situation: spot.situation,
      question:
        `남은 인원 ${spot.players}명, 블라인드 ${spot.smallBlind}/${spot.bigBlind}, `
        + `${spot.ante > 0 ? `앤티 각자 ${spot.ante}칩` : '앤티 없음'}. `
        + '한 오르빗을 다 도는 동안 아무 핸드도 하지 않으면 몇 칩이 나갈까요?',
      answerSpec: { kind: 'numeric', correct: spot.orbitCost, tolerance: 0, unit: 'chips', min: 0, max: 100_000 },
      facts: { ...baseFacts(spot), orbitCost: spot.orbitCost },
    };
  },
};

/** 고정 4지선다 — 순서를 섞지 않는다(「이미 상금권」이 항상 마지막이라 읽기 쉽다). */
const ITM_OPTIONS: readonly string[] = ['1명', '2명', '3명', '이미 상금권'];

const itmDistance: GeneratedDrillDefinition = {
  template: {
    id: 'sng-itm-distance',
    category: 'sng-math',
    title: '상금권까지 몇 명',
    difficulty: 1,
    hints: ['상금은 {paidPlaces}위까지예요. 지금 {players}명이 남았고요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng }) => {
    const spot = buildSpot(rng, {
      heroStack: ({ bigBlind, rng: inner }) => bigBlind * (6 + randomInt(inner, 35)),
    });
    if (!spot) return null;
    const toBust = spot.players - PAID_PLACES;
    const answer = toBust <= 0 ? '이미 상금권' : `${toBust}명`;
    const correctIndex = ITM_OPTIONS.indexOf(answer);
    if (correctIndex < 0) return null;
    return {
      situation: spot.situation,
      question: `${spot.players}명이 남았고 상금은 ${PAID_PLACES}위까지예요. 상금권에 들려면 몇 명이 더 탈락해야 할까요?`,
      answerSpec: { kind: 'multiple-choice', options: [...ITM_OPTIONS], correctIndex },
      facts: { ...baseFacts(spot), toBust: Math.max(0, toBust), answer },
    };
  },
};

const zoneChoice: GeneratedDrillDefinition = {
  template: {
    id: 'sng-stack-zone',
    category: 'sng-math',
    title: '내 스택은 어느 구간',
    difficulty: 2,
    hints: ['스택 {heroStack} ÷ BB {bigBlind}부터 계산하세요. 구간은 그 BB 배수로 나눠요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng }) => {
    const spot = buildSpot(rng, {
      heroStack: ({ bigBlind, rng: inner }) => bigBlind * (4 + randomInt(inner, 37)),
    });
    if (!spot) return null;
    const bb = spot.heroStack / spot.bigBlind;
    // 경계 ±1BB는 "구간을 외웠는가"가 아니라 "경계를 어떻게 읽는가" 문제가 되므로 내지 않는다.
    if (Math.abs(bb - PUSH_FOLD_MAX_BB) <= 1 || Math.abs(bb - SHORT_STACK_MAX_BB) <= 1) return null;
    const zone = stackZone(bb);
    const options = STACK_ZONE_ORDER.map(key => STACK_ZONE_LABEL[key]);
    return {
      situation: spot.situation,
      question: `내 스택 ${spot.heroStack}, BB ${spot.bigBlind}이에요. 지금 내 스택은 어느 구간일까요?`,
      answerSpec: { kind: 'multiple-choice', options, correctIndex: STACK_ZONE_ORDER.indexOf(zone) },
      facts: {
        ...baseFacts(spot),
        stackBb: round1(bb),
        zone: STACK_ZONE_LABEL[zone],
        pushFoldMax: PUSH_FOLD_MAX_BB,
        shortMax: SHORT_STACK_MAX_BB,
      },
    };
  },
};

export const SNG_TEMPLATES: readonly GeneratedDrillDefinition[] = [
  stackBb,
  mRatio,
  nextLevelBb,
  orbitCost,
  itmDistance,
  zoneChoice,
];
