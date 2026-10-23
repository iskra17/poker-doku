import { describe, expect, it } from 'vitest';
import { parseCards } from '@/lib/poker/card-notation';
import { evaluateHand } from '@/lib/poker/evaluator';
import { generateDrill } from './drills/generator';
import { toPublicDrillInstance } from './drills/public';
import type { DrillAnswerSpec, DrillSituation } from './drills/types';
import {
  actionOrder,
  buildDrillTableModel,
  computeShowdown,
  labelOffset,
  parseDemoAction,
  planDrillDemo,
  positionSequence,
} from './drill-table-model';

const CTX = { teacher: 'miyako' } as const;

function situation(input: Partial<DrillSituation>): DrillSituation {
  return {
    hero: parseCards('As Kd'),
    board: [],
    potChips: 30,
    toCallChips: 20,
    bigBlind: 20,
    heroStackChips: 2000,
    heroPosition: 'BTN',
    street: 'preflop',
    villains: [],
    ...input,
  };
}

describe('buildDrillTableModel', () => {
  it('rotates explicit seats so the hero sits at slot 0 and keeps the dealer seat', () => {
    const model = buildDrillTableModel(situation({
      heroPosition: '?',
      heroSeatIndex: 4,
      dealerSeatIndex: 1,
      villains: [0, 1, 2, 3, 5].map(seatIndex => ({ seatIndex, characterId: 'choco', position: '?', stackChips: 2000 })),
    }));
    expect(model.seats[0].occupant).toBe('hero');
    expect(model.seats[0].seatIndex).toBe(4);
    // 좌석 5 → 슬롯 1, 좌석 0 → 슬롯 2, 좌석 1(딜러) → 슬롯 3
    expect(model.seats[1].seatIndex).toBe(5);
    expect(model.seats[3].seatIndex).toBe(1);
    expect(model.dealerSlot).toBe(3);
    expect(model.showSeatNumbers).toBe(true);
    expect(model.positionsHidden).toBe(true);
    expect(model.sbSlot).toBeNull();
    expect(model.bbSlot).toBeNull();
    expect(model.seats.every(seat => seat.occupant !== 'empty')).toBe(true);
  });

  it('derives relative seats and the button from position labels', () => {
    const model = buildDrillTableModel(situation({
      heroPosition: 'CO',
      villains: [
        { seatIndex: 1, characterId: 'luna', position: 'BB', stackChips: 1500 },
        { seatIndex: 2, characterId: 'mochi', position: 'BTN', stackChips: 1800, holeCards: parseCards('9h 9c') },
      ],
    }));
    // CO 오프셋 5 → 딜러는 슬롯 1, BB(오프셋 2)는 슬롯 3
    expect(model.dealerSlot).toBe(1);
    expect(model.seats[1].characterId).toBe('mochi');
    expect(model.seats[3].characterId).toBe('luna');
    expect(model.bbSlot).toBe(3);
    expect(model.sbSlot).toBeNull();
    expect(model.seats[1].cardBacks).toBe(false);
    expect(model.seats[1].holeCards).toHaveLength(2);
    expect(model.seats[3].cardBacks).toBe(true);
    expect(model.showSeatNumbers).toBe(false);
    expect(model.seats.filter(seat => seat.occupant === 'empty')).toHaveLength(3);
  });

  it('places unlabeled villains on the spread slots in seat order', () => {
    const model = buildDrillTableModel(situation({
      heroPosition: '포지션',
      villains: [
        { seatIndex: 5, characterId: 'gumi', position: '', stackChips: 1000 },
        { seatIndex: 2, characterId: 'kapi', position: '', stackChips: 1000 },
      ],
    }));
    expect(model.seats[2].characterId).toBe('kapi');
    expect(model.seats[4].characterId).toBe('gumi');
    expect(model.dealerSlot).toBeNull();
  });

  it('seats a heads-up opponent across the table and gives the button to BTN/SB', () => {
    const model = buildDrillTableModel(situation({
      heroPosition: 'BB',
      villains: [{ seatIndex: 1, characterId: 'paeng', position: 'BTN/SB', stackChips: 1000 }],
    }));
    expect(model.seats[3].characterId).toBe('paeng');
    expect(model.dealerSlot).toBe(3);
    expect(model.bbSlot).toBe(0);
  });

  it('moves a villain whose label collides with another into a free slot', () => {
    const model = buildDrillTableModel(situation({
      heroPosition: 'BTN',
      villains: [
        { seatIndex: 1, characterId: 'luna', position: 'BB', stackChips: 1000 },
        { seatIndex: 2, characterId: 'mochi', position: 'BB', stackChips: 1000 },
      ],
    }));
    const placed = model.seats.filter(seat => seat.occupant === 'villain').map(seat => seat.characterId).sort();
    expect(placed).toEqual(['luna', 'mochi']);
    expect(model.seats[2].characterId).toBe('luna');
  });

  it('keeps an empty hero hand without card backs (board-only questions)', () => {
    const model = buildDrillTableModel(situation({ hero: [] }));
    expect(model.seats[0].holeCards).toEqual([]);
    expect(model.seats[0].cardBacks).toBe(false);
  });

  it('places every generated pos-name seat and never reveals a label', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const instance = toPublicDrillInstance(generateDrill('pos-name', seed, CTX));
      const model = buildDrillTableModel(instance.situation);
      expect(model.seats.every(seat => seat.occupant !== 'empty')).toBe(true);
      expect(model.seats.every(seat => seat.position === '?')).toBe(true);
      expect(model.dealerSlot).not.toBeNull();
      expect(model.sbSlot).toBeNull();
      expect(model.bbSlot).toBeNull();
    }
  });
});

