'use client';

import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import type {
  CreateTournamentRequest,
  MttSpeed,
  TournamentDetailView,
  TournamentSummary,
} from '@/lib/realtime/protocol';
import { useCountdownTo, formatCountdown } from '@/lib/hooks/use-countdown';
import Button from '@/components/ui/Button';

/**
 * 로비 토너먼트 섹션 — 목록(tournament-list 브로드캐스트) + 개설/상세 모달.
 * 상세(순위표·시계)는 열려 있는 동안 5초 폴링 (v1 계약 — spec §5-1).
 */

const SPEED_LABELS: Record<MttSpeed, string> = {
  standard: '스탠다드',
  turbo: '터보',
  hyper: '하이퍼',
};

const PHASE_BADGES: Record<TournamentSummary['phase'], { label: string; cls: string }> = {
  registering: { label: '등록 중', cls: 'bg-cyber/15 text-cyber border-cyber/40' },
  running: { label: '진행 중', cls: 'bg-gilded/15 text-gilded border-gilded/40' },
  completed: { label: '종료', cls: 'bg-mystic/15 text-mystic border-mystic/40' },
  cancelled: { label: '취소됨', cls: 'bg-panel text-ink-dim border-mystic/25' },
};

export default function TournamentPanel() {
  const tournaments = useGameStore(state => state.tournaments);
  const tournamentError = useGameStore(state => state.tournamentError);
  const clearTournamentError = useGameStore(state => state.clearTournamentError);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const visible = tournaments.filter(t => t.phase !== 'cancelled');

  return (
    <section className="mx-auto mb-2 w-full max-w-4xl flex-none px-3 md:px-4">
      <div className="rounded-2xl border border-gilded/30 bg-panel/85 p-2.5 md:p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">🏆 토너먼트</h2>
          <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>
            + 개설
          </Button>
        </div>
        {tournamentError && (
          <button
            type="button"
            onClick={clearTournamentError}
            className="mb-1.5 block w-full text-center text-xs text-blossom"
          >
            {tournamentError} (탭해서 닫기)
          </button>
        )}
        {visible.length === 0 ? (
          <p className="py-1 text-center text-xs text-ink-dim">
            열려 있는 토너먼트가 없어요 — 직접 개설해 보세요!
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map(t => (
              <TournamentRow key={t.id} tournament={t} onOpen={() => setDetailId(t.id)} />
            ))}
          </ul>
        )}
      </div>
      {createOpen && (
        <CreateTournamentModal
          onClose={() => setCreateOpen(false)}
          onCreated={id => {
            setCreateOpen(false);
            setDetailId(id);
          }}
        />
      )}
      {detailId && (
        <TournamentDetailModal tournamentId={detailId} onClose={() => setDetailId(null)} />
      )}
    </section>
  );
}

