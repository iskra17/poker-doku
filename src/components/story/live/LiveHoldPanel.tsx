'use client';

import { motion } from 'framer-motion';
import { holdCopy } from '@/lib/story/story-live-rules';
import type { StoryHoldReason } from '@/lib/story/views';

interface LiveHoldPanelProps {
  holdReason: StoryHoldReason | null;
  /** 스토어 명령 진행 중 — 중복 resume 방지 */
  pending: boolean;
  onResume: () => void;
}

/**
 * 라이브 hold 안내 — 서버가 다음 핸드를 잡아 둔 상태다. [계속하기]가 story-advance(resume)를 보낸다.
 * 테이블 위 중앙 카드(컨테이너 스태킹 컨텍스트 안 = TopBar 아래).
 */
export default function LiveHoldPanel({ holdReason, pending, onResume }: LiveHoldPanelProps) {
  const copy = holdCopy(holdReason);
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-abyss/70 px-4 backdrop-blur-[2px]">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xs rounded-2xl border border-mystic/30 bg-panel/95 p-4 text-center shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
      >
        <p className="text-[10px] font-bold tracking-widest text-mystic">수련 중</p>
        <h3 className="mt-1 text-sm font-bold text-ink">{copy.title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{copy.body}</p>
        <button
          type="button"
          onClick={onResume}
          disabled={pending}
          className="mt-3 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {copy.cta}
        </button>
      </motion.div>
    </div>
  );
}
