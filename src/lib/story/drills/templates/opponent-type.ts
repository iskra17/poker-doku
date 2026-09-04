/**
 * D-TYPE 반생성 템플릿 2종 — HUD로 상대 유형 읽기 · 유형별 착취.
 *
 * 스탯은 `personalities.ts`의 **실제 봇 HUD**(16명)에서 온다 — 문제에서 배운 숫자가 그대로 스파링 상대의
 * 실제 성향이다. 분류 규칙은 Ch5 개념 카드와 같은 두 줄:
 *   ① VPIP 40 이상 = 루스, 22 이하 = 타이트(니트)   ② PFR이 VPIP의 60% 이상 = 어그레시브
 * → 니트(록) / TAG / 콜링 스테이션(루스 패시브) / 매니악(루스 어그레시브). 두 규칙으로 갈리지 않는 봇
 * (중간 VPIP + 패시브 — 루나·유즈키)은 출제하지 않는다. 히로인 6명은 출제자라 상대로 쓰지 않는다(kit 규약) —
 * 남는 풀은 모찌·잉그리드(니트) / 초코·구미·팽팽·린(TAG) / 카피(스테이션) / 드라코(매니악).
 */
import { BOT_PERSONALITIES } from '@/lib/bot/personalities';
import { isStoryHeroineId } from '../../types';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { DrillFacts, GeneratedDrillDefinition } from './kit';
import { STACK_BB, TABLE_SIZE, characterName, makeChoice, makeSeatLayout, makeVillain, valueRange } from './kit';

export type OpponentType = 'nit' | 'tag' | 'station' | 'maniac';

export const OPPONENT_TYPE_LABEL: Readonly<Record<OpponentType, string>> = Object.freeze({
  nit: '니트 (타이트 패시브)',
  tag: 'TAG (타이트 어그레시브)',
  station: '콜링 스테이션 (루스 패시브)',
  maniac: '매니악 (루스 어그레시브)',
});

export const OPPONENT_EXPLOIT: Readonly<Record<OpponentType, string>> = Object.freeze({
  nit: '블라인드를 넓게 스틸하고, 레이즈를 맞으면 폴드하기',
  tag: '포지션에서만 싸우고, 마지널 핸드는 피하기',
  station: '밸류는 크게 받고, 블러프는 하지 않기',
  maniac: '탑페어급으로 콜다운하고, 강한 핸드는 트랩',
});

export const LOOSE_VPIP = 40;
export const TIGHT_VPIP = 22;
export const AGGRESSIVE_PFR_RATIO = 0.6;

/** HUD 두 수치로 유형을 가른다. 규칙 밖(중간 VPIP + 패시브)이면 null. */
export function classifyHud(vpip: number, pfr: number): OpponentType | null {
  const aggressive = pfr >= vpip * AGGRESSIVE_PFR_RATIO;
  if (vpip <= TIGHT_VPIP) return 'nit';
  if (vpip >= LOOSE_VPIP) return aggressive ? 'maniac' : 'station';
  return aggressive ? 'tag' : null;
}

interface HudBot {
  id: string;
  vpip: number;
  pfr: number;
  threeBet: number;
  wtsd: number;
  type: OpponentType;
}

/** 분류 가능한 봇만 — 결정론(객체 키 순서) */
const HUD_POOL: readonly HudBot[] = Object.values(BOT_PERSONALITIES)
  .filter(bot => !isStoryHeroineId(bot.id))
  .map(bot => ({ id: bot.id, vpip: bot.vpip, pfr: bot.pfr, threeBet: bot.threeBet, wtsd: bot.wtsd, type: classifyHud(bot.vpip, bot.pfr) }))
  .filter((bot): bot is HudBot => bot.type !== null);

const TYPES: readonly OpponentType[] = ['nit', 'tag', 'station', 'maniac'];

function hudTag(bot: HudBot): string {
  return `VPIP ${bot.vpip} · PFR ${bot.pfr} · 3벳 ${bot.threeBet}`;
}

