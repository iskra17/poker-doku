'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore, RoomInfo } from '@/lib/store/game-store';
import { SITOUT_MISSED_BB_LIMIT } from '@/server/sitout';
import Button from '../ui/Button';

interface RoomListProps {
  onJoin: (roomId: string) => void;
}

// 난이도 배지 — normal은 표기 생략 (배지 과밀 방지)
const DIFFICULTY_BADGES: Record<string, { label: string; className: string }> = {
  easy: { label: '초보 환영', className: 'text-green-400 border-green-400/40' },
  hard: { label: '고수', className: 'text-red-400 border-red-400/40' },
};

// 인원 구성 배지 — 세 태그 모두 "누가 앉는가" 축.
// bots는 '봇 전용'이 아니라 '혼자 연습' — 전자는 AI끼리 논다는 오해를 부르고,
// 이 방의 실제 차별점은 봇 상대가 아니라(mixed도 봇이 있다) 다른 사람이 못 낀다는 점이다.
const TABLE_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  bots: { label: '🎯 혼자 연습', className: 'text-cyber border-cyber/40' },
  mixed: { label: '봇+사람', className: 'text-ink-dim border-white/20' },
  humans: { label: '사람만', className: 'text-blossom border-blossom/40' },
};

type ModeFilter = 'all' | 'cash' | 'sng';
type TypeFilter = 'all' | 'bots' | 'mixed' | 'humans';
type SortKey = 'default' | 'players' | 'blindAsc' | 'blindDesc';

const MODE_FILTERS: Array<{ id: ModeFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'cash', label: '캐시' },
  { id: 'sng', label: 'Sit & Go' },
];

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'bots', label: '🎯 혼자 연습' },
  { id: 'mixed', label: '봇+사람' },
  { id: 'humans', label: '사람만' },
];

// 정렬 버튼: 누를 때마다 순환
const SORT_LABELS: Record<SortKey, string> = {
  default: '기본순',
  players: '인원순',
  blindAsc: '블라인드 낮은순',
  blindDesc: '블라인드 높은순',
};
const SORT_CYCLE: SortKey[] = ['default', 'players', 'blindAsc', 'blindDesc'];

/** 보존 중인 내 좌석의 상태 안내 문구 (복귀 배너용) */
function mySeatStatusLine(room: RoomInfo): string {
  const seat = room.mySeat!;
  if (room.mode === 'sng') {
    return `칩 ${seat.chips.toLocaleString()} · 블라인드가 계속 차감되고 있어요 — 서둘러 돌아오세요!`;
  }
  if (seat.chips <= 0) {
    return '칩이 다 떨어졌어요 — 리바이하면 같은 자리에서 다시 시작해요.';
  }
  return `칩 ${seat.chips.toLocaleString()} · 자리비움 중 — 빅블라인드를 ${SITOUT_MISSED_BB_LIMIT}번 거르면 자동으로 일어나요.`;
}

/** 만석 판정 — 캐시 게임의 봇 좌석은 만석이 아니다 (휴먼이 오면 봇이 자리를 양보) */
function isRoomFull(room: RoomInfo): boolean {
  // 봇 전용 연습 테이블은 휴먼 1명 전용 — 누가 연습 중이면 입장 불가
  if (room.tableType === 'bots') return (room.humanCount ?? 0) >= 1;
  if (room.playerCount < room.maxPlayers) return false;
  if (room.mode === 'sng') return true; // SnG는 봇 양보 없음
  return (room.humanCount ?? room.playerCount) >= room.maxPlayers;
}

function applyFilters(rooms: RoomInfo[], mode: ModeFilter, type: TypeFilter, joinableOnly: boolean, sort: SortKey): RoomInfo[] {
  let list = rooms;
  if (mode !== 'all') list = list.filter(r => (r.mode ?? 'cash') === mode);
  if (type !== 'all') list = list.filter(r => (r.tableType ?? 'mixed') === type);
  // 내 좌석이 보존된 방은 잠금/만석과 무관하게 복귀 가능하므로 필터에서 제외하지 않는다
  if (joinableOnly) list = list.filter(r => r.mySeat || (!r.locked && !isRoomFull(r)));
  if (sort === 'default') return list;
  return [...list].sort((a, b) => {
    if (sort === 'players') return b.playerCount - a.playerCount;
    const diff = (a.bigBlind ?? 0) - (b.bigBlind ?? 0);
    return sort === 'blindAsc' ? diff : -diff;
  });
}

