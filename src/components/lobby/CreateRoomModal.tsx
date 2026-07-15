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
type Difficulty = 'easy' | 'normal' | 'hard';

const DIFFICULTIES: Array<{ id: Difficulty; label: string; desc: string }> = [
  { id: 'easy', label: '순한 상대', desc: '블러프 적고 예측 가능' },
  { id: 'normal', label: '보통', desc: '캐릭터 본연의 스타일' },
  { id: 'hard', label: '거친 상대', desc: '공격적 · 블러프 많음' },
];

const TURN_TIMES = [
  { seconds: 8, label: '8초', desc: '표준' },
  { seconds: 15, label: '15초', desc: '여유' },
  { seconds: 30, label: '30초', desc: '초보 추천' },
];

// 테이블 인원 구성 (캐시 전용) — 서버가 봇 충원 수를 함께 결정 (bots=5, mixed=2, humans=0)
type TableType = 'bots' | 'mixed' | 'humans';
const TABLE_TYPES: Array<{ id: TableType; label: string; desc: string; hint: string }> = [
  {
    id: 'bots',
    label: '🎯 혼자 연습',
    desc: '나 + 봇 5명',
    hint: '봇 5명과 나만의 연습 테이블 — 다른 플레이어는 입장할 수 없어요.',
  },
  {
    id: 'mixed',
    label: '봇+사람',
    desc: '봇 2명 + 자유 입장',
    hint: '봇이 자리를 지키다가 사람이 오면 양보해요. 남는 좌석은 항상 사람 몫!',
  },
  {
    id: 'humans',
    label: '사람만',
    desc: '친구끼리만',
    hint: '봇 없이 사람만 앉아요 — 2명 이상 모이면 게임이 시작돼요.',
  },
];

export default function CreateRoomModal() {
  const { showCreateRoom, setShowCreateRoom, createRoom } = useGameStore();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('cash');
  const [blindIndex, setBlindIndex] = useState(1);
  const [password, setPassword] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [turnTime, setTurnTime] = useState(8);
  const [tableType, setTableType] = useState<TableType>('mixed');

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
      difficulty,
      turnTime,
      tableType: mode === 'cash' ? tableType : 'mixed', // SnG는 방장 봇 채우기가 있는 혼합 고정
      botCount: tableType === 'humans' ? 0 : tableType === 'bots' ? 5 : 2,
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

        {/* 테이블 구성 (캐시 전용 — SnG는 방장이 대기 화면에서 봇을 채우는 혼합 고정) */}
        {mode === 'cash' && (
          <div>
            <label className="text-gray-400 text-sm block mb-2">테이블 구성</label>
            <div className="grid grid-cols-3 gap-2">
              {TABLE_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTableType(t.id)}
                  className={`py-2 rounded-lg text-sm font-bold transition-all ${
                    tableType === t.id
                      ? 'bg-purple-600 text-white border border-purple-400'
                      : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
                  }`}
                >
                  {t.label}
                  <span className="block text-[10px] font-normal opacity-70">{t.desc}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              {TABLE_TYPES.find(t => t.id === tableType)!.hint}
            </p>
          </div>
        )}

        {/* 봇 난이도 — 사람만 테이블(캐시)엔 봇이 없어 표시하지 않음 */}
        {!(mode === 'cash' && tableType === 'humans') && (
          <div>
            <label className="text-gray-400 text-sm block mb-2">봇 난이도</label>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.id}
                  onClick={() => setDifficulty(d.id)}
                  className={`py-2 rounded-lg text-sm font-bold transition-all ${
                    difficulty === d.id
                      ? 'bg-purple-600 text-white border border-purple-400'
                      : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
                  }`}
                >
                  {d.label}
                  <span className="block text-[10px] font-normal opacity-70">{d.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 턴 시간 */}
        <div>
          <label className="text-gray-400 text-sm block mb-2">턴 시간</label>
          <div className="grid grid-cols-3 gap-2">
            {TURN_TIMES.map(t => (
              <button
                key={t.seconds}
                onClick={() => setTurnTime(t.seconds)}
                className={`py-2 rounded-lg text-sm font-bold transition-all ${
                  turnTime === t.seconds
                    ? 'bg-purple-600 text-white border border-purple-400'
                    : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
                }`}
              >
                {t.label}
                <span className="block text-[10px] font-normal opacity-70">{t.desc}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            시간이 다 되면 타임칩이 자동 사용되고, 다 쓰면 자동 체크/폴드돼요.
          </p>
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
