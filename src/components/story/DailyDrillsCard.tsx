'use client';

import { getCharacterById } from '@/lib/characters';
import type { StoryDailyView } from '@/lib/story/views';

interface DailyDrillsCardProps {
  daily: StoryDailyView;
  pending: boolean;
  onStart: () => void;
}

/** 오늘의 수련 문제 3개 — 챕터 하나를 끝내면 개방, 완료 시 출제 히로인 인연 +5 (일 1회) */
export default function DailyDrillsCard({ daily, pending, onStart }: DailyDrillsCardProps) {
  const teacher = daily.teacherId ? getCharacterById(daily.teacherId === 'miyako' ? 'dealer' : daily.teacherId) : null;
  const done = daily.done >= daily.total;
  return (
    <section aria-label="오늘의 수련 문제" className="rounded-xl border border-gilded/30 bg-gilded/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-gilded">오늘의 수련 문제</h3>
          <p className="mt-0.5 text-[11px] text-ink-dim">
            {!daily.available
              ? '챕터를 하나 끝내면 매일 3문제가 열려요'
              : done
                ? `오늘 ${daily.total}문 완료 · 인연 +5`
                : `${daily.done}/${daily.total} · ${teacher ? `오늘은 ${teacher.name}의 문제` : '2분이면 충분해요'}`}
          </p>
        </div>
        {daily.available && !done && (
          <button
            type="button"
            onClick={onStart}
            disabled={pending}
            className="shrink-0 rounded-lg border border-gilded/50 px-3 py-1.5 text-xs font-bold text-gilded disabled:opacity-50"
          >
            풀기
          </button>
        )}
      </div>
      <div className="mt-2 flex gap-1" role="progressbar" aria-valuenow={daily.done} aria-valuemin={0} aria-valuemax={daily.total} aria-label="오늘의 수련 진행">
        {Array.from({ length: daily.total }, (_, index) => (
          <span key={index} className={`h-1.5 flex-1 rounded-full ${index < daily.done ? 'bg-gilded' : 'bg-abyss'}`} />
        ))}
      </div>
    </section>
  );
}
