'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import { getChapter, STORY_CHAPTERS } from '@/lib/story/chapters';
import { TAP_SUBMIT_DELAY_MS } from '@/lib/story/drill-input';
import type { DrillAnswer, DrillInstancePublic } from '@/lib/story/drills/types';
import { defaultRunModeForTier, placementTierFromFlags, type PlacementSelfReport, type SkillTier } from '@/lib/story/placement';
import { PLACEMENT_TIER_EXPLANATION, PLACEMENT_TIER_LABEL } from '@/lib/story/placement-copy';
import { recommendChapter } from '@/lib/story/story-hub-rules';
import DrillAnswerInput from './DrillAnswerInput';
import DrillTable from './DrillTable';

const SELF_REPORT_OPTIONS: readonly { value: PlacementSelfReport; label: string }[] = [
  { value: 'new', label: '처음이에요' },
  { value: 'rules', label: '규칙은 알아요' },
  { value: 'regular', label: '자주 쳐요' },
];

/**
 * - 'first-run': 첫 수련(2026-10-24) — 자기 평가 한 문항만 묻고, 서버가 등급을 정하면(숙련 없음) 바로 추천 수업(Ch1)을 연다.
 * - 'check': Ch1 뒤 「다음 수업부터 빠르게 가기」 — 4문 중 3문 이상이면 서버가 숙련으로 올린다. 아니면 단계 유지.
 * - 'full': 허브의 실력 측정하기·다시 측정 — 자기 평가 + 4문(기존 흐름).
 */
export type PlacementSheetMode = 'first-run' | 'check' | 'full';

interface CheckResult { promoted: boolean; correct: number; total: number }

const TITLE: Readonly<Record<PlacementSheetMode, string>> = {
  'first-run': '첫 수련 준비',
  check: '다음 수업부터 빠르게 가기',
  full: '내 실력에 맞는 수련',
};

