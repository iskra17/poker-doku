/**
 * BGM 라이브러리(순수) — 장면(mood) → 트랙 여러 개.
 *
 * "한 곡만 있어 질린다"(2026-09-03 피드백) → 장면마다 트랙을 여러 개 두고 설정에서 고르거나(`'auto'`) 순환한다.
 * 파일 규칙 `/assets/music/<id>.mp3`(기존 4파일은 예외로 그대로 참조). 아직 배치되지 않은 트랙은 404 →
 * music-manager가 트랙 단위로 불가 처리하고 같은 mood의 다른 트랙 → mood 폴백으로 내려간다(무한 재시도 없음).
 * 새 곡은 Suno로 만들어(`reference_suno-music-gen`) 파일을 놓고 여기 한 줄만 추가한다.
 */

export type MusicMood =
  | 'lobby'
  | 'table'
  | 'tension'
  | 'victory'
  | 'story-calm'
  | 'story-warm'
  | 'story-tense'
  | 'story-triumph'
  | 'story-sad';

export const MUSIC_MOODS: readonly MusicMood[] = ['lobby', 'table', 'tension', 'victory', 'story-calm', 'story-warm', 'story-tense', 'story-triumph', 'story-sad'];

export const MUSIC_MOOD_LABEL: Readonly<Record<MusicMood, string>> = Object.freeze({
  lobby: '로비',
  table: '테이블',
  tension: '올인 긴장',
  victory: '승리',
  'story-calm': '수련 · 수업',
  'story-warm': '수련 · 에필로그',
  'story-tense': '수련 · 보스전',
  'story-triumph': '수련 · 결산(통과)',
  'story-sad': '수련 · 결산(미통과)',
});

export interface MusicTrack {
  id: string;
  mood: MusicMood;
  title: string;
  file: string;
  /** false면 끝까지 한 번(승리 스팅) — 순환 모드에서는 무시 */
  loop: boolean;
  /** 루프 구간(초) — Suno 인트로/아웃트로 끊김 완화. 없으면 파일 전체 루프 */
  loopStart?: number;
  loopEnd?: number;
}

export const MUSIC_TRACKS: readonly MusicTrack[] = Object.freeze([
  // 로비 — 3곡 순환
  { id: 'lobby-sakura-morning', mood: 'lobby', title: '벚꽃 아침', file: '/assets/music/lobby.mp3', loop: true },
  { id: 'lobby-night-lounge', mood: 'lobby', title: '밤의 도장 라운지', file: '/assets/music/lobby-night-lounge.mp3', loop: true },
  { id: 'lobby-rainy-piano', mood: 'lobby', title: '비 오는 오후', file: '/assets/music/lobby-rainy-piano.mp3', loop: true },
  // 테이블 — 3곡 순환
  { id: 'table-dojo', mood: 'table', title: '도장 테이블', file: '/assets/music/table.mp3', loop: true },
  { id: 'table-green-felt', mood: 'table', title: '그린 펠트', file: '/assets/music/table-green-felt.mp3', loop: true },
  { id: 'table-neon-holdem', mood: 'table', title: '네온 홀덤', file: '/assets/music/table-neon-holdem.mp3', loop: true },
  // 올인 긴장 — 2곡
  { id: 'tension-allin', mood: 'tension', title: '올인', file: '/assets/music/tension.mp3', loop: true },
  { id: 'tension-allin-drums', mood: 'tension', title: '올인 드럼', file: '/assets/music/tension-allin-drums.mp3', loop: true },
  // 승리 — 1회 재생
  { id: 'victory-fanfare', mood: 'victory', title: '승리', file: '/assets/music/victory.mp3', loop: false },
  // 수련 스토리 mood 5종
  { id: 'story-calm-dojo-morning', mood: 'story-calm', title: '도장의 아침', file: '/assets/music/story-calm-dojo-morning.mp3', loop: true },
  { id: 'story-warm-evening-garden', mood: 'story-warm', title: '저녁 정원', file: '/assets/music/story-warm-evening-garden.mp3', loop: true },
  { id: 'story-tense-boss', mood: 'story-tense', title: '보스전', file: '/assets/music/story-tense-boss.mp3', loop: true },
  { id: 'story-triumph-belt', mood: 'story-triumph', title: '승급', file: '/assets/music/story-triumph-belt.mp3', loop: true },
  { id: 'story-sad-rain', mood: 'story-sad', title: '비 내리는 사범실', file: '/assets/music/story-sad-rain.mp3', loop: true },
]);

/** 트랙이 하나도 못 틀 때 대신 틀 mood — 체인 끝은 lobby */
export const MOOD_FALLBACK: Readonly<Partial<Record<MusicMood, MusicMood>>> = Object.freeze({
  tension: 'table',
  'story-calm': 'lobby',
  'story-warm': 'story-calm',
  'story-tense': 'story-calm',
  'story-triumph': 'victory',
  'story-sad': 'story-calm',
});

/** 순환 모드가 켜지는 mood — 곡이 끝나면 같은 mood의 다음 곡. 스토리 mood는 짧은 씬이라 루프 유지 */
export const ROTATING_MOODS: ReadonlySet<MusicMood> = new Set<MusicMood>(['lobby', 'table', 'tension']);

/** 예전 장면 키 'story'는 story-calm */
export function normalizeMood(value: string): MusicMood {
  if (value === 'story') return 'story-calm';
  return (MUSIC_MOODS as readonly string[]).includes(value) ? (value as MusicMood) : 'lobby';
}

export function isMusicMood(value: unknown): value is MusicMood {
  return typeof value === 'string' && (MUSIC_MOODS as readonly string[]).includes(value);
}

export function tracksForMood(mood: MusicMood): MusicTrack[] {
  return MUSIC_TRACKS.filter(track => track.mood === mood);
}

export function getMusicTrack(id: string): MusicTrack | null {
  return MUSIC_TRACKS.find(track => track.id === id) ?? null;
}

export type MusicTrackPref = 'auto' | string;

/**
 * 트랙 선택 — 지정 트랙이 살아 있으면 그것, 아니면(auto/불가) 직전 곡을 뺀 무작위. 후보가 없으면 null(mood 폴백).
 * `rng`는 [0,1) — 테스트 결정론용.
 */
export function pickTrack(
  mood: MusicMood,
  pref: MusicTrackPref,
  lastId: string | null,
  unavailable: ReadonlySet<string>,
  rng: () => number = Math.random,
): MusicTrack | null {
  const alive = tracksForMood(mood).filter(track => !unavailable.has(track.id));
  if (alive.length === 0) return null;
  if (pref !== 'auto') {
    const chosen = alive.find(track => track.id === pref);
    if (chosen) return chosen;
  }
  const candidates = alive.length > 1 && lastId ? alive.filter(track => track.id !== lastId) : alive;
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
}

/** mood 폴백 체인 — 자기 자신 포함 순서대로 (lobby로 끝난다, 순환 방지) */
export function moodFallbackChain(mood: MusicMood): MusicMood[] {
  const chain: MusicMood[] = [mood];
  let cursor: MusicMood | undefined = MOOD_FALLBACK[mood];
  while (cursor && !chain.includes(cursor)) {
    chain.push(cursor);
    cursor = MOOD_FALLBACK[cursor];
  }
  if (!chain.includes('lobby')) chain.push('lobby');
  return chain;
}
