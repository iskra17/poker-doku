'use client';

import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { Card, Pot, PublicPlayer } from '@/lib/poker/types';
import type { SeatAction } from '@/lib/hooks/use-seat-actions';
import PlayerSeat from './PlayerSeat';
import CommunityCards from './CommunityCards';
import PotDisplay from './PotDisplay';
import ChipStack from './ChipStack';
import TableFelt from './TableFelt';
import { getLayout, toDisplayIndex, type TablePos } from './table-layout';

/** 좌석 하나에 덧그릴 표시 — 수련 테이블이 포지션·순서·족보 배지와 하이라이트를 얹는 통로 */
export interface SeatDecor {
  avatarOverlay?: ReactNode;
  footer?: ReactNode;
  highlightCards?: readonly Card[] | null;
}

export interface PokerTableViewProps {
  players: readonly PublicPlayer[];
  myPlayerId: string | null;
  communityCards: Card[];
  /** 쇼다운 승리 5장 — 보드에서 빛나고 나머지는 어두워진다 */
  winningCards?: Card[];
  pots: Pot[];
  /** 좌석 번호(seatIndex) 기준. 없으면 -1 */
  dealerSeatIndex: number;
  sbSeatIndex: number;
  bbSeatIndex: number;
  activeSeatIndex: number;
  /** 활성 좌석의 남은 턴 시간(ms) — 0이면 타이머 링 없음 */
  turnTimeRemainingMs?: number;
  turnTotalSeconds?: number;
  seatActions?: Readonly<Record<number, SeatAction | null | undefined>>;
  compact: boolean;
  showBlindButtons?: boolean;
  finalTable?: boolean;
  storyTheme?: boolean;
  feltId?: string | null;
  feltWatermark?: boolean;
  /** false면 좌석 탭(쇼케이스)·칩 표기 토글을 끈다 (수련 문제 테이블) */
  interactive?: boolean;
  /** 딜러 버튼을 한 번 크게 맥동시킨다 (수련 포지션 재생) */
  dealerPulse?: boolean;
  /** 팟 위치 덮어쓰기 — 주면 그 좌표로 미끄러진다 (수련 쇼다운 재생에서 승자 앞으로) */
  potPosition?: TablePos;
  /** 팟 아래 한 줄 (수련 테이블 스트리트·「상대 벳 포함」) */
  potExtra?: ReactNode;
  seatDecor?: (seatIndex: number, displaySlot: number) => SeatDecor | null;
  /** 빈 좌석 렌더 덮어쓰기 — 기본은 PlayerSeat 빈 자리 */
  renderEmptySeat?: (seatIndex: number, displaySlot: number, position: TablePos) => ReactNode;
  /** 펠트 바로 위 레이어 (딜러 코너 등) */
  underlay?: ReactNode;
  /** 좌표 컨테이너 최상단 레이어 (애니메이션·말풍선·연출 오버레이) */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * 테이블 표시 전용 뷰 — 게임 store를 읽지 않는다. 실전(`PokerTable`)과 수련 문제(`DrillTable`)가 같은 좌석·카드·팟·칩·
 * 포지션 버튼을 그린다. 좌표는 `table-layout.ts` 단일 소스이고, 내 좌석이 하단 중앙에 오도록 `toDisplayIndex`로 회전한다.
 * 이 요소가 % 좌표의 기준 컨테이너다 (부모가 크기를 정한다).
 */
export default function PokerTableView({
  players, myPlayerId, communityCards, winningCards, pots,
  dealerSeatIndex, sbSeatIndex, bbSeatIndex, activeSeatIndex,
  turnTimeRemainingMs = 0, turnTotalSeconds = 30, seatActions,
  compact, showBlindButtons = true, finalTable = false, storyTheme = false, feltId = null, feltWatermark = true,
  interactive = true, dealerPulse = false, potPosition, potExtra, seatDecor, renderEmptySeat,
  underlay, children, className = '', style,
}: PokerTableViewProps) {
  const { seats, betPositions, dealerBtnPositions, potPos, boardPos, seatDepth } = getLayout();
  const mySeatIndex = players.find(p => p.id === myPlayerId)?.seatIndex ?? -1;
  const seatPlayers = seats.map((_, seatIndex) => players.find(p => p.seatIndex === seatIndex) || null);

  // 포지션 버튼 3종 — 크기/모양 동일, 색만 구분 (업계 관행: D 골드/화이트, SB 블루, BB 레드 계열).
  // 헤즈업(딜러=SB)은 표준대로 D만 표시. SB/BB는 설정(showBlindButtons)으로 숨김 가능.
  const positionButtons = [
    {
      label: 'D',
      title: '딜러 버튼',
      seatIndex: dealerSeatIndex,
      show: dealerSeatIndex >= 0 && players.length >= 2,
      color: 'bg-gilded border-gilded shadow-sm',
      textSize: compact ? 'text-[11px]' : 'text-[13px]',
      pulse: dealerPulse,
    },
    {
      label: 'SB',
      title: '스몰 블라인드',
      seatIndex: sbSeatIndex,
      show: showBlindButtons && sbSeatIndex >= 0 && sbSeatIndex !== dealerSeatIndex,
      color: 'bg-cyber border-cyber shadow-sm',
      textSize: compact ? 'text-[8px]' : 'text-[10px]',
      pulse: false,
    },
    {
      label: 'BB',
      title: '빅 블라인드',
      seatIndex: bbSeatIndex,
      show: showBlindButtons && bbSeatIndex >= 0 && bbSeatIndex !== dealerSeatIndex,
      color: 'bg-blossom border-blossom shadow-sm',
      textSize: compact ? 'text-[8px]' : 'text-[10px]',
      pulse: false,
    },
  ];

  return (
    <div className={`relative h-full w-full ${className}`} style={style}>
      <TableFelt finalTable={finalTable} story={storyTheme} feltId={feltId} watermark={feltWatermark} />

      {underlay}

      {/* Pot display — 보드 위 (table-layout POT_POS) */}
      {potPosition ? (
        <motion.div
          className="absolute z-10"
          style={{ x: '-50%', y: '-50%' }}
          initial={false}
          animate={{ left: potPosition.x, top: potPosition.y }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <PotDisplay pots={pots} compact={compact} />
          {potExtra}
        </motion.div>
      ) : (
        <div className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{ left: potPos.x, top: potPos.y }}>
          <PotDisplay pots={pots} compact={compact} />
          {potExtra}
        </div>
      )}

      {/* Community cards (table-layout BOARD_POS) */}
      <div className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{ left: boardPos.x, top: boardPos.y }}>
        <CommunityCards cards={communityCards} winningCards={winningCards} compact={compact} />
      </div>

      {/* Player seats — 내 좌석이 하단 중앙에 오도록 디스플레이 슬롯 회전 */}
      {seats.map((_, i) => {
        const isActiveHere = activeSeatIndex >= 0 && activeSeatIndex === i;
        const displaySlot = toDisplayIndex(i, mySeatIndex);
        const player = seatPlayers[i];
        if (!player && renderEmptySeat) return <div key={i}>{renderEmptySeat(i, displaySlot, seats[displaySlot])}</div>;
        const decor = player ? seatDecor?.(i, displaySlot) ?? null : null;
        return (
          <PlayerSeat
            key={i}
            player={player}
            isCurrentPlayer={!!player && player.id === myPlayerId}
            isActive={isActiveHere}
            position={seats[displaySlot]}
            seatIndex={i}
            compact={compact}
            turnDuration={isActiveHere ? turnTimeRemainingMs : 0}
            turnTotalSeconds={turnTotalSeconds}
            seatAction={seatActions?.[i] ?? null}
            // 우측 열(슬롯 4·5)은 카드가 화면 밖으로 잘리지 않게 왼쪽(중앙 방향)에 부착
            cardSide={displaySlot === 4 || displaySlot === 5 ? 'left' : 'right'}
            depthScale={seatDepth[displaySlot]}
            interactive={interactive}
            avatarOverlay={decor?.avatarOverlay}
            footer={decor?.footer}
            highlightCards={decor?.highlightCards ?? null}
          />
        );
      })}

      {/* 포지션 버튼 (D/SB/BB) — 좌석 옆 펠트 위. 핸드마다 이동 애니메이션 */}
      {positionButtons.map(btn => {
        if (!btn.show) return null;
        const pos = dealerBtnPositions[toDisplayIndex(btn.seatIndex, mySeatIndex)];
        return (
          <motion.div
            key={`pos-btn-${btn.label}`}
            className="absolute z-20 pointer-events-none"
            style={{ x: '-50%', y: '-50%' }}
            initial={false}
            animate={{ left: pos.x, top: pos.y, scale: btn.pulse ? [1, 1.45, 1, 1.3, 1] : 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26, scale: { duration: btn.pulse ? 0.9 : 0.2 } }}
          >
            <div
              className={`rounded-full text-abyss font-bold flex items-center justify-center border-2
                ${btn.color} ${compact ? 'w-6 h-6' : 'w-7 h-7'} ${btn.textSize}`}
              title={btn.title}
              aria-label={btn.title}
            >
              {btn.label}
            </div>
          </motion.div>
        );
      })}

      {/* Bet chips - 테이블 중앙 방향에 배치 (좌석과 같은 회전 적용) */}
      {betPositions.map((_, i) => {
        const player = seatPlayers[i];
        if (!player || player.currentBet <= 0) return null;
        const pos = betPositions[toDisplayIndex(i, mySeatIndex)];
        return (
          <div
            key={`bet-${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
            style={{ left: pos.x, top: pos.y }}
          >
            <ChipStack amount={player.currentBet} size={compact ? 'xs' : 'sm'} />
          </div>
        );
      })}

      {children}
    </div>
  );
}
