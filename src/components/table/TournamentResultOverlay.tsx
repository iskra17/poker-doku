'use client';

import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import Button from '../ui/Button';
import ArenaResultSummary from '@/components/arena/ArenaResultSummary';
import { useArenaStore } from '@/lib/store/arena-store';

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** 시트앤고 종료 후 최종 순위표 오버레이 */
export default function TournamentResultOverlay({ onLeave }: { onLeave: () => void }) {
  const { gameState, myPlayerId } = useGameStore();
  const arenaResult = useArenaStore(state => state.result);
  const tournament = gameState?.tournament;
  if (!tournament?.finished) return null;

  const results = [...tournament.results].sort((a, b) => a.place - b.place);
  const champion = results[0];
  const isMtt = !!tournament.tournamentId;

  if (gameState?.economyMode === 'arena' && !arenaResult) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="arena-result-pending-title"
        className="absolute inset-0 z-40 flex items-center justify-center bg-abyss/80 p-4 backdrop-blur-sm"
      >
        <div className="w-[min(92%,360px)] rounded-2xl border border-mystic/40 bg-elevated p-5 text-center">
          <h2 id="arena-result-pending-title" className="text-lg font-bold text-ink">
            포커 아레나 결과 정산 중
          </h2>
          <p aria-live="polite" className="mt-2 text-sm text-ink-dim">
            순위와 시즌 점수를 안전하게 확인하고 있어요…
          </p>
          <button
            type="button"
            aria-label="결과 확인을 건너뛰고 로비로 돌아가기"
            onClick={() => onLeave()}
            className="mt-5 w-full rounded-xl border border-mystic/50 bg-mystic/10 px-4 py-3 text-sm font-bold text-mystic"
          >
            결과 없이 로비로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (arenaResult) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="arena-result-title"
        className="absolute inset-0 z-40 flex items-center justify-center bg-abyss/80 p-4 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-[min(92%,360px)] rounded-2xl border border-gilded/40 bg-elevated p-4 shadow-2xl"
        >
          <ArenaResultSummary result={arenaResult} />
          <button
            type="button"
            onClick={() => onLeave()}
            className="mt-4 w-full rounded-xl border border-blossom/50 bg-blossom/15 px-4 py-3 text-sm font-bold text-blossom"
          >
            로비로 돌아가기
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="w-[min(92%,360px)] bg-elevated border border-gilded/40 rounded-2xl shadow-2xl shadow-gilded/10 p-5"
      >
        <div className="text-center mb-4">
          <div className="text-4xl mb-1">🏆</div>
          <h2
            className="text-2xl font-bold"
            style={{
              fontFamily: 'var(--font-display)',
              background: 'linear-gradient(135deg, #FFD76A 0%, #FF7EB6 55%, #A78BFA 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {isMtt ? '토너먼트 종료' : 'Sit & Go 종료'}
          </h2>
          {champion && (
            <p className="text-ink-dim text-xs mt-1">
              우승: <span className="text-gilded font-bold">{champion.name}</span>
            </p>
          )}
        </div>

        <div className="space-y-1.5 mb-5">
          {results.map(r => {
            const isMe = r.playerId === myPlayerId;
            const isPodium = r.place <= 3;
            return (
              <div
                key={r.playerId}
                className={`flex items-center justify-between rounded-lg px-3 py-1.5 border
                  ${isMe ? 'border-blossom/60 bg-blossom/10' : isPodium ? 'border-gilded/25 bg-white/5' : 'border-white/5 bg-white/[0.02]'}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-7 shrink-0 text-sm font-bold text-ink">
                    {MEDALS[r.place] ?? `${r.place}위`}
                  </span>
                  <span className={`truncate text-sm ${isMe ? 'text-blossom font-bold' : 'text-ink'}`}>
                    {r.name}
                    {isMe && ' (나)'}
                  </span>
                </div>
                {r.prize > 0 && (
                  <span className="text-gilded font-bold text-sm tabular shrink-0">
                    +{r.prize.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <Button variant="primary" size="lg" className="w-full" onClick={onLeave}>
          로비로 돌아가기
        </Button>
      </motion.div>
    </div>
  );
}
