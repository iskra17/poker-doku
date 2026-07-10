'use client';

import { playTone, playNoise, throttled } from './synth';

/**
 * 이벤트별 사운드 레시피 (100% 합성 — 에셋 파일 0개).
 * 추후 파일 기반으로 교체하려면 이 모듈의 케이스만 바꾸면 된다.
 */

export type SoundName =
  | 'deal'        // 카드 딜 (장당)
  | 'flip'        // 카드 플립/리빌
  | 'chip'        // 칩 베팅/콜
  | 'check'       // 체크 노크
  | 'fold'        // 폴드 슬라이드
  | 'raise'       // 레이즈
  | 'all-in'      // 올인 스팅
  | 'my-turn'     // 내 턴 차임
  | 'tick'        // 타이머 임박 틱
  | 'pot-collect' // 팟 수거 캐스케이드
  | 'win'         // 일반 승리 아르페지오
  | 'big-win'     // 빅윈 팡파레
  | 'ui-click'    // 버튼 블립
  | 'chat';       // 채팅 수신 팝

function chipClack(delayMs: number, gain = 0.14) {
  playTone(2400, 45, { type: 'sine', gain, delayMs });
  playNoise(35, 3500, { gain: gain * 0.6, delayMs });
}

export function playEffect(name: SoundName): void {
  if (throttled(`fx:${name}`, 40)) return;

  switch (name) {
    case 'deal':
      playNoise(60, 1800, { gain: 0.09, filterEnd: 900 });
      break;

    case 'flip':
      playTone(1200, 30, { type: 'square', gain: 0.05 });
      break;

    case 'chip':
      chipClack(0);
      chipClack(30, 0.11);
      break;

    case 'check':
      playTone(180, 80, { type: 'sine', gain: 0.2 });
      playNoise(50, 300, { gain: 0.1, filterType: 'lowpass' });
      playTone(160, 70, { type: 'sine', gain: 0.15, delayMs: 110 });
      break;

    case 'fold':
      playNoise(120, 1200, { gain: 0.07, filterType: 'lowpass', filterEnd: 200 });
      break;

    case 'raise':
      chipClack(0);
      chipClack(35, 0.12);
      playTone(600, 120, { type: 'triangle', gain: 0.08, freqEnd: 900, delayMs: 40 });
      break;

    case 'all-in': {
      for (let i = 0; i < 6; i++) chipClack(i * 40, 0.12);
      // 드라마틱 스팅 (단3도)
      playTone(440, 500, { type: 'triangle', gain: 0.1, delayMs: 180 });
      playTone(523.25, 500, { type: 'triangle', gain: 0.08, delayMs: 180 });
      break;
    }

    case 'my-turn':
      playTone(659.25, 150, { type: 'sine', gain: 0.14 }); // E5
      playTone(880, 280, { type: 'sine', gain: 0.12, delayMs: 130 }); // A5
      break;

    case 'tick':
      playTone(1000, 40, { type: 'square', gain: 0.06 });
      break;

    case 'pot-collect': {
      for (let i = 0; i < 8; i++) {
        chipClack(i * (60 - i * 4), 0.09); // 가속 캐스케이드
      }
      break;
    }

    case 'win':
      // A - C# - E 아르페지오
      playTone(440, 200, { type: 'triangle', gain: 0.13 });
      playTone(554.37, 200, { type: 'triangle', gain: 0.13, delayMs: 120 });
      playTone(659.25, 380, { type: 'triangle', gain: 0.14, delayMs: 240 });
      break;

    case 'big-win': {
      // 5음 팡파레 (A - C# - E - A6 - E 화음)
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, i) => {
        playTone(freq, 220, { type: 'triangle', gain: 0.13, delayMs: i * 110 });
      });
      playTone(880, 600, { type: 'triangle', gain: 0.12, delayMs: 470 });
      playTone(1108.73, 600, { type: 'sine', gain: 0.08, delayMs: 470 });
      break;
    }

    case 'ui-click':
      playTone(880, 50, { type: 'sine', gain: 0.06 });
      break;

    case 'chat':
      playTone(1320, 60, { type: 'sine', gain: 0.04, freqEnd: 1560 });
      break;
  }
}
