import { describe, expect, it } from 'vitest';
import { makeChapter, makeChapterChain } from '@/lib/story/test-fixtures';
import type { Chapter } from '@/lib/story/types';
import type { StoryRunView } from '@/lib/story/views';
import {
  kstDay,
  StoryRunCoordinator,
  type StoryProgressRecord,
  type StoryRepositoryPort,
} from './story-run-coordinator';

const PROFILE = 'profile-hero';
const NOW = Date.UTC(2026, 8, 2, 3, 0, 0); // 2026-09-02 12:00 KST

class FakeRepository implements StoryRepositoryPort {
  progress = new Map<string, StoryProgressRecord[]>();
  flags = new Map<string, Record<string, string>>();
  dailyAttempts = new Map<string, number[]>();
  notes = new Map<string, number>();
  attemptStarts: Array<{ profileId: string; chapterId: string; now: number }> = [];

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

  complete(profileId: string, chapterId: string): void {
    const rows = this.progress.get(profileId) ?? [];
    const row = rows.find(r => r.chapterId === chapterId);
    if (row) row.completions += 1;
    else rows.push({ chapterId, attempts: 1, completions: 1, bestGrade: 'B', firstCompletedAt: NOW, lastPlayedAt: NOW });
    this.progress.set(profileId, rows);
  }

  getFlags(profileId: string): Record<string, string> {
    return { ...(this.flags.get(profileId) ?? {}) };
  }

  getDrillStats(): { total: number; correct: number; byCategory: Record<string, { total: number; correct: number }> } {
    return { total: 4, correct: 3, byCategory: { 'pot-odds': { total: 4, correct: 3 } } };
  }

  countNotes(profileId: string): number {
    return this.notes.get(profileId) ?? 0;
  }

  countAttemptsBetween(profileId: string, fromMs: number, toMsExclusive: number): number {
    return (this.dailyAttempts.get(profileId) ?? []).filter(at => at >= fromMs && at < toMsExclusive).length;
  }
}

function setup(chapters: Chapter[] = makeChapterChain(), partner: 'sakura' | null = 'sakura') {
  const repository = new FakeRepository();
  const emitted: Array<{ profileId: string; view: StoryRunView }> = [];
  let counter = 0;
  const coordinator = new StoryRunCoordinator({
    repository,
    chapters,
    now: () => NOW,
    emit: (profileId, view) => emitted.push({ profileId, view }),
    partnerOf: () => partner,
    runIdFactory: () => `run-${++counter}`,
  });
  return { repository, coordinator, emitted };
}

describe('kstDay', () => {
  it('uses KST midnight boundaries', () => {
    const day = kstDay(NOW);
    expect(day.date).toBe('2026-09-02');
    expect(day.fromMs).toBe(Date.UTC(2026, 8, 1, 15, 0, 0));
    expect(day.toMsExclusive).toBe(Date.UTC(2026, 8, 2, 15, 0, 0));
    // KST 00:30 은 UTC 전날 15:30 — 같은 KST 날짜
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
    expect(before.drillStats.total).toBe(4);

    repository.complete(PROFILE, 'act1-ch01');
    repository.dailyAttempts.set(PROFILE, [NOW - 1000, NOW - 2000, NOW - 3 * 24 * 3600_000]);
    repository.notes.set(PROFILE, 2);
    repository.flags.set(PROFILE, { 'choice:act1-ch01:greet': 'warm' });
    const after = coordinator.getProgress(PROFILE);
    expect(after.chapters[1]).toMatchObject({ chapterId: 'act1-ch02', unlocked: true });
    expect(after.nextChapterId).toBe('act1-ch02');
    expect(after.daily).toMatchObject({ done: 2, available: true });
    expect(after.reviewQueue).toBe(2);
    expect(after.flags).toEqual({ 'choice:act1-ch01:greet': 'warm' });
  });
});

