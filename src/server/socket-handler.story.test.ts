import { STORY_REWARD_CATALOG } from '../lib/story/rewards/catalog';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProgressionSnapshot } from '../lib/progression/types';
import type { RealtimeAck } from '../lib/realtime/protocol';
import { generateDrill, gradeDrill } from '../lib/story/drills/generator';
import type { DrillAnswer, DrillAnswerSpec } from '../lib/story/drills/types';
import { makeChapterChain, makeChapter, makeScene, makeSteps } from '../lib/story/test-fixtures';
import type { StoryTeacherId } from '../lib/story/types';
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

function collect<T>(client: ConnectedTestClient, event: 'story-update' | 'room-lost' | 'progression-update'): T[] {
  const items: T[] = [];
  (client.socket as unknown as { on: (name: string, cb: (payload: T) => void) => void }).on(event, payload => {
    items.push(payload);
  });
  return items;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

  it('choice/drill/daily reach the coordinator after validation; quiz rejects requests without a live run', async () => {
    const { client } = await setup();
    expect(await withAck(done => client.socket.emit('story-choice', { runId: 'r', expectedStepIndex: 0, choiceId: 'c', optionId: 'o' }, done)))
      .toMatchObject({ ok: false, code: 'story-no-run' });
    expect(await withAck(done => client.socket.emit('story-drill', { runId: 'r', setId: 's', index: 0, action: 'hint' }, done)))
      .toMatchObject({ ok: false, code: 'story-no-run' });
    expect(await withAck(done => client.socket.emit('story-quiz', { runId: 'r', quizId: 'q', optionIndex: 0 }, done)))
      .toMatchObject({ ok: false, code: 'stale-state' });
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

  it('finishes an exam run with the reward DTO (items, chips, cutscene, next), pushes progression, and previews rewards in progress', async () => {
    const { harness: h, client, profile } = await setup();
    const walletBefore = h.walletState(profile.profile.id).balance;
    const updates = collect<StoryRunView>(client, 'story-update');
    const progressions = collect<ProgressionSnapshot>(client, 'progression-update');
    // 실력 확인: 드릴 세트만(라이브 스텝 스킵) — 2문 정답이면 S등급 첫 완주
    const started = await withAck<{ runId: string }>(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01', mode: 'exam' }, done));
    if (!started.ok) throw new Error('start failed');
    const runId = started.data!.runId;
    for (let slot = 0; slot < 2; slot++) {
      await sleep(20);
      const view = updates.at(-1)!;
      expect(view.drill).toMatchObject({ index: slot, total: 2 });
      const answer = answerFor(view.drill!.instance.templateId, view.drill!.instance.seed, view.context.teacherId);
      const ack = await withAck<StoryDrillAck>(done => client.socket.emit('story-drill', {
        runId, setId: view.drill!.setId, index: slot, action: 'answer', answer, elapsedMs: 900,
      }, done));
      expect(ack.ok && ack.data?.action === 'answer' && ack.data.result.correct).toBe(true);
      expect(await withAck(done => client.socket.emit('story-advance', { runId, expectedStepIndex: view.stepIndex }, done))).toEqual({ ok: true });
    }
    await sleep(20);
    const resultStep = updates.at(-1)!;
    expect(resultStep).toMatchObject({ phase: 'result', stepKind: 'result' });
    expect(await withAck(done => client.socket.emit('story-advance', { runId, expectedStepIndex: resultStep.stepIndex }, done))).toEqual({ ok: true });
    await sleep(40);

    const ended = updates.at(-1)!;
    expect(ended.phase).toBe('ended');
    const rewards = ended.result!.rewards;
    expect(ended.result).toMatchObject({ mode: 'exam', passed: true, grade: 'S' });
    // Ch1 첫 완주(칭호·CG·500) + S등급(카드백·300) + 무오답·힌트 0 → badge:perfect-set 「퍼펙트」 칭호
    expect(rewards.items!.map(item => item.id)).toEqual([
      'story-title-white-belt', 'story-cg-act1-belt-white', 'story-cardback-dojo-crest', 'story-title-perfect',
    ]);
    expect(rewards.chips).toBe(800);
    expect(rewards.badgeId).toBe('story-title-white-belt');
    expect(rewards.cutscene).toMatchObject({ id: 'story-cg-act1-belt-white', kind: 'belt', characterId: 'miyako' });
    expect(rewards.next!.map(item => item.id)).toEqual(['story-felt-yellow-belt', 'story-cg-act1-belt-yellow']);
    expect(rewards.unlockedScenes).toEqual([]);
    expect(h.walletState(profile.profile.id).balance).toBe(walletBefore + 800);
    // 지급 뒤 인벤토리가 담긴 progression-update가 한 번 더 온다(마지막 스냅샷이 최신)
    expect(progressions.at(-1)!.inventory.map(item => item.itemId)).toEqual(expect.arrayContaining([
      'story-title-white-belt', 'story-cg-act1-belt-white', 'story-cardback-dojo-crest',
    ]));
    expect(progressions.at(-1)!.cosmetics).toEqual({ cardBack: null, felt: null, outfits: {} });

    const progress = await withAck<StoryProgressView>(done => client.socket.emit('get-story-progress', done));
    if (!progress.ok) throw new Error('progress failed');
    expect(progress.data?.rewards?.filter(item => item.granted).map(item => item.id)).toEqual([
      'story-title-white-belt', 'story-chips-act1-ch01-first', 'story-cg-act1-belt-white',
      'story-cardback-dojo-crest', 'story-chips-act1-ch01-s', 'story-title-perfect',
    ]);
    expect(progress.data?.rewards).toHaveLength(STORY_REWARD_CATALOG.length);
    // 재조회 reconcile은 무변경 — 지갑 그대로
    expect(h.walletState(profile.profile.id).balance).toBe(walletBefore + 800);
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
  it('operator capability gates story skip and locked-chapter start (harness set → session.capabilities.operator)', async () => {
    const { harness: h, client } = await setup();
    expect(client.sessionCapabilities.operator).toBe(false);
    const started = await withAck<{ runId: string }>(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01' }, done));
    expect(started.ok).toBe(true);
    const runId = started.ok ? started.data!.runId : '';
    const denied = await withAck(done => client.socket.emit('story-advance', { runId, expectedStepIndex: 0, target: 'skip' }, done));
    expect(denied).toMatchObject({ ok: false, code: 'action-rejected' });
    expect(await withAck(done => client.socket.emit('abandon-story', { runId }, done))).toMatchObject({ ok: true });

    // 같은 프로필에 운영자 권한을 주고 다시 접속하면 capability가 켜지고 잠긴 챕터·스킵이 열린다
    const operatorProfile = await h.createProfile();
    h.grantOperator(operatorProfile.profile.id);
    const operator = await h.connect('token-operator', { profileCookie: operatorProfile.cookie });
    expect(operator.sessionCapabilities.operator).toBe(true);
    const updates = collect<StoryRunView>(operator, 'story-update');
    const locked = await withAck<{ runId: string }>(done => operator.socket.emit('start-story-chapter', { chapterId: 'act1-ch02' }, done));
    expect(locked.ok).toBe(true);
    await sleep(20);
    const first = updates.at(-1)!;
    expect(first).toMatchObject({ chapterId: 'act1-ch02', stepIndex: 0, phase: 'scene' });
    const skipped = await withAck(done => operator.socket.emit('story-advance', { runId: first.runId, expectedStepIndex: first.stepIndex, target: 'skip' }, done));
    expect(skipped).toMatchObject({ ok: true });
    await sleep(20);
    expect(updates.at(-1)!.stepIndex).toBe(first.stepIndex + 1);
    expect(h.recentEvents().some(event => event.type === 'story-step' && (event.data as { target?: string }).target === 'skip')).toBe(true);
    operator.socket.disconnect();
  });
  it('retry validates payloads, restores a real failed terminal, and reuses the new live room on duplicate ACK requests', async () => {
    const sparring = makeSteps('act1-ch01').find(step => step.kind === 'sparring')!;
    harness = await createSocketTestHarness({ storyChapters: [makeChapter({ steps: [sparring, { kind: 'result', id: 'end' }], failScene: makeScene('failure') })] });
    const h = harness;
    const profile = await h.createProfile();
    const client = await h.connect('retry-owner', { profileCookie: profile.cookie });
    const views = collect<StoryRunView>(client, 'story-update');
    expect(await withAck(done => client.socket.emit('retry-story-sparring', { failedRunId: 'r', stepIndex: 0 }, done))).toMatchObject({ code: 'invalid-payload' });
    expect(await withAck(done => client.socket.emit('start-story-chapter', { chapterId: 'act1-ch01' }, done))).toMatchObject({ ok: true });
    const initial = views.at(-1)!;
    const room = h.runtime.roomManager.getRoom(initial.live!.roomId!)!;
    // Bust before the next deal drives the actual adapter -> coordinator failure path.
    room.engine.state.players.find(player => player.id === client.playerId)!.chips = 0;
    for (let i = 0; i < 170 && views.at(-1)?.phase !== 'failure-scene'; i++) await sleep(50);
    expect(views.at(-1)?.phase).toBe('failure-scene');
    const failed = views.at(-1)!;
    expect(await withAck(done => client.socket.emit('story-advance', { runId: failed.runId, expectedStepIndex: failed.stepIndex, target: 'next' }, done))).toMatchObject({ ok: true });
    expect(h.runtime.storyProgress(profile.profile.id)?.activeRun).toBeNull();
    const restored = await h.connect('retry-owner', { profileCookie: profile.cookie });
    const restoredViews = collect<StoryRunView>(restored, 'story-update');
    expect(await withAck(done => restored.socket.emit('resync', done))).toMatchObject({ ok: true });
    expect(restoredViews.at(-1)).toMatchObject({ phase: 'ended', result: { passed: false } });
    const first = await withAck<{ runId: string }>(done => restored.socket.emit('retry-story-sparring', { failedRunId: failed.runId }, done));
    expect(first).toMatchObject({ ok: true });
    const live = restoredViews.at(-1)!;
    expect(live.live?.roomId).not.toBe(initial.live?.roomId);
    const fresh = h.runtime.roomManager.getRoom(live.live!.roomId!)!;
    expect(fresh.engine.state.players.find(player => player.id === client.playerId)?.chips).toBe(sparring.table.heroStackBB * sparring.table.blinds.big);
    expect(await withAck(done => restored.socket.emit('retry-story-sparring', { failedRunId: failed.runId }, done))).toEqual(first);
    expect(restoredViews.at(-1)?.live?.roomId).toBe(live.live?.roomId);
    restored.socket.disconnect();
  }, 15_000);

});
