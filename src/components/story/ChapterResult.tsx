'use client';

import { motion } from 'framer-motion';
import { getCharacterById } from '@/lib/characters';
import { getChapter } from '@/lib/story/chapters';
import type { ChapterResultView } from '@/lib/story/views';

interface ChapterResultProps {
  result: ChapterResultView;
  onClose: () => void;
  onNextChapter?: (chapterId: string) => void;
  onRetry?: () => void;
}

const GRADE_COLOR: Record<ChapterResultView['grade'], string> = {
  S: 'text-gilded',
  A: 'text-cyber',
  B: 'text-mystic',
};

/** 결산 — 등급 스탬프·드릴 정확도/최고 콤보/힌트·목표·보상·복습 노트·[다음 챕터]/[허브로] */
export default function ChapterResult({ result, onClose, onNextChapter, onRetry }: ChapterResultProps) {
  const chapter = getChapter(result.chapterId);
  const next = result.nextChapterId ? getChapter(result.nextChapterId) : undefined;
  const accuracy = result.drill.answered > 0 ? Math.round((result.drill.correct / result.drill.answered) * 100) : null;
  const daily = result.chapterId === 'daily';

  return (
    <div className="w-full max-w-md rounded-2xl border border-gilded/40 bg-panel/95 p-4" aria-label="결산">
      <p className="text-center text-[10px] font-bold tracking-widest text-gilded">CHAPTER RESULT</p>
      <h2 className="mt-1 text-center text-base font-bold text-ink">{daily ? '오늘의 수련 문제' : (chapter?.title ?? result.chapterId)}</h2>
      <motion.p
        initial={{ scale: 2, opacity: 0, rotate: -10 }}
        animate={{ scale: 1, opacity: 1, rotate: -6 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className={`mt-2 mb-4 h-20 text-center text-6xl font-black leading-none ${GRADE_COLOR[result.grade]}`}
        aria-label={`등급 ${result.grade}`}
      >
        {result.grade}
      </motion.p>
      <p className={`text-center text-sm font-bold ${result.passed ? 'text-cyber' : 'text-blossom'}`}>
        {result.passed ? '통과' : '미통과 — 다시 도전할 수 있어요'}
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-2">
          <dt className="text-ink-dim">드릴 정확도</dt>
          <dd className="text-sm font-bold text-ink">{accuracy === null ? '—' : `${accuracy}%`}</dd>
          <dd className="text-[10px] text-ink-dim">{result.drill.correct}/{result.drill.answered}</dd>
        </div>
        <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-2">
          <dt className="text-ink-dim">최고 콤보</dt>
          <dd className="text-sm font-bold text-gilded">🔥{result.drill.bestStreak}</dd>
        </div>
        <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-2">
          <dt className="text-ink-dim">힌트</dt>
          <dd className="text-sm font-bold text-ink">{result.drill.hintsUsed}회</dd>
        </div>
      </dl>

      {result.live && (
        <ul className="mt-2 space-y-1 text-[11px]" aria-label="목표">
          {result.live.objectives.map(objective => (
            <li key={objective.id} className="flex items-center justify-between rounded-lg border border-mystic/15 px-2 py-1">
              <span className="text-ink">{objective.primary ? '★ ' : '☆ '}{objective.label}</span>
              <span className={objective.achieved === null ? 'text-ink-dim' : objective.achieved ? 'text-cyber' : 'text-blossom'}>
                {objective.achieved === null ? '해당 없음' : objective.achieved ? '달성' : '미달'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 rounded-xl border border-gilded/30 bg-gilded/5 p-2 text-[11px] text-ink">
        <p className="font-bold text-gilded">{daily ? '오늘의 수련 보상' : result.rewards.firstClear ? '첫 완주 보상' : '재도전 보상'}</p>
        {result.rewards.dojoXpMilli > 0 && <p>도장 XP +{Math.round(result.rewards.dojoXpMilli / 1000)}</p>}
        {result.rewards.affinity.map(grant => {
          const profile = getCharacterById(grant.characterId);
          return (
            <p key={grant.characterId} style={{ color: profile?.color }}>
              {profile?.name ?? grant.characterId} 인연 +{Math.round(grant.milli / 1000)}
            </p>
          );
        })}
        {result.rewards.badgeId && <p>뱃지 획득 · {result.rewards.badgeId}</p>}
        {result.reviewNotesAdded > 0 && <p className="text-ink-dim">복습 노트에 {result.reviewNotesAdded}문 추가</p>}
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-mystic/30 py-2.5 text-sm font-bold text-ink-dim">
          허브로
        </button>
        {!result.passed && onRetry && (
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
    </div>
  );
}