describe('StoryRunCoordinator.start', () => {
  it('rejects locked or unknown chapters and records an attempt on success', () => {
    const { repository, coordinator, emitted } = setup();
    expect(coordinator.start(PROFILE, 'act1-ch02')).toMatchObject({ ok: false, code: 'story-locked' });
    expect(coordinator.start(PROFILE, 'act9-ch99')).toMatchObject({ ok: false, code: 'story-locked' });
    expect(repository.attemptStarts).toHaveLength(0);

    const started = coordinator.start(PROFILE, 'act1-ch01');
    expect(started).toEqual({ ok: true, value: { runId: 'run-1' } });
    expect(repository.attemptStarts).toEqual([{ profileId: PROFILE, chapterId: 'act1-ch01', now: NOW }]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].view).toMatchObject({
      runId: 'run-1',
      chapterId: 'act1-ch01',
      stepIndex: 0,
      stepKind: 'scene',
      phase: 'scene',
      context: { partnerId: 'sakura', teacherId: 'miyako' },
      drill: null,
      live: null,
      result: null,
    });
    expect(coordinator.getProgress(PROFILE).activeRun).toEqual({ runId: 'run-1', chapterId: 'act1-ch01', stepIndex: 0 });
  });

  it('allows only one run per profile (story-busy) but isolates profiles', () => {
    const { coordinator } = setup();
    expect(coordinator.start(PROFILE, 'act1-ch01').ok).toBe(true);
    expect(coordinator.start(PROFILE, 'act1-ch01')).toMatchObject({ ok: false, code: 'story-busy' });
    expect(coordinator.start('profile-other', 'act1-ch01').ok).toBe(true);
    expect(coordinator.stats()).toEqual({ runs: 2 });
  });

  it("resolves the 'partner' teacher to the selected partner, or miyako without one", () => {
    const chapters = [makeChapter({ teacher: 'partner' })];
    const withPartner = setup(chapters, 'sakura');
    withPartner.coordinator.start(PROFILE, 'act1-ch01');
    expect(withPartner.emitted[0].view.context.teacherId).toBe('sakura');

    const noPartner = setup(chapters, null);
    noPartner.coordinator.start(PROFILE, 'act1-ch01');
    expect(noPartner.emitted[0].view.context).toEqual({ partnerId: null, teacherId: 'miyako' });
  });
});

describe('StoryRunCoordinator.advance / abandon / resend', () => {
  it('walks scene → lesson, skips engine-less steps, and finishes at result', () => {
    const { coordinator, emitted } = setup();
    coordinator.start(PROFILE, 'act1-ch01');
    // fixture steps: scene(0) lesson(1) drill-set(2) practice(3) sparring(4) result(5)
    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' })).toEqual({ ok: true, value: undefined });
    expect(emitted.at(-1)?.view).toMatchObject({ stepIndex: 1, stepKind: 'lesson', phase: 'lesson' });

    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'skip' }).ok).toBe(true);
    // 드릴 엔진·라이브 어댑터 미주입 → 2~4 스킵, result 대기
    expect(emitted.at(-1)?.view).toMatchObject({ stepIndex: 5, stepKind: 'result', phase: 'result', result: null });

    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 5, target: 'next' }).ok).toBe(true);
    const final = emitted.at(-1)?.view;
    expect(final).toMatchObject({ phase: 'ended', stepIndex: 5 });
    expect(final?.result).toMatchObject({ chapterId: 'act1-ch01', passed: true, grade: 'B', nextChapterId: 'act1-ch02' });
    expect(coordinator.getActiveRun(PROFILE)).toBeNull();
    expect(coordinator.stats()).toEqual({ runs: 0 });
    expect(coordinator.resend(PROFILE)).toBe(false);
  });

  it('rejects stale runId/stepIndex and commands without a run', () => {
    const { coordinator } = setup();
    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 0, target: 'next' })).toMatchObject({ ok: false, code: 'story-no-run' });
    coordinator.start(PROFILE, 'act1-ch01');
    expect(coordinator.advance(PROFILE, { runId: 'run-9', expectedStepIndex: 0, target: 'next' })).toMatchObject({ ok: false, code: 'stale-state' });
    expect(coordinator.advance(PROFILE, { runId: 'run-1', expectedStepIndex: 1, target: 'next' })).toMatchObject({ ok: false, code: 'stale-state' });
    // 거절된 명령은 상태를 바꾸지 않는다
    expect(coordinator.getActiveRun(PROFILE)?.stepIndex).toBe(0);
  });

  it('resend re-emits the current view; abandon ends the run and frees the profile', () => {
    const { coordinator, emitted } = setup();
    coordinator.start(PROFILE, 'act1-ch01');
    expect(coordinator.resend(PROFILE)).toBe(true);
    expect(emitted).toHaveLength(2);
    expect(emitted[1].view).toEqual(emitted[0].view);

    expect(coordinator.abandon(PROFILE, 'run-9')).toMatchObject({ ok: false, code: 'stale-state' });
    expect(coordinator.abandon(PROFILE, 'run-1')).toEqual({ ok: true, value: undefined });
    expect(emitted.at(-1)?.view.phase).toBe('ended');
    expect(coordinator.abandon(PROFILE, 'run-1')).toMatchObject({ ok: false, code: 'story-no-run' });
    expect(coordinator.start(PROFILE, 'act1-ch01')).toEqual({ ok: true, value: { runId: 'run-2' } });
  });

  it('clearProfile drops the run silently', () => {
    const { coordinator, emitted } = setup();
    coordinator.start(PROFILE, 'act1-ch01');
    coordinator.clearProfile(PROFILE);
    expect(emitted).toHaveLength(1);
    expect(coordinator.getActiveRun(PROFILE)).toBeNull();
  });
});
