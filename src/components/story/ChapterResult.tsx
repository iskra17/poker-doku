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
  /** 실력 확인 미통과 → 같은 챕터를 수업(full)으로 */
  onFullCourse?: () => void;
  /** 결산에 CG·인연 씬·의상·칭호가 있었을 때 [기록실 보기] — 런을 닫고 기록실을 연다 */
  onOpenGallery?: () => void;
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
export default function ChapterResult({ result, onClose, onNextChapter, onRetry, onFullCourse, onOpenGallery }: ChapterResultProps) {
  const chapter = getChapter(result.chapterId);
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

      <RewardReveal key={`${result.chapterId}:${result.grade}:${result.passed}`} result={result} onDone={() => setDone(true)} />

      {done && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-mystic/30 py-2.5 text-sm font-bold text-ink-dim">
            허브로
          </button>
          {!result.passed && exam && onFullCourse && (
            <button type="button" onClick={onFullCourse} className="flex-1 rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white">
              수업 듣기
            </button>
          )}
          {!result.passed && !exam && onRetry && (
            <button type="button" onClick={onRetry} className="flex-1 rounded-xl bg-blossom py-2.5 text-sm font-bold text-white">
              다시 도전
            </button>
          )}
          {result.passed && next && onNextChapter && (
            <button type="button" onClick={() => onNextChapter(next.id)} className="flex-1 rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white">
              다음: {next.title}
            </button>
          )}
        </div>
      )}
      {done && onOpenGallery && hasCollectible(result) && (
        <button type="button" onClick={onOpenGallery} className="mt-2 w-full rounded-xl border border-gilded/40 bg-gilded/10 py-2 text-xs font-bold text-gilded">
          🖼 기록실 보기 — 받은 CG·씬을 다시 볼 수 있어요
        </button>
      )}
    </div>
  );
}
