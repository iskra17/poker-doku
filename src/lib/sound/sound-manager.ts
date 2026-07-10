'use client';

import { onGameEvent } from '../events/game-events';
import { useSettingsStore } from '../store/settings-store';
import { installAudioUnlock, setMasterMuted } from './audio-engine';
import { playEffect } from './effects';

/**
 * 게임 이벤트 스트림 → 사운드 매핑.
 * GameRoomView 마운트 시 initSoundSystem() 한 번 호출 (모듈 싱글턴, 멱등).
 */

let initialized = false;
let turnTickInterval: ReturnType<typeof setInterval> | null = null;

function clearTurnTick() {
  if (turnTickInterval) {
    clearInterval(turnTickInterval);
    turnTickInterval = null;
  }
}

/** 내 턴 마감 5초 전부터 초당 틱 */
function startTurnTick(deadline: number) {
  clearTurnTick();
  turnTickInterval = setInterval(() => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      clearTurnTick();
      return;
    }
    if (remaining <= 5000) {
      playEffect('tick');
    }
  }, 1000);
}

export function initSoundSystem(): void {
  if (initialized) return;
  initialized = true;

  installAudioUnlock();

  // 음소거 설정 반영 (persist된 초기값 + 변경 구독)
  setMasterMuted(useSettingsStore.getState().muted);
  useSettingsStore.subscribe(state => setMasterMuted(state.muted));

  onGameEvent(event => {
    switch (event.type) {
      case 'hand-start':
        clearTurnTick();
        // 홀카드 딜 사운드 (2장 × 인원 근사 — 간단히 4연타)
        for (let i = 0; i < 4; i++) {
          setTimeout(() => playEffect('deal'), i * 90);
        }
        break;

      case 'street-dealt':
        event.newCards.forEach((_, i) => {
          setTimeout(() => playEffect('deal'), i * 150);
          setTimeout(() => playEffect('flip'), i * 150 + 200);
        });
        break;

      case 'action':
        clearTurnTick();
        switch (event.actionType) {
          case 'fold': playEffect('fold'); break;
          case 'check': playEffect('check'); break;
          case 'call': playEffect('chip'); break;
          case 'raise': playEffect('raise'); break;
          case 'all-in': playEffect('all-in'); break;
        }
        break;

      case 'bets-collected':
        playEffect('pot-collect');
        break;

      case 'my-turn-start':
        playEffect('my-turn');
        startTurnTick(event.deadline);
        break;

      case 'showdown-reveal':
        playEffect('flip');
        break;

      case 'winners':
        clearTurnTick();
        playEffect(event.bigWin ? 'big-win' : 'win');
        break;

      case 'hand-end':
        clearTurnTick();
        break;
    }
  });
}
