import type { Suit } from '@/lib/poker/types';

/**
 * 카드 덱 테마 — 스타일/배색의 단일 소스.
 * Card(렌더링)와 SettingsModal(미리보기/선택 UI)이 공유한다.
 */

/** 앞면 스타일: 클래식(코너 인덱스 + 중앙 수트) / 빅랭크(GG풍 초대형 랭크) / 솔리드(수트색 배경 + 흰 글자) */
export type DeckStyleId = 'classic' | 'big-rank' | 'solid';

/** 배색: 2컬러(♠♣검정 ♥♦빨강) / 4컬러(Mike Caro 표준: ♠검정 ♥빨강 ♦파랑 ♣초록) */
export type DeckColorId = 'two' | 'four';

export const DECK_STYLE_LABELS: Record<DeckStyleId, string> = {
  classic: '클래식',
  'big-rank': '빅랭크',
  solid: '솔리드',
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

/** 클래식 스타일 배경용 은은한 수트 틴트 (흰 배경 위 그라디언트 끝점) */
export function getSuitTint(suit: Suit, colorId: DeckColorId): string {
  return `color-mix(in srgb, ${getSuitColor(suit, colorId)} 5%, transparent)`;
}
