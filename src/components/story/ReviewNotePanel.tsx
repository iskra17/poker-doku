'use client';

import { accuracyPercent, DRILL_CATEGORY_LABEL } from '@/lib/story/story-hub-rules';
import type { StoryProgressView } from '@/lib/story/views';

interface ReviewNotePanelProps {
  reviewQueue: number;
  drillStats: StoryProgressView['drillStats'];
}

/** 복습 노트(Leitner 대기 수) + 유형별 정답률 요약 — 기록실 축소판 */
export default function ReviewNotePanel({ reviewQueue, drillStats }: ReviewNotePanelProps) {
  const overall = accuracyPercent(drillStats.total, drillStats.correct);
  const categories = Object.entries(drillStats.byCategory)
    .map(([category, stats]) => ({ category, label: DRILL_CATEGORY_LABEL[category] ?? category, pct: accuracyPercent(stats.total, stats.correct), total: stats.total }))
    .filter(entry => entry.pct !== null)
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
    .slice(0, 4);

  return (
    <section aria-label="복습 노트" className="rounded-xl border border-mystic/25 bg-elevated/50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-mystic">복습 노트</h3>
        <span className="rounded-full bg-mystic/15 px-2 py-px text-[10px] font-bold text-mystic">{reviewQueue}문 대기</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-dim">
        {reviewQueue > 0
          ? '틀린 문제는 다음 챕터 첫 문제와 오늘의 수련에 먼저 나와요.'
          : drillStats.total > 0
            ? '노트가 비어 있어요. 약점이 없다는 뜻이에요.'
            : '아직 푼 문제가 없어요.'}
      </p>
      {overall !== null && (
        <div className="mt-2 text-[11px] text-ink">
          <div className="flex items-center justify-between">
            <span>전체 정답률</span>
            <span className="font-bold">{overall}% · {drillStats.total}문</span>
          </div>
          <ul className="mt-1 space-y-1">
            {categories.map(entry => (
              <li key={entry.category} className="flex items-center gap-2 text-[10px] text-ink-dim">
                <span className="w-16 shrink-0 truncate">{entry.label}</span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-abyss">
                  <span className="block h-full rounded-full bg-mystic" style={{ width: `${entry.pct ?? 0}%` }} />
                </span>
                <span className="w-8 text-right">{entry.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
