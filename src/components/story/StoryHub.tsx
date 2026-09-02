'use client';

import { useMemo } from 'react';
import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import { getChapter, STORY_CHAPTERS } from '@/lib/story/chapters';
import {
  ACT_BELT,
  ACT_TITLE,
  BELT_LABEL,
  chapterCardState,
  chapterNumber,
  chapterSkills,
  recommendChapter,
  recommendationCopy,
  teacherArtId,
  teacherDisplayName,
} from '@/lib/story/story-hub-rules';
import { nextStoryRewards } from '@/lib/story/rewards/catalog';
import type { StoryAct, StoryHeroineId } from '@/lib/story/types';
import { useOutfitId } from '@/lib/hooks/use-outfit';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useStoryStore } from '@/lib/store/story-store';
import GalleryCard from '@/components/gallery/GalleryCard';
import ChapterCard from './ChapterCard';
import DailyDrillsCard from './DailyDrillsCard';
import ReviewNotePanel from './ReviewNotePanel';

/**
 * 수련 스토리 허브 — **비선형 수련 목록**(2026-09-03 피드백 ②).
 * 띠 헤더 → 추천 수련 카드(진행 중 > 약점 > 첫 방문 > 첫 순서) → 수련 목록(막별, 순서 강제 없음 —
 * 카드마다 다루는 유형과 내 정확도를 칩으로 보여 "부족한 부분"부터 고르게 한다) → 오늘의 수련/복습 노트.
 * 데이터는 서버 진행 뷰(StoryProgressView)와 정적 챕터 레지스트리를 합쳐 그린다.
 */
