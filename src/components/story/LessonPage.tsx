'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import { useOutfitId } from '@/lib/hooks/use-outfit';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { gradeLocally, isAnswerComplete } from '@/lib/story/drill-input';
import type { DrillAnswer } from '@/lib/story/drills/types';
import type { LessonBlock, StoryHeroineId, StoryTeacherRef } from '@/lib/story/types';
import DrillAnswerInput from './DrillAnswerInput';
import { resolveSpeaker } from './ScenePlayer';

interface LessonPageProps {
  title: string;
  blocks: LessonBlock[];
  partnerId: StoryHeroineId | null;
  onFinish: () => void;
}

/**
 * 레슨 페이지 — 개념 카드(≤4장, 한 장씩 넘김) → 함께 풀기(단계식 입력, 점수 없음·즉시 정정).
 * 블록을 순서대로 하나씩 보여 주고, 마지막 블록이 끝나면 onFinish.
 */
export default function LessonPage({ title, blocks, partnerId, onFinish }: LessonPageProps) {
  const [blockIndex, setBlockIndex] = useState(0);
  const block = blocks[blockIndex];
  const last = blockIndex >= blocks.length - 1;
  const next = () => {
    if (last) onFinish();
    else setBlockIndex(index => index + 1);
  };

  if (!block) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-mystic/25 bg-panel/90 p-4 text-center">
        <button type="button" onClick={onFinish} className="rounded-xl bg-gradient-to-r from-mystic to-blossom px-4 py-2 text-sm font-bold text-white">다음</button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3" aria-label={title}>
      <div className="flex items-center justify-between text-[10px] text-ink-dim">
        <span className="font-bold tracking-wider">{title}</span>
        <span>{blockIndex + 1}/{blocks.length}</span>
      </div>
      <motion.div key={blockIndex} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22 }}>
        {block.kind === 'concept-card' && (
          <article className="rounded-2xl border border-mystic/30 bg-panel/90 p-4">
            <p className="text-[10px] font-bold tracking-widest text-mystic">개념 카드</p>
            <h3 className="mt-1 text-base font-bold text-ink">{block.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink">{block.body}</p>
            {block.formula && (
              <p className="mt-3 rounded-xl border border-gilded/40 bg-gilded/10 px-3 py-2 text-center font-mono text-sm font-bold text-gilded">{block.formula}</p>
            )}
            <button type="button" onClick={next} className="mt-4 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white">
              {last ? '문제 풀러 가기' : '다음 카드'}
            </button>
          </article>
        )}
        {block.kind === 'text' && (
          <TextBlock speaker={block.speaker} text={block.text} partnerId={partnerId} onNext={next} last={last} />
        )}
        {block.kind === 'guided' && (
          <GuidedBlock key={blockIndex} teacher={block.teacher} intro={block.intro} stages={block.stages} partnerId={partnerId} onDone={next} last={last} />
        )}
      </motion.div>
    </div>
  );
}

function TextBlock({ speaker, text, partnerId, onNext, last }: { speaker: string; text: string; partnerId: StoryHeroineId | null; onNext: () => void; last: boolean }) {
  const who = resolveSpeaker(speaker, partnerId);
  const outfitId = useOutfitId(who.artId);
  const { display, done, skip } = useTypewriter(text, 22);
  return (
    <div className="rounded-2xl border border-mystic/30 bg-panel/90 p-4">
      <div className="flex gap-3">
        {who.artId && (
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-mystic/25">
            <CharacterImage characterId={who.artId} expression="happy" round={false} outfitId={outfitId} className="h-full w-full text-2xl" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {who.name && <p className="text-[11px] font-bold" style={{ color: who.color ?? undefined }}>{who.name}</p>}
          <p className="text-sm leading-relaxed text-ink">{display}</p>
        </div>
      </div>
      <button type="button" onClick={done ? onNext : skip} className="mt-3 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white">
        {done ? (last ? '문제 풀러 가기' : '다음') : '…'}
      </button>
    </div>
  );
}

function GuidedBlock({ teacher, intro, stages, partnerId, onDone, last }: {
  teacher: StoryTeacherRef;
  intro: string;
  stages: Array<{ prompt: string; answer: Parameters<typeof gradeLocally>[0]; onCorrect: string; onWrong: string }>;
  partnerId: StoryHeroineId | null;
  onDone: () => void;
  last: boolean;
}) {
  const [stageIndex, setStageIndex] = useState(0);
  const [answer, setAnswer] = useState<DrillAnswer | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string } | null>(null);
  const who = resolveSpeaker(teacher, partnerId);
  const outfitId = useOutfitId(who.artId);
  const stage = stages[stageIndex];
  const finished = stageIndex >= stages.length;
  const bubble = finished ? '잘했어요. 이제 진짜 문제로 가 볼까요?' : feedback ? feedback.text : stageIndex === 0 ? `${intro} ${stage.prompt}` : stage.prompt;
  const { display, done } = useTypewriter(bubble, 20);

  const submit = () => {
    if (!stage || !answer) return;
    const correct = gradeLocally(stage.answer, answer);
    setFeedback({ correct, text: correct ? stage.onCorrect : stage.onWrong });
  };
  const proceed = () => {
    setFeedback(null);
    setAnswer(null);
    setStageIndex(index => index + 1);
  };

  return (
    <div className="rounded-2xl border border-gilded/40 bg-panel/90 p-4" aria-label="함께 풀기">
      <p className="text-[10px] font-bold tracking-widest text-gilded">함께 풀기 · 점수 없음</p>
      <div className="mt-2 flex gap-3">
        {who.artId && (
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gilded/30">
            <CharacterImage characterId={who.artId} expression={feedback ? (feedback.correct ? 'happy' : 'thinking') : 'neutral'} round={false} outfitId={outfitId} className="h-full w-full text-2xl" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold" style={{ color: who.color ?? undefined }}>{who.name}</p>
          <p className="text-sm leading-relaxed text-ink" aria-live="polite">{display}</p>
        </div>
      </div>

      {!finished && !feedback && (
        <div className="mt-3">
          <DrillAnswerInput spec={stage.answer} value={answer} onChange={setAnswer} />
          <button
            type="button"
            onClick={submit}
            disabled={!done || !isAnswerComplete(stage.answer, answer)}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            확인
          </button>
        </div>
      )}
      {!finished && feedback && (
        <button
          type="button"
          onClick={feedback.correct ? proceed : () => setFeedback(null)}
          className={`mt-3 w-full rounded-xl py-2.5 text-sm font-bold text-white ${feedback.correct ? 'bg-cyber' : 'bg-blossom'}`}
        >
          {feedback.correct ? (stageIndex + 1 < stages.length ? '다음 단계' : '완료') : '다시 해 볼게요'}
        </button>
      )}
      {finished && (
        <button type="button" onClick={onDone} className="mt-3 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white">
          {last ? '문제 풀러 가기' : '다음'}
        </button>
      )}
    </div>
  );
}
