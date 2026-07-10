'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { initSoundSystem } from '@/lib/sound/sound-manager';
import PokerTable from '@/components/table/PokerTable';
import ActionLog from '@/components/table/ActionLog';
import ChatPanel from '@/components/chat/ChatPanel';
import DialogueBox from '@/components/characters/DialogueBox';
import WinnerCutIn from '@/components/characters/WinnerCutIn';
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
            <DialogueBox />
            <WinnerCutIn isMobile={isMobile} />
            <ActionLog />
            <ChatPanel />
          </>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-4 animate-pulse">🎴</div>
              <p className="text-ink-dim text-sm">테이블에 연결 중...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