export default function RoomList({ onJoin }: RoomListProps) {
  const { rooms } = useGameStore();
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [joinableOnly, setJoinableOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('default');

  const visible = useMemo(
    () => applyFilters(rooms, modeFilter, typeFilter, joinableOnly, sort),
    [rooms, modeFilter, typeFilter, joinableOnly, sort],
  );
  // 자리비움 등으로 좌석이 보존된 방 — 필터와 무관하게 상단 복귀 배너로 노출
  const myRooms = useMemo(() => rooms.filter(r => r.mySeat), [rooms]);

  return (
    // 헤더/복귀 배너/필터는 고정, 테이블 목록만 내부 스크롤 — 테이블이 늘어나도 컨트롤이 화면 밖으로 밀리지 않는다
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-3 md:px-4">
      <div className="flex flex-none items-center justify-between mb-2 md:mb-3">
        <h2 className="text-mystic font-bold text-base md:text-lg">테이블 목록</h2>
        <Button
          variant="primary"
          size="sm"
          onClick={() => useGameStore.getState().setShowCreateRoom(true)}
        >
          + 방 만들기
        </Button>
      </div>

      {/* 보존 중인 내 좌석 — 자리비움으로 나온 테이블은 바이인/설정 없이 한 번에 복귀 */}
      {myRooms.map(room => (
        <motion.div
          key={`mine-${room.id}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 flex-none bg-panel/90 backdrop-blur-sm border border-gilded/50 rounded-xl p-3 flex items-center justify-between gap-3 shadow-[0_0_16px_rgba(255,215,106,0.15)]"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0 text-[10px] font-bold text-gilded border border-gilded/50 rounded px-1 py-px">
                🪑 내 자리
              </span>
              <span className="text-white font-bold text-sm truncate">{room.name}</span>
            </div>
            <p className="text-xs text-ink-dim mt-1 leading-relaxed">{mySeatStatusLine(room)}</p>
          </div>
          <Button variant="success" size="sm" className="shrink-0" onClick={() => onJoin(room.id)}>
            {room.mode !== 'sng' && (room.mySeat?.chips ?? 0) <= 0 ? '리바이' : '게임 복귀'}
          </Button>
        </motion.div>
      ))}

      {/* 필터/정렬 바 */}
      <div className="flex flex-none flex-wrap items-center gap-1.5 mb-2">
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
        <div className="flex rounded-lg border border-mystic/20 overflow-hidden">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setTypeFilter(f.id)}
              className={`px-2.5 py-1 text-xs font-bold transition-colors whitespace-nowrap ${
                typeFilter === f.id
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

      {/* 테이블 목록 — 유일한 스크롤 영역 */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-4 scrollbar-thin md:space-y-3">
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
                  {TABLE_TYPE_BADGES[room.tableType ?? 'mixed'] && (
                    <span className={`shrink-0 text-[10px] font-bold border rounded px-1 py-px ${TABLE_TYPE_BADGES[room.tableType ?? 'mixed'].className}`}>
                      {TABLE_TYPE_BADGES[room.tableType ?? 'mixed'].label}
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
              // 내 좌석이 보존된 방은 잠금(시작된 SnG)/만석과 무관하게 복귀 가능
              variant={room.mySeat ? 'success' : room.locked || isRoomFull(room) ? 'secondary' : 'success'}
              size="sm"
              disabled={!room.mySeat && (room.locked || isRoomFull(room))}
              onClick={() => onJoin(room.id)}
            >
              {room.mySeat
                ? '복귀'
                : room.locked
                  ? '진행 중'
                  : isRoomFull(room)
                    ? room.tableType === 'bots' ? '연습 중' : '만석'
                    : '참가'}
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
              onClick={() => {
                setModeFilter('all');
                setTypeFilter('all');
                setJoinableOnly(false);
                setSort('default');
              }}
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
