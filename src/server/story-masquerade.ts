/** Server-only assignment and answer key. Never import this module from client code. */
import { randomInt, randomUUID } from 'node:crypto';
import type { HandReadQuizView, StoryQuizFeedback, StoryQuizReceipt } from '../lib/story/views';
export const MASQUERADE_POOL = ['mochi', 'choco', 'gumi', 'chloe'] as const;
const OPTIONS = ['슈퍼 니트 · 참여를 아주 아낀다', 'ABC 정직파 · 강할 때 주로 공격한다', '블러프 아티스트 · 공격에 블러프를 섞는다', '콜링 스테이션 · 넓게 참여하고 콜을 즐긴다'];
const EXPLANATIONS = ['참여가 드물고 좁은 레인지를 고르는 모찌예요. 표본이 적으면 단정하지 말아요.', '초코는 강한 핸드 중심으로 공격하는 정직파예요. 강한 리버 공격에 약한 핸드로 버티지 말아요.', '구미는 공격에 블러프를 섞어요. 합리적인 크기의 벳에는 강한 핸드로 콜할 여지가 있어요.', '클로이는 콜링 스테이션이에요. 강한 핸드로 밸류벳하고 에어 블러프를 줄여요.'];
export function shuffledMasqueradePool(): string[] {
  const pool: string[] = [...MASQUERADE_POOL];
  for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool;
}
interface Entry { question: HandReadQuizView; personalityId: string; correctIndex: number; selected: number | null; answered: boolean }
export class MasqueradeQuiz {
  private entries: Entry[] = [];
  constructor(private identities: readonly { seatIndex: number; personalityId: string }[], private id: () => string = randomUUID) {
    if (identities.length !== 4 || new Set(identities.map(i => i.seatIndex)).size !== 4
      || new Set(identities.map(i => i.personalityId)).size !== 4 || identities.some(i => !(MASQUERADE_POOL as readonly string[]).includes(i.personalityId))) throw new Error('Invalid masquerade identity plan');
  }
  issue(now: number): HandReadQuizView | null {
    if (this.pending()) return this.pending();
    if (this.entries.length >= 4) return null;
    const identity = this.identities[this.entries.length];
    const question: HandReadQuizView = { quizId: this.id(), seatIndex: identity.seatIndex, number: this.entries.length + 1, required: 4,
      prompt: `가면 ${String.fromCharCode(65 + this.entries.length)}의 플레이 유형은 무엇일까요?`, options: [...OPTIONS], expiresAt: now + 30_000 };
    this.entries.push({ question, personalityId: identity.personalityId, correctIndex: (MASQUERADE_POOL as readonly string[]).indexOf(identity.personalityId), selected: null, answered: false });
    return { ...question, options: [...question.options] };
  }
  pending(): HandReadQuizView | null { const q = this.entries.find(e => !e.answered)?.question; return q ? { ...q, options: [...q.options] } : null; }
  answer(quizId: string, optionIndex: number | null, now: number): StoryQuizReceipt | null {
    const entry = this.entries.find(e => e.question.quizId === quizId);
    if (!entry || (optionIndex !== null && (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3))) return null;
    if (!entry.answered) { entry.selected = now >= entry.question.expiresAt ? null : optionIndex; entry.answered = true; }
    return { quizId, accepted: true };
  }
  counts() { return { issued: this.entries.length, answered: this.entries.filter(e => e.answered).length, correct: this.entries.filter(e => e.answered && e.selected === e.correctIndex).length, required: 4 as const }; }
  feedback(): StoryQuizFeedback[] | null {
    return this.counts().answered === 4 ? this.entries.map(e => ({ seatIndex: e.question.seatIndex, selected: e.selected, correctIndex: e.correctIndex, correctLabel: OPTIONS[e.correctIndex], selectedLabel: e.selected === null ? null : OPTIONS[e.selected], characterId: e.personalityId, explanation: EXPLANATIONS[e.correctIndex] })) : null;
  }
}
