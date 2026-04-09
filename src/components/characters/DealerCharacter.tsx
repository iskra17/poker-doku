'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { DEALER_CHARACTER } from '@/lib/characters';

interface DealerCharacterProps {
  message?: string;
  street?: string;
}

export default function DealerCharacter({ message, street }: DealerCharacterProps) {
  const dealer = DEALER_CHARACTER;
  const dealerMessage = message || getStreetMessage(street);

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Dealer avatar */}
      <motion.div
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="relative"
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-3xl border-2 shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${dealer.color}, ${dealer.colorSecondary})`,
            borderColor: `${dealer.color}80`,
            boxShadow: `0 0 25px ${dealer.color}30`,
          }}
        >
          {dealer.emoji}
        </div>
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-yellow-300 whitespace-nowrap bg-black/60 px-2 py-0.5 rounded-full">
          {dealer.name}
        </div>
      </motion.div>

      {/* Speech bubble */}
      <AnimatePresence mode="wait">
        {dealerMessage && (
          <motion.div
            key={dealerMessage}
            initial={{ opacity: 0, y: 5, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.9 }}
            className="relative bg-[#1a1028]/90 border border-purple-500/30 rounded-xl px-3 py-2 max-w-[200px]"
          >
            <p className="text-purple-200 text-xs text-center italic">
              &ldquo;{dealerMessage}&rdquo;
            </p>
            {/* Arrow pointing up */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-purple-500/30" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getStreetMessage(street?: string): string {
  switch (street) {
    case 'preflop': return 'New hand starting~ Good luck!';
    case 'flop': return 'The flop is here... how exciting!';
    case 'turn': return 'Time for the turn card~';
    case 'river': return 'The river... moment of truth!';
    case 'showdown': return 'Showdown! Let\'s see those cards~';
    default: return 'Welcome to the table~';
  }
}
