'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useGameStore } from '@/lib/store/game-store';
import { useProfileStore } from '@/lib/store/profile-store';
import GameRoomView from '@/components/layout/GameRoomView';
import ProfileOnboarding from '@/components/onboarding/ProfileOnboarding';

export default function TablePage() {
  const params = useParams();
  const roomId = params.id as string;
  const phase = useProfileStore(state => state.phase);
  const bootstrap = useProfileStore(state => state.bootstrap);
  const { connected, currentRoomId, joinRoom, leaveRoom } = useGameStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (phase === 'ready' && connected && !currentRoomId && roomId) {
      joinRoom(roomId, 1_000, 0);
    }
  }, [phase, connected, currentRoomId, roomId, joinRoom]);

  const handleLeave = (mode?: 'exit' | 'sitout') => {
    void leaveRoom(mode).then(left => {
      if (left) window.location.assign('/');
    });
  };

  if (phase !== 'ready') {
    return (
      // h-dvh + 내부 스크롤 — body는 문서 스크롤이 없다 (page.tsx 온보딩 래퍼와 같은 계약)
      <div className="h-dvh overflow-y-auto bg-abyss py-8">
        <ProfileOnboarding />
      </div>
    );
  }

  return <GameRoomView onLeave={handleLeave} />;
}
