'use client';

import { onGameEvent } from '../events/game-events';
import { useSettingsStore } from '../store/settings-store';
import {
  getMusicTrack,
  moodFallbackChain,
  normalizeMood,
  pickTrack,
  ROTATING_MOODS,
  type MusicMood,
  type MusicTrack,
} from './music-library';

/**
 * 장면별 BGM 매니저 (Suno 생성 트랙, public/assets/music).
 * SFX(Web Audio 합성)와 별개로 HTMLAudioElement 하나를 크로스페이드로 돌린다.
 * - 장면 전환: setMusicScene(mood) — 같은 mood면 no-op. mood마다 트랙이 여러 개(music-library)라
 *   설정 `musicTrackPrefs[mood]`('auto' | 트랙 id)로 고르고, auto는 직전 곡을 피해 무작위.
 * - 순환: 로비/테이블/긴장은 곡이 끝나면 같은 mood의 다음 곡(질림 완화). 스토리 mood는 루프.
 * - 404/디코딩 실패는 **트랙 단위**로 불가 처리 → 같은 mood 다른 트랙 → mood 폴백 체인(무한 재시도 없음).
 * - [다음 곡] nextTrack(), 설정 미리듣기 previewTrack(), 징글용 duck(), 현재 곡 구독 getNowPlaying/subscribeNowPlaying.
 * - 올인 긴장/복귀는 game-events 구독으로 자동 (initMusicSystem)
 * - 자동재생 차단 대응: 첫 재생 실패 시 pointerdown/touchend에서 재시도
 */

/** 호환: 예전 호출부는 'story'를 넘길 수 있다 */
export type MusicScene = MusicMood | 'story';

export interface NowPlaying {
  mood: MusicMood;
  track: MusicTrack;
  preview: boolean;
}

const MUSIC_VOLUME = 0.25;
const DUCK_VOLUME = 0.08;
const FADE_MS = 900;
const PREVIEW_MS = 12_000;

/** 로드에 실패한 트랙 — 같은 세션에서 다시 시도하지 않는다 */
const unavailable = new Set<string>();
const lastTrackByMood = new Map<MusicMood, string>();

let current: HTMLAudioElement | null = null;
let retiring: HTMLAudioElement | null = null;
let currentMood: MusicMood | null = null;
let currentTrack: MusicTrack | null = null;
let nowPlaying: NowPlaying | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let pendingMood: MusicMood | null = null;
let unlockInstalled = false;
let initialized = false;
let ducked = false;
let duckTimer: ReturnType<typeof setTimeout> | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewResumeMood: MusicMood | null = null;

const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeNowPlaying(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getNowPlaying(): NowPlaying | null {
  return nowPlaying;
}

function setNowPlaying(value: NowPlaying | null): void {
  nowPlaying = value;
  notify();
}

function targetVolume(): number {
  return ducked ? DUCK_VOLUME : MUSIC_VOLUME;
}

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
  retire(retiring);
  retiring = current;
  current = next;
  const prev = retiring;
  const steps = Math.max(1, Math.round(FADE_MS / 50));
  let step = 0;
  fadeTimer = setInterval(() => {
    step++;
    const t = step / steps;
    const volume = targetVolume();
    if (prev) prev.volume = volume * Math.max(0, 1 - t);
    if (next) next.volume = volume * Math.min(1, t);
    if (step >= steps) {
      clearFade();
      retire(prev);
      if (retiring === prev) retiring = null;
    }
  }, 50);
}

