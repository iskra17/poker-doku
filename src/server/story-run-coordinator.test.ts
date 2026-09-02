import { describe, expect, it } from 'vitest';
import { generateDrill, gradeDrill } from '@/lib/story/drills/generator';
import type { DrillAnswer, DrillAnswerSpec } from '@/lib/story/drills/types';
import { makeChapter, makeChapterChain } from '@/lib/story/test-fixtures';
import type { Chapter, StoryTeacherId } from '@/lib/story/types';
import { getStoryRewardDefinition, listStoryRewardPreview, toStoryRewardItemView } from '@/lib/story/rewards/catalog';
import type { StoryRewardItemView, StoryRunView } from '@/lib/story/views';
import type { LiveEnterInput, LiveStepSummary, StoryLiveEvents } from './story-live-adapter';
import type { StoryAffinityTransitionRecord, StoryLiveAdapterPort } from './story-run-coordinator';
import {
  DAILY_CHAPTER_ID,
  kstDay,
  StoryRunCoordinator,
  type StoryAttemptInput,
  type StoryProgressRecord,
  type StoryRepositoryPort,
  type StoryReviewNoteRecord,
  type StoryRewardPort,
} from './story-run-coordinator';

const PROFILE = 'profile-hero';
const NOW = Date.UTC(2026, 8, 2, 3, 0, 0); // 2026-09-02 12:00 KST

class FakeRepository implements StoryRepositoryPort {
  progress = new Map<string, StoryProgressRecord[]>();
  flags = new Map<string, Record<string, string>>();
  attempts: StoryAttemptInput[] = [];
  notes = new Map<string, StoryReviewNoteRecord>();
  attemptStarts: Array<{ profileId: string; chapterId: string; now: number }> = [];
  completions: Array<{ chapterId: string; grade: string }> = [];

  listProgress(profileId: string): StoryProgressRecord[] {
    return [...(this.progress.get(profileId) ?? [])];
  }

  recordAttemptStart(profileId: string, chapterId: string, now: number): void {
    this.attemptStarts.push({ profileId, chapterId, now });
    const rows = this.progress.get(profileId) ?? [];
    const row = rows.find(r => r.chapterId === chapterId);
    if (row) {
      row.attempts += 1;
      row.lastPlayedAt = now;
    } else {
      rows.push({ chapterId, attempts: 1, completions: 0, bestGrade: null, firstCompletedAt: null, lastPlayedAt: now });
    }
    this.progress.set(profileId, rows);
  }

  recordCompletion(profileId: string, chapterId: string, grade: 'S' | 'A' | 'B', now: number): void {
    this.completions.push({ chapterId, grade });
    const rows = this.progress.get(profileId) ?? [];
    const row = rows.find(r => r.chapterId === chapterId);
    if (row) {
      row.completions += 1;
      row.bestGrade = row.bestGrade ?? grade;
      row.firstCompletedAt = row.firstCompletedAt ?? now;
    } else {
      rows.push({ chapterId, attempts: 1, completions: 1, bestGrade: grade, firstCompletedAt: now, lastPlayedAt: now });
    }
    this.progress.set(profileId, rows);
  }

  complete(profileId: string, chapterId: string): void {
    this.recordCompletion(profileId, chapterId, 'B', NOW);
  }

  getFlags(profileId: string): Record<string, string> {
    return { ...(this.flags.get(profileId) ?? {}) };
  }

  setFlags(profileId: string, flags: Record<string, string>): void {
    this.flags.set(profileId, { ...(this.flags.get(profileId) ?? {}), ...flags });
  }

  getDrillStats() {
    const total = this.attempts.length;
    const correct = this.attempts.filter(a => a.correct).length;
    return { total, correct, byCategory: {} };
  }

  insertAttempt(input: StoryAttemptInput): void {
    this.attempts.push(input);
  }

  markWrong(_profileId: string, templateId: string, seed: number, now: number): void {
    this.notes.set(`${templateId}:${seed}`, { templateId, seed, box: 1, dueAt: now + 24 * 3600_000 });
  }

  markCorrect(_profileId: string, templateId: string, seed: number): 'promoted' | 'graduated' | 'none' {
    const key = `${templateId}:${seed}`;
    if (!this.notes.has(key)) return 'none';
    this.notes.delete(key);
    return 'graduated';
  }

  listDue(_profileId: string, now: number, limit: number): StoryReviewNoteRecord[] {
    return [...this.notes.values()].filter(note => note.dueAt <= now).slice(0, limit);
  }

  countNotes(): number {
    return this.notes.size;
  }

  countAttemptsBetween(profileId: string, fromMs: number, toMsExclusive: number, context?: string, options?: { firstAttemptOnly?: boolean }): number {
    return this.attempts.filter(a => a.profileId === profileId && a.answeredAt >= fromMs && a.answeredAt < toMsExclusive && (!context || a.context === context) && (!options?.firstAttemptOnly || a.attempt === 0)).length;
  }
}

class FakeRewards implements StoryRewardPort {
  chapters: Array<Parameters<StoryRewardPort['completeChapter']>[0]> = [];
  dailies: Array<Parameters<StoryRewardPort['completeDaily']>[0]> = [];
  reconciles: Array<{ profileId: string; now: number }> = [];
  dailyChips: Array<{ profileId: string; kstDate: string }> = [];
  /** 다음 reconcile이 돌려줄 지급 결과 — 테스트가 세팅, 소비 후 비움 */
  pending: { granted: StoryRewardItemView[]; chips: number } = { granted: [], chips: 0 };
  /** completeChapter가 돌려줄 인연 전이 */
  transitions: StoryAffinityTransitionRecord[] = [];
  granted = new Set<string>();

  constructor(private readonly chapterList: Chapter[]) {}

