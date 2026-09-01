'use client';

import { motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import type { Expression } from '@/lib/assets/character-art';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import type { StoryHeroineId } from '@/lib/story/types';
import { resolveSpeaker } from './ScenePlayer';

interface CoachBubbleProps {
  /** 히로인 id | 'miyako' | 'partner' */
  speaker: string;
  partnerId: StoryHeroineId | null;
  text: string;
  expression?: Expression;
  /** 정답/오답/중립 색조 */
  tone?: 'neutral' | 'correct' | 'wrong';
  typewriter?: boolean;
}

/** 출제·해설 히로인 말풍선 — 아바타(표정) + 타자기 대사. 드릴 카드·결산·인터럽트 공용. */
export default function CoachBubble({ speaker, partnerId, text, expression = 'neutral', tone = 'neutral', typewriter = true }: CoachBubbleProps) {
  const who = resolveSpeaker(speaker, partnerId);
  const { display } = useTypewriter(typewriter ? text : '', 18);
  const shown = typewriter ? display : text;
  const border = tone === 'correct' ? 'border-cyber/60' : tone === 'wrong' ? 'border-blossom/60' : 'border-mystic/30';
  return (
    <motion.div
      key={text}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-start gap-3 rounded-2xl border ${border} bg-panel/90 p-3`}
      role="status"
      aria-live="polite"
    >
      {who.artId && (
        <motion.div
          key={`${who.artId}-${expression}`}
          initial={{ scale: 0.92 }}
          animate={{ scale: [0.92, 1.04, 1] }}
          transition={{ duration: 0.35 }}
          className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border"
          style={{ borderColor: `${who.color ?? '#fff'}55` }}
        >
          <CharacterImage characterId={who.artId} expression={expression} round={false} className="h-full w-full text-2xl" />
        </motion.div>
      )}
      <div className="min-w-0 flex-1">
        {who.name && <p className="text-[11px] font-bold" style={{ color: who.color ?? undefined }}>{who.name}</p>}
        <p className="text-sm leading-relaxed text-ink">{shown}</p>
      </div>
    </motion.div>
  );
}
