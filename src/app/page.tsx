'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import LobbyHeader from '@/components/lobby/LobbyHeader';
import RoomList from '@/components/lobby/RoomList';
import CreateRoomModal from '@/components/lobby/CreateRoomModal';
import PokerTable from '@/components/table/PokerTable';
import ChatPanel from '@/components/chat/ChatPanel';
import Button from '@/components/ui/Button';
import NeonText from '@/components/ui/NeonText';

export default function Home() {
  const { connect, connected, playerName, setPlayerName, joinRoom, leaveRoom, currentRoomId, gameState } = useGameStore();
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

  const handleLeaveRoom = () => {
    leaveRoom();
  };

  // --- Table view (in-room) ---
  if (currentRoomId) {
    return (
      <div className="h-dvh flex flex-col bg-[#0a0614] overflow-hidden">
        {/* Top bar - compact on mobile */}
        <div className="flex items-center justify-between px-3 py-1.5 md:px-4 md:py-2 bg-[#0d0818]/80 border-b border-purple-500/20 z-30 pt-safe">
          <div className="flex items-center gap-2 md:gap-3">
            <Button variant="secondary" size="sm" onClick={handleLeaveRoom}>
              ←
            </Button>
            <NeonText size="sm" color="#A78BFA">POKER DOKU</NeonText>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {gameState && (
              <span className="text-gray-400 text-xs hidden md:inline">
                Blinds: <span className="text-yellow-300">{gameState.smallBlind}/{gameState.bigBlind}</span>
              </span>
            )}
            {gameState && (
              <span className="text-gray-400 text-xs">
                <span className="text-purple-300 capitalize">{gameState.street}</span>
              </span>
            )}
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-gray-500 text-[10px] md:text-xs hidden md:inline">{playerName}</span>
            </div>
          </div>
        </div>

        {/* Table + Chat */}
        <div className="flex-1 relative overflow-hidden">
          {gameState ? (
            <>
              <PokerTable />
              <ChatPanel />
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl mb-4 animate-pulse">🎴</div>
                <p className="text-gray-400 text-sm">테이블에 연결 중...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Name entry ---
  if (!hasName) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center px-4">
        <LobbyHeader />
        <div className="mt-6 md:mt-8 bg-[#1a1028]/80 backdrop-blur-sm border border-purple-500/20 rounded-2xl p-6 md:p-8 max-w-sm w-full">
          <h2 className="text-purple-300 font-bold text-base md:text-lg mb-4 text-center">Enter Your Name</h2>
          <input
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetName()}
            placeholder="Your poker name..."
            className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/50 text-center text-base md:text-lg mb-4"
            autoFocus
            enterKeyHint="go"
            autoComplete="off"
            autoCapitalize="off"
          />
          <Button variant="primary" size="lg" className="w-full" onClick={handleSetName}>
            Enter Lobby
          </Button>
          <div className="flex items-center justify-center gap-2 mt-3">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-gray-500 text-xs">{connected ? 'Connected' : 'Connecting...'}</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Lobby ---
  return (
    <div className="h-dvh overflow-y-auto pt-safe">
      <LobbyHeader />
      <div className="py-4">
        <div className="text-center mb-4">
          <span className="text-gray-400 text-sm">Playing as </span>
          <span className="text-purple-300 font-bold">{playerName}</span>
        </div>
        <RoomList onJoin={handleJoinRoom} />
      </div>
      <CreateRoomModal />
    </div>
  );
}
