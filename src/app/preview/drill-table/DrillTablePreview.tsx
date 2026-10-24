'use client';

import { useEffect, useMemo, useState } from 'react';
import DrillCard from '@/components/story/DrillCard';
import DrillTable from '@/components/story/DrillTable';
import LessonPage from '@/components/story/LessonPage';
import PlacementSheet from '@/components/story/PlacementSheet';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import type { LessonBlock } from '@/lib/story/types';
import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import { generateDrill, gradeDrill } from '@/lib/story/drills/generator';
import { toPublicDrillInstance } from '@/lib/story/drills/public';
import type { DrillAnswer, DrillAnswerSpec, DrillInstance, DrillResult } from '@/lib/story/drills/types';
import type { StoryDrillView } from '@/lib/story/views';

/**
 * 수련 테이블 검토 화면 — 실제 `DrillCard`(서버 대신 같은 생성기·채점기를 로컬로 호출)를 430×900 프레임에 띄운다.
 * [정답 채점]/[오답 채점]으로 판단 재생을 바로 보고, [인트로 다시]로 상황 재생을 다시 본다.
 * 채점 결과(DrillResult)는 서버와 같은 모양으로 만든다 — 판단 재생은 result 이후에만 돈다는 계약 그대로.
 */

const SAMPLES: readonly { id: string; label: string }[] = [
  { id: 'rank-who-wins', label: '족보 · 누가 이기나' },
  { id: 'rank-best-hand', label: '족보 · 내 최고 족보' },
  { id: 'pos-name', label: '포지션 · 내 자리' },
  { id: 'pos-first-to-act', label: '포지션 · 첫 액션' },
  { id: 'call-decision', label: '콜 판단' },
  { id: 'range-open-decision', label: '오픈 레이즈 판단' },
  { id: 'size-cbet-texture', label: '벳 사이즈' },
  { id: 'act-ch02-fold-utg', label: '액션 선택(수기)' },
  { id: 'odds-required-equity', label: '팟오즈(숫자)' },
  { id: 'outs-count', label: '아우츠' },
];

const CTX = { teacher: 'sakura' } as const;

function correctAnswerOf(spec: DrillAnswerSpec): DrillAnswer {
  switch (spec.kind) {
    case 'multiple-choice': return { kind: 'multiple-choice', index: spec.correctIndex };
    case 'numeric': return { kind: 'numeric', value: spec.correct };
    case 'card-pick': return { kind: 'card-pick', cards: spec.correct };
    case 'action-pick': return { kind: 'action-pick', action: spec.correct[0], ...(spec.sizingBB ? { sizingBB: (spec.sizingBB.min + spec.sizingBB.max) / 2 } : {}) };
    case 'multi-select': return { kind: 'multi-select', indices: spec.correctIndices };
  }
}

function wrongAnswerOf(spec: DrillAnswerSpec): DrillAnswer {
  switch (spec.kind) {
    case 'multiple-choice': return { kind: 'multiple-choice', index: (spec.correctIndex + 1) % spec.options.length };
    case 'numeric': return { kind: 'numeric', value: spec.correct + spec.tolerance + 10 };
    case 'card-pick': return { kind: 'card-pick', cards: spec.candidates.filter(card => !spec.correct.includes(card)).slice(0, spec.pickCount) };
    case 'action-pick': return { kind: 'action-pick', action: spec.options.find(option => !spec.correct.includes(option)) ?? spec.options[0] };
    case 'multi-select': return { kind: 'multi-select', indices: [] };
  }
}

/** 첫 함께 풀기 블록 하나만 — LessonPage가 바로 그 블록부터 보여 준다 */
function firstGuidedBlocks(): LessonBlock[] {
  for (const chapter of STORY_CHAPTERS) {
    for (const step of chapter.steps) {
      if (step.kind !== 'lesson') continue;
      const guided = step.blocks.find(block => block.kind === 'guided');
      if (guided) return [guided];
    }
  }
  return [];
}

/** 실력 배치 시트 — 서버 대신 같은 생성기로 문항을 만들어 store 액션을 바꿔 끼운다 (미리보기 전용) */
function PlacementPreview() {
  useEffect(() => {
    const questions = ['rank-who-wins', 'pos-name', 'call-decision']
      .map((id, index) => safeGenerate(id, index + 1))
      .filter((instance): instance is DrillInstance => instance !== null)
      .map(toPublicDrillInstance);
    const previousConnected = useGameStore.getState().connected;
    const previousFetch = useStoryStore.getState().fetchPlacementQuestions;
    useGameStore.setState({ connected: true });
    useStoryStore.setState({ fetchPlacementQuestions: async () => questions });
    return () => {
      useGameStore.setState({ connected: previousConnected });
      useStoryStore.setState({ fetchPlacementQuestions: previousFetch });
    };
  }, []);
  return <PlacementSheet onClose={() => {}} />;
}

function safeGenerate(id: string, seed: number): DrillInstance | null {
  try {
    return generateDrill(id, seed, CTX);
  } catch {
    return null;
  }
}