describe('position helpers', () => {
  it('maps labels to dealer offsets', () => {
    expect(labelOffset('BTN')).toBe(0);
    expect(labelOffset('CO')).toBe(5);
    expect(labelOffset('BTN/SB')).toBe(0);
    expect(labelOffset('?')).toBeNull();
    expect(labelOffset(null)).toBeNull();
  });

  it('walks the labels clockwise from the button', () => {
    expect(positionSequence(4)).toEqual([
      { slot: 4, label: 'BTN' }, { slot: 5, label: 'SB' }, { slot: 0, label: 'BB' },
      { slot: 1, label: 'UTG' }, { slot: 2, label: 'HJ' }, { slot: 3, label: 'CO' },
    ]);
  });

  it('orders preflop from UTG and postflop from SB, skipping empty seats', () => {
    expect(actionOrder(0, 'preflop').map(e => e.label)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(actionOrder(0, 'flop').map(e => e.label)).toEqual(['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']);
    const occupied = [true, false, true, false, true, true];
    expect(actionOrder(0, 'flop', occupied).map(e => e.slot)).toEqual([2, 4, 5, 0]);
  });

  it('matches the server answer for generated pos-name and pos-first-to-act drills', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const named = generateDrill('pos-name', seed, CTX);
      const namedModel = buildDrillTableModel(toPublicDrillInstance(named).situation);
      const demo = planDrillDemo(namedModel, named.answerSpec, { category: 'position', templateId: 'pos-name' });
      if (demo.kind !== 'position-walk' || named.answerSpec.kind !== 'multiple-choice') throw new Error('expected position-walk');
      expect(demo.heroLabel).toBe(named.answerSpec.options[named.answerSpec.correctIndex]);

      const first = generateDrill('pos-first-to-act', seed, CTX);
      const firstModel = buildDrillTableModel(toPublicDrillInstance(first).situation);
      const order = planDrillDemo(firstModel, first.answerSpec, { category: 'position', templateId: 'pos-first-to-act' });
      if (order.kind !== 'action-order' || first.answerSpec.kind !== 'multiple-choice') throw new Error('expected action-order');
      expect(order.order[0].label).toBe(first.answerSpec.options[first.answerSpec.correctIndex]);
      expect(firstModel.seats[order.order[0].slot].position).toBe(order.order[0].label);
    }
  });
});

