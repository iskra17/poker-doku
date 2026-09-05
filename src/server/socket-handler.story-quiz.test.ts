import { afterEach, describe, expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers';
import type { RealtimeAck } from '../lib/realtime/protocol';
import { generateDrill, gradeDrill } from '../lib/story/drills/generator';
import type { DrillAnswer, DrillAnswerSpec } from '../lib/story/drills/types';
import type { StoryTeacherId } from '../lib/story/types';
import type { StoryRunView } from '../lib/story/views';
import { CH07 } from '../lib/story/chapters/act3/ch07-masquerade';
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

function collect<T>(client: ConnectedTestClient, event: 'story-update' | 'room-lost' | 'progression-update'): T[] {
  const items: T[] = [];
  (client.socket as unknown as { on: (name: string, cb: (payload: T) => void) => void }).on(event, payload => {
    items.push(payload);
  });
  return items;
}



/** 서버가 재생성할 인스턴스와 같은 seed로 정답을 만든다 (story-run-coordinator.test.ts와 같은 규약) */
function answerFor(templateId: string, seed: number, teacher: StoryTeacherId): DrillAnswer {
  const instance = generateDrill(templateId, seed, { teacher });
  const spec: DrillAnswerSpec = instance.answerSpec;
  let answer: DrillAnswer;
  switch (spec.kind) {
    case 'multiple-choice':
      answer = { kind: 'multiple-choice', index: spec.correctIndex };
      break;
    case 'numeric':
      answer = { kind: 'numeric', value: spec.correct };
      break;
    case 'action-pick':
      answer = { kind: 'action-pick', action: spec.correct[0], sizingBB: spec.sizingBB?.min };
      break;
    case 'card-pick':
      answer = { kind: 'card-pick', cards: spec.correct };
      break;
    case 'multi-select':
      answer = { kind: 'multi-select', indices: spec.correctIndices };
      break;
  }
  expect(gradeDrill(instance, answer)).toBe(true);
  return answer;
}


describe('Ch7 real socket quiz lifecycle', () => {
  let harness: SocketTestHarness | null = null;
  afterEach(async () => { vi.useRealTimers(); await harness?.close(); harness = null; });
  it.each([true, false])('runs all seven drills, twelve observation hands, four quizzes and ten play hands (pass=%s)', async passing => {
    // Unlock only: preserve all authored steps, hand counts and objectives.
    harness = await createSocketTestHarness({ storyChapters: [{ ...CH07, requires: [] }] });
    const h = harness;
    const profile = await h.createProfile();
    let client = await h.connect('ch7-session', { profileCookie: profile.cookie });
    const stranger = await h.connect('ch7-stranger');
    const updates = collect<StoryRunView>(client, 'story-update');
    vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','Date'] });
    const flush = () => new Promise<void>(resolve => setImmediate(resolve));
    const tick = async (ms = 1) => {
      // Keep transport wall-clock heartbeat outside the accelerated game clock.
      (client.socket.io.engine as unknown as { _resetPingTimeout:()=>void })._resetPingTimeout();
      (stranger.socket.io.engine as unknown as { _resetPingTimeout:()=>void })._resetPingTimeout(); await vi.advanceTimersByTimeAsync(ms); await flush(); await flush(); };
    const start = await withAck<{runId:string}>(done => client.socket.emit('start-story-chapter', { chapterId: CH07.id }, done));
    expect(start.ok).toBe(true);
    await tick();
    const runId = updates.at(-1)!.runId;
    const advance = async () => { const v = updates.at(-1)!; expect(await withAck(done => client.socket.emit('story-advance', { runId: v.runId, expectedStepIndex: v.stepIndex, ...(v.live ? {target:'resume'} : {}) }, done))).toEqual({ok:true}); await tick(600); };
    await advance(); await advance();
    for (let i = 0; i < 7; i++) {
      const v = updates.at(-1)!;
      expect(v.drill?.index).toBe(i);
      const answer = answerFor(v.drill!.instance.templateId, v.drill!.instance.seed, v.context.teacherId);
      expect((await withAck(done => client.socket.emit('story-drill', { runId, setId:v.drill!.setId, index:i, action:'answer', answer, elapsedMs:900 }, done))).ok).toBe(true);
      await tick(600); await advance();
    }
    const drive = async (until:()=>boolean) => {
      for (let elapsed = 0; elapsed < 500_000 && !until(); elapsed += 250) {
        const live = updates.at(-1)?.live;
        const room = live?.roomId ? h.runtime.roomManager.getRoom(live.roomId) : undefined;
        const state = room?.engine.state;
        const actor = state && state.activePlayerIndex >= 0 ? state.players[state.activePlayerIndex] : undefined;
        // Ordinary legal decisions through RoomManager, without skip/deck injection.
        if (actor && live && !live.hold) h.runtime.roomManager.processPlayerAction(live.roomId!, actor.id, 'fold');
        await tick(250);
      }
      expect(until()).toBe(true);
    };
    await drive(() => !!updates.at(-1)?.live?.pendingQuiz);
    expect(updates.at(-1)?.live?.handsPlayed).toBe(12);
    const firstRoom = updates.at(-1)!.live!.roomId!;
    const first = updates.at(-1)!.live!.pendingQuiz!;
    await tick(5_000);
    expect(await withAck(done => client.socket.emit('resync', done))).toEqual({ok:true});
    await tick();
    const resynced = updates.at(-1)!.live!.pendingQuiz!;
    expect(resynced).toMatchObject({quizId:first.quizId,expiresAt:first.expiresAt,number:first.number});
    // In-room resync emits game state only; the client keeps its existing monotonic anchor.
    expect(resynced).toEqual(first);
    expect(await withAck(done => client.socket.emit('story-quiz', { runId, quizId:'unknown', optionIndex:0 }, done))).toMatchObject({ok:false});
    expect(await withAck(done => stranger.socket.emit('story-quiz', {runId,quizId:first.quizId,optionIndex:0},done))).toMatchObject({ok:false});
    let firstQuestion = 0;
    if (passing) {
      // Latest socket owns the run; takeover preserves an already-issued deadline.
      const previous = client;
      client = await h.connect('ch7-session', {profileCookie:profile.cookie});
      client.socket.on('story-update', view => updates.push(view));
      expect(await withAck(done => client.socket.emit('resync',done))).toEqual({ok:true}); await tick();
      expect(previous.socket.connected).toBe(false);
      expect(updates.at(-1)!.live!.pendingQuiz).toEqual(resynced);
      // Keep listeners installed before reconnect so the initial story resend is observed.
      client.socket.disconnect(); await flush(); await flush(); await tick(2_000);
      await new Promise<void>(resolve => {
        client.socket.once('connect', () => resolve());
        client.socket.connect();
      });
      await tick();
      const reconnected = updates.at(-1)!.live!.pendingQuiz!;
      expect(reconnected).toMatchObject({quizId:first.quizId,expiresAt:first.expiresAt,number:1});
      expect(reconnected.remainingMs).toBeLessThanOrEqual(first.remainingMs - 7_000);
      expect(reconnected.remainingMs).toBe(reconnected.expiresAt - reconnected.sampledAt);
      client.socket.disconnect(); await flush(); await flush();
      await tick(31_000);
      client = await h.connect('ch7-session', {profileCookie:profile.cookie});
      client.socket.on('story-update', view => updates.push(view));
      expect(await withAck(done => client.socket.emit('resync',done))).toEqual({ok:true}); await tick();
      expect(updates.at(-1)!.live!.pendingQuiz).toBeNull();
      expect(updates.at(-1)!.live!.masquerade!.answered).toBe(1);
      await advance();
      firstQuestion = 1;
    }
    for (let i = firstQuestion; i < 4; i++) {
      const live = updates.at(-1)!.live!;
      const q = live.pendingQuiz!;
      const personality = h.runtime.roomManager.getRoom(live.roomId!)!.engine.state.players.find(p => p.seatIndex === q.seatIndex)!.personalityId!;
      const correct = ['mochi','choco','gumi','chloe'].indexOf(personality);
      const optionIndex = passing ? correct : (correct + 1) % 4;
      const receipt = await withAck(done => client.socket.emit('story-quiz', {runId,quizId:q.quizId,optionIndex}, done));
      expect(receipt).toEqual({ok:true,data:{quizId:q.quizId,accepted:true}});
      expect(await withAck(done => client.socket.emit('story-quiz', {runId,quizId:q.quizId,optionIndex:(optionIndex+1)%4}, done))).toEqual(receipt);
      await tick(600);
      if (i < 3) {
        expect(updates.at(-1)!.live!.masquerade!.feedback).toBeNull();
        expect(updates.at(-1)!.live!.objectives[0].progress).toBe(0);
        const publicState = h.runtime.roomManager.getRoom(updates.at(-1)!.live!.roomId!)!.engine.getPublicState(client.playerId);
        expect(publicState.players.filter(p=>p.type==='bot').every(p=>p.avatar==='story-mask')).toBe(true);
      }
    }
    expect(updates.at(-1)!.live!.masquerade!.feedback).toHaveLength(4);
    await advance();
    await drive(() => !updates.at(-1)?.live);
    if (passing) { expect(updates.at(-1)!.phase).toBe('scene'); await advance(); }
    else expect(updates.at(-1)!.phase).toBe('failure-scene');
    await advance();
    if (updates.at(-1)!.phase === 'result') await advance();
    const terminal = updates.at(-1)!;
    expect(terminal.phase).toBe('ended');
    expect(terminal.result?.passed).toBe(passing);
    if (!passing) {
      expect(terminal.result?.rewards.dojoXpMilli).toBe(0);
      const retry = await withAck<{runId:string}>(done => client.socket.emit('retry-story-sparring', {failedRunId:runId}, done));
      expect(retry.ok).toBe(true); await tick();
      const fresh = updates.at(-1)!;
      expect(fresh.runId).not.toBe(runId);
      expect(fresh.live?.roomId).not.toBe(firstRoom);
      expect(fresh.live?.handsPlayed).toBe(0);
      expect(fresh.live?.pendingQuiz).toBeNull();
      expect(fresh.live?.masquerade).toMatchObject({phase:'observing',answered:0,feedback:null});
      expect(await withAck(done => client.socket.emit('retry-story-sparring', {failedRunId:runId}, done))).toEqual(retry);
    }
  }, 30_000);
});
