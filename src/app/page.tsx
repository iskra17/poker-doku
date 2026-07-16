'use client';

import { useEffect, useState } from 'react';
import { useGameStore, RoomInfo } from '@/lib/store/game-store';
import { useProfileStore } from '@/lib/store/profile-store';
import { initMusicSystem, setMusicScene } from '@/lib/sound/music-manager';
import LobbyHeader from '@/components/lobby/LobbyHeader';
import RoomList from '@/components/lobby/RoomList';
import CreateRoomModal from '@/components/lobby/CreateRoomModal';
import JoinRoomModal from '@/components/lobby/JoinRoomModal';
import EconomyBar from '@/components/lobby/EconomyBar';
import GameRoomView from '@/components/layout/GameRoomView';
import SettingsModal from '@/components/layout/SettingsModal';
import ProfileOnboarding from '@/components/onboarding/ProfileOnboarding';

const LOBBY_BG_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(rgba(10,6,20,0.82), rgba(10,6,20,0.92)), url(/assets/bg/lobby.webp)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
};

export default function Home() {
  const phase = useProfileStore(state => state.phase);
  const bootstrap = useProfileStore(state => state.bootstrap);
  const refresh = useProfileStore(state => state.refresh);
  const { leaveRoom, currentRoomId, pendingRoomId, joinError, rooms } = useGameStore();
  const [joinTarget, setJoinTarget] = useState<RoomInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteRoomId, setInviteRoomId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('room'),
  );

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void useProfileStore.getState().refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    initMusicSystem();
    if (!currentRoomId) setMusicScene('lobby');
  }, [currentRoomId]);

  const canFastRejoin = (room: RoomInfo) =>
    !!room.mySeat && (room.mode === 'sng' || room.mySeat.chips > 0);

  const handleJoinRoom = (roomId: string) => {
    const room = useGameStore.getState().rooms.find(candidate => candidate.id === roomId);
    if (!room) return;
    if (canFastRejoin(room)) {
      useGameStore.getState().joinRoom(room.id, 0, 0);
      return;
    }
    setJoinTarget(room);
  };

  const inviteRoom = inviteRoomId ? rooms.find(room => room.id === inviteRoomId) ?? null : null;
  const inviteNotFound = !!inviteRoomId && rooms.length > 0 && !inviteRoom;
  const activeJoinTarget = joinTarget
    ?? (phase === 'ready' && inviteRoom && !inviteRoom.locked && !canFastRejoin(inviteRoom)
      ? inviteRoom
      : null);

  const closeJoinModal = () => {
    setJoinTarget(null);
    if (inviteRoomId) {
      setInviteRoomId(null);
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const handleLeave = (mode?: 'exit' | 'sitout') => {
    void leaveRoom(mode).then(left => {
      if (left) void refresh();
    });
  };

  if (currentRoomId) return <GameRoomView onLeave={handleLeave} />;

  if (phase !== 'ready') {
    return (
      <div className="min-h-dvh overflow-y-auto pt-safe" style={LOBBY_BG_STYLE}>
        <LobbyHeader />
        <ProfileOnboarding />
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-y-auto pt-safe" style={LOBBY_BG_STYLE}>
      <LobbyHeader onOpenSettings={() => setSettingsOpen(true)} />
      <EconomyBar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="py-4">
        {joinError && <p className="mb-3 text-center text-xs text-blossom">{joinError}</p>}
        {pendingRoomId && <p className="mb-3 text-center text-xs text-gilded">입장 확인 중…</p>}
        {inviteNotFound && (
          <p className="mb-3 text-center text-xs text-blossom">
            초대받은 방을 찾을 수 없어요 — 이미 종료됐을 수 있어요.
          </p>
        )}
        {inviteRoom?.locked && (
          <p className="mb-3 text-center text-xs text-blossom">
            초대받은 Sit &amp; Go가 이미 시작됐어요.
          </p>
        )}
        <RoomList onJoin={handleJoinRoom} />
      </div>
      <CreateRoomModal />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {activeJoinTarget && (
        <JoinRoomModal key={activeJoinTarget.id} room={activeJoinTarget} onClose={closeJoinModal} />
      )}
    </div>
  );
}
