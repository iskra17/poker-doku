'use client';

import { useState } from 'react';
import { getChapter } from '@/lib/story/chapters';
import type { ChapterResultView } from '@/lib/story/views';
import RewardReveal from './RewardReveal';

interface ChapterResultProps {
  result: ChapterResultView;
  onClose: () => void;
  onNextChapter?: (chapterId: string) => void;
  onRetry?: () => void;
  onRetrySparring?: () => void;
  pending?: boolean;
  /** 실력 확인 미통과 → 같은 챕터를 수업(full)으로 */
  onFullCourse?: () => void;
  /** 결산에 CG·인연 씬·의상·칭호가 있었을 때 [기록실 보기] — 런을 닫고 기록실을 연다 */
  onOpenGallery?: () => void;
  /** 졸업 챕터 — 수업을 건너뛰고 대결만 다시 도전 */
  onGraduationRetry?: () => void;
}

/** 졸업 대결 순위 카드 — 서버가 확정한 순위 영수증의 투영이다(클라 계산 없음) */
function GraduationCard({ graduation }: { graduation: NonNullable<ChapterResultView['graduation']> }) {
  const note = graduation.champion
    ? '우승 — 사범대리 칭호 자격이에요.'
    : graduation.itm
      ? '입상 — 검은띠 자격을 얻었어요.'
      : '아쉽게 입상권 밖이에요. 3위 안에 들면 검은띠 자격이 붙어요.';
  return (
    <div
      className={`mt-3 rounded-xl border p-3 text-center ${
        graduation.itm ? 'border-gilded/50 bg-gilded/10' : 'border-mystic/30 bg-mystic/5'
      }`}
      aria-label="졸업 대결 순위"
    >
      <p className="text-[10px] font-bold tracking-widest text-ink-dim">GRADUATION</p>
      <p className="mt-0.5 text-2xl font-black tabular text-ink">
        {graduation.place}
        <span className="ml-1 text-sm font-bold text-ink-dim">/ {graduation.entrants}위</span>
      </p>
      <p className={`mt-1 text-xs ${graduation.itm ? 'text-gilded' : 'text-ink-dim'}`}>{note}</p>
      {graduation.blackBelt && <p className="mt-1 text-xs font-bold text-gilded">검은띠 조건을 모두 채웠어요.</p>}
      {graduation.mode === 'graduation' && (
        <p className="mt-1 text-[10px] text-ink-dim">졸업 대결만 재도전 — 완료 기록·수련 보상은 그대로예요.</p>
      )}
    </div>
  );
}

/** 이번 결산에 기록실에서 다시 볼 수 있는 항목이 있는가 */
function hasCollectible(result: ChapterResultView): boolean {
  const rewards = result.rewards;
  return !!rewards.cutscene
    || (rewards.unlockedScenes?.length ?? 0) > 0
    || (rewards.items ?? []).some(item => item.kind === 'cg' || item.kind === 'outfit' || item.kind === 'title');
}

/**
 * 결산 — 헤더 + 보상 리빌(`RewardReveal`: 스탬프·통계·보상 카드·CG 컷신·띠 승급·다음 보상) + 버튼 행.
 * 버튼은 리빌이 끝난 뒤에만 켜진다(연출 중 오조작 방지 — 탭으로 언제든 끝까지 갈 수 있으므로 스킵 불가 아님).
 */
export default function ChapterResult({ result, onClose, onNextChapter, onRetry, onRetrySparring, pending = false, onFullCourse, onOpenGallery, onGraduationRetry }: ChapterResultProps) {
  const chapter = getChapter(result.chapterId);
  const graduationChapter = !!chapter?.graduation;
  const next = result.nextChapterId ? getChapter(result.nextChapterId) : undefined;
  const daily = result.chapterId === 'daily';
  const exam = result.mode === 'exam';
  const [done, setDone] = useState(false);

  return (
    <div className="w-full max-w-md rounded-2xl border border-gilded/40 bg-panel/95 p-4" aria-label="결산">
      <p className="text-center text-[10px] font-bold tracking-widest text-gilded">
        {exam ? 'SKILL CHECK' : daily ? 'DAILY DRILLS' : 'CHAPTER RESULT'}
      </p>
      <h2 className="mt-1 text-center text-base font-bold text-ink">{daily ? '오늘의 수련 문제' : (chapter?.title ?? result.chapterId)}</h2>

      {result.graduation && <GraduationCard graduation={result.graduation} />}
      {graduationChapter && !result.passed && (
        <p className="mt-3 rounded-xl border border-mystic/30 bg-mystic/5 p-3 text-center text-xs text-ink-dim">
          결과 없이 끝났어요 — 허브에서 다시 도전할 수 있어요.
        </p>
      )}

      <RewardReveal key={`${result.chapterId}:${result.grade}:${result.passed}`} result={result} onDone={() => setDone(true)} />

      {done && (
        <div className="mt-3 flex flex-wrap gap-2" aria-busy={pending}>
          <button type="button" disabled={pending} onClick={onClose} className="flex-1 rounded-xl border border-mystic/30 py-2.5 text-sm font-bold text-ink-dim">
            허브로
          </button>
          {!result.passed && exam && onFullCourse && (
            <button type="button" disabled={pending} onClick={onFullCourse} className="flex-1 rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white">
              수업 듣기
            </button>
          )}
          {!result.passed && !exam && result.sparringRetry && onRetrySparring && (
            <button type="button" disabled={pending} onClick={onRetrySparring} className="w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50">
              스파링만 재도전
            </button>
          )}
          {!result.passed && !exam && onRetry && (
            <button type="button" disabled={pending} onClick={onRetry} className="flex-1 rounded-xl bg-blossom py-2.5 text-sm font-bold text-white">
              처음부터
            </button>
          )}
          {graduationChapter && onGraduationRetry && (
            <button type="button" disabled={pending} onClick={onGraduationRetry} className="flex-1 rounded-xl border border-gilded/40 bg-gilded/10 py-2.5 text-sm font-bold text-gilded disabled:opacity-50">
              다시 졸업 대결
            </button>
          )}
          {result.passed && next && onNextChapter && (
            <button type="button" disabled={pending} onClick={() => onNextChapter(next.id)} className="flex-1 rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white">
              다음: {next.title}
            </button>
          )}
        </div>
      )}
      {done && onOpenGallery && hasCollectible(result) && (
        <button type="button" disabled={pending} onClick={onOpenGallery} className="mt-2 w-full rounded-xl border border-gilded/40 bg-gilded/10 py-2 text-xs font-bold text-gilded">
          🖼 기록실 보기 — 받은 CG·씬을 다시 볼 수 있어요
        </button>
      )}
    </div>
  );
}
