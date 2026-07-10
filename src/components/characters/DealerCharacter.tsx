'use client';

import { motion } from 'framer-motion';
import { DEALER_CHARACTER } from '@/lib/characters';
import CharacterImage from './CharacterImage';

/** 테이블 중앙 상단의 딜러 미야코 (대사는 DialogueBox가 담당) */
export default function DealerCharacter() {
  const dealer = DEALER_CHARACTER;

  return (
    <div className="flex flex-col items-center gap-1">
      <motion.div
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="relative"
      >
        <div
          className="w-16 h-16 rounded-full border-2 shadow-lg"
          style={{
            borderColor: `${dealer.color}80`,
            boxShadow: `0 0 25px ${dealer.color}30`,
          }}
        >
          <CharacterImage characterId="dealer" round className="w-full h-full text-3xl" />
        </div>
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-gilded whitespace-nowrap bg-black/60 px-2 py-0.5 rounded-full">
          {dealer.name}
        </div>
      </motion.div>
    </div>
  );
}
