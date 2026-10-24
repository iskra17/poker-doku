'use client';

import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useSeatActions } from '@/lib/hooks/use-seat-actions';
import AnimationLayer from './AnimationLayer';
import ThrowableLayer from './ThrowableLayer';
import ThrowLauncher from './ThrowLauncher';
import WinnerSequence from './WinnerSequence';
import SeatSpeechBubbles from '../characters/SeatSpeechBubble';
import DealerCorner from '../characters/DealerCorner';
import PokerTableView from './PokerTableView';

/**
 * 실전 테이블 — 게임 store 스냅샷을 표시 전용 `PokerTableView`에 넘기고, 실전에만 있는 레이어
 * (딜러 코너·칩/카드 비행·투척·좌석 말풍선·승리 연출)를 같은 좌표 컨테이너 안에 얹는다.
 */
export default function PokerTable({ finalTable = false, storyTheme = false }: { finalTable?: boolean; storyTheme?: boolean }) {
  const { gameState, myPlayerId } = useGameStore();
  const showBlindButtons = useSettingsStore(s => s.showBlindButtons);
  const isMobile = useIsMobile();
  const seatActions = useSeatActions();
  // 장착 펠트 코스메틱(수련 스토리 보상) — 훅은 early return 앞에서 무조건 호출, 적용은 수련 테이블에만(TableFelt)
  const feltId = useProgressionStore(state => state.snapshot?.cosmetics?.felt ?? null);

  if (!gameState) return null;

  // dealerIndex는 players 배열 인덱스 — 좌석 번호로 변환해서 사용해야 한다
  const dealerSeatIndex = gameState.players[gameState.dealerIndex]?.seatIndex ?? -1;
  // SB/BB는 엔진이 postBlinds에서 기록한 플레이어 id 기준 (핸드 사이 좌석 변동에 안전)
  const seatIndexOf = (playerId?: string | null) =>
    playerId ? gameState.players.find(p => p.id === playerId)?.seatIndex ?? -1 : -1;
  const activeSeatIndex = gameState.players[gameState.activePlayerIndex]?.seatIndex ?? -1;

  // 수련 스토리 방은 펠트·레일을 시안 계열 「도장 테이블」로 바꾼다 — 외형 계산은 TableFelt가 소유 (파이널 테마 우선)
  const story = storyTheme && !finalTable;

  return (
    <div className="relative z-10 w-full h-full">
      {/* 세로 좌표 컨테이너 — 모든 % 좌표의 기준. 데스크탑에서도 중앙 세로 컬럼 하나 */}
      <PokerTableView
        className="mx-auto"
        style={{ maxWidth: 'min(440px, 60dvh)' }}
        players={gameState.players}
        myPlayerId={myPlayerId}
        communityCards={gameState.communityCards}
        winningCards={gameState.winners?.[0]?.hand?.cards}
        pots={gameState.pots}
        dealerSeatIndex={dealerSeatIndex}
        sbSeatIndex={seatIndexOf(gameState.smallBlindId)}
        bbSeatIndex={seatIndexOf(gameState.bigBlindId)}
        activeSeatIndex={activeSeatIndex}
        turnTimeRemainingMs={gameState.turnTimeRemaining ?? 0}
        turnTotalSeconds={gameState.turnTimer || 30}
        seatActions={seatActions}
        compact={isMobile}
        showBlindButtons={showBlindButtons}
        finalTable={finalTable}
        storyTheme={story}
        feltId={feltId}
        // 딜러 미야코 코너 (아바타 + 진행 말풍선)
        underlay={<DealerCorner />}
      >
        {/* 칩/카드 비행 오버레이 */}
        <AnimationLayer isMobile={isMobile} />
        <ThrowableLayer isMobile={isMobile} />
        <ThrowLauncher />

        {/* 봇 좌석 말풍선 */}
        <SeatSpeechBubbles isMobile={isMobile} />

        {/* 승리 연출 (스포트라이트/배너/컨페티) */}
        <WinnerSequence isMobile={isMobile} />
      </PokerTableView>
    </div>
  );
}