export default function StoryHub({ onOpenGallery }: { onOpenGallery?: () => void } = {}) {
  const progress = useStoryStore(state => state.progress);
  const status = useStoryStore(state => state.progressStatus);
  const error = useStoryStore(state => state.error);
  const pending = useStoryStore(state => state.pending);
  const startChapter = useStoryStore(state => state.startChapter);
  const startDaily = useStoryStore(state => state.startDaily);
  const load = useStoryStore(state => state.load);
  const partnerId = useProgressionStore(state => state.snapshot?.profile.selectedCharacterId ?? null) as StoryHeroineId | null;

  const recommendation = progress ? recommendChapter(STORY_CHAPTERS, progress) : null;
  const recommended = recommendation ? getChapter(recommendation.chapterId) : undefined;
  const recommendedTeacherId = recommended?.teacher === 'partner' ? (partnerId ?? 'miyako') : (recommended?.teacher ?? 'miyako');
  const recommendedTeacher = getCharacterById(teacherArtId(recommendedTeacherId));
  const recommendedTeacherName = teacherDisplayName(recommendedTeacherId, id => getCharacterById(id)?.name);
  const recommendedOutfit = useOutfitId(recommendedTeacherId);

  const acts = useMemo(() => {
    if (!progress) return [];
    // 획득한 보상 id — 서버 보상 라인이 없으면 빈 집합(전부 미획득으로 표시)
    const granted = new Set((progress.rewards ?? []).filter(item => item.granted).map(item => item.id));
    const byId = new Map(progress.chapters.map(chapter => [chapter.chapterId, chapter]));
    const grouped = new Map<StoryAct, typeof STORY_CHAPTERS[number][]>();
    for (const chapter of STORY_CHAPTERS) {
      if (!byId.has(chapter.id)) continue;
      grouped.set(chapter.act, [...(grouped.get(chapter.act) ?? []), chapter]);
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([act, chapters]) => ({
      act,
      chapters: chapters.map(chapter => ({
        chapter,
        row: byId.get(chapter.id)!,
        skills: chapterSkills(chapter, progress.drillStats),
        // 이 챕터로 아직 못 받은 보상(칩 제외) — 첫 완주/S 조건 문구와 함께
        rewardHints: nextStoryRewards(STORY_CHAPTERS, granted, chapter.id, 2)
          .filter(item => item.trigger.kind !== 'act-complete')
          .map(item => `${item.name} (${item.trigger.kind === 'chapter-grade' ? 'S등급' : '첫 완주'})`),
      })),
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

  const activeRun = progress.activeRun;
  const recommendedRow = recommended ? progress.chapters.find(chapter => chapter.chapterId === recommended.id) : undefined;
  const recommendedState = recommendedRow ? chapterCardState(recommendedRow, activeRun) : null;
  const inProgress = recommendation?.reason === 'in-progress';
  // 다음 승급 안내: 미완료 챕터가 남은 가장 낮은 막
  const nextAct = acts.find(({ chapters }) => chapters.some(({ row }) => row.completions === 0))?.act ?? null;

  return (
    <section className="mx-auto mb-4 w-full max-w-4xl px-3 md:px-4" aria-labelledby="story-hub-title">
      {/* 띠 헤더 */}
      <div className="mb-2 flex items-center justify-between rounded-2xl border border-gilded/30 bg-panel/85 px-4 py-2 backdrop-blur-sm">
        <div>
          <h2 id="story-hub-title" className="text-sm font-bold text-ink">수련 스토리</h2>
          <p className="text-[10px] text-ink-dim">
            {nextAct
              ? `원하는 수련부터 골라요 · ${ACT_TITLE[nextAct]}을 모두 마치면 ${BELT_LABEL[ACT_BELT[nextAct]]}`
              : '검은띠 과정 완료'}
          </p>
        </div>
        <span className="rounded-full border border-gilded/50 bg-gilded/15 px-3 py-1 text-xs font-black text-gilded" aria-label={`현재 띠 ${BELT_LABEL[progress.belt]}`}>
          {BELT_LABEL[progress.belt]}
        </span>
      </div>

      {/* 추천 수련 (담당 히로인 카드) — 순서 강제가 아니라 제안 */}
      {recommendation && recommended && (
        <div className="mb-2 rounded-2xl border border-blossom/30 bg-panel/85 p-3 backdrop-blur-sm" aria-label="추천 수련">
          <div className="flex items-center gap-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border" style={{ borderColor: `${recommendedTeacher?.color ?? '#fff'}55` }}>
              <CharacterImage characterId={teacherArtId(recommendedTeacherId)} expression="happy" round={false} outfitId={recommendedOutfit} className="h-full w-full text-3xl" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold tracking-wider" style={{ color: recommendedTeacher?.color }}>
                {inProgress ? '진행 중' : '추천 수련'} · CH{chapterNumber(STORY_CHAPTERS, recommended.id)} · {recommendedTeacherName}
              </p>
              <h3 className="truncate text-base font-bold text-ink">{recommended.title}</h3>
              <p className="truncate text-[11px] text-ink-dim">{recommended.subtitle} · 약 {recommended.estimatedMinutes}분</p>
              <p className={`truncate text-[10px] ${recommendation.reason === 'weakness' ? 'text-blossom' : 'text-ink-dim'}`}>
                {recommendationCopy(recommendation)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => void startChapter(recommended.id)}
                disabled={pending || (!!activeRun && !inProgress)}
                className="rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2.5 text-sm font-bold text-white shadow-lg disabled:opacity-50"
              >
                {inProgress ? '이어하기' : '시작'}
              </button>
              {recommendedState === 'available' && (
                <button
                  type="button"
                  onClick={() => void startChapter(recommended.id, 'exam')}
                  disabled={pending || !!activeRun}
                  title="이미 아는 내용이면 문제만 풀어 통과해요 (힌트 없음, 85점 이상)"
                  className="rounded-xl border border-gilded/40 px-3 py-1 text-[11px] font-bold text-gilded disabled:opacity-50"
                >
                  실력 확인
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <p className="mb-2 text-center text-xs text-blossom">{error}</p>}

      {/* 수련 목록 — 막별, 순서 강제 없음 */}
      <div className="mb-2 space-y-3 rounded-2xl border border-mystic/20 bg-panel/85 p-3 backdrop-blur-sm" aria-label="수련 목록">
        <p className="text-[10px] text-ink-dim">
          순서는 자유예요. 칩의 정확도를 보고 부족한 유형부터 골라도 되고, 아는 내용은 [실력 확인]으로 문제만 풀어 통과할 수 있어요.
        </p>
        {acts.length === 0 && <p className="text-center text-xs text-ink-dim">챕터가 준비되는 중이에요.</p>}
        {acts.map(({ act, chapters }) => (
          <div key={act}>
            <h3 className="mb-1.5 text-[11px] font-bold text-mystic">{ACT_TITLE[act]}</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {chapters.map(({ chapter, row, skills, rewardHints }) => (
                <ChapterCard
                  key={chapter.id}
                  number={chapterNumber(STORY_CHAPTERS, chapter.id) ?? 0}
                  chapter={chapter}
                  progress={row}
                  state={chapterCardState(row, activeRun)}
                  skills={skills}
                  rewardHints={rewardHints}
                  recommended={recommendation?.chapterId === chapter.id}
                  partnerId={partnerId}
                  pending={pending || (!!activeRun && activeRun.chapterId !== chapter.id)}
                  onStart={() => void startChapter(chapter.id)}
                  onExam={() => void startChapter(chapter.id, 'exam')}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={`grid gap-2 ${onOpenGallery ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        <DailyDrillsCard daily={progress.daily} pending={pending || !!activeRun} onStart={() => void startDaily()} />
        <ReviewNotePanel reviewQueue={progress.reviewQueue} drillStats={progress.drillStats} />
        {onOpenGallery && <GalleryCard onOpen={onOpenGallery} />}
      </div>
    </section>
  );
}
