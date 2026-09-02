'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { describeCorrectAnswer, isAnswerComplete } from '@/lib/story/drill-input';
import type { DrillAnswer, DrillResult } from '@/lib/story/drills/types';
import type { StoryHeroineId } from '@/lib/story/types';
import type { StoryDrillView } from '@/lib/story/views';
import CoachBubble from './CoachBubble';
import DrillAnswerInput from './DrillAnswerInput';
import DrillTableView from './DrillTableView';

interface DrillCardProps {
  drill: StoryDrillView;
  teacherId: string;
  partnerId: StoryHeroineId | null;
  pending: boolean;
  hint: string | null;
  lastResult: DrillResult | null;
  onAnswer: (answer: DrillAnswer, elapsedMs: number) => void;
  onHint: () => void;
  /** 실력 확인(exam)에선 힌트 버튼을 숨긴다 (서버도 거절) */
  hintAllowed?: boolean;
  onNext: () => void;
}

const PRAISE = ['정답이에요!', '좋아요, 그거예요.', '완벽해요.', '그렇죠!'];

/**
 * 드릴 카드 — 진행 바+콤보 → 상황 미니 테이블 → 질문 → 입력 → [힌트][제출] → 즉시 피드백 스탬프 + 히로인 해설.
 * 정답 판정은 서버(ack의 DrillResult). 다음 문항은 [다음]으로 story-advance 대신 서버가 story-update로 밀어준다.
 */
export default function DrillCard({ drill, teacherId, partnerId, pending, hint, lastResult, onAnswer, onHint, onNext, hintAllowed = true }: DrillCardProps) {
  const [answer, setAnswer] = useState<DrillAnswer | null>(null);
  const startedAt = useRef<number>(0);
  const key = `${drill.setId}:${drill.index}:${drill.instance.seed}`;
  const [trackedKey, setTrackedKey] = useState(key);
  if (trackedKey !== key) {
    // 문항이 바뀌면 입력 초기화 (렌더 중 보정)
    setTrackedKey(key);
    setAnswer(null);
  }
  useEffect(() => {
    startedAt.current = performance.now();
  }, [key]);

  const instance = drill.instance;
  const answered = lastResult !== null && lastResult.templateId === instance.templateId && lastResult.seed === instance.seed;
  const correctIndices = answered && lastResult
    ? lastResult.correctAnswer.kind === 'multiple-choice'
      ? [lastResult.correctAnswer.correctIndex]
      : lastResult.correctAnswer.kind === 'multi-select'
        ? lastResult.correctAnswer.correctIndices
        : undefined
    : undefined;
  const chosenIndex = answer?.kind === 'multiple-choice' ? answer.index : null;
  const praise = PRAISE[(drill.index + instance.seed) % PRAISE.length];

  return (
    <div className="flex w-full max-w-md flex-col gap-2" aria-label="수련 문제">
      {/* 진행 바 + 콤보 */}
      <div className="flex items-center gap-2 text-[10px] text-ink-dim">
        <span className="font-bold tracking-wider">문제 {drill.index + 1}/{drill.total}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-abyss" role="progressbar" aria-valuenow={drill.index} aria-valuemin={0} aria-valuemax={drill.total}>
          <span className="block h-full rounded-full bg-mystic" style={{ width: `${(drill.index / Math.max(1, drill.total)) * 100}%` }} />
        </span>
        <AnimatePresence>
          {drill.streak >= 2 && (
            <motion.span
              key={drill.streak}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: [0.7, 1.15, 1], opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-full bg-gilded/20 px-2 py-px font-bold text-gilded"
              aria-label={`${drill.streak}연속 정답`}
            >
              🔥{drill.streak}
            </motion.span>
          )}
        </AnimatePresence>
        {drill.wrongQueue > 0 && <span title="세트 끝에 다시 나올 문항">재출제 {drill.wrongQueue}</span>}
      </div>

      <DrillTableView situation={instance.situation} />

      <p className="px-1 text-sm font-bold text-ink">{instance.question}</p>

      <div className="relative">
        <DrillAnswerInput
          spec={instance.answerSpec}
          value={answer}
          onChange={setAnswer}
          disabled={pending || answered}
          reveal={answered ? { correctIndices, chosenIndex } : null}
        />
        <AnimatePresence>
          {answered && lastResult && (
            <motion.div
              key={key}
              initial={{ scale: 1.6, opacity: 0, rotate: -12 }}
              animate={{ scale: 1, opacity: 1, rotate: -8 }}
              className={`pointer-events-none absolute right-2 top-2 rounded-lg border-2 px-3 py-1 text-lg font-black ${
                lastResult.correct ? 'border-cyber text-cyber' : 'border-blossom text-blossom'
              }`}
              style={{ x: 0, y: 0 }}
              aria-hidden
            >
              {lastResult.correct ? '정답' : '오답'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {hint && !answered && (
        <p className="rounded-xl border border-gilded/40 bg-gilded/10 px-3 py-2 text-xs text-ink" role="note">
          <span className="mr-1 font-bold text-gilded">힌트</span>{hint}
          <span className="ml-1 text-[10px] text-ink-dim">(이 문항은 ½점)</span>
        </p>
      )}

      {!answered ? (
        <div className="flex gap-2">
          {hintAllowed && (
            <button
              type="button"
              onClick={onHint}
              disabled={pending || !!hint || !instance.hasHint}
              className="rounded-xl border border-gilded/40 px-3 py-2.5 text-xs font-bold text-gilded disabled:opacity-40"
            >
              힌트
            </button>
          )}
          <button
            type="button"
            onClick={() => answer && onAnswer(answer, performance.now() - startedAt.current)}
            disabled={pending || !isAnswerComplete(instance.answerSpec, answer)}
            className="flex-1 rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? '확인 중…' : '제출'}
          </button>
        </div>
      ) : lastResult && (
        <>
          <CoachBubble
            speaker={lastResult.explanation.speaker}
            partnerId={partnerId}
            expression={lastResult.correct ? 'happy' : 'thinking'}
            tone={lastResult.correct ? 'correct' : 'wrong'}
            text={lastResult.correct ? `${praise} ${lastResult.explanation.text}` : lastResult.explanation.text}
          />
          <p className="text-[11px] text-ink-dim">
            정답: <span className="font-bold text-ink">{describeCorrectAnswer(lastResult.correctAnswer)}</span>
          </p>
          <button
            type="button"
            onClick={onNext}
            disabled={pending}
            className="rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {drill.index + 1 < drill.total || drill.wrongQueue > 0 ? '다음 문제' : '세트 완료'}
          </button>
        </>
      )}
      <p className="sr-only">출제 {teacherId}</p>
    </div>
  );
}
