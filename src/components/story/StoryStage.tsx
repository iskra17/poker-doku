'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getChapter } from '@/lib/story/chapters';
import { useStoryStore } from '@/lib/store/story-store';

const noopSubscribe = () => () => {};

/**
 * 스토리 스테이지 — 로비 위 풀스크린(z-[95]) 컨테이너. 방 없는 런(씬·레슨·드릴·결산)을 그린다.
 * 라이브 스텝(프리셋/스파링)은 방 안 오버레이가 맡으므로 roomId가 있으면 그리지 않는다.
 * Phase 1.8~1.10에서 ScenePlayer / LessonPage / DrillCard / ChapterResult가 여기에 꽂힌다.
 */
export default function StoryStage() {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const run = useStoryStore(state => state.run);
  const pending = useStoryStore(state => state.pending);
  const error = useStoryStore(state => state.error);
  const advance = useStoryStore(state => state.advance);
  const abandon = useStoryStore(state => state.abandon);
  const dismissRun = useStoryStore(state => state.dismissRun);

  if (!mounted || typeof document === 'undefined') return null;
  const visible = !!run && !run.live?.roomId;
  const chapter = run ? getChapter(run.chapterId) : undefined;
  const step = run && chapter ? chapter.steps[run.stepIndex] : undefined;

  return createPortal(
    <AnimatePresence>
      {visible && run && (
        <motion.div
          key={run.runId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] flex flex-col bg-abyss/95 text-ink backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={chapter?.title ?? '수련 스토리'}
        >
          <header className="flex items-center justify-between border-b border-mystic/20 px-4 py-2">
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-wider text-ink-dim">수련 스토리 · {run.chapterId}</p>
              <h2 className="truncate text-sm font-bold">{chapter?.title ?? run.chapterId}</h2>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-ink-dim">
              <span>{run.stepIndex + 1}/{run.stepCount}</span>
              {run.phase !== 'ended' && (
                <button
                  type="button"
                  onClick={() => void abandon()}
                  disabled={pending}
                  className="rounded-lg border border-mystic/30 px-2 py-1 text-ink-dim disabled:opacity-50"
                >
                  포기
                </button>
              )}
            </div>
          </header>

          <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4">
            {run.phase === 'ended' ? (
              <div className="w-full max-w-md rounded-2xl border border-gilded/40 bg-panel/90 p-4 text-center">
                <p className="text-[10px] font-bold tracking-widest text-gilded">CHAPTER RESULT</p>
                <p className="mt-1 text-3xl font-black text-gilded">{run.result?.grade ?? '-'}</p>
                <p className="text-xs text-ink-dim">{run.result?.passed ? '통과' : '미통과 — 다시 도전할 수 있어요'}</p>
                <button type="button" onClick={dismissRun} className="mt-3 rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2 text-sm font-bold text-white">
                  허브로
                </button>
              </div>
            ) : (
              <div className="w-full max-w-md rounded-2xl border border-mystic/25 bg-panel/90 p-4 text-center">
                <p className="text-[10px] font-bold tracking-widest text-mystic">{run.phase.toUpperCase()}</p>
                <p className="mt-1 text-sm">
                  {step?.kind === 'scene' && '장면'}
                  {step?.kind === 'lesson' && (step.title || '레슨')}
                  {step?.kind === 'drill-set' && '수련 문제'}
                  {step?.kind === 'result' && '결산'}
                  {!step && '준비 중…'}
                </p>
                {(run.phase === 'scene' || run.phase === 'lesson' || run.phase === 'result') && (
                  <button
                    type="button"
                    onClick={() => void advance()}
                    disabled={pending}
                    className="mt-3 rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {run.phase === 'result' ? '결산 보기' : '다음'}
                  </button>
                )}
                {error && <p className="mt-2 text-xs text-blossom">{error}</p>}
              </div>
            )}
          </main>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
