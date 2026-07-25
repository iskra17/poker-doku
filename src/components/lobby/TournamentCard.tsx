'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { PublicTournamentSummary } from '@/lib/realtime/protocol';
import { formatCountdown, useCountdownTo } from '@/lib/hooks/use-countdown';
import { presentTournament } from '@/lib/tournament/tournament-presenter';
import Button from '@/components/ui/Button';

const SPEED_LABELS: Record<PublicTournamentSummary['speed'], string> = {
  standard: '스탠다드',
  turbo: '터보',
  hyper: '하이퍼',
};
const KST_SCHEDULE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function useServerNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offsetMs), 500);
    return () => clearInterval(timer);
  }, [offsetMs]);
  return now;
}

function formatSchedule(epoch: number | null): string {
  if (epoch === null) return '운영자 수동 시작';
  return KST_SCHEDULE_FORMATTER.format(epoch);
}

export default function TournamentCard({
  tournament,
  delay,
  serverClockOffsetMs,
  onOpen,
  onReturn,
}: {
  tournament: PublicTournamentSummary;
  delay: number;
  serverClockOffsetMs: number;
  onOpen: () => void;
  onReturn?: () => void;
}) {
  const serverNow = useServerNow(serverClockOffsetMs);
  const presentation = presentTournament(tournament, serverNow);
  const localDeadline = presentation.registrationDeadline === null
    ? 0
    : presentation.registrationDeadline - serverClockOffsetMs;
  const seconds = useCountdownTo(localDeadline);
  const action = onReturn
    ? { kind: 'return' as const, label: '게임 복귀', disabled: false }
    : presentation.primaryAction;
  const currentLevel = tournament.structure.currentSegmentIndex === null
    ? null
    : tournament.structure.segments
      .slice(0, tournament.structure.currentSegmentIndex + 1)
      .filter(segment => segment.kind === 'level').length;

  return (
    <motion.article
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      onClick={onOpen}
      className="cursor-pointer rounded-xl border border-mystic/20 bg-panel/80 p-3 backdrop-blur-sm transition-all hover:border-gilded/40 active:scale-[0.98] md:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gilded/25 bg-gradient-to-br from-yellow-600/25 to-pink-600/25 text-2xl">
            🏆
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded border border-gilded/40 px-1 py-px text-[10px] font-bold text-gilded">
                토너먼트
              </span>
              <span className="rounded border border-cyber/35 px-1 py-px text-[10px] font-bold text-cyber">
                {presentation.lifecycleLabel}
              </span>
              {tournament.registrationState === 'open-late' && (
                <span className="rounded border border-blossom/40 px-1 py-px text-[10px] font-bold text-blossom">
                  레이트 레지 진행 중
                </span>
              )}
              <span className="rounded border border-mystic/30 px-1 py-px text-[10px] font-bold text-ink-dim">
                {tournament.economyMode === 'freeroll' ? '프리롤' : '유료 토너먼트'}
              </span>
              <h3 className="truncate text-sm font-bold text-white md:text-base">
                {tournament.name}
              </h3>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-dim">
              <span>{SPEED_LABELS[tournament.speed]}</span>
              <span>{presentation.fieldLabel}</span>
              <span>{presentation.fieldPolicyLabel}</span>
              <span className="text-gilded">
                총상금 {tournament.payout.totalPrize.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        <span onClick={event => event.stopPropagation()}>
          <Button
            variant={action.disabled ? 'secondary' : 'success'}
            size="sm"
            disabled={action.disabled}
            onClick={() => {
              if (onReturn) onReturn();
              else onOpen();
            }}
          >
            {action.label}
          </Button>
        </span>
      </div>

      <div className="mt-2 grid gap-1 rounded-lg border border-mystic/15 bg-black/10 px-2.5 py-2 text-[11px] text-ink-dim md:grid-cols-2">
        <span>
          시작 {formatSchedule(tournament.schedule.scheduledStartsAt)} · 최소 인원 미달 시 자동 취소
          {tournament.schedule.scheduledStartsAt === null &&
            tournament.schedule.manualStartExpiresAt !== null &&
            ` · ${formatSchedule(tournament.schedule.manualStartExpiresAt)} 미달 시 취소`}
        </span>
        <span>{presentation.payoutLabel} · {presentation.fundingLabel}</span>
        <span>{presentation.economyNotice}</span>
        <span>
          {presentation.registrationLabel}
          {presentation.registrationDeadline !== null &&
            ` · ${formatSchedule(presentation.registrationDeadline)} 마감`}
          {seconds !== null && seconds > 0 && (
            <b className="ml-1 text-cyber">· 마감까지 {formatCountdown(seconds)}</b>
          )}
        </span>
        {presentation.stackDepthLabel && (
          <span className="text-ink">
            {presentation.stackDepthLabel}
            {currentLevel !== null && ` · 현재 레벨 ${currentLevel}`}
          </span>
        )}
        {presentation.lateRegistrationWarning && (
          <span className="text-blossom">{presentation.lateRegistrationWarning}</span>
        )}
      </div>
    </motion.article>
  );
}
