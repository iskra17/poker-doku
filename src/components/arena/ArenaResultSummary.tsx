'use client';

import type { ArenaResultPayload } from '@/lib/realtime/protocol';
import { useArenaStore } from '@/lib/store/arena-store';

const TIER_LABEL: Record<NonNullable<ArenaResultPayload['tier']>, string> = {
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  diamond: '다이아몬드',
  master: '마스터',
};

export default function ArenaResultSummary({
  result: providedResult,
}: {
  result?: ArenaResultPayload | null;
}) {
  const storedResult = useArenaStore(state => state.result);
  const result = providedResult ?? storedResult;
  if (!result) return null;
  const rankDelta = result.weeklyRankBefore !== null
    && result.weeklyRankAfter !== null
    ? result.weeklyRankBefore - result.weeklyRankAfter
    : null;

  return (
    <section
      aria-labelledby="arena-result-title"
      className="rounded-2xl border border-gilded/40 bg-panel p-4"
    >
      <div aria-live="polite" className="text-center">
        <h3 id="arena-result-title" className="text-xl font-bold text-gilded">
          {result.training ? '수련 매치 완료' : `포커 아레나 ${result.place}위`}
        </h3>
        {result.training ? (
          <p className="mt-2 text-sm text-mystic">
            이 경기는 시즌 점수에 반영되지 않습니다.
          </p>
        ) : (
          <p className="mt-2 text-2xl font-bold text-blossom">
            +{result.points}점
          </p>
        )}
      </div>
      {!result.training && (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-elevated p-3">
            <dt className="text-ink-dim">주간 순위</dt>
            <dd className="mt-1 font-bold text-ink">
              {result.weeklyRankAfter ? `${result.weeklyRankAfter}위` : '배정 전'}
              {rankDelta !== null && rankDelta !== 0 && (
                <span className="ml-1 text-blossom">
                  {rankDelta > 0 ? `▲ ${rankDelta}` : `▼ ${Math.abs(rankDelta)}`}
                </span>
              )}
            </dd>
          </div>
          <div className="rounded-xl bg-elevated p-3">
            <dt className="text-ink-dim">배치 진행</dt>
            <dd className="mt-1 font-bold text-ink">
              {result.placementGames}/{result.placementMatches}
              {result.tier && ` · ${TIER_LABEL[result.tier]}`}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
