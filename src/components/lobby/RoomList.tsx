'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore, RoomInfo } from '@/lib/store/game-store';
import Button from '../ui/Button';
import HelpModal from '../help/HelpModal';

interface RoomListProps {
  onJoin: (roomId: string) => void;
}

// 난이도 배지 — normal은 표기 생략 (배지 과밀 방지)
const DIFFICULTY_BADGES: Record<string, { label: string; className: string }> = {
  easy: { label: '초보 환영', className: 'text-green-400 border-green-400/40' },
  hard: { label: '고수', className: 'text-red-400 border-red-400/40' },
};

type ModeFilter = 'all' | 'cash' | 'sng';
type SortKey = 'default' | 'players' | 'blindAsc' | 'blindDesc';

const MODE_FILTERS: Array<{ id: ModeFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'cash', label: '캐시' },
  { id: 'sng', label: 'Sit & Go' },
];

// 정렬 버튼: 누를 때마다 순환
const SORT_LABELS: Record<SortKey, string> = {
  default: '기본순',
  players: '인원순',
  blindAsc: '블라인드 낮은순',
  blindDesc: '블라인드 높은순',
};
const SORT_CYCLE: SortKey[] = ['default', 'players', 'blindAsc', 'blindDesc'];

/** 만석 판정 — 캐시 게임의 봇 좌석은 만석이 아니다 (휴먼이 오면 봇이 자리를 양보) */
function isRoomFull(room: RoomInfo): boolean {
  if (room.playerCount < room.maxPlayers) return false;
  if (room.mode === 'sng') return true; // SnG는 봇 양보 없음
  return (room.humanCount ?? room.playerCount) >= room.maxPlayers;
}

function applyFilters(rooms: RoomInfo[], mode: ModeFilter, joinableOnly: boolean, sort: SortKey): RoomInfo[] {
  let list = rooms;
  if (mode !== 'all') list = list.filter(r => (r.mode ?? 'cash') === mode);
  if (joinableOnly) list = list.filter(r => !r.locked && !isRoomFull(r));
  if (sort === 'default') return list;
  return [...list].sort((a, b) => {
    if (sort === 'players') return b.playerCount - a.playerCount;
    const diff = (a.bigBlind ?? 0) - (b.bigBlind ?? 0);
    return sort === 'blindAsc' ? diff : -diff;
  });
}

export default function RoomList({ onJoin }: RoomListProps) {
  const { rooms } = useGameStore();
  const [helpOpen, setHelpOpen] = useState(false);
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [joinableOnly, setJoinableOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('default');

  const visible = useMemo(
    () => applyFilters(rooms, modeFilter, joinableOnly, sort),
    [rooms, modeFilter, joinableOnly, sort],
  );

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4">
      <div className="flex items-center justify-between mb-3 md:mb-4">
        <h2 className="text-mystic font-bold text-base md:text-lg">테이블 목록</h2>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setHelpOpen(true)}>
            ❓ 도움말
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => useGameStore.getState().setShowCreateRoom(true)}
          >
            + 방 만들기
          </Button>
        </div>
      </div>
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* 필터/정렬 바 */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <div className="flex rounded-lg border border-mystic/20 overflow-hidden">
          {MODE_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setModeFilter(f.id)}
              className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                modeFilter === f.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-panel/60 text-ink-dim hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setJoinableOnly(v => !v)}
          className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-colors ${
            joinableOnly
              ? 'bg-purple-600 text-white border-purple-400'
              : 'bg-panel/60 text-ink-dim border-mystic/20 hover:text-ink'
          }`}
        >
          참가 가능만
        </button>
        <button
          onClick={() => setSort(s => SORT_CYCLE[(SORT_CYCLE.indexOf(s) + 1) % SORT_CYCLE.length])}
          className="ml-auto px-2.5 py-1 text-xs font-bold rounded-lg border border-mystic/20 bg-panel/60 text-ink-dim hover:text-ink transition-colors"
          title="누르면 정렬 기준이 바뀝니다"
        >
          ↕ {SORT_LABELS[sort]}
        </button>
      </div>

      <div className="space-y-2 md:space-y-3">
        {visible.map((room, i) => (
          <motion.div
            key={room.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-panel/80 backdrop-blur-sm border border-mystic/20 rounded-xl p-3 md:p-4 flex items-center justify-between hover:border-blossom/40 transition-all active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              {/* Table icon — 시트앤고는 트로피, 캐시는 스페이드 */}
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-purple-600/30 to-pink-600/30 flex items-center justify-center text-xl md:text-2xl border border-mystic/20 shrink-0">
                {room.mode === 'sng' ? '🏆' : '♠️'}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {room.mode === 'sng' && (
                    <span className="shrink-0 text-[10px] font-bold text-gilded border border-gilded/40 rounded px-1 py-px">
                      Sit &amp; Go
                    </span>
                  )}
                  {room.difficulty && DIFFICULTY_BADGES[room.difficulty] && (
                    <span className={`shrink-0 text-[10px] font-bold border rounded px-1 py-px ${DIFFICULTY_BADGES[room.difficulty].className}`}>
                      {DIFFICULTY_BADGES[room.difficulty].label}
                    </span>
                  )}
                  {room.hasPassword && (
                    <span className="shrink-0 text-[11px]" title="비밀번호 방">🔒</span>
                  )}
                  <h3 className="text-white font-bold text-sm md:text-base truncate">{room.name}</h3>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs md:text-sm text-ink-dim mt-0.5">
                  <span>블라인드 <span className="text-gilded">{room.blinds}</span></span>
                  {(room.turnTime ?? 8) > 8 && (
                    <span>턴 <span className="text-cyber">{room.turnTime}초</span></span>
                  )}
                  <span>
                    <span className={isRoomFull(room) ? 'text-red-400' : 'text-green-400'}>
                      {room.playerCount}/{room.maxPlayers}
                    </span>
                    {(room.humanCount ?? room.playerCount) < room.playerCount && (
                      <span className="text-ink-dim/70"> (봇 {room.playerCount - (room.humanCount ?? 0)})</span>
                    )}
                  </span>
                  <span className={`${room.status === 'Playing' ? 'text-green-400' : 'text-ink-dim'}`}>
                    {room.status === 'Playing' ? '게임 중' : '대기 중'}
                  </span>
                </div>
              </div>
            </div>

            <Button
              variant={room.locked || isRoomFull(room) ? 'secondary' : 'success'}
              size="sm"
              disabled={room.locked || isRoomFull(room)}
              onClick={() => onJoin(room.id)}
            >
              {room.locked ? '진행 중' : isRoomFull(room) ? '만석' : '참가'}
            </Button>
          </motion.div>
        ))}

        {rooms.length === 0 ? (
          <div className="text-center py-12 text-ink-dim">
            <p className="text-4xl mb-3">🃏</p>
            <p className="text-sm">아직 테이블이 없어요. 새 방을 만들어 시작해보세요!</p>
          </div>
        ) : visible.length === 0 && (
          <div className="text-center py-12 text-ink-dim">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-sm">조건에 맞는 테이블이 없어요.</p>
            <button
              onClick={() => { setModeFilter('all'); setJoinableOnly(false); }}
              className="mt-2 text-xs text-mystic underline underline-offset-2 hover:text-blossom"
            >
              필터 초기화
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
