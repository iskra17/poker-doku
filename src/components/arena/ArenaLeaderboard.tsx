'use client';

import { useEffect, useState } from 'react';
import type { ArenaTier } from '@/lib/arena/types';

type BoardKind = 'group' | 'global';

interface LeaderboardRow {
  alias: string;
  avatarId: string;
  cosmetics: { titleId: string | null; frameId: string | null };
  place: number;
  score: number;
  matches: number;
  tier: ArenaTier | null;
  isSelf?: boolean;
}

interface LeaderboardPage {
  enabled: boolean;
  items: LeaderboardRow[];
  nextCursor: string | null;
  smallGroup?: boolean;
  promotionGamesRequired?: number;
}

const TIER_LABELS: Record<ArenaTier, string> = {
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  diamond: '다이아몬드',
  master: '글로벌 마스터 리그',
};

export default function ArenaLeaderboard({ kind }: { kind: BoardKind }) {
  const [page, setPage] = useState<LeaderboardPage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    void fetch(`/api/arena/leaderboard/${kind}${query}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async response => {
      const value = await response.json() as LeaderboardPage;
      if (!response.ok) throw new Error('leaderboard');
      setPage(value);
      setError(null);
    }).catch(cause => {
      if ((cause as { name?: string }).name !== 'AbortError') {
        setError('순위표를 불러오지 못했어요.');
      }
    });
    return () => controller.abort();
  }, [cursor, kind]);

  const nextPage = (): void => {
    if (!page?.nextCursor) return;
    setHistory(previous => [...previous, cursor]);
    setCursor(page.nextCursor);
  };
  const previousPage = (): void => {
    if (history.length === 0) return;
    setCursor(history.at(-1) ?? null);
    setHistory(previous => previous.slice(0, -1));
  };

  return (
    <section
      aria-labelledby={`arena-${kind}-leaderboard-title`}
      className="rounded-2xl border border-mystic/30 bg-panel/90 p-4"
    >
      <h3
        id={`arena-${kind}-leaderboard-title`}
        className="text-base font-bold text-ink"
      >
        {kind === 'group' ? '이번 주 그룹 순위' : '글로벌 마스터 리그'}
      </h3>
      {kind === 'group' && (
        <p className="mt-1 text-xs text-ink-dim">
          승격은 주 3경기 이상 참가자부터 가능해요.
          {page?.smallGroup && ' 소규모 그룹은 승격 1명, 강등 없음 규칙을 적용해요.'}
        </p>
      )}
      <div aria-live="polite" className="mt-3 space-y-1.5">
        {!page && !error && <p className="text-xs text-ink-dim">순위 확인 중…</p>}
        {page?.items.map(row => (
          <div
            key={`${row.place}:${row.alias}`}
            className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 rounded-xl border px-3 py-2 ${
              row.isSelf
                ? 'border-blossom/60 bg-blossom/15'
                : 'border-mystic/15 bg-elevated/70'
            }`}
          >
            <span className="text-sm font-bold text-gilded">{row.place}위</span>
            <span className="min-w-0 truncate text-sm text-ink">
              {row.alias}
              {row.isSelf && <span className="ml-1 text-xs text-blossom">내 순위</span>}
              {kind === 'global' && row.tier && (
                <span className="ml-1 text-[10px] text-mystic">
                  {TIER_LABELS[row.tier]}
                </span>
              )}
            </span>
            <span className="text-right text-xs text-ink-dim">
              <strong className="text-ink">{row.score}점</strong>
              <br />
              {row.matches}경기
            </span>
          </div>
        ))}
        {page?.items.length === 0 && (
          <p className="rounded-xl bg-elevated p-3 text-center text-xs text-ink-dim">
            아직 표시할 순위가 없어요.
          </p>
        )}
        {error && <p className="text-xs text-blossom">{error}</p>}
      </div>
      <nav aria-label="아레나 순위표 페이지" className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={previousPage}
          disabled={history.length === 0}
          aria-label="이전 페이지"
          className="rounded-lg border border-mystic/30 bg-elevated px-3 py-2 text-xs font-bold text-ink disabled:opacity-40"
        >
          이전 페이지
        </button>
        <button
          type="button"
          onClick={nextPage}
          disabled={!page?.nextCursor}
          aria-label="다음 페이지"
          className="rounded-lg border border-mystic/30 bg-elevated px-3 py-2 text-xs font-bold text-ink disabled:opacity-40"
        >
          다음 페이지
        </button>
      </nav>
    </section>
  );
}
