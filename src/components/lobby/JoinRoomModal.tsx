'use client';

import { useState } from 'react';
import { useGameStore, RoomInfo } from '@/lib/store/game-store';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

interface JoinRoomModalProps {
  room: RoomInfo; // 부모가 key={room.id}로 마운트해 방이 바뀌면 상태가 리셋된다
  onClose: () => void;
}

/**
 * 테이블 입장 모달 — 캐시는 바이인(40~200BB) 선택, Sit & Go는 고정 스택 안내. 비밀번호 방은 입력 요구.
 * 보존된 내 좌석(mySeat)이 있는 방은 page.tsx가 모달 없이 즉시 복귀시키므로, 여기로 오는
 * mySeat 케이스는 파산(0칩) 캐시 좌석의 리바이뿐 — 비밀번호는 재입장 멱등 경로라 묻지 않는다.
 */
export default function JoinRoomModal({ room, onClose }: JoinRoomModalProps) {
  const joinRoom = useGameStore(s => s.joinRoom);
  const rooms = useGameStore(s => s.rooms);

  const isSng = room.mode === 'sng';
  const isRebuyReturn = !!room.mySeat;
  const needPassword = !!room.hasPassword && !isRebuyReturn;
  // 다른 테이블에 보존해 둔 좌석 — 이 방에 앉는 순간 서버가 회수한다 (1세션 1테이블)
  const otherSeatRoom = rooms.find(r => r.mySeat && r.id !== room.id);
  const bb = room.bigBlind ?? (parseInt(room.blinds.split('/')[1]) || 20);
  const minBuyIn = room.minBuyIn ?? bb * 40;
  const maxBuyIn = room.maxBuyIn ?? bb * 200;
  const defaultBuyIn = Math.min(Math.max(bb * 100, minBuyIn), maxBuyIn);

  const [buyIn, setBuyIn] = useState(defaultBuyIn);
  const [password, setPassword] = useState('');

  const handleJoin = () => {
    joinRoom(room.id, buyIn, 0, needPassword ? password : undefined);
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title={room.name}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="font-bold text-white">{isSng ? '🏆 Sit & Go' : '♠️ 캐시 게임'}</span>
          <span>블라인드 <span className="text-yellow-300">{room.blinds}</span></span>
          <span>{room.playerCount}/{room.maxPlayers}명</span>
        </div>

        {isSng ? (
          <div className="bg-gray-800/30 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between text-gray-400">
              <span>시작 스택 (전원 동일)</span>
              <span className="text-yellow-300">{(room.minBuyIn ?? 1500).toLocaleString()}</span>
            </div>
            <p className="text-[11px] text-gray-500 pt-1">
              6명이 모이면 시작해요. 탈락하면 리바이 없이 관전으로 전환됩니다.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-gray-400 text-sm">바이인</label>
              <span className="text-yellow-300 font-bold tabular">
                {buyIn.toLocaleString()}
                <span className="text-gray-500 text-xs font-normal"> ({Math.round(buyIn / bb)}BB)</span>
              </span>
            </div>
            <input
              type="range"
              min={minBuyIn}
              max={maxBuyIn}
              step={bb}
              value={buyIn}
              onChange={e => setBuyIn(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
              <span>{minBuyIn.toLocaleString()} (40BB)</span>
              <span>{maxBuyIn.toLocaleString()} (200BB)</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                { label: '최소 40BB', value: minBuyIn },
                { label: '기본 100BB', value: defaultBuyIn },
                { label: '최대 200BB', value: maxBuyIn },
              ].map(preset => (
                <button
                  key={preset.label}
                  onClick={() => setBuyIn(preset.value)}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    buyIn === preset.value
                      ? 'bg-purple-600 text-white border border-purple-400'
                      : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {isRebuyReturn && (
          <p className="text-xs text-gilded/90 bg-gilded/10 border border-gilded/30 rounded-lg px-3 py-2 leading-relaxed">
            🪑 좌석은 그대로 남아 있어요 — 새 바이인으로 같은 자리에서 다시 시작해요.
          </p>
        )}
        {otherSeatRoom && (
          <p className="text-xs text-red-300 bg-red-500/10 border border-red-400/30 rounded-lg px-3 py-2 leading-relaxed">
            ⚠️ <span className="font-bold">{otherSeatRoom.name}</span>에 자리비움 중인 좌석
            (칩 {otherSeatRoom.mySeat!.chips.toLocaleString()})은 이 테이블에 앉는 순간 정리돼요.
          </p>
        )}

        {needPassword && (
          <div>
            <label className="text-gray-400 text-sm block mb-1">🔒 방 비밀번호</label>
            <input
              type="text"
              value={password}
              onChange={e => setPassword(e.target.value)}
              maxLength={20}
              placeholder="비밀번호를 입력하세요"
              className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/50"
              autoFocus
            />
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={handleJoin}
          disabled={needPassword && !password.trim()}
        >
          {isRebuyReturn ? '리바이하고 복귀' : isSng ? '참가하기' : '앉기'}
        </Button>
      </div>
    </Modal>
  );
}
