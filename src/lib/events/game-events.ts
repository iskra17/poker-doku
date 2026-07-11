'use client';

import { Card, GameState, ActionType, Street, WinResult, Player } from '../poker/types';

/**
 * 클라이언트 이벤트 파생 레이어.
 * 서버는 game-update로 전체 스냅샷만 push하므로, prev/next를 diff해서
 * 사운드/애니메이션/액션로그/캐릭터 표정이 구독할 이벤트 스트림을 만든다.
 * React 상태를 거치지 않는 경량 pub/sub — 리렌더 비용 없음.
 */

export type GameEvent =
  | { type: 'hand-start'; handNumber: number }
  | { type: 'street-dealt'; street: Street; newCards: Card[]; startIndex: number }
  | { type: 'action'; playerId: string; playerName: string; seatIndex: number; actionType: ActionType; amount: number; street: Street; isBet: boolean }
  | { type: 'bets-collected'; bets: { seatIndex: number; amount: number }[] }
  | { type: 'my-turn-start'; deadline: number }
  | { type: 'showdown-reveal' }
  | { type: 'winners'; winners: WinResult[]; players: Player[]; potTotal: number; bigWin: boolean }
  | { type: 'hand-end' };

type Listener = (event: GameEvent) => void;

const listeners = new Set<Listener>();

export function onGameEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitGameEvent(event: GameEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      console.error('[game-events] listener error', e);
    }
  }
}

export function diffGameState(
  prev: GameState | null,
  next: GameState,
  myPlayerId: string | null,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (!prev) return events; // 첫 스냅샷은 이벤트 없음 (room-joined가 처리)

  const sameHand = next.handNumber === prev.handNumber;

  // 핸드 시작
  if (next.handNumber !== prev.handNumber && next.isHandInProgress) {
    events.push({ type: 'hand-start', handNumber: next.handNumber });
  }

  // 액션 (actionSeq 증가 기반 — lastAction 객체 비교보다 안정적)
  if (next.actionSeq > prev.actionSeq && next.lastAction) {
    const actor = next.players.find(p => p.id === next.lastAction!.playerId);
    events.push({
      type: 'action',
      playerId: next.lastAction.playerId,
      playerName: actor?.name ?? '',
      seatIndex: actor?.seatIndex ?? -1,
      actionType: next.lastAction.type,
      amount: next.lastAction.amount,
      street: next.street,
      // 벳 vs 레이즈: 포스트플랍에서 해당 스트리트 첫 베팅(직전 currentBet 0)이면 벳
      isBet: next.lastAction.type === 'raise' && next.street !== 'preflop' && prev.currentBet === 0,
    });
  }

  // 베팅 칩 수거: 직전 스냅샷에 베팅이 있었는데 전원 0이 됨 (스트리트 전환/핸드 종료)
  if (sameHand) {
    const prevBets = prev.players
      .filter(p => p.currentBet > 0)
      .map(p => ({ seatIndex: p.seatIndex, amount: p.currentBet }));
    const nextAllZero = next.players.every(p => p.currentBet === 0);
    if (prevBets.length > 0 && nextAllZero) {
      events.push({ type: 'bets-collected', bets: prevBets });
    }
  }

  // 커뮤니티 카드 딜
  if (sameHand && next.communityCards.length > prev.communityCards.length) {
    events.push({
      type: 'street-dealt',
      street: next.street,
      newCards: next.communityCards.slice(prev.communityCards.length),
      startIndex: prev.communityCards.length,
    });
  }

  // 내 턴 시작
  if (myPlayerId && next.isHandInProgress) {
    const prevActor = prev.players[prev.activePlayerIndex]?.id;
    const nextActor = next.players[next.activePlayerIndex]?.id;
    if (nextActor === myPlayerId && (prevActor !== myPlayerId || !prev.isHandInProgress)) {
      events.push({ type: 'my-turn-start', deadline: Date.now() + (next.turnTimeRemaining ?? 0) });
    }
  }

  // 쇼다운 리빌
  if (next.street === 'showdown' && prev.street !== 'showdown') {
    events.push({ type: 'showdown-reveal' });
  }

  // 승자 발표
  if (next.winners && next.winners.length > 0 && (!prev.winners || prev.winners.length === 0)) {
    const potTotal = next.winners.reduce((s, w) => s + w.amount, 0);
    // 빅윈 판정: 투페어 이상 또는 30BB 초과 팟
    const bestHand = next.winners.find(w => w.hand)?.hand;
    const bigHand = bestHand ? !['high-card', 'one-pair'].includes(bestHand.rank) : false;
    const bigPot = potTotal > next.bigBlind * 30;
    events.push({
      type: 'winners',
      winners: next.winners,
      players: next.players,
      potTotal,
      bigWin: bigHand || bigPot,
    });
  }

  // 핸드 종료
  if (prev.isHandInProgress && !next.isHandInProgress) {
    events.push({ type: 'hand-end' });
  }

  return events;
}
