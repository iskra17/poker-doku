'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useGameStore } from '@/lib/store/game-store';
import GameRoomView from '@/components/layout/GameRoomView';
import Button from '@/components/ui/Button';

export default function TablePage() {
  const params = useParams();
  const roomId = params.id as string;
  const { connect, connected, currentRoomId, playerName, joinRoom, leaveRoom } = useGameStore();

  useEffect(() => {
    if (!connected) {
      connect();
    }
  }, [connect, connected]);

  useEffect(() => {
    // Auto-join if we have a name and aren't in the room yet
    if (connected && playerName && !currentRoomId && roomId) {
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
          <p className="text-ink-dim mb-4">로비에서 먼저 이름을 입력해주세요.</p>
          <Button variant="primary" onClick={() => window.location.href = '/'}>
            로비로 가기
          </Button>
        </div>
      </div>
    );
  }

  return <GameRoomView onLeave={handleLeave} />;
}
