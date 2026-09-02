'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getChapter } from '@/lib/story/chapters';
import { setMusicScene } from '@/lib/sound/music-manager';
import { holdCopy, needsResumeFromLobby } from '@/lib/story/story-live-rules';
import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import ChapterResult from './ChapterResult';
import DrillCard from './DrillCard';
import LessonPage from './LessonPage';
import ScenePlayer from './ScenePlayer';

const noopSubscribe = () => () => {};

/**
 * 스토리 스테이지 — 로비 위 풀스크린(z-[95]) 컨테이너. 방 없는 런(씬·레슨·드릴·결산)을 그린다.
 * 라이브 스텝(프리셋/스파링)은 방 안 오버레이가 맡으므로 live.roomId가 있으면 그리지 않는다.
 * 서버 뷰(run)의 stepIndex로 챕터 정적 데이터를 찾아 렌더하고, 진행은 스토어 명령(advance/choose/answerDrill)으로만 한다.
 */
export default function StoryStage({ onOpenGallery }: { onOpenGallery?: () => void } = {}) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const run = useStoryStore(state => state.run);
  const pending = useStoryStore(state => state.pending);
  const error = useStoryStore(state => state.error);
  const hint = useStoryStore(state => state.hint);
  const lastDrillResult = useStoryStore(state => state.lastDrillResult);
  const advance = useStoryStore(state => state.advance);
  const resumeLive = useStoryStore(state => state.resumeLive);
  const choose = useStoryStore(state => state.choose);
  const answerDrill = useStoryStore(state => state.answerDrill);
  const requestHint = useStoryStore(state => state.requestHint);
  const retryDrills = useStoryStore(state => state.retryDrills);
  const skipRetry = useStoryStore(state => state.skipRetry);
  const abandon = useStoryStore(state => state.abandon);
  const dismissRun = useStoryStore(state => state.dismissRun);
  const startChapter = useStoryStore(state => state.startChapter);

  const visible = !!run && !run.live?.roomId;
  const ended = run?.phase === 'ended';
  const passed = run?.result?.passed ?? false;

  // 스테이지 BGM — 열려 있는 동안 'story', 통과 결산은 승리 스팅. 닫히면 로비/테이블로 복귀 (외부 시스템 호출)
  useEffect(() => {
    if (!visible) return;
    setMusicScene(ended && passed ? 'victory' : 'story');
  }, [visible, ended, passed]);
  useEffect(() => {
    if (!visible) return;
    return () => setMusicScene(useGameStore.getState().currentRoomId ? 'table' : 'lobby');
  }, [visible]);

  if (!mounted || typeof document === 'undefined') return null;
  const chapter = run ? getChapter(run.chapterId) : undefined;
  const title = run?.chapterId === 'daily' ? '오늘의 수련 문제' : (chapter?.title ?? run?.chapterId ?? '수련 스토리');
  const step = run && chapter ? chapter.steps[run.stepIndex] : undefined;
  const partnerId = run?.context.partnerId ?? null;

  const finishScene = async (chosen: Record<string, string>) => {
    // 선택은 서버 플래그로 남긴다 (실패해도 진행은 막지 않음 — 정답 없는 선택지)
    for (const [choiceId, optionId] of Object.entries(chosen)) {
      await choose(choiceId, optionId);
    }
    await advance();
  };

  return createPortal(
    <AnimatePresence>
      {visible && run && (
        <motion.div
          key={run.runId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] flex flex-col bg-abyss text-ink"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <header className="flex flex-none items-center justify-between border-b border-mystic/20 px-4 py-2">
            <div className="min-w-0">
              <p className={`text-[10px] font-bold tracking-wider ${run.mode === 'exam' ? 'text-gilded' : 'text-ink-dim'}`}>
                {run.mode === 'exam' ? '실력 확인 · 힌트 없음 · 85점 이상 통과' : '수련 스토리'}
              </p>
              <h2 className="truncate text-sm font-bold">{title}</h2>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-ink-dim">
              <span aria-label="진행">{Math.min(run.stepIndex + 1, run.stepCount)}/{run.stepCount}</span>
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

          <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-3 py-3 scrollbar-thin">
            {run.phase === 'ended' && run.result && (
              <ChapterResult
                result={run.result}
                onClose={dismissRun}
                onOpenGallery={onOpenGallery ? () => { dismissRun(); onOpenGallery(); } : undefined}
                onNextChapter={chapterId => {
                  dismissRun();
                  void startChapter(chapterId);
                }}
                onRetry={() => {
                  const chapterId = run.chapterId;
                  dismissRun();
                  void startChapter(chapterId);
                }}
                onFullCourse={() => {
                  const chapterId = run.chapterId;
                  dismissRun();
                  void startChapter(chapterId, 'full');
                }}
              />
            )}

            {run.phase === 'scene' && step?.kind === 'scene' && (
              <div className="w-full max-w-md">
                <ScenePlayer
                  key={step.id}
                  scene={step.scene}
                  partnerId={partnerId}
                  onFinish={({ chosen }) => void finishScene(chosen)}
                />
              </div>
            )}

            {run.phase === 'lesson' && step?.kind === 'lesson' && (
              <LessonPage key={step.id} title={step.title} blocks={step.blocks} partnerId={partnerId} onFinish={() => void advance()} />
            )}

            {run.phase === 'drill' && run.drill && (
              <DrillCard
                drill={run.drill}
                teacherId={run.context.teacherId}
                partnerId={partnerId}
                pending={pending}
                hint={hint}
                lastResult={lastDrillResult}
                onAnswer={(answer, elapsedMs) => void answerDrill(answer, elapsedMs)}
                onHint={() => void requestHint()}
                onNext={() => void advance()}
                onRetry={() => void retryDrills()}
                onSkipRetry={() => void skipRetry()}
                hintAllowed={run.mode !== 'exam'}
              />
            )}

            {run.phase === 'result' && (
              <div className="w-full max-w-md rounded-2xl border border-mystic/25 bg-panel/90 p-4 text-center">
                <p className="text-[10px] font-bold tracking-widest text-mystic">결산 준비</p>
                <p className="mt-1 text-sm text-ink-dim">오늘 수업을 정리할게요.</p>
                <button
                  type="button"
                  onClick={() => void advance()}
                  disabled={pending}
                  className="mt-3 rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  결산 보기
                </button>
              </div>
            )}

            {/* 라이브 스텝인데 방이 없는 상태 — ①착석 직전(live-play, 안내만) ②방 유실/타임아웃 hold.
                ②는 [이어하기]가 새 방을 열어 같은 스텝을 재개한다 (서버 resumeRoom). */}
            {(run.phase === 'live-hold' || run.phase === 'live-play') && (() => {
              const copy = holdCopy(needsResumeFromLobby(run) ? (run.live?.holdReason ?? null) : null);
              const canResume = needsResumeFromLobby(run);
              return (
                <div className="w-full max-w-md rounded-2xl border border-mystic/25 bg-panel/90 p-4 text-center">
                  <p className="text-[10px] font-bold tracking-widest text-mystic">{copy.title}</p>
                  <p className="mt-1 text-sm text-ink-dim">{copy.body}</p>
                  <button
                    type="button"
                    onClick={() => void resumeLive()}
                    disabled={pending || !canResume}
                    className="mt-3 rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {copy.cta}
                  </button>
                </div>
              );
            })()}

            {error && <p className="text-center text-xs text-blossom" role="alert">{error}</p>}
          </main>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