  completeChapter(input: Parameters<StoryRewardPort['completeChapter']>[0]) {
    const duplicate = this.chapters.some(c => c.chapterId === input.chapterId && c.firstClear && input.firstClear);
    this.chapters.push(input);
    return { duplicate, affinityTransitions: duplicate ? [] : this.transitions };
  }
  completeDaily(input: Parameters<StoryRewardPort['completeDaily']>[0]) {
    const duplicate = this.dailies.some(d => d.kstDate === input.kstDate);
    this.dailies.push(input);
    return { duplicate };
  }
  reconcile(profileId: string, now: number) {
    this.reconciles.push({ profileId, now });
    const result = this.pending;
    this.pending = { granted: [], chips: 0 };
    for (const item of result.granted) this.granted.add(item.id);
    return result;
  }
  preview() {
    return listStoryRewardPreview(this.chapterList, this.granted);
  }
  grantDailyChips(profileId: string, kstDate: string) {
    this.dailyChips.push({ profileId, kstDate });
    return 100;
  }
}

function rewardItem(id: string): StoryRewardItemView {
  return toStoryRewardItemView(getStoryRewardDefinition(id)!);
}

function setup(chapters: Chapter[] = makeChapterChain(), partner: 'sakura' | null = 'sakura') {
  const repository = new FakeRepository();
  const rewards = new FakeRewards(chapters);
  const emitted: Array<{ profileId: string; view: StoryRunView }> = [];
  let counter = 0;
  let clock = NOW;
  const coordinator = new StoryRunCoordinator({
    repository,
    rewards,
    chapters,
    now: () => clock,
    emit: (profileId, view) => emitted.push({ profileId, view }),
    partnerOf: () => partner,
    runIdFactory: () => `run-${++counter}`,
  });
  const latest = () => emitted.at(-1)!.view;
  const tick = (ms: number) => { clock += ms; };
  return { repository, rewards, coordinator, emitted, latest, tick };
}

/** 서버가 재생성할 인스턴스와 같은 seed로 정답/오답을 만든다 */
function answerFor(templateId: string, seed: number, teacher: StoryTeacherId, correct: boolean): DrillAnswer {
  const instance = generateDrill(templateId, seed, { teacher });
  const spec: DrillAnswerSpec = instance.answerSpec;
  let answer: DrillAnswer;
  switch (spec.kind) {
    case 'multiple-choice':
      answer = { kind: 'multiple-choice', index: correct ? spec.correctIndex : (spec.correctIndex + 1) % spec.options.length };
      break;
    case 'numeric':
      answer = { kind: 'numeric', value: correct ? spec.correct : spec.correct + spec.tolerance + 50 };
      break;
    case 'action-pick':
      answer = { kind: 'action-pick', action: correct ? spec.correct[0] : spec.options.find(o => !spec.correct.includes(o)) ?? 'fold', sizingBB: spec.sizingBB?.min };
      break;
    case 'card-pick':
      answer = { kind: 'card-pick', cards: correct ? spec.correct : spec.candidates.slice(0, spec.pickCount) };
      break;
    case 'multi-select':
      answer = { kind: 'multi-select', indices: correct ? spec.correctIndices : [] };
      break;
  }
  expect(gradeDrill(instance, answer)).toBe(correct);
  return answer;
}

/** 현재 뷰의 문항에 답한다 */
function answerCurrent(ctx: ReturnType<typeof setup>, correct: boolean) {
  const view = ctx.latest();
  const drill = view.drill!;
  const answer = answerFor(drill.instance.templateId, drill.instance.seed, view.context.teacherId, correct);
  return ctx.coordinator.drill(PROFILE, { runId: view.runId, setId: drill.setId, index: drill.index, action: 'answer', answer, elapsedMs: 1200 });
}

describe('kstDay', () => {
  it('uses KST midnight boundaries', () => {
    const day = kstDay(NOW);
    expect(day.date).toBe('2026-09-02');
    expect(day.fromMs).toBe(Date.UTC(2026, 8, 1, 15, 0, 0));
    expect(day.toMsExclusive).toBe(Date.UTC(2026, 8, 2, 15, 0, 0));
    expect(kstDay(Date.UTC(2026, 8, 1, 15, 30, 0)).date).toBe('2026-09-02');
    expect(kstDay(Date.UTC(2026, 8, 1, 14, 30, 0)).date).toBe('2026-09-01');
  });
});

describe('StoryRunCoordinator.getProgress', () => {
  it('derives unlocks, belt, next chapter and daily availability', () => {
    const { repository, coordinator } = setup();
    const before = coordinator.getProgress(PROFILE);
    expect(before.chapters.map(c => [c.chapterId, c.unlocked])).toEqual([
      ['act1-ch01', true], ['act1-ch02', false], ['act1-ch03', false], ['act2-ch04', false],
    ]);
    expect(before.belt).toBe('white');
    expect(before.nextChapterId).toBe('act1-ch01');
    expect(before.daily).toEqual({ date: '2026-09-02', done: 0, total: 3, available: false, teacherId: null });
    expect(before.activeRun).toBeNull();

    repository.complete(PROFILE, 'act1-ch01');
    repository.flags.set(PROFILE, { 'choice:act1-ch01:greet': 'warm' });
    const after = coordinator.getProgress(PROFILE);
    expect(after.chapters[1]).toMatchObject({ chapterId: 'act1-ch02', unlocked: true });
    expect(after.nextChapterId).toBe('act1-ch02');
    expect(after.daily).toMatchObject({ available: true, done: 0 });
    // 완료 챕터(Ch1 담당 미야코)엔 히로인이 없어 파트너가 출제자
    expect(after.daily.teacherId).toBe('sakura');
    expect(after.flags).toEqual({ 'choice:act1-ch01:greet': 'warm' });
  });
});

