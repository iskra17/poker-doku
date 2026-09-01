'use client';

import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import type { Chapter, StoryHeroineId } from '@/lib/story/types';
import type { ChapterCardState } from '@/lib/story/story-hub-rules';
import type { StoryChapterProgressView } from '@/lib/story/views';

interface ChapterCardProps {
  number: number;
  chapter: Chapter | undefined;
  progress: StoryChapterProgressView;
  state: ChapterCardState;
  partnerId: StoryHeroineId | null;
  pending: boolean;
  onStart: () => void;
}

const STATE_LABEL: Record<ChapterCardState, string> = {
  locked: '잠김',
  available: '도전 가능',
  'in-progress': '진행 중',
  completed: '완료',
};

/** 챕터 맵 카드 — 담당 히로인·제목·등급·상태·[시작]. 잠긴 챕터는 흐리게, 진행 중은 강조. */
export default function ChapterCard({ number, chapter, progress, state, partnerId, pending, onStart }: ChapterCardProps) {
  const teacherId = chapter?.teacher === 'partner' ? (partnerId ?? 'miyako') : (chapter?.teacher ?? 'miyako');
  const teacher = getCharacterById(teacherId === 'miyako' ? 'dealer' : teacherId);
  const locked = state === 'locked';
  const grade = progress.bestGrade;

  return (
    <article
      aria-label={`챕터 ${number} ${chapter?.title ?? progress.chapterId}`}
      className={`flex gap-3 rounded-xl border p-3 ${
        state === 'in-progress'
          ? 'border-blossom/50 bg-blossom/10'
          : locked
            ? 'border-mystic/15 bg-elevated/30 opacity-60'
            : 'border-mystic/25 bg-elevated/50'
      }`}
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-mystic/25">
        <CharacterImage characterId={teacherId === 'miyako' ? 'dealer' : teacherId} expression={locked ? 'neutral' : 'happy'} round={false} className="h-full w-full text-2xl" />
        {grade && (
          <span className="absolute bottom-0 right-0 rounded-tl-lg bg-gilded px-1.5 text-[10px] font-black text-abyss" aria-label={`최고 등급 ${grade}`}>
            {grade}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold tracking-wider text-ink-dim">
          CH{number} · {teacher?.name ?? '미야코'} · {STATE_LABEL[state]}
        </p>
        <h3 className="truncate text-sm font-bold text-ink">{chapter?.title ?? progress.chapterId}</h3>
        <p className="truncate text-[11px] text-ink-dim">{chapter?.subtitle ?? ''}</p>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-dim">
          {chapter && <span>약 {chapter.estimatedMinutes}분</span>}
          {progress.completions > 0 && <span>완료 {progress.completions}회</span>}
          {progress.attempts > 0 && progress.completions === 0 && <span>도전 {progress.attempts}회</span>}
        </div>
      </div>
      {!locked && (
        <button
          type="button"
          onClick={onStart}
          disabled={pending}
          className={`self-center rounded-lg px-3 py-2 text-xs font-bold text-white shadow disabled:opacity-50 ${
            state === 'in-progress' ? 'bg-blossom' : 'bg-gradient-to-r from-mystic to-blossom'
          }`}
        >
          {state === 'in-progress' ? '이어하기' : state === 'completed' ? '다시' : '시작'}
        </button>
      )}
    </article>
  );
}
