'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import type {
  CreateTournamentRequest,
  MttSpeed,
  TournamentSummary,
} from '@/lib/realtime/protocol';
import { useCountdownTo, formatCountdown } from '@/lib/hooks/use-countdown';
import {
  MTT_WALLET_BUY_IN,
  MTT_WALLET_ENTRY_COST,
  MTT_WALLET_ENTRY_FEE,
} from '@/lib/economy/mtt-entry';
import Button from '@/components/ui/Button';
import TournamentDetailModal, { ModalShell } from './TournamentDetailModal';

/**
 * 로비 토너먼트 섹션 — 목록(tournament-list 브로드캐스트) + 개설 모달.
 * 상세(순위표·시계·운영 패널)는 TournamentDetailModal — 게임 중 TopBar 배지와 공용.
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
  const joinRoom = useGameStore(state => state.joinRoom);
  const badge = PHASE_BADGES[tournament.phase];
  const startSeconds = useCountdownTo(
    tournament.phase === 'registering' && tournament.startAt ? tournament.startAt : 0,
  );
  // 자리비움으로 떠난 생존 좌석 — 1탭 복귀 (서버가 본인 생존 좌석만 재입장 허용)
  const canReturn = tournament.phase === 'running' && !!tournament.myTableRoomId;

  return (
    <li className="flex items-stretch gap-1.5">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-mystic/25 bg-panel/70 px-2.5 py-2 text-left hover:border-gilded/40"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>
              {badge.label}
            </span>
            <span className="truncate text-sm font-bold text-ink">{tournament.name}</span>
            {tournament.economyMode === 'wallet' && (
              <span className="rounded-md border border-gilded/40 bg-gilded/15 px-1 py-0.5 text-[9px] font-bold text-gilded">
                💰 리얼 칩
              </span>
            )}
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
      {canReturn && (
        <button
          type="button"
          onClick={() => joinRoom(tournament.myTableRoomId!, 0, 0)}
          className="flex-none rounded-xl border border-cyber/40 bg-cyber/10 px-2.5 text-xs font-bold text-cyber hover:bg-cyber/20"
        >
          ▶ 게임<br />복귀
        </button>
      )}
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
  const [economyMode, setEconomyMode] = useState<'practice' | 'wallet'>('practice');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const config: CreateTournamentRequest = {
      name: name.trim() || '무명 토너먼트',
      speed,
      maxEntrants,
      startAt: startDelayMin === null ? null : Date.now() + startDelayMin * 60_000,
      // wallet은 봇 충원 불가 (서버도 강제) — 사람만 모여야 시작
      botFill: economyMode === 'wallet' ? false : botFill,
      turnTime,
      economyMode,
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
      <p className="mt-2 text-xs text-ink-dim">참가 방식</p>
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        <OptionButton
          active={economyMode === 'practice'}
          onClick={() => setEconomyMode('practice')}
        >
          🎯 무료 연습
          <span className="block text-[9px] text-ink-dim">상금은 표시용</span>
        </OptionButton>
        <OptionButton
          active={economyMode === 'wallet'}
          onClick={() => setEconomyMode('wallet')}
        >
          💰 리얼 칩
          <span className="block text-[9px] text-ink-dim">
            바이인 {MTT_WALLET_BUY_IN.toLocaleString()} + 수수료 {MTT_WALLET_ENTRY_FEE}
          </span>
        </OptionButton>
      </div>
      {economyMode === 'practice' ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" checked={botFill} onChange={e => setBotFill(e.target.checked)} />
          시작 시 남는 자리를 봇으로 채우기 (혼자여도 풀필드!)
        </label>
      ) : (
        <p className="mt-2 text-[10px] text-ink-dim">
          리얼 칩 토너먼트는 봇 충원 없이 사람만 참가해요 — 등록 시 참가비{' '}
          {MTT_WALLET_ENTRY_COST.toLocaleString()} 칩이 예약되고, 취소·유찰 시 전액 환불돼요.
        </p>
      )}
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
