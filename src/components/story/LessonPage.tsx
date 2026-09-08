'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import { useOutfitId } from '@/lib/hooks/use-outfit';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { mergeGuidedSituation } from '@/lib/story/chapters/helpers';
import { gradeLocally, isAnswerComplete } from '@/lib/story/drill-input';
import type { DrillAnswer, DrillSituation } from '@/lib/story/drills/types';
import type { GuidedStage, LessonBlock, StoryHeroineId, StoryTeacherRef } from '@/lib/story/types';
import DrillAnswerInput from './DrillAnswerInput';
import DrillTableView from './DrillTableView';
import { resolveSpeaker } from './ScenePlayer';

interface LessonPageProps {
  title: string;
  blocks: LessonBlock[];
  partnerId: StoryHeroineId | null;
  onFinish: () => void;
  /** 초보자가 현재 카드에서 다음에 할 일을 알 수 있게 하는 짧은 안내 */
  beginnerGuide?: boolean;
  /** 설명을 한 단계 건너뛸 때 서버 요청 중 중복 입력을 막는다 */
  pending?: boolean;
  onSkip?: () => void;
}

/**
 * 레슨 페이지 — 개념 카드(≤4장, 한 장씩 넘김) → 함께 풀기(단계식 입력, 점수 없음·즉시 정정).
 * 블록을 순서대로 하나씩 보여 주고, 마지막 블록이 끝나면 onFinish.
 */
export default function LessonPage({ title, blocks, partnerId, onFinish, beginnerGuide = false, pending = false, onSkip }: LessonPageProps) {
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
        <div className="flex items-center gap-2">
          <span>{blockIndex + 1}/{blocks.length}</span>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={pending}
              className="rounded-lg border border-mystic/30 px-2 py-1 font-bold text-ink-dim hover:bg-mystic/10 focus-visible:outline-2 focus-visible:outline-cyber disabled:opacity-50"
            >
              설명 건너뛰기
            </button>
          )}
        </div>
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
            {beginnerGuide && <BeginnerHint text={last ? '내용을 읽었으면 문제 풀러 가기 버튼을 눌러 주세요.' : '내용을 읽었으면 다음 카드 버튼을 눌러 주세요.'} />}
            <button type="button" onClick={next} disabled={pending} className={`mt-4 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50 ${beginnerGuide ? 'ring-2 ring-gilded/70 ring-offset-2 ring-offset-panel' : ''}`}>
              {last ? '문제 풀러 가기' : '다음 카드'}
            </button>
          </article>
        )}
        {block.kind === 'text' && (
          <TextBlock speaker={block.speaker} text={block.text} partnerId={partnerId} onNext={next} last={last} beginnerGuide={beginnerGuide} pending={pending} />
        )}
        {block.kind === 'guided' && (
          <GuidedBlock key={blockIndex} teacher={block.teacher} intro={block.intro} situation={block.situation} stages={block.stages} partnerId={partnerId} onDone={next} last={last} beginnerGuide={beginnerGuide} pending={pending} />
        )}
      </motion.div>
    </div>
  );
}

function BeginnerHint({ text }: { text: string }) {
  return <p className="mb-2 rounded-lg border border-gilded/35 bg-gilded/10 px-2.5 py-2 text-[11px] leading-relaxed text-ink" role="note" aria-label="초보 안내">{text}</p>;
}

function TextBlock({ speaker, text, partnerId, onNext, last, beginnerGuide, pending }: { speaker: string; text: string; partnerId: StoryHeroineId | null; onNext: () => void; last: boolean; beginnerGuide: boolean; pending: boolean }) {
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
      {beginnerGuide && <BeginnerHint text={done
        ? `대사를 읽었으면 ${last ? '문제 풀러 가기' : '다음'} 버튼을 눌러 주세요.`
        : '아래 대사 완성 버튼을 누르면 설명이 한 번에 보여요.'} />}
      <button type="button" onClick={done ? onNext : skip} disabled={pending} className={`mt-3 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50 ${beginnerGuide ? 'ring-2 ring-gilded/70 ring-offset-2 ring-offset-panel' : ''}`}>
        {done ? (last ? '문제 풀러 가기' : '다음') : '대사 완성'}
      </button>
    </div>
  );
}

