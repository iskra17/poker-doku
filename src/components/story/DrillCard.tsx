'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { describeCorrectAnswer, isAnswerComplete } from '@/lib/story/drill-input';
import type { DrillAnswer, DrillResult } from '@/lib/story/drills/types';
import type { StoryHeroineId } from '@/lib/story/types';
import type { StoryDrillView } from '@/lib/story/views';
import { drillMomentLine, expressionForResult, pickDrillMoment } from '@/lib/story/drill-moments';
import CoachBubble from './CoachBubble';
import DrillAnswerInput from './DrillAnswerInput';
import DrillMomentLayer from './DrillMomentLayer';
import DrillTableView from './DrillTableView';
import { resolveSpeaker } from './ScenePlayer';

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
  /** 재출제 오퍼 응답 — [다시 풀기 N문] / [복습 노트에 넣고 넘어가기] */
  onRetry: () => void;
  onSkipRetry: () => void;
}

const PRAISE = ['정답이에요!', '좋아요, 그거예요.', '완벽해요.', '그렇죠!'];

/**
 * 드릴 카드 — 진행 바+콤보 → 상황 미니 테이블 → 질문 → 입력 → [힌트][제출] → 즉시 피드백 스탬프 + 히로인 해설.
 * 정답 판정은 서버(ack의 DrillResult). 다음 문항은 [다음]으로 story-advance 대신 서버가 story-update로 밀어준다.
 *
 * 진행 표시 계약(2026-09-03 재출제 완화): `total`은 첫 패스 슬롯 수로 불변이고 재출제는 `retry`로 따로 표시한다 —
 * 오답마다 분모가 늘어 "끝이 안 보이던" 체감의 근본 수정. 첫 패스가 끝나고 오답이 남으면 서버가
 * `retryOffer`를 주고, 이 카드는 문제 대신 오퍼 패널을 그린다.
 */
export default function DrillCard({
  drill, teacherId, partnerId, pending, hint, lastResult, onAnswer, onHint, onNext, hintAllowed = true, onRetry, onSkipRetry,
}: DrillCardProps) {
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
  const retry = drill.retry;
  // 순간 보상 — 콤보/퍼펙트/재출제 오답 (뷰에서 파생, 문항당 1회)
  const isRetry = retry !== null;
  const perfectSet = answered && !!lastResult?.correct && !isRetry
    && drill.index + 1 === drill.total && drill.correct === drill.total && drill.hintsUsed === 0;
  const moment = answered && lastResult
    ? pickDrillMoment({ correct: lastResult.correct, streak: drill.streak, isRetry, perfectSet })
    : null;
  const momentSpeaker = lastResult ? resolveSpeaker(lastResult.explanation.speaker, partnerId) : null;
  // 퍼펙트는 StoryCutIn(StoryStage)이 교사 대사를 맡으므로 여기선 스탬프·색종이만(말풍선 중복 방지)
  const momentLine = moment && lastResult && moment.moment !== 'drill-perfect' ? drillMomentLine(lastResult.explanation.speaker, moment.moment, instance.seed) : '';
  const progressValue = retry ? retry.index : drill.index;
  const progressMax = retry ? retry.total : drill.total;

  if (drill.retryOffer) {
    const count = drill.retryOffer.count;
    return (
      <div className="flex w-full max-w-md flex-col gap-3" aria-label="재출제 선택">
        <div className="flex items-center gap-2 text-[10px] text-ink-dim">
          <span className="font-bold tracking-wider">문제 {drill.total}/{drill.total}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-abyss" role="progressbar" aria-valuenow={drill.total} aria-valuemin={0} aria-valuemax={drill.total}>
            <span className="block h-full rounded-full bg-mystic" style={{ width: '100%' }} />
          </span>
          <span className="rounded-full bg-blossom/15 px-2 py-px font-bold text-blossom">오답 {count}</span>
        </div>
        <CoachBubble
          speaker={teacherId}
          partnerId={partnerId}
          expression="thinking"
          tone="neutral"
          text={`틀린 ${count}문을 새 수치로 한 번만 다시 풀어 볼까요? 넘어가면 복습 노트에서 다시 만나요 — 어느 쪽이든 오늘 수련은 이어져요.`}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkipRetry}
            disabled={pending}
            className="flex-1 rounded-xl border border-mystic/30 py-2.5 text-xs font-bold text-ink-dim disabled:opacity-50"
          >
            복습 노트에 넣고 넘어가기
          </button>
          <button
            type="button"
            onClick={onRetry}
            disabled={pending}
            className="flex-1 rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            다시 풀기 {count}문
          </button>
        </div>
        <p className="sr-only">출제 {teacherId}</p>
      </div>
    );
  }

  return (
    <div className="relative flex w-full max-w-md flex-col gap-2" aria-label="수련 문제">
      <DrillMomentLayer
        momentKey={key}
        pick={moment}
        line={momentLine}
        teacherName={momentSpeaker?.name ?? ''}
        teacherColor={momentSpeaker?.color ?? null}
      />
      {/* 진행 바 + 콤보 — 첫 패스 분모는 불변, 재출제는 별도 카운터 */}
      <div className="flex items-center gap-2 text-[10px] text-ink-dim">
        <span className={`font-bold tracking-wider ${retry ? 'text-blossom' : ''}`}>
          {retry ? `재출제 ${retry.index + 1}/${retry.total}` : `문제 ${drill.index + 1}/${drill.total}`}
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-abyss" role="progressbar" aria-valuenow={progressValue} aria-valuemin={0} aria-valuemax={progressMax}>
          <span className={`block h-full rounded-full ${retry ? 'bg-blossom' : 'bg-mystic'}`} style={{ width: `${(progressValue / Math.max(1, progressMax)) * 100}%` }} />
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
        {!retry && drill.wrongQueue > 0 && <span title="첫 패스가 끝나면 한 번 더 풀지 고를 수 있어요">오답 {drill.wrongQueue}</span>}
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
          {!retry && <span className="ml-1 text-[10px] text-ink-dim">(이 문항은 ½점)</span>}
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
            expression={moment?.expression ?? expressionForResult(lastResult.correct, drill.streak, isRetry)}
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
