'use client';

import { onGameEvent } from '../events/game-events';
import { useSettingsStore } from '../store/settings-store';

/**
 * 장면별 BGM 매니저 (Suno 생성 트랙, public/assets/music).
 * SFX(Web Audio 합성)와 별개로 HTMLAudioElement 하나를 크로스페이드로 돌린다.
 * - 장면 전환: setMusicScene() — 같은 장면이면 no-op
 * - 올인 긴장/복귀는 game-events 구독으로 자동 (initMusicSystem)
 * - 자동재생 차단 대응: 첫 재생 실패 시 pointerdown/touchend에서 재시도
 */

export type MusicScene = 'lobby' | 'table' | 'tension' | 'victory' | 'story';

const TRACKS: Record<MusicScene, string> = {
  lobby: '/assets/music/lobby.mp3',
  table: '/assets/music/table.mp3',
  tension: '/assets/music/tension.mp3',
  victory: '/assets/music/victory.mp3',
  story: '/assets/music/story.mp3',
};

/** 승리 테마는 한 번만 재생 (게임 종료 화면) — 나머지는 루프 */
const LOOP: Record<MusicScene, boolean> = {
  lobby: true,
  table: true,
  tension: true,
  victory: false,
  story: true,
};

/** 트랙 파일이 없을 때(404) 대신 틀 장면 — 'story'는 아트 배치 전까지 로비 트랙으로 */
const FALLBACK: Partial<Record<MusicScene, MusicScene>> = {
  story: 'lobby',
};

/** 로드에 실패한 장면 — 같은 세션에서 다시 시도하지 않는다(404 무한 재시도 방지) */
const unavailable = new Set<MusicScene>();

const MUSIC_VOLUME = 0.25;
const FADE_MS = 900;

let current: HTMLAudioElement | null = null;
let retiring: HTMLAudioElement | null = null; // 페이드아웃 중인 이전 트랙
let currentScene: MusicScene | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let pendingScene: MusicScene | null = null; // 자동재생 차단으로 못 튼 장면
let unlockInstalled = false;
let initialized = false;

function clearFade() {
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

function retire(el: HTMLAudioElement | null) {
  if (!el) return;
  el.pause();
  el.src = '';
}

/** 이전 트랙 페이드아웃 + 새 트랙 페이드인 (단일 타이머) */
function crossfadeTo(next: HTMLAudioElement | null) {
  clearFade();
  retire(retiring); // 직전 크로스페이드가 끝나기 전에 또 전환된 경우 즉시 정리
  retiring = current;
  current = next;
  const prev = retiring;
  const steps = Math.max(1, Math.round(FADE_MS / 50));
  let step = 0;
  fadeTimer = setInterval(() => {
    step++;
    const t = step / steps;
    if (prev) prev.volume = MUSIC_VOLUME * Math.max(0, 1 - t);
    if (next) next.volume = MUSIC_VOLUME * Math.min(1, t);
    if (step >= steps) {
      clearFade();
      retire(prev);
      if (retiring === prev) retiring = null;
    }
  }, 50);
}

/** 자동재생 차단 시 첫 사용자 제스처에서 보류 장면 재시도 */
function installMusicUnlock() {
  if (typeof window === 'undefined' || unlockInstalled) return;
  unlockInstalled = true;
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchend', unlock);
    unlockInstalled = false;
    if (pendingScene) {
      const scene = pendingScene;
      pendingScene = null;
      currentScene = null; // 같은 장면 재시도 허용
      setMusicScene(scene);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('touchend', unlock);
}

export function setMusicScene(requested: MusicScene): void {
  if (typeof window === 'undefined') return;
  const scene = unavailable.has(requested) ? (FALLBACK[requested] ?? 'lobby') : requested;
  if (scene === currentScene) return;
  currentScene = scene;

  const el = new Audio(TRACKS[scene]);
  el.loop = LOOP[scene];
  el.volume = 0;
  el.muted = useSettingsStore.getState().musicMuted;
  el.preload = 'auto';

  // 파일 자체가 없거나(404) 디코딩 실패면 자동재생 차단이 아니다 — 장면을 불가 처리하고 폴백으로
  const markUnavailable = () => {
    if (unavailable.has(scene)) return;
    unavailable.add(scene);
    if (currentScene === scene) {
      currentScene = null;
      pendingScene = null;
      const fallback = FALLBACK[scene];
      if (fallback && fallback !== scene) setMusicScene(fallback);
    }
  };
  el.addEventListener('error', markUnavailable, { once: true });

  el.play().then(
    () => crossfadeTo(el),
    () => {
      if (el.error) {
        markUnavailable();
        return;
      }
      // 자동재생 차단 — 제스처 후 재시도
      pendingScene = scene;
      currentScene = null;
      installMusicUnlock();
    },
  );
}

export function stopMusic(): void {
  currentScene = null;
  pendingScene = null;
  crossfadeTo(null);
}

/** GameRoomView/로비 마운트 시 1회 호출 (모듈 싱글턴, 멱등) */
export function initMusicSystem(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // 음소거 설정 반영 (SFX와 별개 토글)
  useSettingsStore.subscribe(state => {
    if (current) current.muted = state.musicMuted;
  });

  // 올인 긴장 ↔ 테이블 복귀 (게임 중에만 — 로비/승리 장면은 건드리지 않음)
  onGameEvent(event => {
    if (event.type === 'action' && event.actionType === 'all-in' && currentScene === 'table') {
      setMusicScene('tension');
    }
    if (event.type === 'hand-end' && currentScene === 'tension') {
      setMusicScene('table');
    }
  });
}
