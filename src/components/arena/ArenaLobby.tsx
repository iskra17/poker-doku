'use client';

import { useState } from 'react';
import { useArenaStore } from '@/lib/store/arena-store';
import ArenaLeaderboard from './ArenaLeaderboard';
import ArenaQueuePanel from './ArenaQueuePanel';
import ArenaSeasonRewards from './ArenaSeasonRewards';
import WeeklyDojoPanel from './WeeklyDojoPanel';

type ArenaSection = 'group' | 'global' | 'rewards';

const TIER_LABELS = {
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  diamond: '다이아몬드',
  master: '마스터',
} as const;

export default function ArenaLobby() {
  const [mode, setMode] = useState<'weekly' | 'ranked'>('weekly');
  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 px-4 pb-8">
      <nav aria-label="아레나 경기 방식" className="flex gap-4 border-b border-ink-dim/20">
        {([['weekly', '주간 도전'], ['ranked', '공식전']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={`min-h-11 border-b-2 px-2 text-sm font-bold ${mode === value
              ? 'border-blossom text-ink' : 'border-transparent text-ink-dim'}`}
          >{label}</button>
        ))}
      </nav>
      {mode === 'weekly' ? <WeeklyDojoPanel /> : <OfficialArena />}
    </div>
  );
}

function OfficialArena() {
  const snapshot = useArenaStore(state => state.snapshot);
  const loading = useArenaStore(state => state.loading);
  const error = useArenaStore(state => state.error);
  const [section, setSection] = useState<ArenaSection>('group');

  if (!snapshot) {
    return (
      <p aria-live="polite" className="py-10 text-center text-sm text-ink-dim">
        {loading ? '포커 아레나 입장 준비 중…' : error ?? '아레나 정보를 확인 중이에요.'}
      </p>
    );
  }
  if (!snapshot.enabled) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-8 text-center">
        <h2 className="text-lg font-bold text-ink">공식전 준비 중</h2>
        <p aria-live="polite" className="mt-2 text-sm text-ink-dim">
          시즌이 열리면 이곳에서 참가할 수 있어요.
        </p>
      </section>
    );
  }

  const hours = Math.max(0, Math.ceil(snapshot.season.remainingMs / 3_600_000));
  const placement = snapshot.profile.placementGames < snapshot.profile.placementMatches;
  return (
    <section className="space-y-3">
      <section
        aria-labelledby="arena-lobby-title"
        className="rounded-2xl border border-blossom/35 bg-panel/90 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-blossom">
              시즌 종료까지 약 {hours}시간
            </p>
            <h2 id="arena-lobby-title" className="mt-1 text-xl font-bold text-ink">
              공식전
            </h2>
          </div>
          <div className="rounded-xl border border-gilded/30 bg-elevated px-3 py-2 text-right">
            <p className="text-xs text-ink-dim">무료 경기권</p>
            <p className="text-lg font-bold text-gilded">
              {snapshot.profile.availableTickets}장
            </p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-elevated p-3">
            <dt className="text-ink-dim">{placement ? '배치 경기' : '현재 티어'}</dt>
            <dd className="mt-1 text-sm font-bold text-mystic">
              {placement
                ? `${snapshot.profile.placementGames}/${snapshot.profile.placementMatches}`
                : TIER_LABELS[snapshot.profile.tier!]}
            </dd>
          </div>
          <div className="rounded-xl bg-elevated p-3">
            <dt className="text-ink-dim">이번 주 활동 순위</dt>
            <dd className="mt-1 text-sm font-bold text-blossom">
              {snapshot.weekly.rank ? `${snapshot.weekly.rank}위` : '배정 전'}
              <span className="ml-1 text-xs text-ink-dim">
                누적 {snapshot.weekly.score}점
              </span>
            </dd>
          </div>
        </dl>
        {snapshot.season.preseasonScarceRewardsSuppressed && (
          <p className="mt-3 text-xs text-ink-dim">
            프리시즌 운영 중 · 희소 순위 보상은 지급하지 않아요.
          </p>
        )}
      </section>

      <ArenaQueuePanel />

      <nav aria-label="포커 아레나 정보" className="grid grid-cols-3 gap-2">
        {([
          ['group', '내 그룹'],
          ['global', '글로벌'],
          ['rewards', '시즌 보상'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSection(value)}
            aria-pressed={section === value}
            className={`min-h-11 rounded-xl border px-2 py-2 text-xs font-bold ${
              section === value
                ? 'border-blossom/50 bg-blossom/15 text-blossom'
                : 'border-mystic/25 bg-panel text-ink-dim'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      {section === 'rewards'
        ? <ArenaSeasonRewards />
        : <ArenaLeaderboard key={section} kind={section} />}
    </section>
  );
}