function installMusicUnlock() {
  if (typeof window === 'undefined' || unlockInstalled) return;
  unlockInstalled = true;
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchend', unlock);
    unlockInstalled = false;
    if (pendingMood) {
      const mood = pendingMood;
      pendingMood = null;
      currentMood = null;
      setMusicScene(mood);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('touchend', unlock);
}

function prefFor(mood: MusicMood): string {
  return useSettingsStore.getState().musicTrackPrefs?.[mood] ?? 'auto';
}

/** mood 폴백 체인을 따라 틀 수 있는 첫 트랙 */
function resolveTrack(requested: MusicMood): { mood: MusicMood; track: MusicTrack } | null {
  for (const mood of moodFallbackChain(requested)) {
    const track = pickTrack(mood, prefFor(mood), lastTrackByMood.get(mood) ?? null, unavailable);
    if (track) return { mood, track };
  }
  return null;
}

function cancelPreview(): void {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  previewResumeMood = null;
}

function playTrack(mood: MusicMood, track: MusicTrack, preview: boolean): void {
  const el = new Audio(track.file);
  const rotate = !preview && ROTATING_MOODS.has(mood) && prefFor(mood) === 'auto';
  el.loop = track.loop && !rotate && track.loopEnd === undefined;
  el.volume = 0;
  el.muted = useSettingsStore.getState().musicMuted;
  el.preload = 'auto';

  // 파일 자체가 없거나(404) 디코딩 실패 — 트랙 불가 처리 후 같은 mood 다른 트랙/폴백으로
  const markUnavailable = () => {
    if (unavailable.has(track.id)) return;
    unavailable.add(track.id);
    if (currentTrack?.id === track.id) {
      currentTrack = null;
      currentMood = null;
      pendingMood = null;
      setNowPlaying(null);
      setMusicScene(mood);
    }
  };
  el.addEventListener('error', markUnavailable, { once: true });

  // 루프 구간(인트로/아웃트로 제외) — 끝점에 닿으면 시작점으로
  if (track.loopEnd !== undefined && track.loop) {
    const loopStart = track.loopStart ?? 0;
    const loopEnd = track.loopEnd;
    el.addEventListener('timeupdate', () => {
      if (el.currentTime >= loopEnd) el.currentTime = loopStart;
    });
  }
  // 순환 — 곡이 끝나면 같은 mood의 다음 곡
  if (rotate) {
    el.addEventListener('ended', () => {
      if (current !== el || currentMood !== mood) return;
      currentMood = null;
      setMusicScene(mood);
    }, { once: true });
  }

  el.play().then(
    () => {
      currentMood = mood;
      currentTrack = track;
      lastTrackByMood.set(mood, track.id);
      crossfadeTo(el);
      setNowPlaying({ mood, track, preview });
    },
    () => {
      if (el.error) {
        markUnavailable();
        return;
      }
      // 자동재생 차단 — 제스처 후 재시도
      pendingMood = mood;
      currentMood = null;
      installMusicUnlock();
    },
  );
}

export function setMusicScene(requested: MusicScene, options: { force?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  cancelPreview();
  const wanted = normalizeMood(requested);
  if (!options.force && wanted === currentMood) return;
  const resolved = resolveTrack(wanted);
  if (!resolved) {
    // 아무것도 못 튼다(전부 불가) — 조용히 멈춘다
    currentMood = wanted;
    currentTrack = null;
    setNowPlaying(null);
    crossfadeTo(null);
    return;
  }
  // 폴백이 지금 곡과 같은 트랙이면 그대로 둔다(예: story-* → lobby 폴백 중 로비로 복귀)
  if (!options.force && currentTrack && resolved.track.id === currentTrack.id) {
    currentMood = wanted;
    return;
  }
  currentMood = wanted;
  playTrack(resolved.mood, resolved.track, false);
}

/** 같은 mood의 다음 곡(수동 스킵) — 곡이 하나뿐이면 no-op */
export function nextTrack(): void {
  if (!currentMood || !currentTrack) return;
  const next = pickTrack(currentTrack.mood, 'auto', currentTrack.id, unavailable);
  if (!next || next.id === currentTrack.id) return;
  playTrack(currentTrack.mood, next, false);
}

/** 설정 미리듣기 — 12초 뒤 원래 장면으로 복귀. 장면이 바뀌면 취소된다 */
export function previewTrack(trackId: string): void {
  if (typeof window === 'undefined') return;
  const track = getMusicTrack(trackId);
  if (!track || unavailable.has(track.id)) return;
  if (!previewResumeMood) previewResumeMood = currentMood;
  if (previewTimer) clearTimeout(previewTimer);
  const resume = previewResumeMood;
  playTrack(track.mood, track, true);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    previewResumeMood = null;
    if (resume) {
      currentMood = null;
      setMusicScene(resume);
    } else {
      stopMusic();
    }
  }, PREVIEW_MS);
}

/** 징글 재생 동안 BGM을 낮췄다가 복귀 */
export function duck(ms: number): void {
  ducked = true;
  if (current) current.volume = DUCK_VOLUME;
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    ducked = false;
    duckTimer = null;
    if (current && !fadeTimer) current.volume = MUSIC_VOLUME;
  }, ms);
}

export function stopMusic(): void {
  cancelPreview();
  currentMood = null;
  currentTrack = null;
  pendingMood = null;
  setNowPlaying(null);
  crossfadeTo(null);
}

/** GameRoomView/로비 마운트 시 1회 호출 (모듈 싱글턴, 멱등) */
export function initMusicSystem(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // 음소거 + 트랙 선호 반영 (SFX와 별개 토글). 현재 mood의 선호가 바뀌면 그 곡으로 바로 전환
  let prevPrefs = useSettingsStore.getState().musicTrackPrefs;
  useSettingsStore.subscribe(state => {
    if (current) current.muted = state.musicMuted;
    if (state.musicTrackPrefs !== prevPrefs) {
      prevPrefs = state.musicTrackPrefs;
      if (currentMood && currentTrack && !nowPlaying?.preview) {
        const pref = state.musicTrackPrefs?.[currentTrack.mood] ?? 'auto';
        if (pref !== 'auto' && pref !== currentTrack.id) setMusicScene(currentMood, { force: true });
      }
    }
  });

  // 올인 긴장 ↔ 테이블 복귀 (게임 중에만 — 로비/승리 장면은 건드리지 않음)
  onGameEvent(event => {
    if (event.type === 'action' && event.actionType === 'all-in' && currentMood === 'table') {
      setMusicScene('tension');
    }
    if (event.type === 'hand-end' && currentMood === 'tension') {
      setMusicScene('table');
    }
  });
}
