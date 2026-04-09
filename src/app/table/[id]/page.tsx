'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useGameStore } from '@/lib/store/game-store';
import PokerTable from '@/components/table/PokerTable';
import ChatPanel from '@/components/chat/ChatPanel';
import Button from '@/components/ui/Button';
import NeonText from '@/components/ui/NeonText';

export default function TablePage() {
  const params = useParams();
  const roomId = params.id as string;
  const { connect, connected, gameState, currentRoomId, playerName, joinRoom, leaveRoom } = useGameStore();

  useEffect(() => {
    if (!connected) {
      connect();
    }
  }, [connect, connected]);

  useEffect(() => {
    // Auto-join if we have a name and aren't in the room yet
    if (connected && playerName && !currentRoomId && roomId) {
      // Find an available seat
      joinRoom(roomId, 1000, 0);
    }
  }, [connected, playerName, currentRoomId, roomId, joinRoom]);

  const handleLeave = () => {
    leaveRoom();
    window.location.href = '/';
  };

  // Name entry if not set
  if (!playerName) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Please enter the lobby first to set your name.</p>
          <Button variant="primary" onClick={() => window.location.href = '/'}>
            Go to Lobby
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#0a0614] overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d0818]/80 border-b border-purple-500/20 z-30">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleLeave}>
            ← Lobby
          </Button>
          <NeonText size="sm" color="#A78BFA">POKER DOKU</NeonText>
        </div>
        <div className="flex items-center gap-3">
          {gameState && (
            <>
              <span className="text-gray-400 text-sm">
                Blinds: <span className="text-yellow-300">{gameState.smallBlind}/{gameState.bigBlind}</span>
              </span>
              <span className="text-gray-400 text-sm">
                Street: <span className="text-purple-300 capitalize">{gameState.street}</span>
              </span>
            </>
          )}
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-gray-500 text-xs">{playerName}</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 relative">
        {gameState ? (
          <>
            <PokerTable />
            <ChatPanel />
          </>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-4 animate-pulse">🎴</div>
              <p className="text-gray-400">Connecting to table...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
