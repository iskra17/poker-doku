'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { SNG_BLIND_SCHEDULE, SNG_LEVEL_DURATION_MS, SNG_STARTING_STACK } from '@/lib/poker/blind-schedule';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

// 바이인 범위는 40~200BB 표준 (서버도 동일 규칙으로 강제)
const BLIND_LEVELS = [
  { sb: 5, bb: 10 },
  { sb: 10, bb: 20 },
  { sb: 25, bb: 50 },
  { sb: 50, bb: 100 },
  { sb: 100, bb: 200 },
];
const MIN_BUYIN_BB = 40;
const MAX_BUYIN_BB = 200;

type Mode = 'cash' | 'sng';

export default function CreateRoomModal() {
  const { showCreateRoom, setShowCreateRoom, createRoom } = useGameStore();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('cash');
  const [blindIndex, setBlindIndex] = useState(1);
  const [password, setPassword] = useState('');

  const blind = BLIND_LEVELS[blindIndex];
  const sngStart = SNG_BLIND_SCHEDULE[0];

  const handleCreate = () => {
    const fallback = mode === 'sng' ? `Sit & Go ${Math.floor(Math.random() * 1000)}` : `Table ${Math.floor(Math.random() * 1000)}`;
    const roomName = name.trim() || fallback;
    createRoom({
      name: roomName,
      smallBlind: blind.sb,
      bigBlind: blind.bb,
      minBuyIn: blind.bb * MIN_BUYIN_BB,
      maxBuyIn: blind.bb * MAX_BUYIN_BB,
      gameMode: mode,
      password: password.trim() || undefined,
    });
    setName('');
    setPassword('');
  };

  return (
    <Modal isOpen={showCreateRoom} onClose={() => setShowCreateRoom(false)} title="방 만들기">
      <div className="space-y-4">
        {/* 게임 모드 */}
        <div>
          <label className="text-gray-400 text-sm block mb-2">게임 모드</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'cash' as Mode, label: '캐시 게임', desc: '자유 입퇴장' },
              { id: 'sng' as Mode, label: 'Sit & Go', desc: '6인 토너먼트' },
            ]).map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`py-2 rounded-lg text-sm font-bold transition-all ${
                  mode === m.id
                    ? 'bg-purple-600 text-white border border-purple-400'
                    : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
                }`}
              >
                {m.label}
                <span className="block text-[10px] font-normal opacity-70">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 방 이름 */}
        <div>
          <label className="text-gray-400 text-sm block mb-1">방 이름</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="방 이름을 입력하세요..."
            className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/50"
          />
        </div>

        {/* 비밀번호 (선택) */}
        <div>
          <label className="text-gray-400 text-sm block mb-1">비밀번호 (선택)</label>
          <input
            type="text"
            value={password}
            onChange={e => setPassword(e.target.value)}
            maxLength={20}
            placeholder="설정하면 아는 사람만 입장할 수 있어요"
            className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/50"
          />
        </div>

        {mode === 'cash' ? (
          <>
            {/* 블라인드 레벨 */}
            <div>
              <label className="text-gray-400 text-sm block mb-2">블라인드</label>
              <div className="grid grid-cols-5 gap-2">
                {BLIND_LEVELS.map((bl, i) => (
                  <button
                    key={i}
                    onClick={() => setBlindIndex(i)}
                    className={`py-2 rounded-lg text-sm font-bold transition-all ${
                      blindIndex === i
                        ? 'bg-purple-600 text-white border border-purple-400'
                        : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
                    }`}
                  >
                    {bl.sb}/{bl.bb}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-gray-800/30 rounded-lg p-3 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>바이인 범위</span>
                <span className="text-yellow-300">
                  {(blind.bb * MIN_BUYIN_BB).toLocaleString()} - {(blind.bb * MAX_BUYIN_BB).toLocaleString()}
                  <span className="text-gray-500"> ({MIN_BUYIN_BB}~{MAX_BUYIN_BB}BB)</span>
                </span>
              </div>
              <div className="flex justify-between text-gray-400 mt-1">
                <span>최대 인원</span>
                <span className="text-white">6</span>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-gray-800/30 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between text-gray-400">
              <span>시작 스택</span>
              <span className="text-yellow-300">{SNG_STARTING_STACK.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>시작 블라인드</span>
              <span className="text-white">{sngStart.smallBlind}/{sngStart.bigBlind}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>블라인드 인상</span>
              <span className="text-white">{SNG_LEVEL_DURATION_MS / 60000}분마다</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>시상</span>
              <span className="text-white">1~3위 (50/30/20%)</span>
            </div>
            <p className="text-[11px] text-gray-500 pt-1">
              6명이 모두 모이면 자동 시작돼요. 방장은 남는 자리를 봇으로 채워 바로 시작할 수도 있어요.
              시작 후에는 참가·리바이가 불가능해요.
            </p>
          </div>
        )}

        {/* 만들기 */}
        <Button variant="primary" size="lg" className="w-full" onClick={handleCreate}>
          {mode === 'sng' ? 'Sit & Go 만들기' : '테이블 만들기'}
        </Button>
      </div>
    </Modal>
  );
}
