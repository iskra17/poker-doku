import { expect, it } from 'vitest';
import { assessOpponentResponse, opponentResponseStrength } from './opponent-response';
import { cards } from '../poker/test-helpers';
import { evaluateHand } from '../poker/evaluator';

it.each([
  ['Tc 2d', '5c 6d 7h 8s 9c', 'straight'],
  ['Qh 3c', 'Ah Kh 7h 4h 2h', 'flush'],
  ['Kd 2s', '8c 8d 8h Kc Kh', 'full-house'],
  ['Th 2c', '5h 6h 7h 8h 9h', 'straight-flush'],
])('recognizes actual same-rank improvement %s on %s', (holeText, boardText, rank) => {
  const hole = cards(holeText), board = cards(boardText);
  const made = evaluateHand(hole, board), boardOnly = evaluateHand([], board);
  expect(made.rank).toBe(rank);
  expect(boardOnly.rank).toBe(rank);
  expect(made.value).toBeGreaterThan(boardOnly.value);
  const strength = opponentResponseStrength(hole, board);
  expect(strength).toEqual({ topPairOrBetter: true, strongMade: true });
  expect(assessOpponentResponse({ type: 'honest', street: 'river', opponents: 1, facingBet: true, betToPot: 0.5, action: 'call', ...strength })).toBeNull();
});

it.each([
  ['2c 3d', '5c 6d 7h 8s 9c'],
  ['Ac Qd', '8c 8d 8h 8s 2c'],
  ['Ac Ad', '8c 8d 8h 8s 2c'],
  ['Ac Qd', 'Kc Kd 8h 8s 2c'],
])('preserves board-only and kicker guards %s on %s', (hole, board) => {
  expect(opponentResponseStrength(cards(hole), cards(board))).toEqual({ topPairOrBetter: false, strongMade: false });
});
it('grades public decision opportunities, including a strong-hand fold, independently of outcome', () => {
  const base = { type: 'bluffer' as const, street: 'river' as const, topPairOrBetter: true, opponents: 1, betToPot: 0.5, facingBet: true };
  expect(assessOpponentResponse({ ...base, action: 'call' })?.correct).toBe(true);
  expect(assessOpponentResponse({ ...base, action: 'fold' })?.correct).toBe(false);
  expect(assessOpponentResponse({ ...base, action: 'call', opponents: 2 })).toBeNull();
  expect(assessOpponentResponse({ ...base, action: 'call', betToPot: 2 })).toBeNull();
  expect(assessOpponentResponse({ ...base, type: 'honest', topPairOrBetter: false, action: 'fold' })?.correct).toBe(true);
  expect(assessOpponentResponse({ ...base, type: 'station', facingBet: false, action: 'raise' })?.correct).toBe(true);
  expect(assessOpponentResponse({ ...base, type: 'station', facingBet: false, action: 'check' })?.correct).toBe(false);
});

it('excludes a strong made-hand value raise from the bluff-catch lesson', () => {
 const base = { type: 'bluffer' as const, street: 'river' as const, topPairOrBetter:true, strongMade:true, opponents:1, betToPot:0.5, facingBet:true };
 expect(assessOpponentResponse({...base, action:'raise'})).toBeNull();
 expect(assessOpponentResponse({...base, action:'fold'})?.correct).toBe(false);
 expect(assessOpponentResponse({...base, strongMade:false, action:'raise'})?.correct).toBe(false);
});

it('requires hero contribution and distinguishes top pair, overpair and strong made hands', () => {
  const card = (rank: import('../poker/types').Rank, suit: import('../poker/types').Suit = 'hearts') => ({rank,suit});
  const board = [card('K'),card('K','clubs'),card('8'),card('8','clubs'),card('2')];
  expect(opponentResponseStrength([card('A','spades'),card('Q','spades')],board)).toEqual({topPairOrBetter:false,strongMade:false});
  expect(opponentResponseStrength([card('K','spades'),card('Q','spades')],board)).toEqual({topPairOrBetter:true,strongMade:true});
  const dry = [card('K'),card('9','clubs'),card('7'),card('4','clubs'),card('2')];
  expect(opponentResponseStrength([card('K','spades'),card('Q','spades')],dry)).toEqual({topPairOrBetter:true,strongMade:false});
  expect(opponentResponseStrength([card('A','spades'),card('A','clubs')],dry)).toEqual({topPairOrBetter:true,strongMade:false});
});
