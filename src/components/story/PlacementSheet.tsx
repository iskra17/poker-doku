'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import { getChapter, STORY_CHAPTERS } from '@/lib/story/chapters';
import { TAP_SUBMIT_DELAY_MS } from '@/lib/story/drill-input';
import type { DrillAnswer, DrillInstancePublic } from '@/lib/story/drills/types';
import { defaultRunModeForTier, type PlacementSelfReport, type SkillTier } from '@/lib/story/placement';
import { PLACEMENT_TIER_EXPLANATION, PLACEMENT_TIER_LABEL } from '@/lib/story/placement-copy';
import { recommendChapter } from '@/lib/story/story-hub-rules';
import DrillAnswerInput from './DrillAnswerInput';
import DrillTableView from './DrillTableView';

const SELF_REPORT_OPTIONS: readonly { value: PlacementSelfReport; label: string }[] = [
  { value: 'new', label: '처음이에요' },
  { value: 'rules', label: '규칙은 알아요' },
  { value: 'regular', label: '자주 쳐요' },
];

/** 부모가 열릴 때만 마운트한다. 문항·응답은 이 시트 안에서만 보관하고 서버가 일괄 채점한다. */
export default function PlacementSheet({ onClose, onStarted }: { onClose: () => void; onStarted?: () => void }) {
  const pending = useStoryStore(state => state.pending);
  const connected = useGameStore(state => state.connected);
  const fetchQuestions = useStoryStore(state => state.fetchPlacementQuestions);
  const submitPlacement = useStoryStore(state => state.submitPlacement);
  const startChapter = useStoryStore(state => state.startChapter);
  const [selfReport, setSelfReport] = useState<PlacementSelfReport | null>(null);
  const [questions, setQuestions] = useState<DrillInstancePublic[]>([]);
  const [answers, setAnswers] = useState<DrillAnswer[]>([]);
  const [selected, setSelected] = useState<DrillAnswer | null>(null);
  const [tier, setTier] = useState<SkillTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const locked = busy || pending || !connected;
  const question = questions[answers.length];

  useEffect(() => () => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const submit = async (report: PlacementSelfReport, nextAnswers: DrillAnswer[]) => {
    const current = generation.current;
    setBusy(true);
    setError(null);
    const result = await submitPlacement(report, nextAnswers);
    if (current !== generation.current) return;
    setBusy(false);
    if (result?.tier) setTier(result.tier);
    else setError(useStoryStore.getState().error ?? '측정 결과를 저장하지 못했어요. 다시 시도해 주세요.');
  };

  const chooseSelfReport = async (report: PlacementSelfReport) => {
    if (locked) return;
    setSelfReport(report);
    if (report === 'new') {
      await submit(report, []);
      return;
    }
    const current = generation.current;
    setBusy(true);
    setError(null);
    const received = await fetchQuestions();
    if (current !== generation.current) return;
    setBusy(false);
    if (received?.length) setQuestions(received);
    else setError(useStoryStore.getState().error ?? '문제를 불러오지 못했어요. 다시 선택해 주세요.');
  };

  const chooseAnswer = (answer: DrillAnswer | null) => {
    if (locked || !question || !selfReport || answer?.kind !== 'multiple-choice') return;
    setSelected(answer);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      // 강조 중 연결이 끊기면 선택을 유지한다. 재연결 뒤 다시 탭하여 진행할 수 있다.
      if (!useGameStore.getState().connected) return;
      const nextAnswers = [...answers, answer];
      setAnswers(nextAnswers);
      setSelected(null);
      if (nextAnswers.length === questions.length) void submit(selfReport, nextAnswers);
    }, TAP_SUBMIT_DELAY_MS);
  };

  const restart = () => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    setSelfReport(null);
    setQuestions([]);
    setAnswers([]);
    setSelected(null);
    setTier(null);
    setError(null);
  };

  const startRecommended = async () => {
    if (!tier || locked) return;
    const progress = useStoryStore.getState().progress;
    const recommendation = progress ? recommendChapter(STORY_CHAPTERS, progress) : null;
    const chapter = recommendation?.chapterId ? getChapter(recommendation.chapterId) : undefined;
    if (!chapter) {
      onClose();
      return;
    }
    const current = generation.current;
    setBusy(true);
    const ok = await startChapter(chapter.id, defaultRunModeForTier(tier, chapter));
    if (current !== generation.current) return;
    setBusy(false);
    if (ok) {
      onStarted?.();
      onClose();
    }
    else setError(useStoryStore.getState().error ?? '수련을 시작하지 못했어요. 다시 시도해 주세요.');
  };

  return (
    <Modal isOpen onClose={onClose} title="내 실력에 맞는 수련" dismissible={!busy && !pending} contentKey={tier ? 'result' : question ? `question-${answers.length}` : 'self-report'}>
      <div className="space-y-3">
        {tier ? (
          <div className="space-y-3 text-center">
            <p className="text-xs text-ink-dim">내 수련 단계</p>
            <p className="text-3xl font-black text-gilded">{PLACEMENT_TIER_LABEL[tier]}</p>
            <p className="text-sm leading-relaxed text-ink">{PLACEMENT_TIER_EXPLANATION[tier]}</p>
            <button type="button" disabled={locked} onClick={() => void startRecommended()} className="min-h-11 w-full rounded-xl bg-blossom px-3 text-sm font-bold text-abyss disabled:opacity-50">수련 시작</button>
            <button type="button" disabled={locked} onClick={restart} className="min-h-11 px-2 text-xs text-ink-dim underline disabled:opacity-50">다시 측정</button>
          </div>
        ) : questions.length > 0 ? (
          question ? (
            <>
              <p className="text-xs font-bold text-mystic" aria-live="polite">{answers.length + 1}/{questions.length}</p>
              <DrillTableView situation={question.situation} />
              <h3 className="text-sm font-bold leading-relaxed text-ink">{question.question}</h3>
              <DrillAnswerInput key={answers.length} spec={question.answerSpec} value={selected} onChange={chooseAnswer} disabled={locked} />
              <p className="text-[11px] text-ink-dim">보기를 누르면 다음 문제로 넘어가요.</p>
            </>
          ) : (
            <div className="text-center">
              <p className="text-sm text-ink">{busy ? '수련 단계를 확인하는 중…' : '모든 문제에 답했어요.'}</p>
              {!busy && <button type="button" disabled={locked} onClick={() => selfReport && void submit(selfReport, answers)} className="mt-3 min-h-11 rounded-xl border border-mystic/30 px-3 text-sm text-mystic disabled:opacity-50">결과 다시 확인</button>}
            </div>
          )
        ) : (
          <>
            <h3 className="text-base font-bold text-ink">포커를 얼마나 해 보셨어요?</h3>
            <div className="grid gap-2">
              {SELF_REPORT_OPTIONS.map(option => <button key={option.value} type="button" disabled={locked} onClick={() => void chooseSelfReport(option.value)} className="min-h-11 rounded-xl border border-mystic/30 bg-elevated/50 px-3 py-3 text-left text-sm font-bold text-ink hover:border-mystic disabled:opacity-50">{option.label}</button>)}
            </div>
            <button type="button" disabled={busy || pending} onClick={onClose} className="min-h-11 w-full text-xs text-ink-dim underline disabled:opacity-50">나중에 할게요</button>
          </>
        )}
        {busy && <p className="text-center text-xs text-ink-dim" role="status">처리 중…</p>}
        {!connected && <p className="text-xs text-blossom" role="status">서버와 다시 연결되면 계속할 수 있어요.</p>}
        {error && <p className="text-xs text-blossom" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
