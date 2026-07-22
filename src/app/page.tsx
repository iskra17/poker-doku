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
import MissionPanel from '@/components/lobby/MissionPanel';
import PartnerCard from '@/components/lobby/PartnerCard';
import SessionRecapModal from '@/components/lobby/SessionRecapModal';
import { getSessionRecap, type SessionRecapData } from '@/lib/session-recap';
import GameRoomView from '@/components/layout/GameRoomView';
import SettingsModal from '@/components/layout/SettingsModal';
import FeedbackModal from '@/components/lobby/FeedbackModal';
import HandHistoryModal from '@/components/history/HandHistoryModal';
import ProfileOnboarding from '@/components/onboarding/ProfileOnboarding';
import HelpModal from '@/components/help/HelpModal';
import { shouldRenderAuthenticatedTable } from '@/lib/profile/profile-view';
import ArenaLobby from '@/components/arena/ArenaLobby';
import { useArenaStore } from '@/lib/store/arena-store';

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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lobbyView, setLobbyView] = useState<'games' | 'arena' | 'missions'>('games');
  const [sessionRecap, setSessionRecap] = useState<SessionRecapData | null>(null);
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

  // 로비 복귀의 단일 지점 — 수동 나가기뿐 아니라 room-lost(미납 BB/파산/방치 회수, 서버 재시작)와
  // 나가기 예약 즉시 퇴장까지 모든 경로에서 지갑 표시를 갱신하고 세션 리캡을 띄운다.
  // (강제 회수 후 로비가 정산 전 지갑 잔액을 보여주던 문제 — 2026-07-22 QA)
  useEffect(() => {
    return useGameStore.subscribe((state, prevState) => {
      if (prevState.currentRoomId === null || state.currentRoomId !== null) return;
      void refresh();
      // 리캡 스냅샷은 복귀 직후 즉시 — 집계는 다음 게임 이벤트 전까지 유지된다
      const recap = getSessionRecap();
      if (recap.hands > 0) setSessionRecap(recap);
    });
  }, [refresh]);

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
    // 지갑 갱신·세션 리캡은 로비 복귀 구독(위 effect)이 공통 처리한다
    void leaveRoom(mode).then(left => {
      if (left) useArenaStore.getState().resetAfterResult();
    });
  };

  if (phase !== 'ready') {
    return (
      // h-dvh 고정 + 내부 스크롤 필수 — body가 position:fixed/overflow:hidden(당김 새로고침 방지)이라
      // 문서 스크롤이 없다. min-h로 두면 캐릭터 그리드(봇 16명)가 넘칠 때 모바일에서 스크롤 불가
      <div className="h-dvh overflow-y-auto pt-safe" style={LOBBY_BG_STYLE}>
        <LobbyHeader />
        <ProfileOnboarding />
      </div>
    );
  }

  if (shouldRenderAuthenticatedTable(phase, currentRoomId)) {
    return <GameRoomView onLeave={handleLeave} />;
  }

  return (
    // 고정 헤더/프로필/탭 + 콘텐츠 영역만 내부 스크롤 — 테이블이 늘어나도 상단 UI는 제자리
    <div className="flex h-dvh flex-col overflow-hidden pt-safe" style={LOBBY_BG_STYLE}>
      <LobbyHeader
        compact
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <EconomyBar onOpenSettings={() => setSettingsOpen(true)} />
      <nav aria-label="로비 메뉴" className="mx-auto mb-2 grid w-full max-w-4xl flex-none grid-cols-3 gap-2 px-3 md:px-4">
        {([
          ['games', '일반 게임', '친구·봇과 자유롭게'],
          ['arena', '포커 아레나', '시즌 공식 경쟁'],
          ['missions', '수련 과제', '오늘의 성장 목표'],
        ] as const).map(([value, title, description]) => (
          <button
            key={value}
            type="button"
            onClick={() => setLobbyView(value)}
            aria-pressed={lobbyView === value}
            className={`rounded-2xl border p-2 text-left md:p-3 ${
              lobbyView === value
                ? 'border-blossom/50 bg-blossom/15'
                : 'border-mystic/25 bg-panel/85'
            }`}
          >
            <span className="block text-sm font-bold text-ink">{title}</span>
            <span className="mt-0.5 block text-[10px] text-ink-dim">{description}</span>
          </button>
        ))}
      </nav>
      <main className="min-h-0 flex-1">
        {lobbyView === 'missions' && (
          <div className="h-full overflow-y-auto pb-4 scrollbar-thin"><MissionPanel /></div>
        )}
        {lobbyView === 'arena' && (
          <div className="h-full overflow-y-auto pb-4 scrollbar-thin"><ArenaLobby /></div>
        )}
        {lobbyView === 'games' && (
          <div className="flex h-full min-h-0 flex-col pt-1">
            <div className="flex-none"><PartnerCard /></div>
            {(joinError || pendingRoomId || inviteNotFound || inviteRoom?.locked) && (
              <div className="flex-none">
                {joinError && <p className="mb-2 text-center text-xs text-blossom">{joinError}</p>}
                {pendingRoomId && <p className="mb-2 text-center text-xs text-gilded">입장 확인 중…</p>}
                {inviteNotFound && (
                  <p className="mb-2 text-center text-xs text-blossom">
                    초대받은 방을 찾을 수 없어요 — 이미 종료됐을 수 있어요.
                  </p>
                )}
                {inviteRoom?.locked && (
                  <p className="mb-2 text-center text-xs text-blossom">
                    초대받은 Sit &amp; Go가 이미 시작됐어요.
                  </p>
                )}
              </div>
            )}
            <RoomList onJoin={handleJoinRoom} />
          </div>
        )}
      </main>
      <CreateRoomModal />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <FeedbackModal isOpen={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <HandHistoryModal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      {activeJoinTarget && (
        <JoinRoomModal key={activeJoinTarget.id} room={activeJoinTarget} onClose={closeJoinModal} />
      )}
      <SessionRecapModal recap={sessionRecap} onClose={() => setSessionRecap(null)} />
    </div>
  );
}
