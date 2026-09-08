'use client';

import { useGameStore } from '@/lib/store/game-store';
import { useWeeklyDojoStore } from '@/lib/store/weekly-dojo-store';
import Button from '@/components/ui/Button';

export default function WeeklyDojoTableStatus() {
  const roomId = useGameStore(state => state.currentRoomId);
  const inWeeklyRoom = useGameStore(state => state.gameState?.weeklyDojo === true);
  const connected = useGameStore(state => state.connected);
  const view = useWeeklyDojoStore(state => state.view);
  const pending = useWeeklyDojoStore(state => state.pending);
  const error = useWeeklyDojoStore(state => state.error);
  if (!inWeeklyRoom) return null;
  const live = view?.live?.roomId === roomId ? view?.live : null;
  return (
    <div className="flex-none border-b border-ink-dim/20 bg-panel px-3 py-2 text-xs text-ink-dim">
      <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-2">
        <p>
          <strong className="text-ink">주간 도전</strong>
          {live && <> · {live.slot}/3회 · {live.handsPlayed}/{view?.rules.maxHands}핸드
            <span className="ml-2 tabular-nums text-gilded">{live.netBB > 0 ? '+' : ''}{live.netBB.toFixed(1)}BB</span>
          </>}
          {!live && <span className="ml-2">기록을 확인하고 있어요.</span>}
        </p>
        {live?.paused && (
          <Button size="sm" disabled={!connected || pending} onClick={() => void useWeeklyDojoStore.getState().start()}>
            {pending ? '연결 중…' : '도전 계속'}
          </Button>
        )}
      </div>
      {live?.paused && <p className="mt-1">잠시 멈췄어요. 준비되면 계속할 수 있어요.</p>}
      {error && <p aria-live="polite" className="mt-1 text-blossom">{error}</p>}
    </div>
  );
}