describe('StoryRunCoordinator.start', () => {
  it('rejects locked or unknown chapters and records an attempt on success', () => {
    const { repository, coordinator, emitted } = setup();
    expect(coordinator.start(PROFILE, 'act1-ch02')).toMatchObject({ ok: false, code: 'story-locked' });
    expect(coordinator.start(PROFILE, 'act9-ch99')).toMatchObject({ ok: false, code: 'story-locked' });
    expect(repository.attemptStarts).toHaveLength(0);

    expect(coordinator.start(PROFILE, 'act1-ch01')).toEqual({ ok: true, value: { runId: 'run-1' } });
    expect(repository.attemptStarts).toEqual([{ profileId: PROFILE, chapterId: 'act1-ch01', now: NOW }]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].view).toMatchObject({
      runId: 'run-1', chapterId: 'act1-ch01', stepIndex: 0, stepKind: 'scene', phase: 'scene',
      context: { partnerId: 'sakura', teacherId: 'miyako' }, drill: null, result: null,
    });
    expect(coordinator.start(PROFILE, 'act1-ch01')).toMatchObject({ ok: false, code: 'story-busy' });
    expect(coordinator.start('profile-other', 'act1-ch01').ok).toBe(true);
    expect(coordinator.stats()).toEqual({ runs: 2 });
  });

  it("resolves the 'partner' teacher to the selected partner, or miyako without one", () => {
    const chapters = [makeChapter({ teacher: 'partner' })];
    const withPartner = setup(chapters, 'sakura');
    withPartner.coordinator.start(PROFILE, 'act1-ch01');
    expect(withPartner.latest().context.teacherId).toBe('sakura');
    const noPartner = setup(chapters, null);
    noPartner.coordinator.start(PROFILE, 'act1-ch01');
    expect(noPartner.latest().context).toEqual({ partnerId: null, teacherId: 'miyako' });
  });
});

describe('scene choices', () => {
  it('records flags from options that exist in the current scene, rejects others', () => {
    const chapters = [makeChapter({
      steps: [
        {
          kind: 'scene', id: 's', scene: {
            id: 's', lines: [
              { kind: 'say', speaker: 'miyako', text: '안녕' },
              { kind: 'choice', choice: { id: 'greet', options: [{ id: 'warm', text: '네', setFlags: { 'choice:act1-ch01:greet': 'warm' } }, { id: 'cool', text: '…' }] } },
            ],
          },
        },
        { kind: 'result', id: 'r' },
      ],
    })];
    const ctx = setup(chapters);
    ctx.coordinator.start(PROFILE, 'act1-ch01');
    expect(ctx.coordinator.choose(PROFILE, { runId: 'run-1', expectedStepIndex: 0, choiceId: 'greet', optionId: 'nope' })).toMatchObject({ ok: false, code: 'action-rejected' });
    expect(ctx.coordinator.choose(PROFILE, { runId: 'run-1', expectedStepIndex: 0, choiceId: 'greet', optionId: 'warm' })).toEqual({ ok: true, value: undefined });
    expect(ctx.coordinator.choose(PROFILE, { runId: 'run-1', expectedStepIndex: 1, choiceId: 'greet', optionId: 'warm' })).toMatchObject({ ok: false, code: 'stale-state' });
    ctx.coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    ctx.coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' });
    expect(ctx.repository.flags.get(PROFILE)).toEqual({ 'choice:act1-ch01:greet': 'warm' });
    expect(ctx.repository.completions).toEqual([{ chapterId: 'act1-ch01', grade: 'B' }]);
  });
});

