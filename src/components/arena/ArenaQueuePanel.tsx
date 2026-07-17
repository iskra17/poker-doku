'use client';

import { useArenaStore } from '@/lib/store/arena-store';
import ArenaTrainingOffer from './ArenaTrainingOffer';

export default function ArenaQueuePanel() {
  const phase = useArenaStore(state => state.phase);
  const remainingMs = useArenaStore(state => state.remainingMs);
  const error = useArenaStore(state => state.error);
  const snapshot = useArenaStore(state => state.snapshot);
  const joinQueue = useArenaStore(state => state.joinQueue);
  const cancelQueue = useArenaStore(state => state.cancelQueue);

  if (phase === 'training-offered') return <ArenaTrainingOffer />;

  const queued = phase === 'queued';
  const hasTicket = snapshot?.enabled
    ? snapshot.profile.availableTickets > 0
    : false;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  return (
    <section
      aria-labelledby="arena-queue-title"
      className="rounded-2xl border border-mystic/30 bg-panel/90 p-4"
    >
      <div aria-live="polite" className="text-center">
        <h3 id="arena-queue-title" className="text-base font-bold text-ink">
          {queued ? '실력이 비슷한 상대를 찾는 중' : '공식 매치 참가'}
        </h3>
        <p className="mt-1 text-xs text-ink-dim">
          {queued
            ? `약 ${seconds}초 뒤에도 혼자라면 무료 수련 매치를 제안해요.`
            : '경기권 1장을 사용해 6인 포커 아레나에 참가해요.'}
        </p>
      </div>
      <button
        type="button"
        onClick={queued ? cancelQueue : joinQueue}
        disabled={(!hasTicket && !queued) || (phase !== 'idle' && !queued)}
        aria-label={queued ? '포커 아레나 대기 취소' : '포커 아레나 대기 시작'}
        className="mt-4 w-full rounded-xl border border-blossom/50 bg-blossom/15 px-4 py-2.5 text-sm font-bold text-blossom disabled:opacity-50"
      >
        {queued ? '대기 취소' : hasTicket ? '매치 찾기' : '경기권이 없어요'}
      </button>
      {error && <p className="mt-2 text-center text-xs text-blossom">{error}</p>}
    </section>
  );
}
