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
  /** 아직 못 받은 보상 미리보기 */
  rewardHints: string[];
  recommended: boolean;
  partnerId: StoryHeroineId | null;
  pending: boolean;
  onStart: () => void;
  /** 아는 내용이면 문제만 풀어 통과하는 실력 확인 — 미완료 챕터에서만 */
  onExam?: () => void;
  /** 졸업 챕터를 완주한 뒤 대결만 다시 도전 — 완료 기록·XP는 늘지 않고 순위만 남는다 */
  onGraduation?: () => void;
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
      className={`rounded-md border px-1.5 py-1 text-xs ${
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
  number, chapter, progress, state, skills, rewardHints, recommended, partnerId, pending, onStart, onExam, onGraduation,
}: ChapterCardProps) {
  const teacherId = chapter?.teacher === 'partner' ? (partnerId ?? 'miyako') : (chapter?.teacher ?? 'miyako');
  const teacherName = teacherDisplayName(teacherId, id => getCharacterById(id)?.name);
  const outfitId = useOutfitId(teacherId);
  const locked = state === 'locked';
  const grade = progress.bestGrade;

  return (
    <article
      aria-label={`챕터 ${number} ${chapter?.title ?? progress.chapterId}`}
      className={`flex min-w-0 gap-3 rounded-xl border p-3 ${
        state === 'in-progress'
          ? 'border-blossom/50 bg-blossom/10'
          : locked
            ? 'border-mystic/15 bg-elevated/30 opacity-60'
            : recommended
              ? 'border-gilded/50 bg-elevated/60'
              : 'border-mystic/25 bg-elevated/50'
      }`}
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/15">
        <CharacterImage characterId={teacherArtId(teacherId)} expression={locked ? 'neutral' : 'happy'} round={false} outfitId={outfitId} className="h-full w-full text-2xl" />
        {grade && (
          <span className="absolute bottom-0 right-0 rounded-tl-lg bg-gilded px-1.5 text-xs font-black text-abyss" aria-label={`최고 등급 ${grade}`}>
            {grade}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold tracking-wide text-ink-dim">
          CH{number} · {teacherName} · <span className={state === 'completed' ? 'text-cyber' : state === 'in-progress' ? 'text-blossom' : ''}>{STATE_LABEL[state]}</span>
          {recommended && state !== 'in-progress' && <span className="ml-1 text-gilded">· 추천</span>}
        </p>
        <h3 className="truncate text-sm font-bold text-ink">{chapter?.title ?? progress.chapterId}</h3>
        <p className="truncate text-sm text-ink-dim">{chapter?.subtitle ?? ''}</p>
        {skills.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" aria-label="다루는 유형">
            {skills.map(skill => <SkillChip key={skill.category} skill={skill} />)}
          </div>
        )}
        {rewardHints.length > 0 && (
          <p className="mt-1 line-clamp-2 text-xs text-gilded" title={rewardHints.join(' · ')}>
            보상 · {rewardHints.join(' · ')}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-dim">
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
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-xs font-bold text-abyss transition-colors hover:bg-blossom-hot disabled:opacity-50 ${
              state === 'in-progress' ? 'bg-blossom' : 'bg-blossom'
            }`}
          >
            {state === 'in-progress' ? '이어하기' : state === 'completed' ? '다시' : '시작'}
          </button>
          {onExam && !chapter?.examDisabled && state === 'available' && (
            <>
              <button
                type="button"
                onClick={onExam}
                disabled={pending}
                title="이미 아는 내용이면 문제만 풀어 통과해요 (힌트 없음, 85점 이상)"
                className="min-h-11 whitespace-nowrap rounded-lg border border-gilded/40 px-2 text-xs font-bold text-gilded transition-colors hover:bg-gilded/10 disabled:opacity-50"
              >
                문제만 풀기
              </button>
              <span className="max-w-32 text-center text-xs leading-tight text-gilded">85점 이상 · 첫 완료 보상</span>
            </>
          )}
          {onGraduation && state === 'completed' && (
            <button
              type="button"
              onClick={onGraduation}
              disabled={pending}
              title="수업을 건너뛰고 졸업 대결(실제 6인 Sit & Go)만 다시 도전해요"
              className="min-h-11 whitespace-nowrap rounded-lg border border-gilded/40 px-2 text-xs font-bold text-gilded transition-colors hover:bg-gilded/10 disabled:opacity-50"
            >
              졸업 대결만
            </button>
          )}
        </div>
      )}
    </article>
  );
}