/**
 * 함께 풀기 — 상황(보드·내 카드·팟·콜)은 `DrillTableView`로 **단계·피드백과 무관하게 상시** 그린다.
 * 예전엔 보드가 intro 문장에만 있어 2단계·오답 피드백 때 사라져 풀 수 없었다(2026-09-03 피드백 ①).
 * intro는 정적 한 줄로 항상 보이고, 말풍선은 이번 단계의 프롬프트/피드백만 담는다.
 */
function GuidedBlock({ teacher, intro, situation, stages, partnerId, onDone, last, beginnerGuide, pending }: {
  teacher: StoryTeacherRef;
  intro: string;
  situation: DrillSituation;
  stages: GuidedStage[];
  partnerId: StoryHeroineId | null;
  onDone: () => void;
  last: boolean;
  beginnerGuide: boolean;
  pending: boolean;
}) {
  const [stageIndex, setStageIndex] = useState(0);
  const [answer, setAnswer] = useState<DrillAnswer | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string } | null>(null);
  const who = resolveSpeaker(teacher, partnerId);
  const outfitId = useOutfitId(who.artId);
  const stage = stages[stageIndex] as GuidedStage | undefined;
  const finished = stageIndex >= stages.length;
  const merged = mergeGuidedSituation(situation, stage?.situation);
  const answerComplete = stage ? isAnswerComplete(stage.answer, answer) : false;
  const bubble = finished || !stage ? '잘했어요. 이제 진짜 문제로 가 볼까요?' : feedback ? feedback.text : stage.prompt;
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
      <div className="mt-2">
        <DrillTableView situation={merged} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-dim" aria-label="상황 설명">{intro}</p>
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

      {!finished && stage && !feedback && (
        <div className="mt-3">
          {beginnerGuide && <BeginnerHint text="보드와 내 카드를 확인한 뒤, 답을 고르고 확인을 눌러 주세요." />}
          <div className={beginnerGuide && !answerComplete ? 'rounded-xl ring-2 ring-gilded/70 ring-offset-2 ring-offset-panel' : undefined}>
            <DrillAnswerInput spec={stage.answer} value={answer} onChange={setAnswer} />
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !done || !answerComplete}
            className={`mt-3 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50 ${beginnerGuide && answerComplete ? 'ring-2 ring-gilded/70 ring-offset-2 ring-offset-panel' : ''}`}
          >
            확인
          </button>
        </div>
      )}
      {!finished && feedback && (
        <>
        {beginnerGuide && <BeginnerHint text={feedback.correct
          ? (stageIndex + 1 < stages.length ? '피드백을 읽었으면 다음 단계 버튼을 눌러 주세요.' : '피드백을 읽었으면 완료 버튼을 눌러 주세요.')
          : '피드백을 읽었으면 다시 해 볼게요 버튼을 눌러 주세요.'} />}
        <button
          type="button"
          onClick={feedback.correct ? proceed : () => setFeedback(null)}
          disabled={pending}
          className={`mt-3 w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50 ${feedback.correct ? 'bg-cyber' : 'bg-blossom'} ${beginnerGuide ? 'ring-2 ring-gilded/70 ring-offset-2 ring-offset-panel' : ''}`}
        >
          {feedback.correct ? (stageIndex + 1 < stages.length ? '다음 단계' : '완료') : '다시 해 볼게요'}
        </button>
        </>
      )}
      {finished && (
        <>
        {beginnerGuide && <BeginnerHint text="함께 풀기를 마쳤어요. 다음으로 넘어가 주세요." />}
        <button type="button" onClick={onDone} disabled={pending} className={`mt-3 w-full rounded-xl bg-gradient-to-r from-mystic to-blossom py-2.5 text-sm font-bold text-white disabled:opacity-50 ${beginnerGuide ? 'ring-2 ring-gilded/70 ring-offset-2 ring-offset-panel' : ''}`}>
          {last ? '문제 풀러 가기' : '다음'}
        </button>
        </>
      )}
    </div>
  );
}
