'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { initSoundSystem } from '@/lib/sound/sound-manager';
import { initMusicSystem, setMusicScene } from '@/lib/sound/music-manager';
import PokerTable from '@/components/table/PokerTable';
import ActionBar from '@/components/table/ActionBar';
import ActionLog from '@/components/table/ActionLog';
import TournamentResultOverlay from '@/components/table/TournamentResultOverlay';
import SngWaitingOverlay from '@/components/table/SngWaitingOverlay';
import EliminationNotice from '@/components/table/EliminationNotice';
import LeaveRoomModal from '@/components/table/LeaveRoomModal';
import BustNotice from '@/components/table/BustNotice';
import ChatPanel from '@/components/chat/ChatPanel';
import WinnerCutIn from '@/components/characters/WinnerCutIn';
import LoserCutIn from '@/components/characters/LoserCutIn';
import HandEconomySummary from '@/components/table/HandEconomySummary';
import TopBar from './TopBar';

interface GameRoomViewProps {
  /** 방 나가기 — 'sitout'이면 좌석/칩 유지 (game-store.leaveRoom과 시그니처 호환) */
  onLeave: (mode?: 'exit' | 'sitout') => void;
}

/** 인룸 뷰 공용 컴포넌트 — page.tsx와 table/[id]/page.tsx가 공유 */
export default function GameRoomView({ onLeave }: GameRoomViewProps) {
  const { gameState, myPlayerId, connectionState, tableNotice } = useGameStore();
  const isMobile = useIsMobile();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const tournamentFinished = gameState?.tournament?.finished ?? false;
  const connectionNotice = connectionState === 'reconnecting'
    ? '연결이 끊겼어요. 다시 연결하는 중…'
    : connectionState === 'replaced'
      ? '다른 탭에서 게임을 열어 이 연결을 종료했어요.'
      : null;
  const visibleNotice = connectionNotice ?? tableNotice;

  // 나가기 확인 다이얼로그는 '지킬 좌석'이 있을 때만 — 그 외엔 바로 퇴장.
  // 올인(chips===0이지만 status='all-in')은 팟 지분이 살아 있으므로 파산이 아니다 — 좌석 유지 대상.
  const myPlayer = gameState?.players.find(p => p.id === myPlayerId);
  const busted = !!myPlayer && myPlayer.chips <= 0 && myPlayer.status !== 'all-in';
  const canSitOut = !!myPlayer && !busted && !myPlayer.finishPlace && !tournamentFinished;
  const handleLeaveClick = () => {
    if (canSitOut) setLeaveOpen(true);
    else onLeave();
  };

  useEffect(() => {
    initSoundSystem();
    initMusicSystem();
  }, []);

  // 장면 BGM: 입장 시 테이블, SnG 종료 시 승리 테마 (이탈 시 로비 복귀는 page.tsx가 처리)
  useEffect(() => {
    setMusicScene(tournamentFinished ? 'victory' : 'table');
  }, [tournamentFinished]);

  return (
    <div className="h-dvh flex flex-col bg-abyss overflow-hidden">
      <TopBar onLeave={handleLeaveClick} />
      {visibleNotice && (
        <div className="flex-none border-b border-gilded/30 bg-elevated/95 px-3 py-1.5 text-center text-xs text-gilded">
          {visibleNotice}
        </div>
      )}
      <LeaveRoomModal
        isOpen={leaveOpen}
        isSng={!!gameState?.tournament}
        onClose={() => setLeaveOpen(false)}
        onSitOut={() => { setLeaveOpen(false); onLeave('sitout'); }}
        onExit={() => { setLeaveOpen(false); onLeave(); }}
      />

      <div className="flex-1 relative overflow-hidden">
        {gameState ? (
          <>
            <PokerTable />
            <WinnerCutIn isMobile={isMobile} />
            <LoserCutIn isMobile={isMobile} />
            <HandEconomySummary key={myPlayerId ?? 'anonymous'} />
            <ActionLog />
            <ChatPanel />
            <SngWaitingOverlay />
            <EliminationNotice />
            <BustNotice onLeave={onLeave} />
            <TournamentResultOverlay onLeave={onLeave} />
          </>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-4 animate-pulse">♠️</div>
              <p className="text-ink-dim text-sm">테이블에 연결 중...</p>
            </div>
          </div>
        )}
      </div>

      {/* 하단 액션 독 — 상시 예약 높이 (테이블 좌표 안정) */}
      {gameState && <ActionBar />}
    </div>
  );
}