describe('drill set flow', () => {
  it('serves generated drills, grades server-side, re-serves wrong slots, then finishes the chapter with rewards', () => {
    const ctx = setup();
    const { coordinator, repository, rewards, latest } = ctx;
    coordinator.start(PROFILE, 'act1-ch01');
    // fixture: scene(0) lesson(1) drill-set(2 — rank-who-wins per-run, pos-name fixed 7) practice(3) sparring(4) result(5)
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' });
    let view = latest();
    expect(view).toMatchObject({ stepIndex: 2, stepKind: 'drill-set', phase: 'drill' });
    expect(view.drill).toMatchObject({ setId: 'act1-ch01:drills', index: 0, total: 2, streak: 0, hint: null, lastResult: null });
    // 공개 인스턴스에는 정답·해설·힌트 본문이 없다 (drill.correct는 정답 '개수' 카운터)
    expect(JSON.stringify(view.drill!.instance)).not.toMatch(/correct|explanation|"hint"/i);
    expect(view.drill!.instance.templateId).toBe('rank-who-wins');

    // 답 제출 전엔 advance 불가
    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' })).toMatchObject({ ok: false, code: 'action-rejected' });
    // 잘못된 커서
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'act1-ch01:drills', index: 1, action: 'hint' })).toMatchObject({ ok: false, code: 'stale-state' });

    // 힌트 → hintsUsed 1, 같은 문항 재요청은 카운트 안 됨
    const hint = coordinator.drill(PROFILE, { runId: 'run-1', setId: 'act1-ch01:drills', index: 0, action: 'hint' });
    expect(hint.ok).toBe(true);
    expect(latest().drill).toMatchObject({ hintsUsed: 1, hint: expect.any(String) });
    coordinator.drill(PROFILE, { runId: 'run-1', setId: 'act1-ch01:drills', index: 0, action: 'hint' });
    expect(latest().drill!.hintsUsed).toBe(1);

    // 첫 문항 오답 → 큐는 불변(total 2), 오답 슬롯만 기록, 복습 노트 +1, 시도 기록(attempt 0)
    const wrong = answerCurrent(ctx, false);
    expect(wrong.ok && wrong.value.action === 'answer' && wrong.value.result.correct).toBe(false);
    view = latest();
    expect(view.drill).toMatchObject({ index: 0, total: 2, retry: null, retryOffer: null, wrongQueue: 1, streak: 0, answered: 1, correct: 0 });
    expect(view.drill!.lastResult).toMatchObject({ correct: false, hintsUsed: 1 });
    expect(view.drill!.lastResult!.explanation.speaker).toBe('miyako');
    expect(repository.attempts).toHaveLength(1);
    expect(repository.attempts[0]).toMatchObject({ templateId: 'rank-who-wins', context: 'chapter', chapterId: 'act1-ch01', runId: 'run-1', correct: false, hintsUsed: 1, attempt: 0 });
    expect(repository.notes.size).toBe(1);
    // 이미 답한 문항 재제출 거절
    expect(answerCurrent(ctx, true)).toMatchObject({ ok: false, code: 'action-rejected' });

    // 다음 문항(pos-name, fixed seed 7) 정답 → streak 1
    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' }).ok).toBe(true);
    expect(latest().drill).toMatchObject({ index: 1, total: 2, instance: { templateId: 'pos-name', seed: 7 }, hint: null, lastResult: null });
    expect(answerCurrent(ctx, true).ok).toBe(true);
    expect(latest().drill).toMatchObject({ streak: 1, correct: 1, answered: 2 });

    // 첫 패스 끝 → 재출제 오퍼(오답 1문). 오퍼 중 advance는 거절, retry로 새 seed 재출제 패스
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    view = latest();
    // 오퍼 커서 = total(2), 재출제 첫 문항 커서 = total+1(3) — 단조 증가·서로 다른 값
    expect(view.drill).toMatchObject({ index: 2, total: 2, retryOffer: { count: 1 }, retry: null, wrongQueue: 1 });
    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' })).toMatchObject({ ok: false, code: 'action-rejected' });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'act1-ch01:drills', index: 1, action: 'retry' })).toMatchObject({ ok: false, code: 'stale-state' });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'act1-ch01:drills', index: 2, action: 'retry' })).toEqual({ ok: true, value: { action: 'retry', count: 1 } });
    view = latest();
    expect(view.drill).toMatchObject({ index: 3, total: 2, retry: { index: 0, total: 1 }, retryOffer: null, wrongQueue: 0 });
    expect(view.drill!.instance.templateId).toBe('rank-who-wins');
    expect(view.drill!.instance.seed).not.toBe(repository.attempts[0].seed);
    // 재출제 힌트는 S 판정(hintsUsed)에 안 센다
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'act1-ch01:drills', index: 3, action: 'hint' }).ok).toBe(true);
    expect(latest().drill!.hintsUsed).toBe(1);
    // 재출제 정답 → 노트는 갱신 대상 아님(attempt>0), 0.5점
    expect(answerCurrent(ctx, true).ok).toBe(true);
    expect(repository.notes.size).toBe(1);
    expect(repository.attempts[2]).toMatchObject({ attempt: 1, correct: true });

    // 세트 완료 → 라이브 스텝 스킵 → result 대기
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    view = latest();
    expect(view).toMatchObject({ stepIndex: 5, stepKind: 'result', phase: 'result', drill: null });

    // 결산: 첫 완주 보상(파트너 +30,000·도장 100,000+등급 보너스), 복습 노트 1, 다음 챕터
    // 카탈로그 보상 포트: reconcile이 칭호+CG+500칩을 새로 지급하고, 인연은 사쿠라 L4→L5(씬 「벚꽃 아래서」 해금)
    rewards.pending = { granted: [rewardItem('story-title-white-belt'), rewardItem('story-cg-act1-belt-white')], chips: 500 };
    rewards.transitions = [{ characterId: 'sakura', previousLevel: 4, nextLevel: 5 }];
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 5, target: 'next' });
    view = latest();
    expect(view.phase).toBe('ended');
    expect(view.result).toMatchObject({
      chapterId: 'act1-ch01', passed: true,
      drill: { answered: 3, correct: 2, bestStreak: 2, hintsUsed: 1, slots: 2, finalCorrect: 2, perfect: false, retrySkipped: false },
      rewards: {
        firstClear: true,
        affinity: [{ characterId: 'sakura', milli: 30_000, levelBefore: 4, levelAfter: 5 }],
        // 호환용 badgeId = 새로 지급된 첫 칭호 id (챕터 데이터의 'white-belt'보다 우선)
        badgeId: 'story-title-white-belt',
        items: [{ id: 'story-title-white-belt', kind: 'title' }, { id: 'story-cg-act1-belt-white', kind: 'cg' }],
        chips: 500,
        cutscene: { id: 'story-cg-act1-belt-white', kind: 'belt', characterId: 'miyako', art: '/assets/story/cg/act1-belt-white.webp' },
        unlockedScenes: [{ id: 'sakura-lv5', characterId: 'sakura', level: 5, title: '벚꽃 아래서', art: '/assets/characters/sakura/scene-lv5.webp' }],
      },
      reviewNotesAdded: 1,
      nextChapterId: 'act1-ch02',
      // Ch1만으로는 1막이 끝나지 않는다 — 승급 없음
      beltAwarded: null,
    });
    // 점수: 슬롯0 재출제 정답 0.5 + 슬롯1 정답 1 = 0.75 → A (힌트 1)
    expect(view.result!.grade).toBe('A');
    expect(view.result!.rewards.dojoXpMilli).toBe(120_000);
    expect(repository.completions).toEqual([{ chapterId: 'act1-ch01', grade: 'A' }]);
    expect(rewards.chapters).toHaveLength(1);
    expect(rewards.chapters[0]).toMatchObject({ profileId: PROFILE, chapterId: 'act1-ch01', runId: 'run-1', firstClear: true, grade: 'A', dojoXpMilli: 120_000 });
    // reconcile은 completeChapter 뒤 한 번(결산) — 「다음 보상」은 이 챕터 S + 1막 완주의 미획득 아이템(칩 제외, 최대 3)
    expect(rewards.reconciles).toEqual([{ profileId: PROFILE, now: expect.any(Number) }]);
    expect(view.result!.rewards.next!.map(item => [item.id, item.granted])).toEqual([
      ['story-cardback-dojo-crest', false], ['story-felt-yellow-belt', false], ['story-cg-act1-belt-yellow', false],
    ]);
    // 진행도 조회는 미리보기(영수증 기준 granted) + 자기 치유 reconcile
    const progress = coordinator.getProgress(PROFILE);
    expect(progress.rewards!.filter(item => item.granted).map(item => item.id)).toEqual(['story-title-white-belt', 'story-cg-act1-belt-white']);
    expect(rewards.reconciles).toHaveLength(2);
    expect(coordinator.getActiveRun(PROFILE)).toBeNull();
    expect(coordinator.getProgress(PROFILE).chapters[0]).toMatchObject({ completions: 1, bestGrade: 'A' });
  });

  it('replays grant replay XP only, and a slot missed again in the retry pass is retired (one retry round by default)', () => {
    const ctx = setup([makeChapter({ steps: [
      { kind: 'drill-set', id: 'd', title: 't', teacher: 'miyako', drills: [{ templateId: 'pos-name', seedPolicy: 'fixed', fixedSeed: 3 }], hintPenalty: 0.5 },
      { kind: 'result', id: 'r' },
    ] })]);
    const { coordinator, repository, rewards, latest } = ctx;
    repository.complete(PROFILE, 'act1-ch01');
    coordinator.start(PROFILE, 'act1-ch01');
    expect(latest().phase).toBe('drill');
    answerCurrent(ctx, false);
    expect(latest().drill).toMatchObject({ total: 1, index: 0, wrongQueue: 1 });
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    expect(latest().drill).toMatchObject({ total: 1, index: 1, retryOffer: { count: 1 } });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'd', index: 1, action: 'retry' }).ok).toBe(true);
    expect(latest().drill).toMatchObject({ total: 1, index: 2, retry: { index: 0, total: 1 }, wrongQueue: 0 });
    answerCurrent(ctx, false);
    // 재출제에서도 오답: 라운드 상한(1) 도달 → 두 번째 오퍼 없이 세트 종료 (워스트 슬롯×2)
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    expect(latest().phase).toBe('result');
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' });
    const result = latest().result!;
    expect(result).toMatchObject({ passed: true, grade: 'B', drill: { slots: 1, finalCorrect: 0, answered: 2, retrySkipped: false }, rewards: { firstClear: false, affinity: [], badgeId: null, dojoXpMilli: 20_000 } });
    expect(repository.attempts.map(a => a.attempt)).toEqual([0, 1]);
    expect(rewards.chapters[0]).toMatchObject({ firstClear: false, dojoXpMilli: 20_000 });
  });

  it('skip-retry ends the set at once, keeps first-pass notes, marks retrySkipped; retry commands outside the offer are rejected', () => {
    const ctx = setup([makeChapter({ steps: [
      { kind: 'drill-set', id: 'd', title: 't', teacher: 'miyako', drills: [{ templateId: 'pos-name', seedPolicy: 'fixed', fixedSeed: 3 }, { templateId: 'pos-name', seedPolicy: 'fixed', fixedSeed: 4 }], hintPenalty: 0.5 },
      { kind: 'result', id: 'r' },
    ] })]);
    const { coordinator, repository, latest } = ctx;
    coordinator.start(PROFILE, 'act1-ch01');
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'd', index: 0, action: 'skip-retry' })).toMatchObject({ ok: false, code: 'action-rejected' });
    answerCurrent(ctx, false);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    answerCurrent(ctx, true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    expect(latest().drill).toMatchObject({ index: 2, total: 2, retryOffer: { count: 1 } });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'd', index: 2, action: 'skip-retry' })).toEqual({ ok: true, value: { action: 'skip-retry', skipped: 1 } });
    expect(latest().phase).toBe('result');
    expect(repository.notes.size).toBe(1);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' });
    expect(latest().result).toMatchObject({ passed: true, drill: { slots: 2, finalCorrect: 1, answered: 2, retrySkipped: true, perfect: false }, reviewNotesAdded: 1 });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'd', index: 2, action: 'retry' })).toMatchObject({ ok: false, code: 'story-no-run' });
  });

  it('a perfect first pass (no misses, no hints) persists badge:perfect-set with the chapter flags', () => {
    const ctx = setup();
    const { coordinator, repository, latest } = ctx;
    coordinator.start(PROFILE, 'act1-ch01');
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' });
    expect(latest().phase).toBe('drill');
    answerCurrent(ctx, true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    answerCurrent(ctx, true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    expect(latest()).toMatchObject({ phase: 'result', stepIndex: 5 });
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 5, target: 'next' });
    expect(latest().result).toMatchObject({ passed: true, grade: 'S', drill: { perfect: true, slots: 2, finalCorrect: 2 } });
    expect(repository.getFlags(PROFILE)).toMatchObject({ 'badge:perfect-set': '1' });
  });
});

