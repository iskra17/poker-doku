'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { DEALER_CHARACTER } from '@/lib/characters';
import LobbyHeader from '@/components/lobby/LobbyHeader';
import RoomList from '@/components/lobby/RoomList';
import CreateRoomModal from '@/components/lobby/CreateRoomModal';
import GameRoomView from '@/components/layout/GameRoomView';
import CharacterImage from '@/components/characters/CharacterImage';
import Button from '@/components/ui/Button';

const LOBBY_BG_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(rgba(10,6,20,0.82), rgba(10,6,20,0.92)), url(/assets/bg/lobby.jpg)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
};

export default function Home() {
  const { connect, connected, playerName, setPlayerName, joinRoom, leaveRoom, currentRoomId } = useGameStore();
  const [nameInput, setNameInput] = useState('');
  const [hasName, setHasName] = useState(false);

  useEffect(() => {
    connect();
  }, [connect]);

  const handleSetName = () => {
    const name = nameInput.trim();
    if (!name) return;
    setPlayerName(name);
    setHasName(true);
  };

  const handleJoinRoom = (roomId: string) => {
    const room = useGameStore.getState().rooms.find(r => r.id === roomId);
    if (!room) return;
    const blinds = room.blinds.split('/');
    const bb = parseInt(blinds[1]) || 20;
    joinRoom(roomId, bb * 50, 0);
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
        <RoomList onJoin={handleJoinRoom} />
      </div>
      <CreateRoomModal />
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
          {DEALER_CHARACTER.nameJp} {DEALER_CHARACTER.name}
        </div>
        <p className="text-ink text-xs leading-relaxed min-h-[32px]">
          {display}
          <span className="animate-pulse text-gilded">▏</span>
        </p>
      </div>
    </div>
  );
}
