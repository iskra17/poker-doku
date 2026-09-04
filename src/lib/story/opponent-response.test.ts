import { expect, it } from 'vitest';
import { assessOpponentResponse, opponentResponseStrength } from './opponent-response';
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
