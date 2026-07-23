'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { initSoundSystem } from '@/lib/sound/sound-manager';
import { initMusicSystem, setMusicScene } from '@/lib/sound/music-manager';
import { initSessionRecap } from '@/lib/session-recap';
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
import ProgressionSummary from '@/components/table/ProgressionSummary';
import PartnerReactions from '@/components/table/PartnerReactions';
import Coachmarks from '@/components/table/Coachmarks';
import BondSceneUnlockWatcher from '@/components/characters/BondSceneUnlockWatcher';
import TopBar from './TopBar';

interface GameRoomViewProps {
  /** 방 나가기 — 'sitout'이면 좌석/칩 유지 (game-store.leaveRoom과 시그니처 호환) */
  onLeave: (mode?: 'exit' | 'sitout') => void;
}

/** 인룸 뷰 공용 컴포넌트 — page.tsx와 table/[id]/page.tsx가 공유 */
export default function GameRoomView({ onLeave }: GameRoomViewProps) {
  const { gameState, myPlayerId, connectionState, tableNotice, reserveLeave } = useGameStore();
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
  // 진행 중 핸드의 올인(chips===0, status='all-in')은 팟 지분이 살아 있으므로 파산이 아니다 —
  // 좌석 유지 대상. 핸드가 끝난 뒤에도 남는 all-in status는 올인 패배 확정이라 파산으로 본다
  // (엔진은 파산 좌석 status를 리셋하지 않는다 — BustNotice와 같은 계약).
  const myPlayer = gameState?.players.find(p => p.id === myPlayerId);
  // 착석 대기(만석 방의 봇 좌석 핸드오프) — 방에는 들어왔지만 아직 좌석이 없다.
  // 서버가 진행 중 핸드 종료 후 자동 착석시키면 game-update에 본인이 나타나며 배너가 사라진다.
  const waitingForSeat = !!gameState && !myPlayer && !tournamentFinished;
  const busted = !!myPlayer && myPlayer.chips <= 0
    && !(gameState?.isHandInProgress && (myPlayer.status === 'active' || myPlayer.status === 'all-in'));
  const canSitOut = !!myPlayer && !busted && !myPlayer.finishPlace && !tournamentFinished;
  // 나가기 예약은 캐시 전용 (SnG/아레나 제외 — 서버 setLeaveReservation과 같은 조건)
  const canReserve = canSitOut && !gameState?.tournament && gameState?.economyMode !== 'arena';
  const myReservation = myPlayer?.leaveReservation ?? null;
  const handleLeaveClick = () => {
    if (canSitOut) setLeaveOpen(true);
    else onLeave();
  };

  useEffect(() => {
    initSoundSystem();
    initMusicSystem();
    initSessionRecap();
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
      {/* 착석 대기 배너 — 봇이 자리를 비워줄 때까지 관전 (나가기 ←로 대기 취소) */}
      {waitingForSeat && (
        <div className="flex-none border-b border-cyber/30 bg-elevated/95 px-3 py-1.5 text-center text-xs text-cyber">
          🪑 자리 준비 중 — 진행 중인 핸드가 끝나면 자동으로 앉아요. 잠시 테이블을 구경해 주세요!
        </div>
      )}
      {/* 나가기 예약 배너 — 예약 중에만 노출, [취소]로 즉시 해제 */}
      {myReservation && (
        <div className="flex-none border-b border-gilded/30 bg-elevated/95 px-3 py-1.5 flex items-center justify-center gap-2 text-xs text-gilded">
          <span>
            {myReservation === 'hand'
              ? '🕐 이번 핸드를 마치면 자동으로 나가요'
              : '🕐 다음 빅블라인드 차례 전에 자동으로 나가요'}
          </span>
          <button
            type="button"
            onClick={() => reserveLeave('cancel')}
            className="rounded-md border border-gilded/40 px-2 py-0.5 font-bold hover:bg-gilded/15 transition-colors"
          >
            취소
          </button>
        </div>
      )}
      <LeaveRoomModal
        isOpen={leaveOpen}
        isSng={!!gameState?.tournament}
        isMtt={!!gameState?.tournament?.tournamentId}
        isPractice={gameState?.economyMode === 'practice'}
        canReserve={canReserve}
        onClose={() => setLeaveOpen(false)}
        onSitOut={() => { setLeaveOpen(false); onLeave('sitout'); }}
        onReserve={kind => { setLeaveOpen(false); reserveLeave(kind); }}
        onExit={() => { setLeaveOpen(false); onLeave(); }}
      />

      <div className="flex-1 relative overflow-hidden">
        {gameState ? (
          <>
            {/* 데스크탑 광폭 화면에서 액션 로그(좌)/채팅(우)이 화면 양끝까지 벌어지지 않게
                테이블 기준 중앙 컨테이너에 함께 묶는다 — 전체 화면을 덮어야 하는
                오버레이(컷인·모달·백드롭)는 바깥에 남긴다 */}
            <div className="relative mx-auto h-full w-full max-w-[1100px]">
              <PokerTable />
              <ActionLog />
              <ChatPanel />
              {/* 승/패 컷인도 컨테이너 안 왼쪽(액션 로그 아래)에 — 광폭 화면에서 양끝으로
                  흩어지지 않게 (2026-07-22 유저 피드백). 승리 38% / 패배 62%로 스택 */}
              <WinnerCutIn isMobile={isMobile} />
              <LoserCutIn isMobile={isMobile} />
            </div>
            <HandEconomySummary key={myPlayerId ?? 'anonymous'} />
            <ProgressionSummary />
            <PartnerReactions />
            <Coachmarks />
            <BondSceneUnlockWatcher />
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
