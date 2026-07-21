import type { Suit } from '@/lib/poker/types';

/**
 * 카드 덱 테마 — 스타일/배색의 단일 소스.
 * Card(렌더링)와 SettingsModal(미리보기/선택 UI)이 공유한다.
 */

/** 앞면 스타일: 솔리드(수트색 배경 + 흰 글자, 기본) / 빅랭크(GG풍 초대형 랭크) */
export type DeckStyleId = 'solid' | 'big-rank';

/** 배색: 2컬러(♠♣검정 ♥♦빨강) / 4컬러(Mike Caro 표준: ♠검정 ♥빨강 ♦파랑 ♣초록) */
export type DeckColorId = 'two' | 'four';

export const DECK_STYLE_LABELS: Record<DeckStyleId, string> = {
  solid: '솔리드',
  'big-rank': '빅랭크',
};

export const DECK_COLOR_LABELS: Record<DeckColorId, string> = {
  two: '2컬러',
  four: '4컬러',
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

// 수트 색상은 globals.css @theme의 suit-* 토큰을 참조
const FOUR_COLOR: Record<Suit, string> = {
  hearts: 'var(--color-suit-red)',
  diamonds: 'var(--color-suit-blue)',
  clubs: 'var(--color-suit-green)',
  spades: 'var(--color-suit-dark)',
};

const TWO_COLOR: Record<Suit, string> = {
  hearts: 'var(--color-suit-red)',
  diamonds: 'var(--color-suit-red)',
  clubs: 'var(--color-suit-dark)',
  spades: 'var(--color-suit-dark)',
};

export function getSuitColor(suit: Suit, colorId: DeckColorId): string {
  return (colorId === 'four' ? FOUR_COLOR : TWO_COLOR)[suit];
}
