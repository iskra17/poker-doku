'use client';

/**
 * AudioContext 싱글턴 + 마스터 게인 + iOS 언락.
 * 모든 사운드는 masterGain을 거친다 (음소거 = gain 0, 컨텍스트는 유지).
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let unlockInstalled = false;

const MASTER_VOLUME = 0.5;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function getAudioContext(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_VOLUME;
    masterGain.connect(ctx.destination);
  }
  return { ctx, master: masterGain! };
}

export function setMasterMuted(muted: boolean): void {
  const audio = getAudioContext();
  if (!audio) return;
  audio.master.gain.value = muted ? 0 : MASTER_VOLUME;
}

/** iOS/모바일 오디오 언락: 첫 사용자 제스처에서 resume */
export function installAudioUnlock(): void {
  if (typeof window === 'undefined' || unlockInstalled) return;
  unlockInstalled = true;
  const unlock = () => {
    const audio = getAudioContext();
    if (audio && audio.ctx.state === 'suspended') {
      audio.ctx.resume().catch(() => {});
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchend', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('touchend', unlock);
}
