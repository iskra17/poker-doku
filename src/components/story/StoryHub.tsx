'use client';

import { useMemo } from 'react';
import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import { getChapter, STORY_CHAPTERS } from '@/lib/story/chapters';
import { ACT_BELT, ACT_TITLE, BELT_LABEL, chapterCardState, chapterNumber, teacherArtId, teacherDisplayName } from '@/lib/story/story-hub-rules';
import type { StoryAct, StoryHeroineId } from '@/lib/story/types';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useStoryStore } from '@/lib/store/story-store';
import ChapterCard from './ChapterCard';
import DailyDrillsCard from './DailyDrillsCard';
import ReviewNotePanel from './ReviewNotePanel';

/**
 * 수련 스토리 허브 — 띠 헤더 → 다음 챕터(담당 히로인) 카드 → 챕터 맵 → 오늘의 수련/복습 노트.
 * 데이터는 서버 진행 뷰(StoryProgressView)와 정적 챕터 레지스트리를 합쳐 그린다.
 */
export default function StoryHub() {
  const progress = useStoryStore(state => state.progress);
  const status = useStoryStore(state => state.progressStatus);
  const error = useStoryStore(state => state.error);
  const pending = useStoryStore(state => state.pending);
  const startChapter = useStoryStore(state => state.startChapter);
  const startDaily = useStoryStore(state => state.startDaily);
  const load = useStoryStore(state => state.load);
  const partnerId = useProgressionStore(state => state.snapshot?.profile.selectedCharacterId ?? null) as StoryHeroineId | null;

  const nextChapter = progress?.nextChapterId ? getChapter(progress.nextChapterId) : undefined;
  const nextTeacherId = nextChapter?.teacher === 'partner' ? (partnerId ?? 'miyako') : (nextChapter?.teacher ?? 'miyako');
  const nextTeacher = getCharacterById(teacherArtId(nextTeacherId));
  const nextTeacherName = teacherDisplayName(nextTeacherId, id => getCharacterById(id)?.name);

  const acts = useMemo(() => {
    if (!progress) return [];
    const byId = new Map(progress.chapters.map(chapter => [chapter.chapterId, chapter]));
    const grouped = new Map<StoryAct, typeof STORY_CHAPTERS[number][]>();
    for (const chapter of STORY_CHAPTERS) {
      if (!byId.has(chapter.id)) continue;
      grouped.set(chapter.act, [...(grouped.get(chapter.act) ?? []), chapter]);
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([act, chapters]) => ({
      act,
      chapters: chapters.map(chapter => ({ chapter, row: byId.get(chapter.id)! })),
    }));
  }, [progress]);

  if (status === 'loading' && !progress) {
    return <p className="p-6 text-center text-xs text-ink-dim">수련 기록을 불러오는 중…</p>;
  }
  if (!progress) {
    return (
      <div className="p-6 text-center text-xs text-ink-dim">
        <p>{error ?? '수련 스토리를 준비 중이에요.'}</p>
        <button type="button" onClick={() => void load()} className="mt-2 rounded-lg border border-mystic/30 px-3 py-1 text-mystic">다시 시도</button>
      </div>
    );
  }

  const nextAct = nextChapter?.act ?? null;
  const activeRun = progress.activeRun;

  return (
    <section className="mx-auto mb-4 w-full max-w-4xl px-3 md:px-4" aria-labelledby="story-hub-title">
      {/* 띠 헤더 */}
      <div className="mb-2 flex items-center justify-between rounded-2xl border border-gilded/30 bg-panel/85 px-4 py-2 backdrop-blur-sm">
        <div>
          <h2 id="story-hub-title" className="text-sm font-bold text-ink">수련 스토리</h2>
          <p className="text-[10px] text-ink-dim">
            {nextAct ? `${ACT_TITLE[nextAct]} 진행 중 · 막을 끝내면 ${BELT_LABEL[ACT_BELT[nextAct]]}` : '검은띠 과정 완료'}
          </p>
        </div>
        <span className="rounded-full border border-gilded/50 bg-gilded/15 px-3 py-1 text-xs font-black text-gilded" aria-label={`현재 띠 ${BELT_LABEL[progress.belt]}`}>
          {BELT_LABEL[progress.belt]}
        </span>
      </div>

      {/* 다음 챕터 (담당 히로인 카드) */}
      {nextChapter && (
        <div className="mb-2 rounded-2xl border border-blossom/30 bg-panel/85 p-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border" style={{ borderColor: `${nextTeacher?.color ?? '#fff'}55` }}>
              <CharacterImage characterId={teacherArtId(nextTeacherId)} expression="happy" round={false} className="h-full w-full text-3xl" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold tracking-wider" style={{ color: nextTeacher?.color }}>
                {activeRun?.chapterId === nextChapter.id ? '진행 중' : '다음 수업'} · CH{chapterNumber(STORY_CHAPTERS, nextChapter.id)} · {nextTeacherName}
              </p>
              <h3 className="truncate text-base font-bold text-ink">{nextChapter.title}</h3>
              <p className="truncate text-[11px] text-ink-dim">{nextChapter.subtitle} · 약 {nextChapter.estimatedMinutes}분</p>
            </div>
            <button
              type="button"
              onClick={() => void startChapter(nextChapter.id)}
              disabled={pending || !!activeRun}
              className="shrink-0 rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2.5 text-sm font-bold text-white shadow-lg disabled:opacity-50"
            >
              {activeRun ? '진행 중' : '시작'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-2 text-center text-xs text-blossom">{error}</p>}

      {/* 챕터 맵 */}
      <div className="mb-2 space-y-3 rounded-2xl border border-mystic/20 bg-panel/85 p-3 backdrop-blur-sm">
        {acts.length === 0 && <p className="text-center text-xs text-ink-dim">챕터가 준비되는 중이에요.</p>}
        {acts.map(({ act, chapters }) => (
          <div key={act}>
            <h3 className="mb-1.5 text-[11px] font-bold text-mystic">{ACT_TITLE[act]}</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {chapters.map(({ chapter, row }) => (
                <ChapterCard
                  key={chapter.id}
                  number={chapterNumber(STORY_CHAPTERS, chapter.id) ?? 0}
                  chapter={chapter}
                  progress={row}
                  state={chapterCardState(row, activeRun)}
                  partnerId={partnerId}
                  pending={pending || (!!activeRun && activeRun.chapterId !== chapter.id)}
                  onStart={() => void startChapter(chapter.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <DailyDrillsCard daily={progress.daily} pending={pending || !!activeRun} onStart={() => void startDaily()} />
        <ReviewNotePanel reviewQueue={progress.reviewQueue} drillStats={progress.drillStats} />
      </div>
    </section>
  );
}
