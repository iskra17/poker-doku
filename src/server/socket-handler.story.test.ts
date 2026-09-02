import { afterEach, describe, expect, it } from 'vitest';
import type { RealtimeAck } from '../lib/realtime/protocol';
import { makeChapterChain } from '../lib/story/test-fixtures';
import type { StoryDrillAck, StoryProgressView, StoryRunView } from '../lib/story/views';
import { createSocketTestHarness } from './socket-test-harness';
import type { ConnectedTestClient, SocketTestHarness } from './socket-test-harness';

function withAck<T>(
  send: (done: (ack: RealtimeAck<T>) => void) => void,
): Promise<RealtimeAck<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ack timeout')), 1_000);
    send(ack => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function collect<T>(client: ConnectedTestClient, event: 'story-update' | 'room-lost'): T[] {
  const items: T[] = [];
  (client.socket as unknown as { on: (name: string, cb: (payload: T) => void) => void }).on(event, payload => {
    items.push(payload);
  });
  return items;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('story socket events', () => {
  let harness: SocketTestHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  async function setup() {
    harness = await createSocketTestHarness({ storyChapters: makeChapterChain() });
    const profile = await harness.createProfile();
    const client = await harness.connect('token-hero', { profileCookie: profile.cookie });
    return { harness, profile, client };
  }

  it('serves progress, starts a chapter with a story-update, and exposes the same view over the runtime', async () => {
    const { harness: h, client, profile } = await setup();
    const progress = await withAck<StoryProgressView>(done => client.socket.emit('get-story-progress', done));
    expect(progress.ok).toBe(true);
    if (!progress.ok) return;
    expect(progress.data?.chapters.map(c => [c.chapterId, c.unlocked])).toEqual([
      ['act1-ch01', true], ['act1-ch02', false], ['act1-ch03', false], ['act2-ch04', false],
    ]);
    expect(progress.data?.activeRun).toBeNull();
    expect(h.runtime.storyProgress(profile.profile.id)).toEqual(progress.data);

    const updates = collect<StoryRunView>(client, 'story-update');
    const started = await withAck<{ runId: string }>(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01' }, done));
    expect(started.ok).toBe(true);
    await sleep(20);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ chapterId: 'act1-ch01', stepIndex: 0, stepKind: 'scene', phase: 'scene' });
    expect(updates[0].context.partnerId).toBe(client.initialProgression.profile.selectedCharacterId);
    expect(h.runtime.storyProgress(profile.profile.id)?.activeRun).toMatchObject({ chapterId: 'act1-ch01', stepIndex: 0, mode: 'full' });
  });

  it('starts an exam run (mode: exam) straight at the drill set and rejects unknown modes as invalid-payload', async () => {
    const { client } = await setup();
    expect(await withAck(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01', mode: 'cheat' }, done)))
      .toMatchObject({ ok: false, code: 'invalid-payload' });
    const updates = collect<StoryRunView>(client, 'story-update');
    const started = await withAck<{ runId: string }>(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01', mode: 'exam' }, done));
    expect(started.ok).toBe(true);
    await sleep(20);
    expect(updates[0]).toMatchObject({ chapterId: 'act1-ch01', mode: 'exam', stepKind: 'drill-set', phase: 'drill' });
  });

  it('rejects malformed payloads before touching state and locked chapters with story-locked', async () => {
    const { client } = await setup();
    for (const bad of [undefined, null, 'act1-ch01', { chapterId: 'act1 ch01' }, { chapterId: 'act1-ch01', extra: 1 }]) {
      const ack = await withAck(done => client.socket.emit('start-story-chapter', bad as never, done));
      expect(ack).toMatchObject({ ok: false, code: 'invalid-payload' });
    }
    const advance = await withAck(done => client.socket.emit('story-advance', { runId: 'x', expectedStepIndex: -1 } as never, done));
    expect(advance).toMatchObject({ ok: false, code: 'invalid-payload' });
    const drill = await withAck(done => client.socket.emit('story-drill', { runId: 'r', setId: 's', index: 0, action: 'answer', answer: { kind: 'numeric', value: 'x' } } as never, done));
    expect(drill).toMatchObject({ ok: false, code: 'invalid-payload' });

    const locked = await withAck(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch02' }, done));
    expect(locked).toMatchObject({ ok: false, code: 'story-locked' });
    const unknown = await withAck(done => client.socket.emit('start-story-chapter', { chapterId: 'act9-ch99' }, done));
    expect(unknown).toMatchObject({ ok: false, code: 'story-locked' });
    const noRun = await withAck(done => client.socket.emit('story-advance', { runId: 'r', expectedStepIndex: 0 }, done));
    expect(noRun).toMatchObject({ ok: false, code: 'story-no-run' });
  });

  it('applies the storyStart rate limit (2 per 10s) after validation', async () => {
    const { client } = await setup();
    // 잠긴 챕터라도 요청 자체는 카운트된다 — 세 번째부터 rate-limited
    expect(await withAck(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch02' }, done))).toMatchObject({ code: 'story-locked' });
    expect(await withAck(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch02' }, done))).toMatchObject({ code: 'story-locked' });
    expect(await withAck(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01' }, done))).toMatchObject({ ok: false, code: 'rate-limited' });
    // 잘못된 payload는 한도를 소모하지 않는다 (검증이 리밋보다 앞)
    expect(await withAck(done => client.socket.emit('start-story-chapter', { chapterId: '' }, done))).toMatchObject({ code: 'invalid-payload' });
  });

  it('advances with stale-state protection and re-sends the view on resync instead of room-lost', async () => {
    const { client } = await setup();
    const updates = collect<StoryRunView>(client, 'story-update');
    const lost = collect<unknown>(client, 'room-lost');
    const started = await withAck<{ runId: string }>(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01' }, done));
    if (!started.ok) throw new Error('start failed');
    const runId = started.data!.runId;

    const stale = await withAck(done => client.socket.emit('story-advance', { runId, expectedStepIndex: 3 }, done));
    expect(stale).toMatchObject({ ok: false, code: 'stale-state' });
    const wrongRun = await withAck(done => client.socket.emit('story-advance', { runId: 'run-other', expectedStepIndex: 0 }, done));
    expect(wrongRun).toMatchObject({ ok: false, code: 'stale-state' });

    const ok = await withAck(done => client.socket.emit('story-advance', { runId, expectedStepIndex: 0 }, done));
    expect(ok).toEqual({ ok: true });
    await sleep(20);
    expect(updates.at(-1)).toMatchObject({ stepIndex: 1, stepKind: 'lesson' });

    // 방 없는 런의 resync → story-update 재전송, room-lost 없음
    const before = updates.length;
    const resync = await withAck(done => client.socket.emit('resync', done));
    expect(resync).toEqual({ ok: true });
    await sleep(20);
    expect(updates.length).toBe(before + 1);
    expect(updates.at(-1)).toEqual(updates.at(-2));
    expect(lost).toHaveLength(0);
  });

  it('choice/drill/daily reach the coordinator after validation; quiz is still a stub', async () => {
    const { client } = await setup();
    expect(await withAck(done => client.socket.emit('story-choice', { runId: 'r', expectedStepIndex: 0, choiceId: 'c', optionId: 'o' }, done)))
      .toMatchObject({ ok: false, code: 'story-no-run' });
    expect(await withAck(done => client.socket.emit('story-drill', { runId: 'r', setId: 's', index: 0, action: 'hint' }, done)))
      .toMatchObject({ ok: false, code: 'story-no-run' });
    expect(await withAck(done => client.socket.emit('story-quiz', { runId: 'r', quizId: 'q', optionIndex: 0 }, done)))
      .toMatchObject({ ok: false, code: 'action-rejected' });
    // Ch1 미완료 → 오늘의 수련 잠김
    expect(await withAck(done => client.socket.emit('story-daily', done)))
      .toMatchObject({ ok: false, code: 'story-locked' });
  });

  it('answers a drill end-to-end: story-update carries a public instance, the ack carries the graded result', async () => {
    const { client } = await setup();
    const updates = collect<StoryRunView>(client, 'story-update');
    const started = await withAck<{ runId: string }>(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01' }, done));
    if (!started.ok) throw new Error('start failed');
    const runId = started.data!.runId;
    // scene → lesson → drill-set (fixture: rank-who-wins, pos-name)
    expect(await withAck(done => client.socket.emit('story-advance', { runId, expectedStepIndex: 0 }, done))).toEqual({ ok: true });
    expect(await withAck(done => client.socket.emit('story-advance', { runId, expectedStepIndex: 1 }, done))).toEqual({ ok: true });
    await sleep(20);
    const drillView = updates.at(-1)!;
    expect(drillView).toMatchObject({ phase: 'drill', stepKind: 'drill-set' });
    expect(drillView.drill).toMatchObject({ index: 0, total: 2, hint: null });
    expect(JSON.stringify(drillView.drill!.instance)).not.toMatch(/correct|explanation/i);

    const hint = await withAck<StoryDrillAck>(done => client.socket.emit('story-drill', { runId, setId: drillView.drill!.setId, index: 0, action: 'hint' }, done));
    expect(hint.ok && hint.data?.action).toBe('hint');

    const answer = await withAck<StoryDrillAck>(done => client.socket.emit('story-drill', {
      runId, setId: drillView.drill!.setId, index: 0, action: 'answer', answer: { kind: 'multiple-choice', index: 0 }, elapsedMs: 900,
    }, done));
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const data = answer.data;
    if (!data || data.action !== 'answer') throw new Error('expected an answer ack');
    expect(typeof data.result.correct).toBe('boolean');
    expect(data.result.explanation.speaker).toBe('miyako');
    await sleep(20);
    expect(updates.at(-1)!.drill?.lastResult?.correct).toBe(data.result.correct);
    // 같은 문항 재제출은 거절
    expect(await withAck(done => client.socket.emit('story-drill', {
      runId, setId: drillView.drill!.setId, index: 0, action: 'answer', answer: { kind: 'multiple-choice', index: 1 },
    }, done))).toMatchObject({ ok: false, code: 'action-rejected' });
  });

  it('abandon ends the run, and a replaced socket no longer controls it', async () => {
    const { harness: h, client, profile } = await setup();
    const started = await withAck<{ runId: string }>(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01' }, done));
    if (!started.ok) throw new Error('start failed');
    const runId = started.data!.runId;

    // 같은 세션 토큰의 새 소켓이 소유권을 가져간다 → 구 소켓은 session-replaced 후 서버가 끊는다
    const replacedEvents: unknown[] = [];
    (client.socket as unknown as { on: (name: string, cb: (payload: unknown) => void) => void })
      .on('session-replaced', payload => replacedEvents.push(payload));
    const replacement = await h.connect('token-hero', { profileCookie: profile.cookie });
    await sleep(20);
    expect(replacedEvents).toHaveLength(1);
    expect(client.socket.connected).toBe(false);

    // 새 소켓은 접속 시 진행 중 런을 복원받았고, 계속 제어할 수 있다
    const view = await withAck<StoryProgressView>(done => replacement.socket.emit('get-story-progress', done));
    expect(view.ok && view.data?.activeRun?.runId).toBe(runId);
    const ended = collect<StoryRunView>(replacement, 'story-update');
    const abandoned = await withAck(done => replacement.socket.emit('abandon-story', { runId }, done));
    expect(abandoned).toEqual({ ok: true });
    await sleep(20);
    expect(ended.at(-1)).toMatchObject({ runId, phase: 'ended' });
    expect(h.runtime.storyProgress(profile.profile.id)?.activeRun).toBeNull();
    expect(await withAck(done => replacement.socket.emit('abandon-story', { runId }, done))).toMatchObject({ ok: false, code: 'story-no-run' });
  });
});
