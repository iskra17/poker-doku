'use client';

import { Card as CardType } from '@/lib/poker/types';
import CardComponent from './Card';

interface CommunityCardsProps {
  cards: CardType[];
  winningCards?: CardType[];
  compact?: boolean;
}

export default function CommunityCards({ cards, winningCards = [], compact = false }: CommunityCardsProps) {
  const isWinning = (card: CardType) =>
    winningCards.some(wc => wc.rank === card.rank && wc.suit === card.suit);

  const cardSize = compact ? 'sm' : 'md';
  const emptySize = compact ? 'w-10 h-14' : 'w-14 h-20';

  return (
    <div className={`flex items-center justify-center ${compact ? 'gap-1' : 'gap-2'}`}>
      {cards.map((card, i) => (
        <CardComponent
          key={`${card.rank}-${card.suit}-${i}`}
          card={card}
          highlight={isWinning(card)}
          delay={i * 0.15}
          size={cardSize}
        />
      ))}
      {Array.from({ length: 5 - cards.length }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className={`${emptySize} rounded-lg border-2 border-dashed border-white/10`}
        />
      ))}
    </div>
  );
}