function pickBot(rng: () => number): HudBot | null {
  return HUD_POOL.length > 0 ? pickOne(rng, HUD_POOL) : null;
}

function factsOf(bot: HudBot): DrillFacts {
  return {
    villainName: characterName(bot.id),
    vpip: bot.vpip,
    pfr: bot.pfr,
    pfrRatio: Math.round((bot.pfr / bot.vpip) * 100),
    aggro: bot.pfr >= bot.vpip * AGGRESSIVE_PFR_RATIO ? '어그레시브' : '패시브',
    looseLine: LOOSE_VPIP,
    tightLine: TIGHT_VPIP,
    type: OPPONENT_TYPE_LABEL[bot.type],
    exploit: OPPONENT_EXPLOIT[bot.type],
  };
}

function situationFor(rng: () => number, bigBlind: number, bot: HudBot, rangeTag: string) {
  const layout = makeSeatLayout(rng);
  const seats = shuffleWith(rng, valueRange(0, TABLE_SIZE - 1)).slice(0, 2);
  const stackChips = STACK_BB * bigBlind;
  return {
    hero: [],
    board: [],
    potChips: Math.round(bigBlind * 1.5),
    toCallChips: 0,
    bigBlind,
    heroStackChips: stackChips,
    heroPosition: layout.positions[seats[0]],
    street: 'preflop' as const,
    villains: [makeVillain(layout, seats[1], bot.id, { stackChips, rangeTag })],
    note: `${characterName(bot.id)}의 최근 200핸드 HUD예요 — VPIP는 참여율, PFR은 레이즈로 들어간 비율.`,
  };
}

const fromHud: GeneratedDrillDefinition = {
  template: {
    id: 'type-from-hud',
    category: 'opponent-type',
    title: 'HUD로 유형 읽기',
    difficulty: 2,
    hints: ['VPIP {vpip}는 {looseLine} 이상이면 루스, {tightLine} 이하면 타이트예요. PFR이 VPIP의 60%를 넘으면 어그레시브고요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const bot = pickBot(rng);
    if (!bot) return null;
    const options = shuffleWith(rng, TYPES).map(type => OPPONENT_TYPE_LABEL[type]);
    return {
      situation: situationFor(rng, bigBlind, bot, hudTag(bot)),
      question: `${characterName(bot.id)}의 HUD는 VPIP ${bot.vpip} · PFR ${bot.pfr}이에요. 어떤 유형일까요?`,
      answerSpec: { kind: 'multiple-choice', options, correctIndex: options.indexOf(OPPONENT_TYPE_LABEL[bot.type]) },
      facts: factsOf(bot),
    };
  },
};

const exploit: GeneratedDrillDefinition = {
  template: {
    id: 'type-exploit',
    category: 'opponent-type',
    title: '이 상대에겐 이렇게',
    difficulty: 2,
    hints: ['{type} 상대예요. 폴드하지 않는 상대에겐 블러프 대신 밸류, 너무 자주 폴드하는 상대에겐 스틸이에요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const bot = pickBot(rng);
    if (!bot) return null;
    const correct = OPPONENT_EXPLOIT[bot.type];
    const choice = makeChoice(rng, correct, TYPES.filter(type => type !== bot.type).map(type => OPPONENT_EXPLOIT[type]), 4);
    if (!choice) return null;
    return {
      situation: situationFor(rng, bigBlind, bot, OPPONENT_TYPE_LABEL[bot.type].split(' ')[0]),
      question: `${characterName(bot.id)}는 ${OPPONENT_TYPE_LABEL[bot.type]}이에요(VPIP ${bot.vpip} · PFR ${bot.pfr}). 가장 좋은 대응은?`,
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: factsOf(bot),
    };
  },
};

export const OPPONENT_TYPE_TEMPLATES: readonly GeneratedDrillDefinition[] = [fromHud, exploit];
