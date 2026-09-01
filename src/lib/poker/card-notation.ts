/**
 * 카드 축약 표기 파서/포매터 — 챕터 데이터·프리셋 스크립트·드릴 픽스처·소켓 payload 공용.
 *
 * 표기: 랭크 1글자(2~9, T, J, Q, K, A — '10'도 허용) + 수트 1글자(h/d/c/s).
 * 예) 'As' = A♠, 'Th' = 10♥, '2c' = 2♣, 'Kd' = K♦. 대소문자는 관대하게 받는다('as', 'AS').
 * test-helpers.ts의 card()/cards()와 같은 문법이지만 그쪽은 테스트 전용이라 여기서 다시 정의한다.
 *
 * 이 모듈은 파싱만 한다 — 셔플/딜링 경로가 아니므로 deck.ts의 CSPRNG 규칙 대상이 아니다.
 */
import type { Card, Rank, Suit } from './types';

const SUIT_BY_CHAR: Readonly<Record<string, Suit>> = Object.freeze({
  h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades',
});
const CHAR_BY_SUIT: Readonly<Record<Suit, string>> = Object.freeze({
  hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's',
});
const RANK_BY_CHAR: Readonly<Record<string, Rank>> = Object.freeze({
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
});

export class CardNotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardNotationError';
  }
}

/** 'As' | 'Th' | '10h' → Card. 잘못된 표기는 CardNotationError. */
export function parseCard(code: string): Card {
  const card = tryParseCard(code);
  if (!card) throw new CardNotationError(`Invalid card code: ${JSON.stringify(code)}`);
  return card;
}

/** parseCard의 non-throwing 변형 — 소켓 payload 검증처럼 실패가 정상 경로인 곳에서 사용. */
export function tryParseCard(code: unknown): Card | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (trimmed.length < 2 || trimmed.length > 3) return null;
  const suitChar = trimmed[trimmed.length - 1].toLowerCase();
  const rankText = trimmed.slice(0, -1).toUpperCase();
  const rank = rankText === '10' ? '10' : RANK_BY_CHAR[rankText];
  const suit = SUIT_BY_CHAR[suitChar];
  if (!rank || !suit || (rankText.length === 2 && rankText !== '10')) return null;
  return { rank, suit };
}

/**
 * 'As Kd' / 'As,Kd' / 'As, Kd' → Card[]. 빈 문자열은 []. 중복 카드는 거부한다
 * (프리셋 스크립트가 같은 카드를 두 좌석에 주는 실수를 데이터 검증 단계에서 잡기 위함).
 */
export function parseCards(text: string): Card[] {
  const cards = tryParseCards(text);
  if (!cards) throw new CardNotationError(`Invalid card list: ${JSON.stringify(text)}`);
  return cards;
}

export function tryParseCards(text: unknown): Card[] | null {
  if (typeof text !== 'string') return null;
  const tokens = text.split(/[\s,]+/).filter(token => token.length > 0);
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const card = tryParseCard(token);
    if (!card) return null;
    const key = formatCard(card);
    if (seen.has(key)) return null;
    seen.add(key);
    cards.push(card);
  }
  return cards;
}

/** Card → 'As' (10은 'T'). parseCard(formatCard(c)) ≡ c. */
export function formatCard(card: Card): string {
  const rankChar = card.rank === '10' ? 'T' : card.rank;
  return `${rankChar}${CHAR_BY_SUIT[card.suit]}`;
}

/** Card[] → 'As Kd'. */
export function formatCards(cards: readonly Card[]): string {
  return cards.map(formatCard).join(' ');
}

/** 두 카드가 같은 카드인지 (rank·suit 동치). */
export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/** 목록 안에 중복 카드가 있으면 그 표기를, 없으면 null을 돌려준다. */
export function findDuplicateCard(cards: readonly Card[]): string | null {
  const seen = new Set<string>();
  for (const card of cards) {
    const key = formatCard(card);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}
