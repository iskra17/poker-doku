'use client';

import { useMemo } from 'react';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import {
  ACT_BELT,
  ACT_TITLE,
  BELT_LABEL,
  chapterCardState,
  chapterNumber,
  chapterSkills,
  recommendChapter,
  recommendationCopy,
} from '@/lib/story/story-hub-rules';
import { nextStoryRewards, STORY_REWARD_CATALOG } from '@/lib/story/rewards/catalog';
import type { StoryAct, StoryHeroineId } from '@/lib/story/types';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useOperatorMode } from '@/lib/store/operator-store';
import { useStoryStore } from '@/lib/store/story-store';
import GalleryCard from '@/components/gallery/GalleryCard';
import ChapterCard from './ChapterCard';
import DailyDrillsCard from './DailyDrillsCard';
import ReviewNotePanel from './ReviewNotePanel';

/**
 * 수련 스토리 허브 — **비선형 수련 목록**(2026-09-03 피드백 ②).
 * 띠 헤더 → 한 줄 추천 이유(진행 중 > 약점 > 첫 방문 > 첫 순서) → 수련 목록(막별, 순서 강제 없음 —
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
  // 운영자 모드 — 잠긴 챕터도 열어 둔다(서버 start도 operator면 해금 검사를 우회)
  const operator = useOperatorMode();
  const partnerId = useProgressionStore(state => state.snapshot?.profile.selectedCharacterId ?? null) as StoryHeroineId | null;

  const recommendation = progress ? recommendChapter(STORY_CHAPTERS, progress) : null;

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
        walletReward: STORY_REWARD_CATALOG
          .filter(item => {
            if (item.kind !== 'chips' || granted.has(item.id)) return false;
            const trigger = item.trigger;
            return trigger.kind === 'chapter-first-clear' && trigger.chapterId === chapter.id;
          })
          .reduce((sum, item) => sum + (item.chipAmount ?? 0), 0),
        // 이 챕터로 아직 못 받은 보상(지갑 칩 제외) — 첫 완주/S 조건 문구와 함께
        rewardHints: nextStoryRewards(STORY_CHAPTERS, granted, chapter.id, 2)
          .filter(item => item.trigger.kind !== 'act-complete')
          .map(item => `${item.name} (${item.trigger.kind === 'chapter-grade' ? 'S등급' : '첫 완주'})`),
      })),
    }));
  }, [progress]);

  if (status === 'loading' && !progress) {
    return <p className="p-6 text-center text-sm text-ink-dim">수련 기록을 불러오는 중…</p>;
  }
  if (!progress) {
    return (
      <div className="p-6 text-center text-sm text-ink-dim">
        <p>{error ?? '수련 스토리를 준비 중이에요.'}</p>
        <button type="button" onClick={() => void load()} className="mt-2 min-h-11 rounded-lg border border-mystic/30 px-3 text-sm font-bold text-mystic">다시 시도</button>
      </div>
    );
  }

  const activeRun = progress.activeRun;
  // 다음 승급 안내: 미완료 챕터가 남은 가장 낮은 막
  const nextAct = acts.find(({ chapters }) => chapters.some(({ row }) => row.completions === 0))?.act ?? null;

  return (
    <section className="mx-auto mb-4 w-full max-w-4xl px-3 md:px-4" aria-labelledby="story-hub-title">
      {/* 띠 헤더 */}
      <div className="mb-2 flex items-center justify-between rounded-xl border border-gilded/30 bg-panel/90 px-3 py-2.5">
        <div>
          <h2 id="story-hub-title" className="text-base font-bold text-ink">수련 스토리</h2>
          <p className="text-xs text-ink-dim">
            {nextAct
              ? `${ACT_TITLE[nextAct]} · 완료하면 ${BELT_LABEL[ACT_BELT[nextAct]]}`
              : '검은띠 과정 완료'}
          </p>
        </div>
        <span className="rounded-lg border border-gilded/50 bg-gilded/15 px-3 py-1.5 text-sm font-black text-gilded" aria-label={`현재 띠 ${BELT_LABEL[progress.belt]}`}>
          {BELT_LABEL[progress.belt]}
        </span>
      </div>

      {recommendation && (
        <p className="mb-1 px-1 text-xs leading-relaxed text-ink-dim" aria-label="추천 수련">
          <span className="font-bold text-blossom">추천 수련</span> · {recommendationCopy(recommendation)}
        </p>
      )}

      <details className="mb-2">
        <summary className="min-h-11 cursor-pointer content-center px-1 text-xs text-ink-dim">
          실력 확인 안내
        </summary>
        <p className="px-3 pb-3 text-sm leading-relaxed text-ink-dim">
          문제만 풀기는 설명과 힌트를 건너뛰고 문제 세트만 풉니다. 85점 이상이면 첫 완료로 기록되고, 미완료 챕터에서만 사용할 수 있어요.
        </p>
      </details>

      {error && <p className="mb-2 text-center text-xs text-blossom">{error}</p>}

      {/* 수련 목록 — 막별, 순서 강제 없음 */}
      <div className="mb-2 space-y-3" aria-label="수련 목록">
        {acts.length === 0 && <p className="text-center text-xs text-ink-dim">챕터가 준비되는 중이에요.</p>}
        {acts.map(({ act, chapters }) => (
          <div key={act}>
            <h3 className="mb-1.5 text-sm font-bold text-mystic">{ACT_TITLE[act]}</h3>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {chapters.map(({ chapter, row, skills, walletReward, rewardHints }) => (
                <ChapterCard
                  key={chapter.id}
                  number={chapterNumber(STORY_CHAPTERS, chapter.id) ?? 0}
                  chapter={chapter}
                  progress={row}
                  state={chapterCardState(operator && !row.unlocked ? { ...row, unlocked: true } : row, activeRun)}
                  skills={skills}
                  walletReward={walletReward}
                  rewardHints={rewardHints}
                  recommended={recommendation?.chapterId === chapter.id}
                  partnerId={partnerId}
                  pending={pending || (!!activeRun && activeRun.chapterId !== chapter.id)}
                  onStart={() => void startChapter(chapter.id)}
                  onExam={() => void startChapter(chapter.id, 'exam')}
                  onGraduation={chapter.graduation ? () => void startChapter(chapter.id, 'graduation') : undefined}
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
