'use client';

import type { TournamentHoldReason } from '@/lib/poker/types';
import { formatCountdown, useCountdownTo } from '@/lib/hooks/use-countdown';

const STATUS_PRIORITY: Array<{
  reason: TournamentHoldReason;
  label: string;
  detail: string;
  icon: string;
}> = [
  {
    reason: 'director-pause',
    label: '운영자 일시정지',
    detail: '진행 재개를 기다리고 있어요',
    icon: '⏸',
  },
  {
    reason: 'scheduled-break',
    label: '브레이크',
    detail: '휴식이 끝나면 자동으로 재개돼요',
    icon: '☕',
  },
  {
    reason: 'final-forming',
    label: '파이널 테이블 재편성 중',
    detail: '마지막 테이블의 좌석을 준비하고 있어요',
    icon: '🏆',
  },
  {
    reason: 'final-intro',
    label: '파이널 테이블',
    detail: '챔피언십 무대를 준비하고 있어요',
    icon: '✨',
  },
  {
    reason: 'h4h-barrier',
    label: '핸드 포 핸드 · 다른 테이블 대기 중',
    detail: '모든 테이블이 같은 핸드를 마칠 때까지 기다려요',
    icon: '🤝',
  },
];

export type TournamentStatus = (typeof STATUS_PRIORITY)[number];

export function resolveTournamentStatus(
  reasons: TournamentHoldReason[] | undefined,
): TournamentStatus | null {
  if (!reasons?.length) return null;
  return STATUS_PRIORITY.find(status => reasons.includes(status.reason)) ?? null;
}

export function shouldBlockTournamentActions(
  reasons: TournamentHoldReason[] | undefined,
  isHandInProgress: boolean,
): boolean {
  return !isHandInProgress && (reasons?.length ?? 0) > 0;
}

export default function TournamentStatusBanner({
  reasons,
  stageEndsAt = 0,
  compact = false,
}: {
  reasons: TournamentHoldReason[] | undefined;
  stageEndsAt?: number;
  compact?: boolean;
}) {
  const status = resolveTournamentStatus(reasons);
  const seconds = useCountdownTo(
    status?.reason === 'scheduled-break' || status?.reason === 'final-intro'
      ? stageEndsAt
      : 0,
  );

  if (!status) return null;

  if (compact) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-bold text-[var(--final-highlight,var(--color-gilded))]">
        <span aria-hidden>{status.icon}</span>
        <span className="truncate">{status.label}</span>
        {seconds !== null && (
          <span aria-hidden className="shrink-0 tabular">{formatCountdown(seconds)}</span>
        )}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sr-only flex-none items-center justify-center gap-2 border-b border-[var(--final-accent,var(--color-gilded))]/30 bg-elevated/95 px-3 py-1.5 text-center md:not-sr-only md:flex"
    >
      <span aria-hidden>{status.icon}</span>
      <span className="text-xs font-bold text-[var(--final-highlight,var(--color-gilded))]">
        {status.label}
      </span>
      <span className="text-[11px] text-ink-dim">{status.detail}</span>
      {seconds !== null && (
        <span aria-hidden className="tabular text-[11px] font-bold text-cyber">
          {formatCountdown(seconds)}
        </span>
      )}
    </div>
  );
}