describe('exam mode (실력 확인)', () => {
  it('skips scene/lesson/live steps, rejects hints, and records completion + first-clear rewards at ≥ 0.85', () => {
    const ctx = setup();
    const { coordinator, rewards, latest } = ctx;
    expect(coordinator.start(PROFILE, 'act1-ch01', 'exam')).toEqual({ ok: true, value: { runId: 'run-1' } });
    let view = latest();
    // 픽스처: [scene, lesson, drill-set, practice, sparring, result] → 바로 드릴 세트(2)로
    expect(view).toMatchObject({ mode: 'exam', stepIndex: 2, stepKind: 'drill-set', phase: 'drill' });
    expect(coordinator.getProgress(PROFILE).activeRun).toMatchObject({ chapterId: 'act1-ch01', mode: 'exam' });

    const drill = view.drill!;
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: drill.setId, index: drill.index, action: 'hint' }))
      .toMatchObject({ ok: false, code: 'action-rejected' });

    expect(answerCurrent(ctx, true).ok).toBe(true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    expect(answerCurrent(ctx, true).ok).toBe(true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    view = latest();
    // 라이브 스텝은 exam이 건너뛴다 → 결산 대기
    expect(view).toMatchObject({ stepIndex: 5, stepKind: 'result', phase: 'result' });
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 5, target: 'next' });
    view = latest();
    expect(view.phase).toBe('ended');
    expect(view.result).toMatchObject({ mode: 'exam', passed: true, grade: 'S', live: null, rewards: { firstClear: true } });
    expect(coordinator.getProgress(PROFILE).chapters[0]).toMatchObject({ chapterId: 'act1-ch01', completions: 1, bestGrade: 'S' });
    expect(rewards.chapters[0]).toMatchObject({ chapterId: 'act1-ch01', firstClear: true });

    // 완료한 챕터의 실력 확인은 거절 — [다시](full)로만
    expect(coordinator.start(PROFILE, 'act1-ch01', 'exam')).toMatchObject({ ok: false, code: 'action-rejected' });
    expect(coordinator.start(PROFILE, 'act1-ch01', 'full').ok).toBe(true);
  });

  it('fails below 0.85 without recording completion or rewards, result keeps mode for the [수업 듣기] CTA', () => {
    const ctx = setup();
    const { coordinator, rewards, latest } = ctx;
    expect(coordinator.start(PROFILE, 'act1-ch01', 'exam').ok).toBe(true);
    // 슬롯0 오답(재출제 정답 0.5) + 슬롯1 정답 1 = 0.75 < 0.85 — 실력 확인에도 재출제 오퍼 1회는 열린다
    expect(answerCurrent(ctx, false).ok).toBe(true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    expect(answerCurrent(ctx, true).ok).toBe(true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    expect(latest().drill).toMatchObject({ index: 2, retryOffer: { count: 1 } });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 'act1-ch01:drills', index: 2, action: 'retry' }).ok).toBe(true);
    expect(answerCurrent(ctx, true).ok).toBe(true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 2, target: 'next' });
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 5, target: 'next' });
    const view = latest();
    expect(view.phase).toBe('ended');
    expect(view.result).toMatchObject({ mode: 'exam', passed: false, rewards: { firstClear: false, dojoXpMilli: 0, affinity: [] } });
    expect(coordinator.getProgress(PROFILE).chapters[0]).toMatchObject({ chapterId: 'act1-ch01', completions: 0, attempts: 1 });
    expect(rewards.chapters).toHaveLength(0);
  });
});

