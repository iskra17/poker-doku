'use client';

import { useSettingsStore } from '../store/settings-store';
import { playEffect, type SoundName } from './effects';
import { duck } from './music-manager';

/**
 * 징글(스팅어) — 결산 스탬프·띠 승급·퍼펙트·도장 레벨업의 3~6초 팡파레(Suno 숏트랙, `/assets/music/stinger-*.mp3`).
 * 파일이 없으면(404) 기존 합성 효과음으로 폴백하고 같은 세션에선 다시 시도하지 않는다. 재생 중 BGM은 `duck`.
 * 단발 UI 효과음(클릭·칩·카드)은 여전히 Web Audio 합성 — 징글만 에셋.
 */
export type StingerName = 'chapter-clear' | 'belt-up' | 'perfect' | 'level-up';

export const STINGER_FILE: Readonly<Record<StingerName, string>> = Object.freeze({
  'chapter-clear': '/assets/music/stinger-chapter-clear.mp3',
  'belt-up': '/assets/music/stinger-belt-up.mp3',
  perfect: '/assets/music/stinger-perfect.mp3',
  'level-up': '/assets/music/stinger-level-up.mp3',
});

/** 파일이 없을 때 대신 낼 합성 효과음 */
export const STINGER_FALLBACK: Readonly<Record<StingerName, SoundName>> = Object.freeze({
  'chapter-clear': 'big-win',
  'belt-up': 'level-up',
  perfect: 'reward',
  'level-up': 'level-up',
});

const STINGER_VOLUME = 0.35;
const DUCK_MS = 4_500;

const unavailable = new Set<StingerName>();

export function stingerFallbackEffect(name: StingerName): SoundName {
  return STINGER_FALLBACK[name];
}

export function playStinger(name: StingerName): void {
  if (typeof window === 'undefined') return;
  if (useSettingsStore.getState().muted) return;
  if (unavailable.has(name)) {
    playEffect(STINGER_FALLBACK[name]);
    return;
  }
  const el = new Audio(STINGER_FILE[name]);
  el.volume = STINGER_VOLUME;
  el.preload = 'auto';
  const fallback = () => {
    if (unavailable.has(name)) return;
    unavailable.add(name);
    playEffect(STINGER_FALLBACK[name]);
  };
  el.addEventListener('error', fallback, { once: true });
  el.play().then(
    () => duck(DUCK_MS),
    () => {
      // 404/디코딩 실패는 폴백, 자동재생 차단이면 조용히(BGM 언락과 같은 제스처 뒤엔 다음 징글이 난다)
      if (el.error) fallback();
    },
  );
}
