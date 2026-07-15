'use client';

import { useEffect, useState } from 'react';
import { useGameStore, RoomInfo } from '@/lib/store/game-store';
import { initMusicSystem, setMusicScene } from '@/lib/sound/music-manager';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { DEALER_CHARACTER } from '@/lib/characters';
import LobbyHeader from '@/components/lobby/LobbyHeader';
import RoomList from '@/components/lobby/RoomList';
import CreateRoomModal from '@/components/lobby/CreateRoomModal';
import JoinRoomModal from '@/components/lobby/JoinRoomModal';
import GameRoomView from '@/components/layout/GameRoomView';
import CharacterImage from '@/components/characters/CharacterImage';
import Button from '@/components/ui/Button';

const LOBBY_BG_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(rgba(10,6,20,0.82), rgba(10,6,20,0.92)), url(/assets/bg/lobby.webp)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
};

export default function Home() {
  const { connect, connected, playerName, setPlayerName, leaveRoom, currentRoomId, joinError, rooms } = useGameStore();
  const [nameInput, setNameInput] = useState('');
  const [hasName, setHasName] = useState(false);
  const [joinTarget, setJoinTarget] = useState<RoomInfo | null>(null);
  // 초대 링크(?room=id)로 진입한 경우 — 닉네임 입력 후 해당 방 입장 모달을 자동으로 연다
  const [inviteRoomId, setInviteRoomId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('room'),
  );

  useEffect(() => {
    connect();
  }, [connect]);

  // 로비/이름 입력 화면 BGM (인룸은 GameRoomView가 테이블 테마로 전환)
  useEffect(() => {
    initMusicSystem();
    if (!currentRoomId) setMusicScene('lobby');
  }, [currentRoomId]);

  const handleSetName = () => {
    const name = nameInput.trim();
    if (!name) return;
    setPlayerName(name);
    setHasName(true);
  };

  // 보존 중인 내 좌석이 있으면 이미 착석 상태 — 바이인/비밀번호를 다시 묻지 않고 즉시 복귀 가능
  // (서버 join-room 멱등 경로가 좌석/칩을 그대로 되살린다). 단, 캐시에서 칩이 0으로
  // 파산한 좌석은 새 바이인이 필요하므로 리바이 모달을 거친다.
  const canFastRejoin = (room: RoomInfo) =>
    !!room.mySeat && (room.mode === 'sng' || room.mySeat.chips > 0);

  const handleJoinRoom = (roomId: string) => {
    const room = useGameStore.getState().rooms.find(r => r.id === roomId);
    if (!room) return;
    if (canFastRejoin(room)) {
      useGameStore.getState().joinRoom(room.id, 0, 0);
      return;
    }
    setJoinTarget(room);
  };

  // 초대받은 방 (파생값 — 목록 도착 후 유효성 판단)
  const inviteRoom = inviteRoomId ? rooms.find(r => r.id === inviteRoomId) ?? null : null;
  const inviteNotFound = !!inviteRoomId && rooms.length > 0 && !inviteRoom;
  // 좌석이 보존된 방(즉시 복귀 대상)은 초대 모달을 자동으로 열지 않는다 — 상단 복귀 배너로 안내
  const activeJoinTarget = joinTarget
    ?? (hasName && inviteRoom && !inviteRoom.locked && !canFastRejoin(inviteRoom) ? inviteRoom : null);

  const closeJoinModal = () => {
    setJoinTarget(null);
    if (inviteRoomId) {
      setInviteRoomId(null);
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  // --- Table view (in-room) ---
  if (currentRoomId) {
    return <GameRoomView onLeave={leaveRoom} />;
  }

  // --- Name entry ---
  if (!hasName) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center px-4" style={LOBBY_BG_STYLE}>
        <LobbyHeader />
        <div className="mt-4 md:mt-6 bg-panel/80 backdrop-blur-sm border border-mystic/20 rounded-2xl p-6 md:p-8 max-w-sm w-full">
          <MiyakoGreeting />
          <input
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetName()}
            placeholder="포커 닉네임을 입력하세요"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-ink-dim/50 focus:outline-none focus:border-blossom/50 text-center text-base md:text-lg mb-4"
            autoFocus
            enterKeyHint="go"
            autoComplete="off"
            autoCapitalize="off"
          />
          <Button variant="primary" size="lg" className="w-full" onClick={handleSetName}>
            로비 입장
          </Button>
          <div className="flex items-center justify-center gap-2 mt-3">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-ink-dim/70 text-xs">{connected ? '서버 연결됨' : '연결 중...'}</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Lobby ---
  return (
    <div className="h-dvh overflow-y-auto pt-safe" style={LOBBY_BG_STYLE}>
      <LobbyHeader />
      <div className="py-4">
        <div className="text-center mb-4">
          <span className="text-ink-dim text-sm">플레이어: </span>
          <span className="text-mystic font-bold">{playerName}</span>
        </div>
        {joinError && (
          <p className="text-center text-red-400 text-xs mb-3">{joinError}</p>
        )}
        {inviteNotFound && (
          <p className="text-center text-red-400 text-xs mb-3">
            초대받은 방을 찾을 수 없어요 — 이미 종료됐을 수 있어요.
          </p>
        )}
        {inviteRoom?.locked && (
          <p className="text-center text-red-400 text-xs mb-3">
            초대받은 Sit &amp; Go가 이미 시작됐어요.
          </p>
        )}
        <RoomList onJoin={handleJoinRoom} />
      </div>
      <CreateRoomModal />
      {activeJoinTarget && (
        <JoinRoomModal key={activeJoinTarget.id} room={activeJoinTarget} onClose={closeJoinModal} />
      )}
    </div>
  );
}

/** 이름 입력 화면의 미야코 인사 (버스트업 + 타이핑) */
function MiyakoGreeting() {
  const { display } = useTypewriter(DEALER_CHARACTER.greeting, 35);
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-16 h-16 shrink-0 rounded-full border-2 border-gilded/50 shadow-[0_0_18px_rgba(255,215,106,0.25)]">
        <CharacterImage characterId="dealer" round className="w-full h-full text-2xl" />
      </div>
      <div className="min-w-0">
        <div className="text-gilded text-xs font-bold mb-0.5" style={{ fontFamily: 'var(--font-display)' }}>
          딜러 (미야코)
        </div>
        <p className="text-ink text-xs leading-relaxed min-h-[32px]">
          {display}
          <span className="animate-pulse text-gilded">▏</span>
        </p>
      </div>
    </div>
  );
}