export default function DrillTablePreview() {
  const [templateId, setTemplateId] = useState(SAMPLES[0].id);
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<DrillResult | null>(null);
  const [streak, setStreak] = useState(0);
  const [mount, setMount] = useState(0);
  const [mode, setMode] = useState<'card' | 'table' | 'guided' | 'placement'>('card');

  const instance = useMemo(() => safeGenerate(templateId, seed), [templateId, seed]);
  const publicInstance = useMemo(() => (instance ? toPublicDrillInstance(instance) : null), [instance]);

  const grade = (answer: DrillAnswer) => {
    if (!instance) return;
    const correct = gradeDrill(instance, answer);
    const nextStreak = correct ? streak + 1 : 0;
    setStreak(nextStreak);
    setResult({
      templateId: instance.templateId,
      seed: instance.seed,
      correct,
      correctAnswer: instance.answerSpec,
      explanation: instance.explanation,
      hintsUsed: 0,
      streak: nextStreak,
      elapsedMs: 0,
    });
  };

  const choose = (id: string, nextSeed = seed) => {
    setTemplateId(id);
    setSeed(nextSeed);
    setResult(null);
  };

  const view: StoryDrillView | null = publicInstance ? {
    setId: 'preview',
    index: seed % 5,
    total: 5,
    retry: null,
    retryOffer: null,
    instance: publicInstance,
    streak,
    hintsUsed: 0,
    wrongQueue: 0,
    hint: null,
    lastResult: result,
    answered: 0,
    correct: 0,
  } : null;

  return (
    <div className="min-h-dvh bg-abyss p-4 text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="flex flex-col gap-2 lg:w-64">
          <h1 className="text-lg font-black">수련 테이블 미리보기</h1>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
            {SAMPLES.map(sample => (
              <button
                key={sample.id}
                type="button"
                onClick={() => choose(sample.id)}
                className={`rounded-lg border px-2 py-1.5 text-left text-xs font-bold ${templateId === sample.id ? 'border-blossom bg-blossom/15 text-blossom' : 'border-mystic/30 text-ink-dim'}`}
              >
                {sample.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" className="rounded border border-mystic/30 px-2 py-1" onClick={() => choose(templateId, Math.max(1, seed - 1))}>◀</button>
            <span className="tabular-nums">seed {seed}</span>
            <button type="button" className="rounded border border-mystic/30 px-2 py-1" onClick={() => choose(templateId, seed + 1)}>▶</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-xs font-bold">
            <button type="button" data-preview="grade-correct" className="rounded-lg bg-cyber/80 px-2 py-1.5 text-abyss" onClick={() => instance && grade(correctAnswerOf(instance.answerSpec))}>정답 채점</button>
            <button type="button" data-preview="grade-wrong" className="rounded-lg bg-blossom/80 px-2 py-1.5 text-abyss" onClick={() => instance && grade(wrongAnswerOf(instance.answerSpec))}>오답 채점</button>
            <button type="button" data-preview="replay-intro" className="rounded-lg border border-mystic/30 px-2 py-1.5" onClick={() => { setResult(null); setMount(value => value + 1); }}>인트로 다시</button>
            <button type="button" className="rounded-lg border border-mystic/30 px-2 py-1.5" onClick={() => setMode(value => (value === 'card' ? 'table' : 'card'))}>{mode === 'card' ? '테이블만' : '문제 카드'}</button>
            <button type="button" data-preview="mode-guided" className="rounded-lg border border-mystic/30 px-2 py-1.5" onClick={() => setMode('guided')}>함께 풀기</button>
            <button type="button" data-preview="mode-placement" className="rounded-lg border border-mystic/30 px-2 py-1.5" onClick={() => setMode('placement')}>실력 배치</button>
          </div>
          <p className="text-[11px] text-ink-dim">프레임은 430×900(모바일). 테이블을 탭하면 재생을 건너뛴다.</p>
        </aside>

        <div data-preview="frame" className="mx-auto flex h-[900px] w-[430px] shrink-0 flex-col overflow-hidden rounded-2xl border border-mystic/30 bg-abyss">
          <header className="flex h-12 shrink-0 items-center border-b border-mystic/20 px-3 text-xs font-bold text-ink-dim">수련 · 미리보기</header>
          <main className="flex min-h-0 flex-1 flex-col items-center justify-start gap-3 overflow-y-auto px-3 py-3">
            {mode === 'guided' ? (
              <LessonPage title="함께 풀기 미리보기" blocks={firstGuidedBlocks()} partnerId="sakura" onFinish={() => setMode('card')} />
            ) : mode === 'placement' ? (
              <PlacementPreview />
            ) : !view || !instance ? (
              <p className="text-sm text-blossom">이 템플릿을 만들 수 없어요.</p>
            ) : mode === 'card' ? (
              <DrillCard
                key={`${templateId}:${seed}:${mount}`}
                drill={view}
                teacherId={CTX.teacher}
                partnerId="sakura"
                pending={false}
                hint={null}
                lastResult={result}
                onAnswer={answer => grade(answer)}
                onHint={() => {}}
                onNext={() => choose(templateId, seed + 1)}
                onRetry={() => {}}
                onSkipRetry={() => {}}
              />
            ) : (
              <DrillTable
                key={`${templateId}:${seed}:${mount}`}
                situation={view.instance.situation}
                replayKey={`${templateId}:${seed}:${mount}`}
                category={view.instance.category}
                templateId={view.instance.templateId}
                result={result}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