describe('showdown demo', () => {
  it('evaluates every face-up hand and finds the same winner as the server', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const instance = generateDrill('rank-who-wins', seed, CTX);
      const model = buildDrillTableModel(toPublicDrillInstance(instance).situation);
      const demo = planDrillDemo(model, instance.answerSpec, { category: 'hand-ranking', templateId: 'rank-who-wins' });
      if (demo.kind !== 'showdown' || instance.answerSpec.kind !== 'multiple-choice') throw new Error('expected showdown');
      expect(demo.showdown.entries).toHaveLength(3);
      expect(demo.showdown.winnerSlots).toHaveLength(1);
      const winnerSeat = model.seats[demo.showdown.winnerSlots[0]];
      const winnerName = winnerSeat.occupant === 'hero' ? '나' : winnerSeat.name;
      expect(winnerName).toBe(instance.answerSpec.options[instance.answerSpec.correctIndex]);
    }
  });

  it('returns the best five cards for a single hand', () => {
    const model = buildDrillTableModel(situation({ hero: parseCards('Ah Ad'), board: parseCards('As 7c 2d 9h Kc'), street: 'river' }));
    const result = computeShowdown(model);
    expect(result?.entries[0].rankName).toBe('트리플');
    expect(result?.entries[0].cards).toEqual(evaluateHand(parseCards('Ah Ad'), parseCards('As 7c 2d 9h Kc')).cards);
  });

  it('skips showdown for board-only nuts questions', () => {
    const instance = generateDrill('rank-nuts', 1, CTX);
    const model = buildDrillTableModel(toPublicDrillInstance(instance).situation);
    expect(planDrillDemo(model, instance.answerSpec, { category: 'hand-ranking', templateId: 'rank-nuts' }).kind).toBe('answer');
  });
});

describe('action demo', () => {
  it('parses action words at the start of an option', () => {
    expect(parseDemoAction('콜 — 뜰 확률이 필요 승률보다 높아요')).toEqual({ action: 'call', label: '콜' });
    expect(parseDemoAction('폴드')).toEqual({ action: 'fold', label: '폴드' });
    expect(parseDemoAction('오픈 레이즈')).toEqual({ action: 'raise', label: '오픈 레이즈' });
    expect(parseDemoAction('3벳')).toEqual({ action: 'raise', label: '3벳' });
    expect(parseDemoAction('¾ 팟')).toEqual({ action: 'bet', label: '¾ 팟' });
    expect(parseDemoAction('원페어')).toBeNull();
    expect(parseDemoAction('BTN')).toBeNull();
  });

  it('acts out a multiple-choice call with the call amount and a pot-fraction bet', () => {
    const model = buildDrillTableModel(situation({ potChips: 400, toCallChips: 100, street: 'flop', board: parseCards('2c 7d Jh') }));
    const call: DrillAnswerSpec = { kind: 'multiple-choice', options: ['폴드 — 아니요', '콜 — 네'], correctIndex: 1 };
    expect(planDrillDemo(model, call, { category: 'call-decision' })).toEqual({ kind: 'act', action: 'call', label: '콜', chips: 100 });
    const bet: DrillAnswerSpec = { kind: 'multiple-choice', options: ['체크', '¾ 팟'], correctIndex: 1 };
    expect(planDrillDemo(model, bet, { category: 'sizing' })).toEqual({ kind: 'act', action: 'bet', label: '¾ 팟', chips: 300 });
  });

  it('acts out action-pick answers and falls back to an answer label otherwise', () => {
    const model = buildDrillTableModel(situation({}));
    const fold: DrillAnswerSpec = { kind: 'action-pick', options: ['fold', 'call'], correct: ['fold'] };
    expect(planDrillDemo(model, fold, { category: 'action-judgment' })).toMatchObject({ kind: 'act', action: 'fold', label: '폴드' });
    const numeric: DrillAnswerSpec = { kind: 'numeric', correct: 25, tolerance: 0, unit: '%', min: 0, max: 100 };
    expect(planDrillDemo(model, numeric, { category: 'pot-odds' })).toEqual({ kind: 'answer', label: '25%' });
  });
});
