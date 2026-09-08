'use client';

import { useEffect, useState } from 'react';
import ContextGuide from '@/components/onboarding/ContextGuide';
import { onGameEvent } from '@/lib/events/game-events';
import { qaAwareStorage } from '@/lib/qa-browser';
import { useGameStore } from '@/lib/store/game-store';

const SEEN_KEY = 'poker-doku-coachmarks-v2';
function alreadySeen(): boolean {
  try { return qaAwareStorage().getItem(SEEN_KEY) === '1'; }
  catch { return true; }
}

/** 실제 액션 버튼을 가리킨다. 입력·서버 타이머·포커스를 가로채지 않는다. */
export default function Coachmarks({ chipMessage }: { chipMessage: string }) {
  const [visible, setVisible] = useState(() => typeof window !== 'undefined' && !alreadySeen());
  const state = useGameStore(store => store.gameState);
  const myPlayerId = useGameStore(store => store.myPlayerId);
  const connected = useGameStore(store => store.connected);
  const pending = useGameStore(store => store.pendingAction);
  const myTurn = state?.isHandInProgress && state.players[state.activePlayerIndex]?.id === myPlayerId;

  const dismiss = () => {
    setVisible(false);
    try { qaAwareStorage().setItem(SEEN_KEY, '1'); } catch { /* 이번 세션에서만 닫기 */ }
  };
  useEffect(() => {
    if (!visible) return;
    let pressed = false;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-tour="table-actions"] button:not(:disabled)')) pressed = true;
    };
    document.addEventListener('click', onClick, true);
    const unsubscribe = onGameEvent(event => {
      if (pressed && event.type === 'action' && event.playerId === myPlayerId) {
        setVisible(false);
        try { qaAwareStorage().setItem(SEEN_KEY, '1'); } catch { /* 저장 불가 환경 */ }
      }
      if (event.type === 'hand-start') pressed = false;
    });
    return () => { document.removeEventListener('click', onClick, true); unsubscribe(); };
  }, [visible, myPlayerId]);
  useEffect(() => {
    const reopen = () => setVisible(true);
    window.addEventListener('poker-doku:show-table-guide', reopen);
    return () => window.removeEventListener('poker-doku:show-table-guide', reopen);
  }, []);

  if (!visible || !myTurn || !connected || pending) return null;
  return <ContextGuide target={'[data-tour="table-actions"]'} onDismiss={dismiss}>
    {`내 차례예요. 아래 버튼으로 액션을 선택하세요. ${chipMessage}`}
  </ContextGuide>;
}