'use client';

import { onGameEvent } from '../events/game-events';
import { playEffect } from './effects';

let installed = false;

/**
 * 수련 스토리 사운드 바인딩 — 드릴 결과 이벤트(`story-drill-result`)만 구독한다.
 * 연출(스탬프·버스트·대사)은 DrillCard가 뷰에서 파생하고, 결산 리빌은 자기 단계에서 직접 울린다 — 이중 구독 없음.
 * StoryLifecycle 마운트 시 1회 (모듈 싱글턴, 멱등).
 */
export function initStorySoundBindings(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  onGameEvent(event => {
    if (event.type !== 'story-drill-result') return;
    if (!event.correct) {
      playEffect('fold');
      return;
    }
    if (event.perfect) {
      playEffect('level-up');
      return;
    }
    if (event.streak === 3 || event.streak === 5) {
      playEffect('combo');
      return;
    }
    playEffect('ui-click');
  });
}
