'use client';

import { MUSIC_MOOD_LABEL, MUSIC_MOODS, tracksForMood, type MusicMood } from '@/lib/sound/music-library';
import { nextTrack, previewTrack } from '@/lib/sound/music-manager';
import { useNowPlaying } from '@/lib/sound/use-now-playing';
import { useSettingsStore } from '@/lib/store/settings-store';

/** 설정 사운드 탭에 노출하는 mood — 승리 스팅(1곡)은 제외 */
const PICKER_MOODS: readonly MusicMood[] = MUSIC_MOODS.filter(mood => mood !== 'victory');

/**
 * 배경 음악 선택 — mood마다 [자동 순환] + 트랙 라디오, ▶ 미리듣기(12초 뒤 원래 곡 복귀), 지금 재생 중 표시.
 * 트랙이 하나뿐인 mood는 라디오 대신 곡 이름만.
 */
export default function MusicTrackPicker() {
  const prefs = useSettingsStore(state => state.musicTrackPrefs);
  const setPref = useSettingsStore(state => state.setMusicTrackPref);
  const now = useNowPlaying();
  return (
    <div className="space-y-3" aria-label="배경 음악 선택">
      <div className="flex items-center justify-between rounded-xl border border-mystic/20 bg-elevated/40 px-3 py-2">
        <div className="min-w-0 text-xs">
          <span className="text-ink-dim">지금 재생</span>
          <span className="ml-2 font-bold text-ink">{now ? `${MUSIC_MOOD_LABEL[now.mood]} · ${now.track.title}` : '—'}</span>
          {now?.preview && <span className="ml-1 text-[10px] text-gilded">미리듣기</span>}
        </div>
        <button type="button" onClick={nextTrack} disabled={!now || now.preview} className="shrink-0 rounded-lg border border-mystic/30 px-2 py-1 text-[11px] font-bold text-ink-dim disabled:opacity-40">
          다음 곡 ⏭
        </button>
      </div>
      {PICKER_MOODS.map(mood => {
        const tracks = tracksForMood(mood);
        const pref = prefs[mood] ?? 'auto';
        const groupName = `music-${mood}`;
        return (
          <fieldset key={mood} className="rounded-xl border border-mystic/15 p-2">
            <legend className="px-1 text-[11px] font-bold text-ink-dim">{MUSIC_MOOD_LABEL[mood]}</legend>
            {tracks.length > 1 && (
              <label className="flex items-center gap-2 py-1 text-sm text-ink">
                <input type="radio" name={groupName} checked={pref === 'auto'} onChange={() => setPref(mood, 'auto')} className="accent-[var(--color-blossom)]" />
                자동 순환
              </label>
            )}
            {tracks.map(track => {
              const playing = now?.track.id === track.id;
              return (
                <div key={track.id} className="flex items-center gap-2 py-1">
                  {tracks.length > 1 ? (
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
                      <input type="radio" name={groupName} checked={pref === track.id} onChange={() => setPref(mood, track.id)} className="accent-[var(--color-blossom)]" />
                      <span className="truncate">{track.title}</span>
                    </label>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{track.title}</span>
                  )}
                  {playing && <span className="text-[10px] font-bold text-blossom">♪ 재생 중</span>}
                  <button type="button" onClick={() => previewTrack(track.id)} aria-label={`${track.title} 미리듣기`} className="rounded-md border border-mystic/30 px-1.5 py-0.5 text-[10px] text-ink-dim">
                    ▶
                  </button>
                </div>
              );
            })}
          </fieldset>
        );
      })}
      <p className="text-[10px] text-ink-dim">아직 준비 중인 곡은 건너뛰고 다음 곡을 틀어요. 곡은 계속 늘어날 예정이에요.</p>
    </div>
  );
}
