'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { getCharacterById } from '@/lib/characters';
import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import type { StoryLiveView } from '@/lib/story/views';

export default function MasqueradePanel({ live }: { live: StoryLiveView }) {
  const pending = useStoryStore(state => state.pending);
  const error = useStoryStore(state => state.error);
  const answer = useStoryStore(state => state.answerQuiz);
  const resume = useStoryStore(state => state.resumeLive);
  const online = useGameStore(state => state.connected);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const mask = live.masquerade;
  if (!mask) return null;
  const quiz = live.pendingQuiz;
  const holding = mask.phase === 'quiz' || mask.phase === 'feedback';
  const notes = <div className="space-y-1 text-xs text-ink-dim">
    <p>관찰한 행동 · 짧은 표본이라 실제 경향과 다를 수 있어요.</p>
    {mask.notes.map((note, i) => <p key={note.seatIndex}>가면 {String.fromCharCode(65 + i)} · {note.hands}핸드 / 참여 {note.entered} / 레이즈 {note.raised} / 콜 {note.called}</p>)}
  </div>;
  if (!holding) return <details className="pointer-events-auto rounded-xl border border-mystic/30 bg-panel/95 p-2 text-xs text-ink"><summary>가면 관찰 노트 {mask.phase === 'observing' ? `${live.handsPlayed}/12` : '· 정체 공개'}</summary>{notes}</details>;
  return <Modal isOpen onClose={() => {}} dismissible={false}
    contentKey={quiz?.quizId ?? `${mask.phase}:${mask.answered}`}
    title={mask.phase === 'feedback' ? '네 가면의 정체' : '가면 퀴즈'}>
    {notes}
    {quiz ? <div key={quiz.quizId} className="mt-3 space-y-2">
      <p className="text-xs text-gilded">{quiz.number}/{quiz.required} · {Math.min(30, Math.max(0, Math.ceil((quiz.expiresAt - now) / 1000)))}초</p>
      <p className="text-sm font-bold">{quiz.prompt}</p>
      {quiz.options.map((option, index) => <button key={option} type="button" disabled={pending || !online || now >= quiz.expiresAt} onClick={() => void answer(quiz.quizId, index)} className="w-full rounded-xl border border-mystic/30 px-3 py-2.5 text-left text-sm disabled:opacity-50">{index + 1}. {option}</button>)}
      <p className="text-xs text-ink-dim">네 답이 확정된 뒤 정답을 함께 공개해요. 시간이 지나면 무응답으로 기록돼요.</p>
    </div> : mask.feedback ? <div className="mt-3 space-y-3">
      {mask.feedback.map((entry, i) => <article key={entry.seatIndex} className="rounded-xl border border-mystic/20 p-2 text-xs">
        <p className="font-bold">가면 {String.fromCharCode(65 + i)} · {getCharacterById(entry.characterId)?.name} · {entry.selected === entry.correctIndex ? '정답' : entry.selected === null ? '무응답' : '다시 살펴봐요'}</p>
        <p>내 선택: {entry.selectedLabel ?? '시간 초과'} / 정답: {entry.correctLabel}</p><p className="mt-1 text-ink-dim">{entry.explanation}</p>
      </article>)}
      <p className="text-xs text-ink-dim">이제 최대 10핸드 동안 상대에게 맞춰 결정해요. 실제 기회가 없으면 대응 항목은 미측정으로 남아요.</p>
    </div> : <p className="my-3 text-sm">답 {mask.answered}/4개가 확정됐어요. 연결을 확인하고 다음 질문을 이어가요.</p>}
    {!quiz && <button type="button" disabled={pending || !online} onClick={() => void resume()} className="mt-3 w-full rounded-xl bg-mystic py-2.5 text-sm font-bold text-white disabled:opacity-50">{mask.feedback ? '계속 · 상대에게 맞춰 대결' : '계속 · 다음 질문'}</button>}
    {!online && <p role="status" className="mt-2 text-xs text-blossom">연결이 끊겼어요. 현재 질문의 제한 시간은 계속 흘러요.</p>}
    {error && <p role="alert" className="mt-2 text-xs text-blossom">{error}</p>}
  </Modal>;
}