/** 부모가 열릴 때만 마운트한다. 문항·응답은 이 시트 안에서만 보관하고 서버가 일괄 채점한다. */
export default function PlacementSheet({ onClose, onStarted, mode = 'full', startChapterId }: {
  onClose: () => void;
  onStarted?: () => void;
  mode?: PlacementSheetMode;
  /** 시작할 수업(결산의 다음 수업). 없으면 허브 추천 수업 */
  startChapterId?: string;
}) {
  const pending = useStoryStore(state => state.pending);
  const connected = useGameStore(state => state.connected);
  const fetchQuestions = useStoryStore(state => state.fetchPlacementQuestions);
  const submitPlacement = useStoryStore(state => state.submitPlacement);
  const submitSelfReport = useStoryStore(state => state.submitPlacementSelfReport);
  const submitCheck = useStoryStore(state => state.submitPlacementCheck);
  const declineCheck = useStoryStore(state => state.declinePlacementCheck);
  const startChapter = useStoryStore(state => state.startChapter);
  const [selfReport, setSelfReport] = useState<PlacementSelfReport | null>(null);
  const [questions, setQuestions] = useState<DrillInstancePublic[]>([]);
  const [answers, setAnswers] = useState<DrillAnswer[]>([]);
  const [selected, setSelected] = useState<DrillAnswer | null>(null);
  const [tier, setTier] = useState<SkillTier | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const locked = busy || pending || !connected;
  const question = questions[answers.length];
  const graded = mode === 'check' || selfReport !== null;

  useEffect(() => () => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const startFor = async (startTier: SkillTier | null) => {
    const progress = useStoryStore.getState().progress;
    const recommendation = !startChapterId && progress ? recommendChapter(STORY_CHAPTERS, progress) : null;
    const chapterId = startChapterId ?? recommendation?.chapterId;
    const chapter = chapterId ? getChapter(chapterId) : undefined;
    if (!chapter) {
      setBusy(false);
      onClose();
      return;
    }
    const current = generation.current;
    setBusy(true);
    setError(null);
    const ok = await startChapter(chapter.id, defaultRunModeForTier(startTier, chapter));
    if (current !== generation.current) return;
    setBusy(false);
    if (ok) {
      onStarted?.();
      onClose();
    }
    else setError(useStoryStore.getState().error ?? '수련을 시작하지 못했어요. 다시 시도해 주세요.');
  };

  const submit = async (report: PlacementSelfReport | null, nextAnswers: DrillAnswer[]) => {
    const current = generation.current;
    setBusy(true);
    setError(null);
    if (mode === 'check') {
      const result = await submitCheck(nextAnswers);
      if (current !== generation.current) return;
      setBusy(false);
      if (result && typeof result.correct === 'number' && typeof result.total === 'number') {
        setCheckResult({ promoted: !!result.promoted, correct: result.correct, total: result.total });
      }
      else setError(useStoryStore.getState().error ?? '결과를 저장하지 못했어요. 다시 시도해 주세요.');
      return;
    }
    if (!report) {
      setBusy(false);
      return;
    }
    const result = await submitPlacement(report, nextAnswers);
    if (current !== generation.current) return;
    setBusy(false);
    if (result?.tier) setTier(result.tier);
    else setError(useStoryStore.getState().error ?? '측정 결과를 저장하지 못했어요. 다시 시도해 주세요.');
  };

  const loadQuestions = async () => {
    if (locked) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    const received = await fetchQuestions();
    if (current !== generation.current) return;
    setBusy(false);
    if (received?.length) setQuestions(received);
    else setError(useStoryStore.getState().error ?? '문제를 불러오지 못했어요. 다시 시도해 주세요.');
  };

  const chooseSelfReport = async (report: PlacementSelfReport) => {
    if (locked) return;
    setSelfReport(report);
    if (mode === 'first-run') {
      // 첫 수련은 문제를 내지 않는다 — 서버가 자기 평가로 등급을 정하고(숙련 없음) 바로 첫 수업을 연다
      const current = generation.current;
      setBusy(true);
      setError(null);
      const result = await submitSelfReport(report);
      if (current !== generation.current) return;
      if (!result?.tier) {
        setBusy(false);
        setSelfReport(null);
        setError(useStoryStore.getState().error ?? '수련을 준비하지 못했어요. 다시 선택해 주세요.');
        return;
      }
      setTier(result.tier);
      await startFor(result.tier);
      return;
    }
    if (report === 'new') {
      await submit(report, []);
      return;
    }
    await loadQuestions();
  };

  const decline = async () => {
    if (locked) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    const ok = await declineCheck();
    if (current !== generation.current) return;
    setBusy(false);
    if (ok) onClose();
    else setError(useStoryStore.getState().error ?? '저장하지 못했어요. 다시 시도해 주세요.');
  };

  const chooseAnswer = (answer: DrillAnswer | null) => {
    if (locked || !question || !graded || answer?.kind !== 'multiple-choice') return;
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
    setCheckResult(null);
    setError(null);
  };

  const startAfterCheck = () => {
    if (!checkResult || locked) return;
    // 올라가지 않았으면 서버에 저장된 지금 단계(ack 뒤 진행 요약을 다시 받았다)로 다음 수업을 연다
    void startFor(checkResult.promoted ? 'advanced' : placementTierFromFlags(useStoryStore.getState().progress?.flags));
  };

  const contentKey = checkResult ? 'check-result' : tier ? 'result' : question ? `question-${answers.length}` : 'intro';

  return (
    <Modal isOpen onClose={onClose} title={TITLE[mode]} dismissible={!busy && !pending} contentKey={contentKey}>
      <div className="space-y-3">
        {checkResult ? (
          <div className="space-y-3 text-center">
            <p className="text-xs text-ink-dim">{checkResult.total}문 중 {checkResult.correct}문 정답</p>
            {checkResult.promoted ? (
              <>
                <p className="text-3xl font-black text-gilded">{PLACEMENT_TIER_LABEL.advanced} · 빠른 진행</p>
                <p className="text-sm leading-relaxed text-ink">{PLACEMENT_TIER_EXPLANATION.advanced}</p>
              </>
            ) : (
              <>
                <p className="text-xl font-black text-ink">지금처럼 차근차근 가요</p>
                <p className="text-sm leading-relaxed text-ink">빠른 진행은 3문부터 켜져요. 수업을 듣다 보면 금방이에요. 허브에서 언제든 다시 풀 수 있어요.</p>
              </>
            )}
            <button type="button" disabled={locked} onClick={startAfterCheck} className="min-h-11 w-full rounded-xl bg-blossom px-3 text-sm font-bold text-abyss disabled:opacity-50">다음 수업 시작</button>
            <button type="button" disabled={busy || pending} onClick={onClose} className="min-h-11 px-2 text-xs text-ink-dim underline disabled:opacity-50">닫기</button>
          </div>
        ) : tier ? (
          <div className="space-y-3 text-center">
            <p className="text-xs text-ink-dim">내 수련 단계</p>
            <p className="text-3xl font-black text-gilded">{PLACEMENT_TIER_LABEL[tier]}</p>
            <p className="text-sm leading-relaxed text-ink">{PLACEMENT_TIER_EXPLANATION[tier]}</p>
            <button type="button" disabled={locked} onClick={() => void startFor(tier)} className="min-h-11 w-full rounded-xl bg-blossom px-3 text-sm font-bold text-abyss disabled:opacity-50">수련 시작</button>
            {mode === 'full' && <button type="button" disabled={locked} onClick={restart} className="min-h-11 px-2 text-xs text-ink-dim underline disabled:opacity-50">다시 측정</button>}
          </div>
        ) : questions.length > 0 ? (
          question ? (
            <>
              <p className="text-xs font-bold text-mystic" aria-live="polite">{answers.length + 1}/{questions.length}</p>
              <DrillTable situation={question.situation} replayKey={`placement-${answers.length}`} category={question.category} templateId={question.templateId} />
              <h3 className="text-sm font-bold leading-relaxed text-ink">{question.question}</h3>
              <DrillAnswerInput key={answers.length} spec={question.answerSpec} value={selected} onChange={chooseAnswer} disabled={locked} />
              <p className="text-[11px] text-ink-dim">보기를 누르면 다음 문제로 넘어가요.</p>
            </>
          ) : (
            <div className="text-center">
              <p className="text-sm text-ink">{busy ? '수련 단계를 확인하는 중…' : '모든 문제에 답했어요.'}</p>
              {!busy && <button type="button" disabled={locked} onClick={() => void submit(selfReport, answers)} className="mt-3 min-h-11 rounded-xl border border-mystic/30 px-3 text-sm text-mystic disabled:opacity-50">결과 다시 확인</button>}
            </div>
          )
        ) : mode === 'check' ? (
          <>
            <h3 className="text-base font-bold text-ink">규칙을 이미 아신다면 4문만 풀고 다음 수업부터 빠르게 가요.</h3>
            <p className="text-xs leading-relaxed text-ink-dim">3문 이상 맞히면 기초 레슨과 연습 테이블을 건너뛰고 상대가 조금 강해져요. 못 맞혀도 지금처럼 그대로예요.</p>
            <button type="button" disabled={locked} onClick={() => void loadQuestions()} className="min-h-11 w-full rounded-xl bg-blossom px-3 text-sm font-bold text-abyss disabled:opacity-50">4문 풀기</button>
            <button type="button" disabled={locked} onClick={() => void decline()} className="min-h-11 w-full rounded-xl border border-mystic/30 px-3 text-sm text-ink-dim disabled:opacity-50">괜찮아요, 지금처럼 갈게요</button>
            <button type="button" disabled={busy || pending} onClick={onClose} className="min-h-11 w-full text-xs text-ink-dim underline disabled:opacity-50">나중에 할게요</button>
          </>
        ) : (
          <>
            <h3 className="text-base font-bold text-ink">포커를 얼마나 해 보셨어요?</h3>
            {mode === 'first-run' && <p className="text-xs leading-relaxed text-ink-dim">고르면 바로 첫 수업을 시작해요. 문제는 나중에 원할 때만 풀어요.</p>}
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
