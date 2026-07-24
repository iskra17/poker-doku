'use client';

import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import type { MttSpeed, TournamentDetailView } from '@/lib/realtime/protocol';
import { useCountdownTo, formatCountdown } from '@/lib/hooks/use-countdown';
import { PAYOUT_PRESETS } from '@/lib/poker/payout-table';
import Button from '@/components/ui/Button';
import { resolveTournamentStatus } from '@/components/table/TournamentStatusBanner';

/**
 * 토너먼트 상세 모달 — 로비(TournamentPanel)와 게임 중(TopBar 배지 탭) 공용.
 * 실시간 순위표(내 순위 하이라이트)·블라인드 구조·상금 분배·[운영] 패널(개설자)·
 * [게임 복귀](자리비움으로 떠난 생존 좌석)를 담는다. 5초 폴링 (v1 계약 — spec §5-1).
 * 모바일 우선: 단일 세로 스크롤 시트, 큰 탭 타깃.
 */

const SPEED_LABELS: Record<MttSpeed, string> = {
  standard: '스탠다드',
  turbo: '터보',
  hyper: '하이퍼',
};

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
  const [detail, setDetail] = useState<TournamentDetailView | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  // 위험 액션(취소/강제 제거) 2탭 확인 — 브라우저 confirm 다이얼로그 금지 (자동화 차단 이슈)
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await fetchTournamentDetail(tournamentId);
    if (next) setDetail(next);
    else setGone(true);
  }, [fetchTournamentDetail, tournamentId]);

  useEffect(() => {
    // 초기 로드도 타이머 콜백으로 — effect 본문 직접 setState 금지 (react-hooks 순수성 규칙)
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
        <p className="py-4 text-center text-sm text-ink-dim">토너먼트가 종료되어 정리됐어요.</p>
      </ModalShell>
    );
  }
  if (!detail) {
    return (
      <ModalShell title="토너먼트" onClose={onClose}>
        <p className="py-4 text-center text-sm text-ink-dim">불러오는 중…</p>
      </ModalShell>
    );
  }

  const { summary } = detail;
  // 내 실시간 순위 — 생존자는 칩 순 표시 순서, 탈락자는 확정 순위
  const myRow = detail.standings.find(row => row.playerId === myPlayerId);
  const myRank = myRow
    ? myRow.place ?? detail.standings.indexOf(myRow) + 1
    : null;
  const tournamentStatus = resolveTournamentStatus(
    detail.holdReasons ?? summary.holdReasons,
  );
  const finalPlaying = (detail.stage ?? summary.stage) === 'final-playing';
  const act = async (fn: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    await fn();
    await load();
    setBusy(false);
  };

  return (
    <ModalShell title={`🏆 ${summary.name}`} onClose={onClose}>
      <div className="flex items-center justify-between text-xs text-ink-dim">
        <span>
          {SPEED_LABELS[summary.speed]} · {summary.tableSize}인 테이블 ·{' '}
          {PAYOUT_PRESETS[summary.payoutPreset].label} ·{' '}
          {summary.phase === 'registering'
            ? `등록 ${summary.entrantCount}/${summary.maxEntrants}`
            : `잔존 ${summary.remaining}/${summary.entrantCount} · 테이블 ${summary.tableCount}개`}
        </span>
        <span className="font-bold text-gilded">풀 {summary.prizePool.toLocaleString()}</span>
      </div>

      <div className="mt-2 rounded-lg border border-mystic/20 bg-panel/65 px-2.5 py-2 text-[10px] leading-relaxed text-ink-dim">
        <p className="font-bold text-ink">
          프리즈아웃 · 늦은 등록 없음 · 재등록/리엔트리 없음
        </p>
        <p className="mt-0.5">
          시작 필드는 최소 8명이며, 등록한 사람은 시작 시 온라인이어야 체크인되어 착석해요.
          연습 모드의 봇 채우기는 체크인 후 빈자리를 채워요.
        </p>
      </div>

      {(tournamentStatus || finalPlaying) && (
        <div className="mt-2 rounded-lg border border-gilded/30 bg-gilded/10 px-2 py-1.5 text-center text-xs">
          <span className="font-bold text-gilded">
            {tournamentStatus
              ? `${tournamentStatus.icon} ${tournamentStatus.label}`
              : '🏆 파이널 테이블'}
          </span>
          {tournamentStatus && (
            <span className="ml-1.5 text-ink-dim">· {tournamentStatus.detail}</span>
          )}
        </div>
      )}

      {summary.phase === 'running' && myRank !== null && (
        <div className="mt-2 rounded-lg border border-blossom/30 bg-blossom/10 px-2 py-1.5 text-center text-xs">
          {myRow?.place !== null && myRow?.place !== undefined ? (
            <span className="text-ink">
              내 최종 순위 <span className="font-bold text-blossom">{myRow.place}위</span>
              {myRow.prize > 0 && (
                <span className="text-gilded"> · 상금 {myRow.prize.toLocaleString()}</span>
              )}
            </span>
          ) : (
            <span className="text-ink">
              내 순위 <span className="font-bold text-blossom">{myRank}위</span>
              <span className="text-ink-dim"> / {summary.remaining}명</span>
              {myRow && (
                <span className="text-ink-dim"> · 스택 {myRow.chips.toLocaleString()}</span>
              )}
            </span>
          )}
        </div>
      )}

      {detail.clock && (
        <div className="mt-2 rounded-lg border border-gilded/30 bg-gilded/10 px-2 py-1.5 text-center text-xs">
          {summary.paused ? (
            <span className="font-bold text-blossom">
              ⏸ 일시정지 중 — 레벨 {detail.clock.level}에서 시계가 멈춰 있어요
            </span>
          ) : detail.clock.onBreak ? (
            <span className="font-bold text-cyber">☕ 휴식 중 — 곧 재개돼요</span>
          ) : (
            <span className="text-ink">
              레벨 <span className="font-bold text-gilded">{detail.clock.level}</span> 진행 중
              {detail.clock.segmentRemainingMs !== null && (
                <ClockCountdown remainingMs={detail.clock.segmentRemainingMs} />
              )}
            </span>
          )}
        </div>
      )}

      {/* 자리비움으로 떠난 생존 좌석 복귀 — 서버가 본인 생존 좌석만 재입장을 허용한다 */}
      {summary.phase === 'running'
        && summary.myTableRoomId
        && summary.myTableRoomId !== currentRoomId && (
        <Button
          size="sm"
          className="mt-2 w-full"
          disabled={busy}
          onClick={() => {
            joinRoom(summary.myTableRoomId!, 0, 0);
            onClose();
          }}
        >
          ▶ 게임 복귀 (T
          {detail.standings.find(row => row.playerId === myPlayerId)?.tableNo ?? '?'}
          )
        </Button>
      )}

      {canOperateTournament
        && summary.phase !== 'completed'
        && summary.phase !== 'cancelled' && (
        <div className="mt-2 rounded-lg border border-blossom/30 bg-blossom/5 p-2">
          <p className="mb-1.5 text-[10px] font-bold text-blossom">🛠️ 운영자 도구</p>
          <div className="flex flex-wrap gap-1.5">
            {summary.phase === 'running' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void act(() =>
                  directorTournamentAction(summary.id, {
                    action: summary.paused ? 'resume' : 'pause',
                  }))}
              >
                {summary.paused ? '▶ 재개' : '⏸ 일시정지'}
              </Button>
            )}
            {summary.phase === 'running' && summary.paused && detail.clock && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || detail.clock.level <= 1}
                  onClick={() => void act(() =>
                    directorTournamentAction(summary.id, {
                      action: 'set-level',
                      level: detail.clock!.level - 1,
                    }))}
                >
                  레벨 ▼
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void act(() =>
                    directorTournamentAction(summary.id, {
                      action: 'set-level',
                      level: detail.clock!.level + 1,
                    }))}
                >
                  레벨 ▲
                </Button>
              </>
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
              {confirmKey === 'cancel' ? '정말 취소할까요?' : '토너먼트 취소'}
            </Button>
          </div>
          {summary.phase === 'running' && !summary.paused && (
            <p className="mt-1 text-[9px] text-ink-dim">
              블라인드 조정은 일시정지 중에만 할 수 있어요.
            </p>
          )}
        </div>
      )}

      {summary.phase === 'registering' && (
        <div className="mt-2 flex gap-2">
          {summary.registered ? (
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => void act(() => unregisterTournament(summary.id))}
            >
              등록 취소
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => void act(() => registerTournament(summary.id))}
            >
              {summary.economyMode === 'wallet'
                ? `등록하기 (${(summary.entryBuyIn + summary.entryFee).toLocaleString()} 칩)`
                : '등록하기'}
            </Button>
          )}
          {canOperateTournament && (
            <Button
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => void act(() => startTournament(summary.id))}
            >
              ▶ 지금 시작
            </Button>
          )}
        </div>
      )}
      {summary.phase === 'registering' && summary.botFill && (
        <p className="mt-1 text-center text-[10px] text-ink-dim">
          시작 시 남는 자리는 봇 캐릭터들이 채워요 (총 {summary.maxEntrants}명)
        </p>
      )}
      {summary.phase === 'registering' && summary.economyMode === 'wallet' && (
        <p className="mt-1 text-center text-[10px] text-ink-dim">
          💰 리얼 칩 토너먼트 — 등록 시 참가비가 예약되고 취소·유찰 시 전액 환불,
          상금은 지갑으로 지급돼요.
        </p>
      )}

      {detail.standings.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-bold text-ink">순위표</h3>
          <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-mystic/20 scrollbar-thin">
            <table className="w-full text-[11px]">
              <tbody>
                {detail.standings.map((row, i) => (
                  <tr
                    key={row.playerId}
                    className={`border-b border-mystic/10 ${row.playerId === myPlayerId ? 'bg-blossom/10' : ''}`}
                  >
                    <td className="px-2 py-1 text-ink-dim">
                      {row.place ?? i + 1}
                      {row.place === 1 && ' 🏆'}
                    </td>
                    <td className="px-2 py-1 font-medium text-ink">{row.name}</td>
                    <td className="px-2 py-1 text-right tabular text-ink-dim">
                      {row.place !== null
                        ? row.prize > 0
                          ? `+${row.prize.toLocaleString()}`
                          : '탈락'
                        : row.chips.toLocaleString()}
                    </td>
                    <td className="px-2 py-1 text-right text-ink-dim">
                      {row.tableNo !== null ? `T${row.tableNo}` : ''}
                    </td>
                    {canOperateTournament && summary.phase === 'running' && (
                      <td className="px-1 py-1 text-right">
                        {row.place === null && (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`${row.name} 강제 제거`}
                            className={`rounded px-1 text-[10px] ${
                              confirmKey === `remove:${row.playerId}`
                                ? 'bg-blossom/20 font-bold text-blossom'
                                : 'text-ink-dim hover:text-blossom'
                            }`}
                            onClick={() => {
                              const key = `remove:${row.playerId}`;
                              if (confirmKey !== key) {
                                setConfirmKey(key);
                                return;
                              }
                              setConfirmKey(null);
                              void act(() =>
                                directorTournamentAction(summary.id, {
                                  action: 'remove-player',
                                  playerId: row.playerId,
                                }));
                            }}
                          >
                            {confirmKey === `remove:${row.playerId}` ? '제거 확정' : '✖'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {summary.phase === 'registering' && detail.entrants.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-bold text-ink">등록자 ({detail.entrants.length})</h3>
          <p className="mt-1 text-[11px] leading-5 text-ink-dim">
            {detail.entrants.map(e => e.name).join(' · ')}
          </p>
        </>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <h3 className="text-xs font-bold text-ink">블라인드 구조</h3>
          <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-mystic/20 scrollbar-thin">
            <table className="w-full text-[10px]">
              <tbody>
                {detail.levels.map(level => (
                  <tr key={level.level} className="border-b border-mystic/10">
                    <td className="px-1.5 py-0.5 text-ink-dim">Lv.{level.level}</td>
                    <td className="px-1.5 py-0.5 text-right tabular text-ink">
                      {level.smallBlind}/{level.bigBlind}
                    </td>
                    <td className="px-1.5 py-0.5 text-right tabular text-ink-dim">
                      {level.ante > 0 ? `A${level.ante}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-0.5 text-[9px] text-ink-dim">
            레벨당 {Math.round(detail.levelDurationMs / 60_000)}분 · 앤티는 BB가 일괄 납부
          </p>
        </div>
        <div>
          <h3 className="text-xs font-bold text-ink">
            상금 분배 · {PAYOUT_PRESETS[summary.payoutPreset].label}
          </h3>
          <div className="mt-1 rounded-lg border border-mystic/20">
            <table className="w-full text-[10px]">
              <tbody>
                {detail.payouts.map(payout => (
                  <tr key={payout.place} className="border-b border-mystic/10">
                    <td className="px-1.5 py-0.5 text-ink-dim">{payout.place}위</td>
                    <td className="px-1.5 py-0.5 text-right tabular text-gilded">
                      {payout.prize.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

/** 서버가 준 남은 ms 기준 로컬 카운트다운 (5초 폴링 사이를 메운다) */
function ClockCountdown({ remainingMs }: { remainingMs: number }) {
  const [receivedAt] = useState(() => Date.now());
  const seconds = useCountdownTo(receivedAt + remainingMs);
  if (seconds === null) return null;
  return <span className="ml-1 tabular text-cyber">· 다음 레벨까지 {formatCountdown(seconds)}</span>;
}

export function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-mystic/30 bg-panel p-3.5 scrollbar-thin md:p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="truncate text-sm font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="px-1 text-ink-dim hover:text-ink"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