function TournamentRow({
  tournament,
  onOpen,
}: {
  tournament: TournamentSummary;
  onOpen: () => void;
}) {
  const badge = PHASE_BADGES[tournament.phase];
  const startSeconds = useCountdownTo(
    tournament.phase === 'registering' && tournament.startAt ? tournament.startAt : 0,
  );

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-mystic/25 bg-panel/70 px-2.5 py-2 text-left hover:border-gilded/40"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>
              {badge.label}
            </span>
            <span className="truncate text-sm font-bold text-ink">{tournament.name}</span>
            {tournament.registered && tournament.phase === 'registering' && (
              <span className="text-[10px] font-bold text-cyber">✓ 등록됨</span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-ink-dim">
            {SPEED_LABELS[tournament.speed]} · {tournament.tableSize}인 테이블 ·{' '}
            {tournament.phase === 'registering'
              ? `등록 ${tournament.entrantCount}/${tournament.maxEntrants}${tournament.botFill ? ' (봇 충원)' : ''}`
              : `잔존 ${tournament.remaining}/${tournament.entrantCount} · Lv.${tournament.level}`}
            {startSeconds !== null && startSeconds > 0 && (
              <span className="text-gilded"> · 시작 {formatCountdown(startSeconds)}</span>
            )}
          </p>
        </div>
        <div className="flex-none text-right">
          <p className="text-[10px] text-ink-dim">상금 풀</p>
          <p className="text-sm font-bold text-gilded">{tournament.prizePool.toLocaleString()}</p>
        </div>
      </button>
    </li>
  );
}

const ENTRANT_OPTIONS = [8, 12, 18, 24, 36, 48];
const START_DELAY_OPTIONS: Array<[label: string, minutes: number | null]> = [
  ['수동 시작 (내가 시작 버튼)', null],
  ['3분 후 자동 시작', 3],
  ['5분 후 자동 시작', 5],
  ['10분 후 자동 시작', 10],
];

function CreateTournamentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (tournamentId: string) => void;
}) {
  const createTournament = useGameStore(state => state.createTournament);
  const registerTournament = useGameStore(state => state.registerTournament);
  const playerName = useGameStore(state => state.playerName);
  const [name, setName] = useState(`${playerName}의 토너먼트`);
  const [speed, setSpeed] = useState<MttSpeed>('turbo');
  const [maxEntrants, setMaxEntrants] = useState(18);
  const [botFill, setBotFill] = useState(true);
  const [turnTime, setTurnTime] = useState(15);
  const [startDelayMin, setStartDelayMin] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const config: CreateTournamentRequest = {
      name: name.trim() || '무명 토너먼트',
      speed,
      maxEntrants,
      startAt: startDelayMin === null ? null : Date.now() + startDelayMin * 60_000,
      botFill,
      turnTime,
    };
    const id = await createTournament(config);
    if (id) {
      await registerTournament(id); // 개설자는 자동 등록 — 개설 후 바로 대기 명단에
      onCreated(id);
    }
    setBusy(false);
  };

  return (
    <ModalShell title="토너먼트 개설" onClose={onClose}>
      <label className="block text-xs text-ink-dim">
        이름
        <input
          value={name}
          onChange={e => setName(e.target.value.slice(0, 30))}
          className="mt-1 w-full rounded-lg border border-mystic/30 bg-panel px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {(Object.keys(SPEED_LABELS) as MttSpeed[]).map(value => (
          <OptionButton key={value} active={speed === value} onClick={() => setSpeed(value)}>
            {SPEED_LABELS[value]}
            <span className="block text-[9px] text-ink-dim">
              {value === 'standard' ? '8분 레벨' : value === 'turbo' ? '5분 레벨' : '3분 레벨'}
            </span>
          </OptionButton>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-dim">최대 인원</p>
      <div className="mt-1 grid grid-cols-6 gap-1.5">
        {ENTRANT_OPTIONS.map(value => (
          <OptionButton key={value} active={maxEntrants === value} onClick={() => setMaxEntrants(value)}>
            {value}
          </OptionButton>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-dim">턴 시간</p>
      <div className="mt-1 grid grid-cols-3 gap-1.5">
        {[8, 15, 30].map(value => (
          <OptionButton key={value} active={turnTime === value} onClick={() => setTurnTime(value)}>
            {value}초
          </OptionButton>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-dim">시작 방식</p>
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        {START_DELAY_OPTIONS.map(([label, minutes]) => (
          <OptionButton
            key={label}
            active={startDelayMin === minutes}
            onClick={() => setStartDelayMin(minutes)}
          >
            {label}
          </OptionButton>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-ink">
        <input type="checkbox" checked={botFill} onChange={e => setBotFill(e.target.checked)} />
        시작 시 남는 자리를 봇으로 채우기 (혼자여도 풀필드!)
      </label>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} className="flex-1">
          취소
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={busy} className="flex-1">
          {busy ? '개설 중…' : '개설하기'}
        </Button>
      </div>
    </ModalShell>
  );
}

function TournamentDetailModal({
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
  const myPlayerId = useGameStore(state => state.myPlayerId);
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
  const isHost = myPlayerId === summary.hostId;
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
          {summary.phase === 'registering'
            ? `등록 ${summary.entrantCount}/${summary.maxEntrants}`
            : `잔존 ${summary.remaining}/${summary.entrantCount} · 테이블 ${summary.tableCount}개`}
        </span>
        <span className="font-bold text-gilded">풀 {summary.prizePool.toLocaleString()}</span>
      </div>

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

      {isHost && summary.phase !== 'completed' && summary.phase !== 'cancelled' && (
        <div className="mt-2 rounded-lg border border-blossom/30 bg-blossom/5 p-2">
          <p className="mb-1.5 text-[10px] font-bold text-blossom">🛠️ 운영 (개설자 전용)</p>
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
              등록하기
            </Button>
          )}
          {isHost && (
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
                    {isHost && summary.phase === 'running' && (
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
          <h3 className="text-xs font-bold text-ink">상금 분배</h3>
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

function OptionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-1.5 py-1.5 text-center text-[11px] font-medium ${
        active
          ? 'border-blossom/50 bg-blossom/15 text-ink'
          : 'border-mystic/25 bg-panel/70 text-ink-dim hover:border-mystic/40'
      }`}
    >
      {children}
    </button>
  );
}

function ModalShell({
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
