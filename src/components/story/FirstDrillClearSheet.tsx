'use client';

import { motion } from 'framer-motion';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import type { StoryHeroineId } from '@/lib/story/types';
import CoachBubble from './CoachBubble';

interface FirstDrillClearSheetProps {
  teacherId: string;
  partnerId: StoryHeroineId | null;
  pending: boolean;
  onContinue: () => void;
}

/** Ch1 첫 두 드릴이 서버에서 닫힌 뒤 한 번만 거치는 작은 이벤트 시트. */
export default function FirstDrillClearSheet({ teacherId, partnerId, pending, onContinue }: FirstDrillClearSheetProps) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.28 }}
      className="w-full max-w-md overflow-hidden rounded-3xl border border-cyber/45 bg-panel/95 shadow-[0_0_42px_rgba(74,222,128,0.14)]"
      aria-label="첫걸음 완료"
    >
      <div className="relative overflow-hidden bg-gradient-to-br from-cyber/20 via-mystic/15 to-blossom/15 px-5 py-5 text-center">
        <span aria-hidden className="absolute -right-5 -top-7 text-8xl text-gilded/15">✦</span>
        <p className="text-[10px] font-black tracking-[0.28em] text-cyber">FIRST STEP CLEAR</p>
        <h2 className="mt-1 text-2xl font-black text-ink">첫걸음 완료</h2>
        <p className="mt-1 text-xs text-ink-dim">핸드 랭킹 첫 두 문제를 끝까지 풀었어요.</p>
      </div>

      <div className="space-y-3 p-4">
        <CoachBubble
          speaker={teacherId}
          partnerId={partnerId}
          expression="happy"
          tone="correct"
          typewriter={false}
          text="좋아요♪ 이제 누가 더 높은 족보인지 직접 읽을 수 있어요. 다음은 테이블의 언어예요."
        />

        <div className="rounded-2xl border border-cyber/25 bg-cyber/5 p-3 text-left">
          <p className="text-[10px] font-bold tracking-wider text-cyber">이번에 익힌 것</p>
          <ul className="mt-2 space-y-1.5 text-xs text-ink">
            <li>✓ 높은 족보가 낮은 족보를 이겨요</li>
            <li>✓ 홀카드와 보드를 함께 보고 족보를 읽어요</li>
          </ul>
        </div>

        <div className="rounded-2xl border border-mystic/25 bg-mystic/5 p-3 text-left">
          <p className="text-[10px] font-bold tracking-wider text-mystic">다음 수련</p>
          <p className="mt-1 text-sm font-black text-ink">테이블의 언어</p>
          <p className="mt-1 text-xs text-ink-dim">액션 · 스트리트 · 자리 이름을 연결해요.</p>
        </div>

        <button
          type="button"
          onClick={onContinue}
          disabled={pending}
          className="w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-3 text-sm font-black text-white shadow-lg transition-transform hover:scale-[1.01] disabled:opacity-50"
        >
          {pending ? '다음 수련을 여는 중…' : '다음 수련: 테이블의 언어'}
        </button>
      </div>
    </motion.section>
  );
}
