'use client';

import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import type {
  PublicTournamentSummary,
  TournamentDetailView,
} from '@/lib/realtime/protocol';
import { formatCountdown, useCountdownTo } from '@/lib/hooks/use-countdown';
import { useDialogFocus } from '@/lib/hooks/use-dialog-focus';
import { useServerNow } from '@/lib/hooks/use-server-now';
import { presentTournament } from '@/lib/tournament/tournament-presenter';
import Button from '@/components/ui/Button';

const KST_DETAIL_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatKst(epoch: number | null): string {
  if (epoch === null) return '운영자 수동 시작';
  return KST_DETAIL_FORMATTER.format(epoch);
}

export default function TournamentDetailModal({
  tournamentId,
  onClose,
}: {
  tournamentId: string;
  onClose: () => void;
}) {
  const fetchTournamentDetail = useGameStore(state => state.fetchTournamentDetail);
  const registerTournament = useGameStore(state => state.registerTournament);
  const unregisterTournament = useGameStore(state => state.unregisterTournament);
  const startTournament = useGameStore(state => state.startTournament);
  const directorTournamentAction = useGameStore(state => state.directorTournamentAction);
  const joinRoom = useGameStore(state => state.joinRoom);
  const myPlayerId = useGameStore(state => state.myPlayerId);
  const currentRoomId = useGameStore(state => state.currentRoomId);
  const canOperateTournament = useGameStore(state => state.canCreateTournament);
  const serverClockOffsetMs = useGameStore(state => state.serverClockOffsetMs);
  const serverNow = useServerNow(serverClockOffsetMs);
  const [detail, setDetail] = useState<TournamentDetailView | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const summary = detail?.summary as PublicTournamentSummary | undefined;
  const presentation = summary
    ? presentTournament(summary, serverNow)
    : null;
  const deadlineSeconds = useCountdownTo(
    presentation?.registrationDeadline
      ? presentation.registrationDeadline - serverClockOffsetMs
      : 0,
  );

  const load = useCallback(async () => {
    const next = await fetchTournamentDetail(tournamentId);
    if (next) setDetail(next);
    else setGone(true);
  }, [fetchTournamentDetail, tournamentId]);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 5_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [load]);

  if (gone) {
    return (
      <ModalShell title="토너먼트" onClose={onClose}>
        <p className="py-6 text-center text-sm text-ink-dim">
          토너먼트가 종료되어 정리되었습니다.
        </p>
      </ModalShell>
    );
  }
  if (!detail) {
    return (
      <ModalShell title="토너먼트" onClose={onClose}>
        <p className="py-6 text-center text-sm text-ink-dim">불러오는 중…</p>
      </ModalShell>
    );
  }

  if (!summary || !presentation) return null;
  const myRow = detail.standings.find(row => row.playerId === myPlayerId);
  const myRank = myRow
    ? myRow.place ?? detail.standings.indexOf(myRow) + 1
    : null;

  const act = async (action: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    await action();
    await load();
    setBusy(false);
  };

  const runPrimaryAction = () => {
    if (presentation.primaryAction.kind === 'return' && summary.mySeat) {
      joinRoom(summary.mySeat.roomId, 0, 0);
      onClose();
      return;
    }
    if (presentation.primaryAction.kind === 'register') {
      void act(() => registerTournament(summary.id));
      return;
    }
    if (presentation.primaryAction.kind === 'cancel') {
      void act(() => unregisterTournament(summary.id));
    }
  };

  return (
    <ModalShell title={`🏆 ${summary.name}`} onClose={onClose} wide>
      <div className="grid gap-2 md:grid-cols-2">
        <InfoCard label="상태" value={`${presentation.lifecycleLabel} · ${presentation.registrationLabel}`} />
        <InfoCard label="필드" value={presentation.fieldLabel} />
        <InfoCard label="참가" value={presentation.economyLabel} />
        <InfoCard label="운영" value={presentation.fieldPolicyLabel} />
      </div>

      <div className="mt-2 rounded-xl border border-mystic/20 bg-panel/60 p-3 text-xs leading-5 text-ink-dim">
        <p>시작 · {formatKst(summary.schedule.scheduledStartsAt)}</p>
        <p>등록 시작 · {formatKst(summary.schedule.registrationOpensAt)}</p>
        {summary.schedule.manualStartExpiresAt !== null && (
          <p>최소 인원 미달 자동 취소 · {formatKst(summary.schedule.manualStartExpiresAt)}</p>
        )}
        {presentation.registrationDeadline !== null && (
          <p>등록 마감 · {formatKst(presentation.registrationDeadline)}</p>
        )}
        {deadlineSeconds !== null && deadlineSeconds > 0 && (
          <p className="font-bold text-cyber">
            등록 마감까지 {formatCountdown(deadlineSeconds)}
          </p>
        )}
        <p className="text-gilded">
          총상금 {summary.payout.totalPrize.toLocaleString()} · {presentation.payoutLabel}
        </p>
        <p>{presentation.fundingLabel}</p>
        <p>{presentation.economyNotice}</p>
      </div>

      {presentation.stackDepthLabel && (
        <div className="mt-2 rounded-xl border border-blossom/30 bg-blossom/5 p-3 text-xs">
          <p className="font-bold text-ink">{presentation.stackDepthLabel}</p>
          {presentation.lateRegistrationWarning && (
            <p className="mt-1 text-blossom">{presentation.lateRegistrationWarning}</p>
          )}
          {detail.clock && (
            <p className="mt-1 text-ink-dim">
              현재 레벨 {detail.clock.level}
              {detail.clock.segmentRemainingMs !== null &&
                ` · 다음 레벨까지 ${formatCountdown(Math.ceil(detail.clock.segmentRemainingMs / 1000))}`}
            </p>
          )}
        </div>
      )}

      {summary.myRegistrationStatus === 'late-pending' && (
        <div className="mt-2 rounded-xl border border-cyber/30 bg-cyber/5 p-3 text-xs">
          <p className="font-bold text-cyber">등록 완료</p>
          <p className="mt-1 text-ink">
            공정한 좌석 배정을 위해 현재 핸드 종료를 기다리는 중입니다.
          </p>
        </div>
      )}

      {myRank !== null && summary.lifecycle === 'running' && (
        <div className="mt-2 rounded-xl border border-blossom/30 bg-blossom/10 p-2 text-center text-xs text-ink">
          내 순위 <b className="text-blossom">{myRank}위</b>
          {myRow && myRow.place === null && (
            <span className="text-ink-dim"> · 스택 {myRow.chips.toLocaleString()}</span>
          )}
        </div>
      )}

      {summary.mySeat && summary.mySeat.roomId !== currentRoomId && (
        <Button className="mt-2 w-full" size="sm" disabled={busy} onClick={runPrimaryAction}>
          게임 복귀 (T{summary.mySeat.tableNo})
        </Button>
      )}

      {!summary.mySeat &&
        (presentation.primaryAction.kind === 'register' ||
          presentation.primaryAction.kind === 'cancel' ||
          presentation.primaryAction.kind === 'waiting' ||
          presentation.primaryAction.kind === 'pending') && (
          <Button
            className="mt-2 w-full"
            size="sm"
            variant={presentation.primaryAction.disabled ? 'secondary' : 'primary'}
            disabled={busy || presentation.primaryAction.disabled}
            onClick={runPrimaryAction}
          >
            {presentation.primaryAction.label}
          </Button>
        )}

      {detail.standings.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-bold text-ink">순위표</h3>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-mystic/20 scrollbar-thin">
            <table className="w-full text-[11px]">
              <tbody>
                {detail.standings.map((row, index) => (
                  <tr key={row.playerId} className={`border-b border-mystic/10 ${row.playerId === myPlayerId ? 'bg-blossom/10' : ''}`}>
                    <td className="px-2 py-1 text-ink-dim">{row.place ?? index + 1}</td>
                    <td className="px-2 py-1 font-medium text-ink">{row.name}</td>
                    <td className="px-2 py-1 text-right text-ink-dim">
                      {row.place !== null
                        ? row.prize > 0 ? `+${row.prize.toLocaleString()}` : '탈락'
                        : row.chips.toLocaleString()}
                    </td>
                    <td className="px-2 py-1 text-right text-ink-dim">
                      {row.tableNo === null ? '' : `T${row.tableNo}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <section>
          <h3 className="text-xs font-bold text-ink">블라인드 구조</h3>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-mystic/20 scrollbar-thin">
            {summary.structure.segments.map((segment, index) => (
              <div key={index} className="flex justify-between border-b border-mystic/10 px-2 py-1 text-[10px]">
                <span className="text-ink-dim">
                  {segment.kind === 'break' ? '휴식' : `Lv.${summary.structure.segments.slice(0, index + 1).filter(item => item.kind === 'level').length}`}
                </span>
                <span className="text-ink">
                  {segment.kind === 'break'
                    ? `${Math.round(segment.durationMs / 60_000)}분`
                    : `${segment.smallBlind}/${segment.bigBlind}${segment.bigBlindAnte > 0 ? ` A${segment.bigBlindAnte}` : ''}`}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-xs font-bold text-ink">상금 배분 · {summary.payout.status === 'final' ? '확정' : '예상'}</h3>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-mystic/20 scrollbar-thin">
            {summary.payout.payouts.map(row => (
              <div key={row.place} className="flex justify-between border-b border-mystic/10 px-2 py-1 text-[10px]">
                <span className="text-ink-dim">{row.place}위 · {row.percent}%</span>
                <span className="text-gilded">{row.amount.toLocaleString()}</span>
              </div>
            ))}
            {summary.payout.payouts.length === 0 && (
              <p className="p-2 text-[10px] text-ink-dim">등록 인원 확정 후 표시됩니다.</p>
            )}
          </div>
        </section>
      </div>

      {canOperateTournament &&
        !['completed', 'cancelled', 'payout-pending', 'refund-pending'].includes(summary.lifecycle) && (
          <section className="mt-4 rounded-xl border border-blossom/30 bg-blossom/5 p-3">
            <h3 className="text-xs font-bold text-blossom">운영</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {['upcoming', 'registering', 'start-delayed'].includes(summary.lifecycle) && (
                <Button size="sm" disabled={busy} onClick={() => void act(() => startTournament(summary.id))}>
                  지금 시작
                </Button>
              )}
              {summary.lifecycle === 'running' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void act(() => directorTournamentAction(summary.id, {
                    action: summary.paused ? 'resume' : 'pause',
                  }))}
                >
                  {summary.paused ? '재개' : '일시정지'}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                className={confirmKey === 'cancel' ? 'border-blossom/60 text-blossom' : ''}
                onClick={() => {
                  if (confirmKey !== 'cancel') {
                    setConfirmKey('cancel');
                    return;
                  }
                  setConfirmKey(null);
                  void act(() => directorTournamentAction(summary.id, { action: 'cancel' }));
                }}
              >
                {confirmKey === 'cancel' ? '취소 확정' : '토너먼트 취소'}
              </Button>
            </div>
          </section>
        )}
    </ModalShell>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-mystic/20 bg-panel/60 px-2.5 py-2">
      <p className="text-[10px] text-ink-dim">{label}</p>
      <p className="mt-0.5 text-xs font-bold text-ink">{value}</p>
    </div>
  );
}

export function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useDialogFocus(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 md:items-center md:p-3" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-mystic/30 bg-panel p-3.5 scrollbar-thin md:max-h-[88dvh] md:rounded-2xl md:p-4 ${wide ? 'md:max-w-2xl' : 'md:max-w-md'}`}
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="truncate text-sm font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="px-1 text-ink-dim hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
