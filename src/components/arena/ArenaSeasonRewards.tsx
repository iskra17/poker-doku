'use client';

import { useEffect, useState } from 'react';

interface RewardView {
  enabled: boolean;
  season?: {
    preseason: boolean;
    preseasonScarceRewardsSuppressed: boolean;
  };
  items: {
    rewardKey: string;
    name: string;
    description: string;
    kind: string;
  }[];
}

export default function ArenaSeasonRewards() {
  const [view, setView] = useState<RewardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/arena/rewards', {
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async response => {
      const value = await response.json() as RewardView;
      if (!response.ok) throw new Error('rewards');
      setView(value);
      setError(null);
    }).catch(cause => {
      if ((cause as { name?: string }).name !== 'AbortError') {
        setError('시즌 보상을 불러오지 못했어요.');
      }
    });
    return () => controller.abort();
  }, []);

  return (
    <section
      aria-labelledby="arena-rewards-title"
      className="rounded-2xl border border-gilded/30 bg-panel/90 p-4"
    >
      <h3 id="arena-rewards-title" className="text-base font-bold text-gilded">
        시즌 보상 미리보기
      </h3>
      {view?.season?.preseason && (
        <p className="mt-2 rounded-xl border border-mystic/25 bg-mystic/10 p-3 text-xs text-ink">
          프리시즌에는 운영 검증을 위해 한정 칭호·순위 등 희소 보상을 지급하지 않아요.
          참가 보상만 받을 수 있어요.
        </p>
      )}
      <div aria-live="polite" className="mt-3 space-y-2">
        {view?.items.map(item => (
          <article
            key={item.rewardKey}
            className="rounded-xl border border-gilded/20 bg-elevated/70 p-3"
          >
            <h4 className="text-sm font-bold text-ink">{item.name}</h4>
            <p className="mt-1 text-xs text-ink-dim">{item.description}</p>
          </article>
        ))}
        {!view && !error && <p className="text-xs text-ink-dim">보상 확인 중…</p>}
        {error && <p className="text-xs text-blossom">{error}</p>}
      </div>
    </section>
  );
}
