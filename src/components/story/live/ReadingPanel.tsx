'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatCard } from '@/lib/poker/card-notation';
import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import { quizRemainingMs } from '@/lib/story/quiz-countdown';
import type { StoryLiveView } from '@/lib/story/views';

/** 서버가 같은 리버 턴을 보류한 동안만 body portal에 표시한다. */
export default function ReadingPanel({ live }: { live: StoryLiveView }) {
  const pending = useStoryStore(state => state.pending);
  const error = useStoryStore(state => state.error);
  const answer = useStoryStore(state => state.answerQuiz);
  const resume = useStoryStore(state => state.resumeLive);
  const countdown = useStoryStore(state => state.quizCountdown);
  const online = useGameStore(state => state.connected);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 250); return () => clearInterval(timer); }, []);
  const reading = live.reading;
  if (!reading) return null;
  const quiz = live.pendingQuiz;
  const situation = quiz?.situation;
  const feedback = reading.feedback;
  return <Modal isOpen onClose={() => {}} dismissible={false}
    contentKey={quiz?.quizId ?? `reading-feedback:${feedback?.quizId}`} title="리버에서 잠깐 · 레인지 리딩">
    {quiz ? <div className="space-y-3">
      <p className="text-xs text-gilded">{quiz.number}/{quiz.required} · {Math.ceil(quizRemainingMs(countdown?.quizId === quiz.quizId ? countdown : null, now) / 1000)}초</p>
      {situation && <div className="rounded-xl bg-mystic/10 p-3 text-sm">
        <p>내 카드: {situation.hero.map(formatCard).join(' · ')}</p>
        <p>보드: {situation.board.map(formatCard).join(' · ')}</p>
        <p className="mt-2 break-words">가정한 상대 레인지: {situation.range}</p>
        <p className="mt-1 text-xs text-ink-dim">{situation.assumption}</p>
      </div>}
      <p className="text-sm font-bold">{quiz.prompt}</p>
      {quiz.options.map((option, index) => <button type="button" key={option} disabled={pending || !online}
        onClick={() => void answer(quiz.quizId, index)} className="w-full rounded-xl border border-mystic/30 px-3 py-3 text-left text-sm disabled:opacity-50">{option}</button>)}
      <p className="text-xs text-ink-dim">답을 확정한 뒤 계산을 보여 드려요. 시간 초과는 무응답으로 기록돼요.</p>
    </div> : feedback && <div className="space-y-3">
      <p className="font-bold">{feedback.selected === feedback.correctIndex ? '정답이에요' : feedback.selected === null ? '답할 시간이 지났어요' : '가격과 콤보를 다시 살펴봐요'}</p>
      <p className="text-sm">{feedback.explanation}</p>
      <p className="text-xs text-ink-dim">이 계산은 공개한 레인지 가정에 대한 답이에요. 실제 상대 패를 알아낸 것은 아니에요. 최대 10초 뒤 내 포커 턴이 시작돼요.</p>
      <button type="button" disabled={pending || !online} onClick={() => void resume()} className="w-full rounded-xl bg-mystic py-3 text-sm font-bold text-white disabled:opacity-50">계속 · 직접 포커 결정하기</button>
    </div>}
    {!online && <p role="status" className="mt-2 text-xs text-blossom">연결이 끊기면 원래 포커 턴은 자동 체크/폴드돼요. 미응답 질문은 점수에서 제외돼요.</p>}
    {error && <p role="alert" className="mt-2 text-xs text-blossom">{error}</p>}
  </Modal>;
}