describe('daily drills', () => {
  it('requires one completed chapter, serves due review notes first, records daily attempts, rewards the teacher once per day', () => {
    const ctx = setup();
    const { coordinator, repository, rewards, latest, tick } = ctx;
    expect(coordinator.startDaily(PROFILE)).toMatchObject({ ok: false, code: 'story-locked' });
    repository.complete(PROFILE, 'act1-ch01');
    repository.notes.set('pos-name:11', { templateId: 'pos-name', seed: 11, box: 1, dueAt: NOW - 1 });

    expect(coordinator.startDaily(PROFILE)).toEqual({ ok: true, value: { runId: 'run-1' } });
    let view = latest();
    expect(view).toMatchObject({ chapterId: DAILY_CHAPTER_ID, phase: 'drill', stepCount: 2 });
    expect(view.drill).toMatchObject({ total: 3, index: 0, instance: { templateId: 'pos-name', seed: 11 } });
    expect(coordinator.startDaily(PROFILE)).toMatchObject({ ok: false, code: 'story-busy' });

    for (let index = 0; index < 3; index++) {
      expect(answerCurrent(ctx, true).ok).toBe(true);
      tick(1000);
      coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    }
    view = latest();
    expect(view.phase).toBe('result');
    expect(repository.attempts.every(a => a.context === 'daily' && a.chapterId === null)).toBe(true);
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' });
    view = latest();
    expect(view.phase).toBe('ended');
    expect(view.result).toMatchObject({ chapterId: DAILY_CHAPTER_ID, passed: true, rewards: { affinity: [{ characterId: 'sakura', milli: 5_000 }] } });
    expect(rewards.dailies).toEqual([{ profileId: PROFILE, kstDate: '2026-09-02', teacherId: 'sakura', completedAt: expect.any(Number) }]);
    // 데일리 칩 100은 인연과 같은 조건(첫 완료)에서만, 결산 DTO chips에 합산 — 칭호 reconcile도 한 번 돈다
    expect(rewards.dailyChips).toEqual([{ profileId: PROFILE, kstDate: '2026-09-02' }]);
    expect(view.result!.rewards).toMatchObject({ chips: 100, items: [], cutscene: null, next: [] });
    expect(rewards.reconciles).toEqual([{ profileId: PROFILE, now: expect.any(Number) }]);
    expect(repository.completions).toEqual([{ chapterId: 'act1-ch01', grade: 'B' }]); // 데일리는 챕터 완료 아님
    expect(coordinator.getProgress(PROFILE).daily).toMatchObject({ done: 3, available: true });
    expect(coordinator.startDaily(PROFILE)).toMatchObject({ ok: false, code: 'action-rejected' });
  });

  it('counts only first attempts toward the daily total — retries never consume the day', () => {
    const ctx = setup();
    const { coordinator, repository, rewards, latest } = ctx;
    repository.complete(PROFILE, 'act1-ch01');
    expect(coordinator.startDaily(PROFILE).ok).toBe(true);
    for (let index = 0; index < 3; index++) {
      expect(answerCurrent(ctx, false).ok).toBe(true);
      coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    }
    let view = latest();
    expect(view.drill).toMatchObject({ total: 3, retryOffer: { count: 3 } });
    expect(coordinator.getProgress(PROFILE).daily).toMatchObject({ done: 3 });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: view.drill!.setId, index: view.drill!.index, action: 'retry' }).ok).toBe(true);
    for (let index = 0; index < 3; index++) {
      expect(latest().drill).toMatchObject({ total: 3, retry: { index, total: 3 } });
      expect(answerCurrent(ctx, true).ok).toBe(true);
      coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' });
    }
    view = latest();
    expect(view.phase).toBe('result');
    coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' });
    expect(latest().result).toMatchObject({ chapterId: DAILY_CHAPTER_ID, passed: true, drill: { slots: 3, answered: 6, finalCorrect: 3, perfect: false } });
    expect(repository.attempts).toHaveLength(6);
    expect(repository.attempts.map(a => a.attempt)).toEqual([0, 0, 0, 1, 1, 1]);
    // 재출제 3제출은 '오늘의 3문'에 안 센다 — 인연은 슬롯 3개를 다 푼 뒤 1회
    expect(coordinator.getProgress(PROFILE).daily).toMatchObject({ done: 3 });
    expect(rewards.dailies).toHaveLength(1);
  });
});

