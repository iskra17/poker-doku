'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
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

export default function RoomList({ onJoin }: RoomListProps) {
  const { rooms } = useGameStore();
  const [helpOpen, setHelpOpen] = useState(false);

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

      <div className="space-y-2 md:space-y-3">
        {rooms.map((room, i) => (
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
                    <span className={room.playerCount >= room.maxPlayers ? 'text-red-400' : 'text-green-400'}>
                      {room.playerCount}/{room.maxPlayers}
                    </span>
                  </span>
                  <span className={`${room.status === 'Playing' ? 'text-green-400' : 'text-ink-dim'}`}>
                    {room.status === 'Playing' ? '게임 중' : '대기 중'}
                  </span>
                </div>
              </div>
            </div>

            <Button
              variant={room.locked || room.playerCount >= room.maxPlayers ? 'secondary' : 'success'}
              size="sm"
              disabled={room.locked || room.playerCount >= room.maxPlayers}
              onClick={() => onJoin(room.id)}
            >
              {room.locked ? '진행 중' : room.playerCount >= room.maxPlayers ? '만석' : '참가'}
            </Button>
          </motion.div>
        ))}

        {rooms.length === 0 && (
          <div className="text-center py-12 text-ink-dim">
            <p className="text-4xl mb-3">🃏</p>
            <p className="text-sm">아직 테이블이 없어요. 새 방을 만들어 시작해보세요!</p>
          </div>
        )}
      </div>
    </div>
  );
}
