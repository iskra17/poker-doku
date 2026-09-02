'use client';

import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import { useOutfitId } from '@/lib/hooks/use-outfit';
import type { Chapter, StoryHeroineId } from '@/lib/story/types';
import {
  WEAKNESS_MAX_PCT,
  WEAKNESS_MIN_ATTEMPTS,
  teacherArtId,
  teacherDisplayName,
  type ChapterCardState,
  type ChapterSkill,
} from '@/lib/story/story-hub-rules';
import type { StoryChapterProgressView } from '@/lib/story/views';

interface ChapterCardProps {
  number: number;
  chapter: Chapter | undefined;
  progress: StoryChapterProgressView;
  state: ChapterCardState;
  /** 이 챕터가 다루는 드릴 유형 + 내 정확도 (수련 목록의 "부족한 부분 고르기" 단서) */
  skills: ChapterSkill[];
  /** 아직 못 받은 보상 미리보기 — '🎁 사쿠라 · 도복 (첫 완주)' */
  rewardHints: string[];
  recommended: boolean;
  partnerId: StoryHeroineId | null;
  pending: boolean;
  onStart: () => void;
  /** 아는 내용이면 문제만 풀어 통과하는 실력 확인 — 미완료 챕터에서만 */
  onExam?: () => void;
}

const STATE_LABEL: Record<ChapterCardState, string> = {
  locked: '잠김',
  available: '미수련',
  'in-progress': '진행 중',
  completed: '완료',
};

function SkillChip({ skill }: { skill: ChapterSkill }) {
  const weak = skill.pct !== null && skill.total >= WEAKNESS_MIN_ATTEMPTS && skill.pct < WEAKNESS_MAX_PCT;
  const strong = skill.pct !== null && skill.total >= WEAKNESS_MIN_ATTEMPTS && skill.pct >= 90;
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[9px] ${
        weak ? 'border-blossom/50 bg-blossom/10 text-blossom' : strong ? 'border-cyber/40 bg-cyber/10 text-cyber' : 'border-mystic/25 bg-abyss/40 text-ink-dim'
      }`}
      title={skill.pct === null ? `${skill.label} · 아직 푼 문제 없음` : `${skill.label} · 정확도 ${skill.pct}% (${skill.total}문)`}
    >
      {skill.label}
      {skill.pct !== null && <span className="ml-0.5 tabular">{skill.pct}%</span>}
    </span>
  );
}

/**
 * 수련 목록 카드 — 담당 히로인·제목·스킬 칩(내 정확도)·상태·[시작]/[실력 확인].
 * 순서 강제 없음: 잠김은 requires가 있는 후속 막에서만 나온다. 진행 중은 강조, 추천은 테두리로 표시.
 */
export default function ChapterCard({
  number, chapter, progress, state, skills, rewardHints, recommended, partnerId, pending, onStart, onExam,
}: ChapterCardProps) {
  const teacherId = chapter?.teacher === 'partner' ? (partnerId ?? 'miyako') : (chapter?.teacher ?? 'miyako');
  const teacherName = teacherDisplayName(teacherId, id => getCharacterById(id)?.name);
  const outfitId = useOutfitId(teacherId);
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
            : recommended
              ? 'border-gilded/50 bg-elevated/60'
              : 'border-mystic/25 bg-elevated/50'
      }`}
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-mystic/25">
        <CharacterImage characterId={teacherArtId(teacherId)} expression={locked ? 'neutral' : 'happy'} round={false} outfitId={outfitId} className="h-full w-full text-2xl" />
        {grade && (
          <span className="absolute bottom-0 right-0 rounded-tl-lg bg-gilded px-1.5 text-[10px] font-black text-abyss" aria-label={`최고 등급 ${grade}`}>
            {grade}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold tracking-wider text-ink-dim">
          CH{number} · {teacherName} · <span className={state === 'completed' ? 'text-cyber' : state === 'in-progress' ? 'text-blossom' : ''}>{STATE_LABEL[state]}</span>
          {recommended && state !== 'in-progress' && <span className="ml-1 text-gilded">★ 추천</span>}
        </p>
        <h3 className="truncate text-sm font-bold text-ink">{chapter?.title ?? progress.chapterId}</h3>
        <p className="truncate text-[11px] text-ink-dim">{chapter?.subtitle ?? ''}</p>
        {skills.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" aria-label="다루는 유형">
            {skills.map(skill => <SkillChip key={skill.category} skill={skill} />)}
          </div>
        )}
        {rewardHints.length > 0 && (
          <p className="mt-1 truncate text-[10px] text-gilded" title={rewardHints.join(' · ')}>
            🎁 {rewardHints.join(' · ')}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-dim">
          {chapter && <span>약 {chapter.estimatedMinutes}분</span>}
          {progress.completions > 0 && <span>완료 {progress.completions}회</span>}
          {progress.attempts > 0 && progress.completions === 0 && <span>도전 {progress.attempts}회</span>}
        </div>
      </div>
      {!locked && (
        <div className="flex shrink-0 flex-col justify-center gap-1">
          <button
            type="button"
            onClick={onStart}
            disabled={pending}
            className={`rounded-lg px-3 py-2 text-xs font-bold text-white shadow disabled:opacity-50 ${
              state === 'in-progress' ? 'bg-blossom' : 'bg-gradient-to-r from-mystic to-blossom'
            }`}
          >
            {state === 'in-progress' ? '이어하기' : state === 'completed' ? '다시' : '시작'}
          </button>
          {onExam && state === 'available' && (
            <button
              type="button"
              onClick={onExam}
              disabled={pending}
              title="이미 아는 내용이면 문제만 풀어 통과해요 (힌트 없음, 85점 이상)"
              className="rounded-lg border border-gilded/40 px-2 py-1 text-[10px] font-bold text-gilded disabled:opacity-50"
            >
              실력 확인
            </button>
          )}
        </div>
      )}
    </article>
  );
}
