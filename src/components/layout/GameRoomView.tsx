'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { initSoundSystem } from '@/lib/sound/sound-manager';
import PokerTable from '@/components/table/PokerTable';
import ActionBar from '@/components/table/ActionBar';
import ActionLog from '@/components/table/ActionLog';
import TournamentResultOverlay from '@/components/table/TournamentResultOverlay';
import SngWaitingOverlay from '@/components/table/SngWaitingOverlay';
import EliminationNotice from '@/components/table/EliminationNotice';
import ChatPanel from '@/components/chat/ChatPanel';
import WinnerCutIn from '@/components/characters/WinnerCutIn';
import LoserCutIn from '@/components/characters/LoserCutIn';
import TopBar from './TopBar';

interface GameRoomViewProps {
  onLeave: () => void;
}

/** 인룸 뷰 공용 컴포넌트 — page.tsx와 table/[id]/page.tsx가 공유 */
export default function GameRoomView({ onLeave }: GameRoomViewProps) {
  const { gameState } = useGameStore();
  const isMobile = useIsMobile();

  useEffect(() => {
    initSoundSystem();
  }, []);

  return (
    <div className="h-dvh flex flex-col bg-abyss overflow-hidden">
      <TopBar onLeave={onLeave} />

      <div className="flex-1 relative overflow-hidden">
        {gameState ? (
          <>
            <PokerTable />
            <WinnerCutIn isMobile={isMobile} />
            <LoserCutIn isMobile={isMobile} />
            <ActionLog />
            <ChatPanel />
            <SngWaitingOverlay />
            <EliminationNotice />
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
