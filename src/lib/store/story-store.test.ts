import { describe, expect, it, vi } from 'vitest';
import { cards } from '@/lib/poker/test-helpers';
import type { PokerClientSocket, RealtimeAck } from '@/lib/realtime/protocol';
import type { DrillResult } from '@/lib/story/drills/types';
import type { StoryProgressView, StoryRunView } from '@/lib/story/views';
import { onGameEvent, type GameEvent } from '@/lib/events/game-events';
import { createStoryStore, toWireDrillAnswer } from './story-store';

type Handler = (...args: unknown[]) => void;

/** 최소 소켓 fake — emit(event, payload?, ack) 호출을 기록하고 ack를 테스트가 제어한다 */
function makeSocket(connected = true) {
  const handlers = new Map<string, Set<Handler>>();
  const emitted: Array<{ event: string; payload: unknown; ack: ((ack: RealtimeAck<unknown>) => void) | null }> = [];
  const socket = {
    connected,
    on: (event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return socket;
    },
    off: (event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
      return socket;
    },
    emit: (event: string, ...args: unknown[]) => {
      const last = args[args.length - 1];
      const ack = typeof last === 'function' ? (last as (ack: RealtimeAck<unknown>) => void) : null;
      const payload = ack ? args[0] : args[0];
      emitted.push({ event, payload: ack && args.length === 1 ? undefined : payload, ack });
      return socket;
    },
    fire: (event: string, payload: unknown) => {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
    listenerCount: (event: string) => handlers.get(event)?.size ?? 0,
  };
  return { socket: socket as unknown as PokerClientSocket, emitted, fire: socket.fire, listenerCount: socket.listenerCount };
}

function progressFixture(): StoryProgressView {
  return {
    chapters: [{ chapterId: 'act1-ch01', attempts: 0, completions: 0, bestGrade: null, unlocked: true }],
    flags: {},
    belt: 'white',
    nextChapterId: 'act1-ch01',
    drillStats: { total: 0, correct: 0, byCategory: {} },
    reviewQueue: 0,
    daily: { date: '2026-09-02', done: 0, total: 3, available: false, teacherId: null },
    activeRun: null,
  };
}

function runFixture(overrides: Partial<StoryRunView> = {}): StoryRunView {
  return {
    runId: 'run-1',
    chapterId: 'act1-ch01',
    stepIndex: 2,
    stepCount: 6,
    stepKind: 'drill-set',
    phase: 'drill',
    context: { partnerId: 'sakura', teacherId: 'miyako' },
    drill: {
      setId: 'act1-ch01:drills',
      index: 0,
      total: 6,
      instance: {
        templateId: 'odds-required-equity',
        seed: 7,
        category: 'pot-odds',
        situation: {
          hero: cards('Ah Kh'), board: cards('Qh 7h 2c'), potChips: 150, toCallChips: 50, bigBlind: 20,
          heroStackChips: 2000, heroPosition: 'BTN', street: 'flop', villains: [],
        },
        question: '필요 승률은?',
        answerSpec: { kind: 'numeric', unit: '%', min: 0, max: 100 },
        hasHint: true,
      },
      streak: 0,
      hintsUsed: 0,
      wrongQueue: 0,
      hint: null,
      lastResult: null,
      answered: 0,
      correct: 0,
    },
    live: null,
    result: null,
    startedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('story-store', () => {
  it('load: parses the progress view, maps 401 to unauthorized, ignores stale identities', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    const store = createStoryStore({ fetch });
    expect(await store.getState().load()).toBe('stale');

    store.getState().setProfileIdentity('p1');
    fetch.mockResolvedValueOnce(jsonResponse(200, { progress: progressFixture() }));
    expect(await store.getState().load()).toBe('ok');
    expect(store.getState().progressStatus).toBe('ready');
    expect(store.getState().progress?.nextChapterId).toBe('act1-ch01');
    expect(fetch.mock.calls[0][0]).toBe('/api/story');

    fetch.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'PROFILE_REQUIRED' } }));
    expect(await store.getState().load()).toBe('unauthorized');

    fetch.mockResolvedValueOnce(jsonResponse(200, { nope: true }));
    expect(await store.getState().load()).toBe('error');
    expect(store.getState().error).toContain('불러오지');

    // 요청 중 프로필이 바뀌면 결과를 버린다
    let resolveFetch: (response: Response) => void = () => undefined;
    fetch.mockImplementationOnce(() => new Promise(resolve => { resolveFetch = resolve; }));
    const pending = store.getState().load();
    store.getState().setProfileIdentity('p2');
    resolveFetch(jsonResponse(200, { progress: progressFixture() }));
    expect(await pending).toBe('stale');
    expect(store.getState().progress).toBeNull();
  });

  it('bindSocket subscribes story-update once per socket and receiveRun mirrors the view', () => {
    const store = createStoryStore({ fetch: vi.fn() });
    const { socket, fire, listenerCount } = makeSocket();
    const unbindA = store.getState().bindSocket(socket);
    const unbindB = store.getState().bindSocket(socket);
    expect(listenerCount('story-update')).toBe(1);

    fire('story-update', runFixture());
    expect(store.getState().run?.runId).toBe('run-1');
    unbindA();
    expect(listenerCount('story-update')).toBe(1);
    unbindB();
    expect(listenerCount('story-update')).toBe(0);
  });

  it('commands lock with pending until the ack, surface ack errors, and refuse when offline', async () => {
    const store = createStoryStore({ fetch: vi.fn() });
    const { socket, emitted } = makeSocket();
    store.getState().setProfileIdentity('p1');
    store.getState().bindSocket(socket);

    const first = store.getState().startChapter('act1-ch01');
    expect(store.getState().pending).toBe(true);
    // 잠금 중 두 번째 명령은 발사되지 않는다
    expect(await store.getState().startChapter('act1-ch01')).toBe(false);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ event: 'start-story-chapter', payload: { chapterId: 'act1-ch01' } });
    emitted[0].ack!({ ok: false, code: 'story-locked', message: '아직 열리지 않은 챕터예요.' });
    expect(await first).toBe(false);
    expect(store.getState().pending).toBe(false);
    expect(store.getState().error).toBe('아직 열리지 않은 챕터예요.');

    const offline = createStoryStore({ fetch: vi.fn() });
    offline.getState().bindSocket(makeSocket(false).socket);
    expect(await offline.getState().startChapter('act1-ch01')).toBe(false);
    expect(offline.getState().error).toContain('연결');
  });

  it('advance sends the current runId/stepIndex and clears hint/result on success', async () => {
    const store = createStoryStore({ fetch: vi.fn() });
    const { socket, emitted, fire } = makeSocket();
    store.getState().bindSocket(socket);
    expect(await store.getState().advance()).toBe(false); // 런 없음

    fire('story-update', runFixture({ stepIndex: 1, stepKind: 'lesson', phase: 'lesson', drill: null }));
    const promise = store.getState().advance('skip');
    expect(emitted.at(-1)).toMatchObject({ event: 'story-advance', payload: { runId: 'run-1', expectedStepIndex: 1, target: 'skip' } });
    fire('story-update', runFixture());
    emitted.at(-1)!.ack!({ ok: true });
    expect(await promise).toBe(true);
    expect(store.getState().run?.stepIndex).toBe(2);
  });

  it('answerDrill converts cards to notation, stores the result and emits a game event', async () => {
    const store = createStoryStore({ fetch: vi.fn() });
    const { socket, emitted, fire } = makeSocket();
    store.getState().bindSocket(socket);
    fire('story-update', runFixture());
    const events: GameEvent[] = [];
    const off = onGameEvent(event => { events.push(event); });

    expect(toWireDrillAnswer({ kind: 'card-pick', cards: cards('Ah Th') })).toEqual({ kind: 'card-pick', cards: ['Ah', 'Th'] });
    expect(toWireDrillAnswer({ kind: 'action-pick', action: 'raise', sizingBB: 2.5 })).toEqual({ kind: 'action-pick', action: 'raise', sizingBB: 2.5 });

    const result: DrillResult = {
      templateId: 'odds-required-equity', seed: 7, correct: true,
      correctAnswer: { kind: 'numeric', correct: 25, tolerance: 2, unit: '%', min: 0, max: 100 },
      explanation: { text: '정확해요.', speaker: 'hana', facts: { pct: 25 } },
      hintsUsed: 0, streak: 1, elapsedMs: 1200,
    };
    const promise = store.getState().answerDrill({ kind: 'numeric', value: 25 }, 1234.6);
    expect(emitted.at(-1)).toMatchObject({
      event: 'story-drill',
      payload: { runId: 'run-1', setId: 'act1-ch01:drills', index: 0, action: 'answer', answer: { kind: 'numeric', value: 25 }, elapsedMs: 1235 },
    });
    emitted.at(-1)!.ack!({ ok: true, data: { action: 'answer', result } });
    expect(await promise).toEqual(result);
    expect(store.getState().lastDrillResult).toEqual(result);
    expect(events).toEqual([{ type: 'story-drill-result', correct: true, streak: 1 }]);
    off();

    // 힌트는 한 번 열면 캐시된다
    const hintPromise = store.getState().useHint();
    expect(emitted.at(-1)).toMatchObject({ event: 'story-drill', payload: { action: 'hint' } });
    emitted.at(-1)!.ack!({ ok: true, data: { action: 'hint', hint: '콜 ÷ (팟 + 콜)' } });
    expect(await hintPromise).toBe('콜 ÷ (팟 + 콜)');
    const sent = emitted.length;
    expect(await store.getState().useHint()).toBe('콜 ÷ (팟 + 콜)');
    expect(emitted).toHaveLength(sent);

    // 다음 문항으로 넘어가면 힌트·결과가 초기화된다
    fire('story-update', runFixture({ drill: { ...runFixture().drill!, index: 1 } }));
    expect(store.getState().hint).toBeNull();
    expect(store.getState().lastDrillResult).toBeNull();
  });

  it('keeps an ended run for the result screen, reloads progress, and dismissRun clears it', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse(200, { progress: { ...progressFixture(), nextChapterId: 'act1-ch02' } }));
    const store = createStoryStore({ fetch });
    const { socket, fire } = makeSocket();
    store.getState().setProfileIdentity('p1');
    store.getState().bindSocket(socket);
    const events: GameEvent[] = [];
    const off = onGameEvent(event => { events.push(event); });

    fire('story-update', runFixture({
      phase: 'ended', stepIndex: 5, stepKind: 'result', drill: null,
      result: {
        chapterId: 'act1-ch01', passed: true, grade: 'A',
        drill: { answered: 6, correct: 5, bestStreak: 3, hintsUsed: 1, score: 0.8 },
        live: null, rewards: { firstClear: true, dojoXpMilli: 100_000, affinity: [], badgeId: null },
        reviewNotesAdded: 1, nextChapterId: 'act1-ch02',
      },
    }));
    expect(store.getState().run?.phase).toBe('ended');
    expect(events).toEqual([{ type: 'story-chapter-complete', chapterId: 'act1-ch01', grade: 'A', passed: true }]);
    await vi.waitFor(() => expect(store.getState().progress?.nextChapterId).toBe('act1-ch02'));
    store.getState().dismissRun();
    expect(store.getState().run).toBeNull();
    off();
  });
});