describe('StoryRunCoordinator misc', () => {
  it('rejects stale runId/stepIndex and commands without a run; abandon/resend/clearProfile', () => {
    const { coordinator, emitted } = setup();
    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' })).toMatchObject({ ok: false, code: 'story-no-run' });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 's', index: 0, action: 'hint' })).toMatchObject({ ok: false, code: 'story-no-run' });
    coordinator.start(PROFILE, 'act1-ch01');
    expect(coordinator.advance(PROFILE, { runId: 'run-9', expectedStepIndex: 0, target: 'next' })).toMatchObject({ ok: false, code: 'stale-state' });
    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' })).toMatchObject({ ok: false, code: 'stale-state' });
    expect(coordinator.drill(PROFILE, { runId: 'run-1', setId: 's', index: 0, action: 'hint' })).toMatchObject({ ok: false, code: 'stale-state' });
    expect(coordinator.getActiveRun(PROFILE)?.stepIndex).toBe(0);

    expect(coordinator.resend(PROFILE)).toBe(true);
    expect(emitted.at(-1)!.view).toEqual(emitted[0].view);
    expect(coordinator.abandon(PROFILE, 'run-9')).toMatchObject({ ok: false, code: 'stale-state' });
    expect(coordinator.abandon(PROFILE, 'run-1')).toEqual({ ok: true, value: undefined });
    expect(emitted.at(-1)!.view).toMatchObject({ phase: 'ended', result: null });
    expect(coordinator.abandon(PROFILE, 'run-1')).toMatchObject({ ok: false, code: 'story-no-run' });
    expect(coordinator.start(PROFILE, 'act1-ch01')).toEqual({ ok: true, value: { runId: 'run-2' } });
    coordinator.clearProfile(PROFILE);
    expect(coordinator.getActiveRun(PROFILE)).toBeNull();
    expect(coordinator.resend(PROFILE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 라이브 스텝 (Phase 1b) — 어댑터 포트 계약

interface FakeLiveState {
  profileId: string;
  runId: string;
  stepIndex: number;
  held: boolean;
  roomId: string | null;
}

function makeFakeAdapter(options: { abandonOk?: () => boolean } = {}) {
  let events: StoryLiveEvents | null = null;
  const enters: LiveEnterInput[] = [];
  const resumes: string[] = [];
  let state: FakeLiveState | null = null;
  const adapter: StoryLiveAdapterPort = {
    bindEvents: bound => { events = bound; },
    enter: input => {
      enters.push(input);
      state = { profileId: input.profileId, runId: input.runId, stepIndex: input.stepIndex, held: false, roomId: `room-${input.stepIndex}` };
      return 'entered';
    },
    resume: (profileId, runId) => {
      if (!state || state.runId !== runId) return { ok: false, code: 'stale-state', message: 'stale' };
      resumes.push(`${profileId}:${runId}`);
      state.held = false;
      return { ok: true };
    },
    abandon: () => {
      if (options.abandonOk && !options.abandonOk()) return false;
      state = null;
      return true;
    },
    phase: () => (state ? (state.held ? 'live-hold' : 'live-play') : null),
    view: () => (state
      ? {
          roomId: state.roomId,
          tag: '대결',
          hold: state.held,
          holdReason: state.held ? 'timeout' : null,
          interruptId: null,
          objectives: [],
          handsPlayed: 0,
          maxHands: 3,
          minHands: null,
          lastReview: null,
          botThoughts: [],
          pendingQuiz: null,
        }
      : null),
  };
  return {
    adapter,
    enters,
    resumes,
    hold: () => { if (state) state.held = true; events?.onLiveChanged(state!.profileId); },
    finish: (summary: LiveStepSummary) => {
      const finished = state!;
      state = null;
      events?.onStepFinished(finished.profileId, finished.runId, summary);
    },
  };
}

function liveSummary(overrides: Partial<LiveStepSummary> = {}): LiveStepSummary {
  return {
    outcome: 'done',
    tag: '대결',
    objectives: [{ id: 'played', kind: 'hands-played', label: '완주', primary: true, progress: 3, target: 3, achieved: true }],
    primaryObjectivesMet: true,
    liveScore: 1,
    handsPlayed: 3,
    netBB: 4.5,
    ...overrides,
  };
}

/** 드릴 세트까지 전부 정답으로 통과해 첫 라이브 스텝 앞에 세운다 */
function driveToLive(ctx: ReturnType<typeof setup>) {
  const started = ctx.coordinator.start(PROFILE, 'act1-ch01');
  expect(started.ok).toBe(true);
  for (let guard = 0; guard < 12; guard++) {
    const view = ctx.latest();
    if (view.phase === 'live-play' || view.phase === 'live-hold') return view;
    if (view.phase === 'drill') {
      expect(answerCurrent(ctx, true).ok).toBe(true);
    }
    const advanced = ctx.coordinator.advance(PROFILE, { runId: view.runId, expectedStepIndex: ctx.latest().stepIndex, target: 'next' });
    expect(advanced.ok).toBe(true);
  }
  throw new Error('live step not reached');
}

describe('StoryRunCoordinator live steps (adapter port)', () => {
  it('enters practice then sparring through the adapter, only resume advances, and sparring objectives decide the pass', () => {
    const ctx = setup();
    const fake = makeFakeAdapter();
    ctx.coordinator.setLiveAdapter(fake.adapter);

    const practice = driveToLive(ctx);
    expect(practice.stepKind).toBe('practice-table');
    expect(practice.phase).toBe('live-play');
    expect(practice.live?.roomId).toBe(`room-${practice.stepIndex}`);
    expect(fake.enters).toHaveLength(1);
    expect(fake.enters[0]).toMatchObject({ profileId: PROFILE, runId: practice.runId, stepIndex: practice.stepIndex, partnerId: 'sakura' });

    // 라이브 스텝은 next/skip으로 못 넘긴다 — resume만
    const next = ctx.coordinator.advance(PROFILE, { runId: practice.runId, expectedStepIndex: practice.stepIndex, target: 'next' });
    expect(next).toMatchObject({ ok: false, code: 'action-rejected' });
    fake.hold();
    expect(ctx.latest().phase).toBe('live-hold');
    expect(ctx.latest().live?.holdReason).toBe('timeout');
    const resumed = ctx.coordinator.advance(PROFILE, { runId: practice.runId, expectedStepIndex: practice.stepIndex, target: 'resume' });
    expect(resumed.ok).toBe(true);
    expect(fake.resumes).toEqual([`${PROFILE}:${practice.runId}`]);
    expect(ctx.latest().phase).toBe('live-play');

    // 연습 종료 → 스파링 진입 (새 방)
    fake.finish(liveSummary({ tag: '연습', objectives: [], primaryObjectivesMet: null, liveScore: null, handsPlayed: 1, netBB: 0 }));
    const sparring = ctx.latest();
    expect(sparring.stepKind).toBe('sparring');
    expect(sparring.stepIndex).toBe(practice.stepIndex + 1);
    expect(fake.enters).toHaveLength(2);

    // 스파링 종료(primary 미달) → 에필로그/결산까지 진행 → 통과 실패, 결산 live 요약은 스파링만
    fake.finish(liveSummary({ primaryObjectivesMet: false, objectives: [{ id: 'played', kind: 'hands-played', label: '완주', primary: true, progress: 1, target: 3, achieved: false }], handsPlayed: 1, liveScore: 0 }));
    for (let guard = 0; guard < 6 && ctx.latest().phase !== 'ended'; guard++) {
      const view = ctx.latest();
      expect(ctx.coordinator.advance(PROFILE, { runId: view.runId, expectedStepIndex: view.stepIndex, target: 'next' }).ok).toBe(true);
    }
    const ended = ctx.latest();
    expect(ended.phase).toBe('ended');
    expect(ended.result?.passed).toBe(false);
    expect(ended.result?.live).toMatchObject({ handsPlayed: 1 });
    expect(ended.result?.live?.objectives.map(o => o.id)).toEqual(['played']);
    expect(ctx.repository.listProgress(PROFILE).find(row => row.chapterId === 'act1-ch01')?.completions ?? 0).toBe(0);
  });

  it('passes and grades with the live score when sparring primary objectives are met', () => {
    const ctx = setup();
    const fake = makeFakeAdapter();
    ctx.coordinator.setLiveAdapter(fake.adapter);
    driveToLive(ctx);
    fake.finish(liveSummary({ tag: '연습', objectives: [], primaryObjectivesMet: null, liveScore: null, handsPlayed: 2, netBB: 0 }));
    fake.finish(liveSummary());
    for (let guard = 0; guard < 6 && ctx.latest().phase !== 'ended'; guard++) {
      const view = ctx.latest();
      expect(ctx.coordinator.advance(PROFILE, { runId: view.runId, expectedStepIndex: view.stepIndex, target: 'next' }).ok).toBe(true);
    }
    const ended = ctx.latest();
    expect(ended.result?.passed).toBe(true);
    expect(ended.result?.live).toEqual({ objectives: liveSummary().objectives, handsPlayed: 3, netBB: 4.5 });
    expect(ctx.repository.listProgress(PROFILE).find(row => row.chapterId === 'act1-ch01')?.completions).toBe(1);
  });

  it('keeps the run when the adapter cannot close the room yet, and abandons once it can', () => {
    let canAbandon = false;
    const ctx = setup();
    const fake = makeFakeAdapter({ abandonOk: () => canAbandon });
    ctx.coordinator.setLiveAdapter(fake.adapter);
    const live = driveToLive(ctx);
    const refused = ctx.coordinator.abandon(PROFILE, live.runId);
    expect(refused).toMatchObject({ ok: false, code: 'server-error' });
    expect(ctx.coordinator.getActiveRun(PROFILE)?.runId).toBe(live.runId);
    canAbandon = true;
    expect(ctx.coordinator.abandon(PROFILE, live.runId).ok).toBe(true);
    expect(ctx.coordinator.getActiveRun(PROFILE)).toBeNull();
    expect(ctx.latest().phase).toBe('ended');
  });

  it('skips live steps entirely when no adapter is installed (Phase 1 behaviour)', () => {
    const ctx = setup();
    const started = ctx.coordinator.start(PROFILE, 'act1-ch01');
    expect(started.ok).toBe(true);
    const kinds = new Set<string>();
    for (let guard = 0; guard < 16 && ctx.latest().phase !== 'ended'; guard++) {
      const view = ctx.latest();
      kinds.add(view.stepKind);
      if (view.phase === 'drill') expect(answerCurrent(ctx, true).ok).toBe(true);
      expect(ctx.coordinator.advance(PROFILE, { runId: view.runId, expectedStepIndex: ctx.latest().stepIndex, target: 'next' }).ok).toBe(true);
    }
    expect(kinds.has('practice-table')).toBe(false);
    expect(kinds.has('sparring')).toBe(false);
    expect(ctx.latest().result?.live).toBeNull();
  });
});
