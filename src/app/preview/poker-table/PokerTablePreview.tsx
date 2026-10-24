'use client';

import { useEffect, useState } from 'react';
import PokerTable from '@/components/table/PokerTable';
import { ACTION_DOCK_HEIGHT } from '@/components/table/ActionBar';
import { useGameStore } from '@/lib/store/game-store';
import type { Card, PublicGameState, PublicPlayer } from '@/lib/poker/types';

/**
 * 실전 테이블 검토 화면 — 게임 store에 6인 샘플 스냅샷을 넣고 실제 `PokerTable`을 GameRoomView와 같은 골격
 * (상단 바 · 테이블 · 고정 높이 액션 독 자리)으로 띄운다. 개발 서버 전용.
 * `?state=turn|showdown|preflop` · `?story=1`(수련 테마) · `?final=1`(파이널 테마)
 */

const c = (text: string): Card => {
  const suit = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' }[text.slice(-1)] as Card['suit'];
  const rank = text.slice(0, -1) === 'T' ? '10' : (text.slice(0, -1) as Card['rank']);
  return { rank, suit };
};

function player(seatIndex: number, partial: Partial<PublicPlayer> & Pick<PublicPlayer, 'id' | 'name' | 'avatar'>): PublicPlayer {
  return {
    type: 'bot',
    chips: 2000,
    seatIndex,
    holeCards: [c('As'), c('Ad')],
    currentBet: 0,
    totalContributed: 0,
    status: 'active',
    hasActed: false,
    ...partial,
  };
}

function sampleState(kind: string): PublicGameState {
  const showdown = kind === 'showdown';
  const preflop = kind === 'preflop';
  const players: PublicPlayer[] = [
    player(0, { id: 'me', name: '새벽참새', avatar: 'yuzuki', type: 'human', chips: 1840, holeCards: [c('Kh'), c('Qh')], currentBet: preflop ? 60 : 120 }),
    player(1, { id: 'p1', name: '사쿠라', avatar: 'sakura', chips: 2310, currentBet: preflop ? 20 : 120, revealed: showdown, holeCards: [c('Jc'), c('Jd')] }),
    player(2, { id: 'p2', name: '아라', avatar: 'ara', chips: 960, status: 'folded' }),
    player(3, { id: 'p3', name: '하나', avatar: 'hana', chips: 3120, currentBet: preflop ? 40 : 0 }),
    player(4, { id: 'p4', name: '클로이', avatar: 'chloe', chips: 1500, currentBet: preflop ? 0 : 240, revealed: showdown, holeCards: [c('9s'), c('8s')] }),
    player(5, { id: 'p5', name: '엘레나', avatar: 'elena', chips: 2750, status: 'folded' }),
  ];
  return {
    id: 'preview',
    players,
    communityCards: preflop ? [] : kind === 'flop' ? [c('Qs'), c('Jh'), c('4h')] : [c('Qs'), c('Jh'), c('4h'), c('2c'), ...(showdown ? [c('Th')] : [])],
    pots: [{ amount: preflop ? 30 : 840, eligiblePlayerIds: ['me', 'p1', 'p3', 'p4'] }],
    currentBet: 240,
    minRaise: 240,
    street: showdown ? 'showdown' : preflop ? 'preflop' : 'turn',
    dealerIndex: 3,
    activePlayerIndex: showdown ? -1 : 0,
    smallBlind: 10,
    bigBlind: 20,
    isHandInProgress: !showdown,
    smallBlindId: 'p4',
    bigBlindId: 'p5',
    winners: null,
    handRake: 0,
    lastAction: null,
    turnTimer: 15,
    turnTimeRemaining: showdown ? undefined : 11000,
    handNumber: 7,
    actionSeq: 12,
  };
}

export default function PokerTablePreview() {
  const [ready, setReady] = useState(false);
  const [flags, setFlags] = useState({ story: false, final: false });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    useGameStore.setState({ gameState: sampleState(params.get('state') ?? 'turn'), myPlayerId: 'me' });
    // 외부 시스템(URL) 동기화 — 마운트 1회
    queueMicrotask(() => {
      setFlags({ story: params.get('story') === '1', final: params.get('final') === '1' });
      setReady(true);
    });
    return () => useGameStore.setState({ gameState: null, myPlayerId: null });
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-abyss text-ink">
      <header className="flex h-14 shrink-0 items-center border-b border-mystic/20 px-3 text-xs font-bold text-ink-dim">실전 테이블 · 미리보기</header>
      <div className="relative flex-1 overflow-hidden">
        <div className="relative isolate mx-auto h-full w-full max-w-[1100px]">
          {ready && <PokerTable storyTheme={flags.story} finalTable={flags.final} />}
        </div>
      </div>
      <div className="shrink-0 border-t border-mystic/20 bg-panel/60" style={{ height: ACTION_DOCK_HEIGHT }} />
    </div>
  );
}
