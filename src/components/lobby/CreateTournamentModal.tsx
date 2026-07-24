'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import type { CreateTournamentRequest, MttSpeed } from '@/lib/realtime/protocol';
import {
  MTT_WALLET_BUY_IN,
  MTT_WALLET_ENTRY_COST,
  MTT_WALLET_ENTRY_FEE,
} from '@/lib/economy/mtt-entry';
import Button from '@/components/ui/Button';
import { ModalShell } from './TournamentDetailModal';

/** 토너먼트 개설 모달 — RoomList의 '토너먼트' 탭 [+ 개설]에서 진입. 개설자는 자동 등록. */

const SPEED_LABELS: Record<MttSpeed, string> = {
  standard: '스탠다드',
  turbo: '터보',
  hyper: '하이퍼',
};

const ENTRANT_OPTIONS = [8, 12, 18, 24, 36, 48];
const START_DELAY_OPTIONS: Array<[label: string, minutes: number | null]> = [
  ['수동 시작 (내가 시작 버튼)', null],
  ['3분 후 자동 시작', 3],
  ['5분 후 자동 시작', 5],
  ['10분 후 자동 시작', 10],
];

export default function CreateTournamentModal({
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
      <div className="mb-2 rounded-lg border border-mystic/25 bg-panel/70 px-2.5 py-2 text-[10px] leading-relaxed text-ink-dim">
        <p className="font-bold text-ink">프리즈아웃 · 늦은 등록 없음 · 재등록/리엔트리 없음</p>
        <p className="mt-0.5">
          최소 8명 필드가 필요하며, 등록한 사람은 시작 시 온라인이어야 체크인되어 착석해요.
        </p>
      </div>
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
          체크인 후 최대 인원까지 남은 자리를 봇으로 채우기
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
