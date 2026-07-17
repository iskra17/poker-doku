'use client';

import { useArenaStore } from '@/lib/store/arena-store';

export default function ArenaTrainingOffer() {
  const remainingMs = useArenaStore(state => state.remainingMs);
  const acceptTraining = useArenaStore(state => state.acceptTraining);
  const rejectTraining = useArenaStore(state => state.rejectTraining);
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));

  return (
    <section
      aria-labelledby="arena-training-title"
      className="rounded-2xl border border-gilded/40 bg-elevated p-4"
    >
      <div aria-live="polite" className="text-center">
        <p className="text-xs font-bold text-gilded">무료 선택지 · {seconds}초</p>
        <h3 id="arena-training-title" className="mt-1 text-lg font-bold text-ink">
          수련 매치
        </h3>
        <p className="mt-2 text-sm font-bold text-mystic">
          경기권/점수 사용 없음
        </p>
        <p className="mt-1 text-xs text-ink-dim">
          단단한 봇 다섯 명과 한 판 연습할 수 있어요.
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={rejectTraining}
          aria-label="수련 매치 제안을 거절하고 돌아가기"
          className="rounded-xl border border-mystic/30 bg-panel px-3 py-2 text-sm font-bold text-ink"
        >
          돌아가기
        </button>
        <button
          type="button"
          onClick={acceptTraining}
          aria-label="무료 수련 매치 수락"
          className="rounded-xl border border-gilded/50 bg-gilded/15 px-3 py-2 text-sm font-bold text-gilded"
        >
          수락
        </button>
      </div>
    </section>
  );
}
