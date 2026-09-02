'use client';

import { useEffect, useRef, useState } from 'react';
import { MUSIC_MOOD_LABEL } from '@/lib/sound/music-library';
import { nextTrack } from '@/lib/sound/music-manager';
import { useNowPlaying } from '@/lib/sound/use-now-playing';
import { useSettingsStore } from '@/lib/store/settings-store';

/**
 * 로비 헤더 🎵 — 팝오버에 지금 재생 중인 곡 · [다음 곡] · [배경음악 끄기/켜기] · 설정 바로가기.
 * BGM을 고르는 본진은 설정 → 사운드 탭(MusicTrackPicker); 여기는 "지금 곡 바꾸기" 지름길이다.
 */
export default function NowPlayingButton({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const now = useNowPlaying();
  const musicMuted = useSettingsStore(state => state.musicMuted);
  const toggleMusicMuted = useSettingsStore(state => state.toggleMusicMuted);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // 바깥 탭으로 닫기 (외부 시스템 콜백)
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const label = now ? `${MUSIC_MOOD_LABEL[now.mood]} · ${now.track.title}` : '배경 음악';
  return (
    <span ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-label={`배경 음악 — ${label}`}
        aria-expanded={open}
        title={label}
        className={`rounded-full border border-mystic/20 bg-panel/80 p-2 transition-colors hover:text-ink ${musicMuted ? 'text-ink-dim/60' : 'text-ink-dim'}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="배경 음악" className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-mystic/25 bg-elevated/95 p-2 text-left shadow-2xl backdrop-blur">
          <p className="text-[10px] text-ink-dim">지금 재생</p>
          <p className="truncate text-xs font-bold text-ink">{now ? now.track.title : '—'}</p>
          {now && <p className="text-[10px] text-ink-dim">{MUSIC_MOOD_LABEL[now.mood]}{now.preview ? ' · 미리듣기' : ''}</p>}
          <div className="mt-2 flex gap-1">
            <button type="button" onClick={nextTrack} disabled={!now || now.preview} className="flex-1 rounded-lg border border-mystic/30 px-2 py-1 text-[11px] font-bold text-ink disabled:opacity-40">
              다음 곡 ⏭
            </button>
            <button type="button" onClick={toggleMusicMuted} className="flex-1 rounded-lg border border-mystic/30 px-2 py-1 text-[11px] font-bold text-ink">
              {musicMuted ? '음악 켜기' : '음악 끄기'}
            </button>
          </div>
          {onOpenSettings && (
            <button type="button" onClick={() => { setOpen(false); onOpenSettings(); }} className="mt-1 w-full rounded-lg px-2 py-1 text-left text-[10px] text-ink-dim hover:text-ink">
              곡 고르기 → 설정 · 사운드
            </button>
          )}
        </div>
      )}
    </span>
  );
}
