'use client';

/**
 * 수련 스토리 클라이언트 스토어 — 서버 뷰(StoryProgressView·StoryRunView)의 수신 전용 미러 + 명령 발사.
 * - 진행 요약은 GET /api/story(허브)로, 런은 소켓 story-update(개인 emit)로 받는다.
 * - 모든 명령은 ack 전까지 `pending`으로 잠가 중복 입력을 막는다(player-action 계약과 동형).
 *   서버는 성공 시 story-update를 ack보다 먼저 보내므로 ack 시점엔 이미 최신 뷰다.
 * - VN 커서·드릴 입력 초안 같은 로컬 UI 상태는 컴포넌트가 소유한다. 스토어는 서버 뷰만 들고 있다.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { formatCard } from '@/lib/poker/card-notation';
import type { PokerClientSocket, RealtimeAck } from '@/lib/realtime/protocol';
import type { DrillAnswer, DrillResult } from '@/lib/story/drills/types';
import type { StoryAdvanceTarget, StoryDrillAck, StoryProgressView, StoryRunView } from '@/lib/story/views';
import { emitGameEvent } from '@/lib/events/game-events';

interface Dependencies {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export type StoryLoadOutcome = 'ok' | 'unauthorized' | 'error' | 'stale';

export interface StoryStoreState {
  profileId: string | null;
  progress: StoryProgressView | null;
  progressStatus: 'idle' | 'loading' | 'ready' | 'error';
  run: StoryRunView | null;
  /** 소켓 명령 진행 중 — UI는 버튼을 잠근다 */
  pending: boolean;
  error: string | null;
  lastDrillResult: DrillResult | null;
  /** 현재 문항에서 연 힌트 본문 */
  hint: string | null;

  load(): Promise<StoryLoadOutcome>;
  startChapter(chapterId: string): Promise<boolean>;
  advance(target?: StoryAdvanceTarget): Promise<boolean>;
  choose(choiceId: string, optionId: string): Promise<boolean>;
  answerDrill(answer: DrillAnswer, elapsedMs: number): Promise<DrillResult | null>;
  useHint(): Promise<string | null>;
  startDaily(): Promise<boolean>;
  abandon(): Promise<boolean>;
  receiveRun(view: StoryRunView): void;
  /** 결산을 본 뒤 끝난 런을 지운다 (허브로 복귀) */
  dismissRun(): void;
  setProfileIdentity(profileId: string | null): void;
  bindSocket(socket: PokerClientSocket): () => void;
  reset(): void;
  clearError(): void;
}

export type StoryStore = UseBoundStore<StoreApi<StoryStoreState>>;

const DEFAULT_ERROR = '수련 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const OFFLINE_ERROR = '서버와 연결되어 있지 않아요. 잠시 후 다시 시도해 주세요.';

/** 드릴 답의 카드는 'As' 표기 문자열로 보낸다 (서버 파서 화이트리스트) */
export function toWireDrillAnswer(answer: DrillAnswer): Record<string, unknown> {
  switch (answer.kind) {
    case 'card-pick':
      return { kind: 'card-pick', cards: answer.cards.map(formatCard) };
    case 'action-pick':
      return answer.sizingBB === undefined
        ? { kind: 'action-pick', action: answer.action }
        : { kind: 'action-pick', action: answer.action, sizingBB: answer.sizingBB };
    case 'multiple-choice':
      return { kind: 'multiple-choice', index: answer.index };
    case 'numeric':
      return { kind: 'numeric', value: answer.value };
    case 'multi-select':
      return { kind: 'multi-select', indices: [...answer.indices] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProgress(payload: unknown): StoryProgressView | null {
  if (!isRecord(payload) || !isRecord(payload.progress)) return null;
  const progress = payload.progress;
  if (!Array.isArray(progress.chapters) || typeof progress.belt !== 'string' || !isRecord(progress.daily)) return null;
  return progress as unknown as StoryProgressView;
}

export function createStoryStore(dependencies: Dependencies): StoryStore {
  let boundSocket: PokerClientSocket | null = null;
  let bindCount = 0;
  let onRun: ((view: StoryRunView) => void) | null = null;
  let identityGeneration = 0;
  const controllers = new Set<AbortController>();

  return create<StoryStoreState>((set, get) => {
    const withAck = <T>(
      send: (socket: PokerClientSocket, done: (ack: RealtimeAck<T>) => void) => void,
    ): Promise<RealtimeAck<T> | null> => {
      const socket = boundSocket;
      if (!socket?.connected) {
        set({ error: OFFLINE_ERROR });
        return Promise.resolve(null);
      }
      if (get().pending) return Promise.resolve(null);
      set({ pending: true, error: null });
      const generation = identityGeneration;
      return new Promise(resolve => {
        let settled = false;
        const finish = (ack: RealtimeAck<T> | null): void => {
          if (settled) return;
          settled = true;
          if (generation === identityGeneration) {
            set({ pending: false, ...(ack && !ack.ok ? { error: ack.message } : {}) });
          }
          resolve(ack);
        };
        const timer = setTimeout(() => finish(null), 10_000);
        send(socket, ack => {
          clearTimeout(timer);
          finish(ack);
        });
      });
    };

    return {
      profileId: null,
      progress: null,
      progressStatus: 'idle',
      run: null,
      pending: false,
      error: null,
      lastDrillResult: null,
      hint: null,

      load: async () => {
        const profileId = get().profileId;
        if (!profileId) return 'stale';
        const generation = identityGeneration;
        const controller = new AbortController();
        controllers.add(controller);
        set({ progressStatus: 'loading', error: null });
        try {
          const response = await dependencies.fetch('/api/story', {
            method: 'GET',
            credentials: 'same-origin',
            signal: controller.signal,
          });
          let payload: unknown = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
          if (generation !== identityGeneration) return 'stale';
          if (response.status === 401) {
            set({ progressStatus: 'error', error: null });
            return 'unauthorized';
          }
          const progress = response.ok ? parseProgress(payload) : null;
          if (!progress) {
            set({ progressStatus: 'error', error: DEFAULT_ERROR });
            return 'error';
          }
          set({ progress, progressStatus: 'ready', error: null });
          return 'ok';
        } catch {
          if (generation !== identityGeneration) return 'stale';
          set({ progressStatus: 'error', error: DEFAULT_ERROR });
          return 'error';
        } finally {
          controllers.delete(controller);
        }
      },

      startChapter: async chapterId => {
        const ack = await withAck<{ runId: string }>((socket, done) => {
          socket.emit('start-story-chapter', { chapterId }, done);
        });
        return !!ack?.ok;
      },

      advance: async (target = 'next') => {
        const run = get().run;
        if (!run) return false;
        const ack = await withAck((socket, done) => {
          socket.emit('story-advance', { runId: run.runId, expectedStepIndex: run.stepIndex, target }, done);
        });
        if (ack?.ok) set({ hint: null, lastDrillResult: null });
        return !!ack?.ok;
      },

      choose: async (choiceId, optionId) => {
        const run = get().run;
        if (!run) return false;
        const ack = await withAck((socket, done) => {
          socket.emit('story-choice', { runId: run.runId, expectedStepIndex: run.stepIndex, choiceId, optionId }, done);
        });
        return !!ack?.ok;
      },

      answerDrill: async (answer, elapsedMs) => {
        const run = get().run;
        const drill = run?.drill;
        if (!run || !drill) return null;
        const ack = await withAck<StoryDrillAck>((socket, done) => {
          socket.emit('story-drill', {
            runId: run.runId,
            setId: drill.setId,
            index: drill.index,
            action: 'answer',
            answer: toWireDrillAnswer(answer),
            elapsedMs: Math.max(0, Math.round(elapsedMs)),
          }, done);
        });
        if (!ack?.ok || ack.data?.action !== 'answer') return null;
        const result = ack.data.result;
        set({ lastDrillResult: result, hint: null });
        emitGameEvent({ type: 'story-drill-result', correct: result.correct, streak: result.streak });
        return result;
      },

      useHint: async () => {
        const run = get().run;
        const drill = run?.drill;
        if (!run || !drill) return null;
        if (get().hint) return get().hint;
        const ack = await withAck<StoryDrillAck>((socket, done) => {
          socket.emit('story-drill', { runId: run.runId, setId: drill.setId, index: drill.index, action: 'hint' }, done);
        });
        if (!ack?.ok || ack.data?.action !== 'hint') return null;
        set({ hint: ack.data.hint });
        return ack.data.hint;
      },

      startDaily: async () => {
        const ack = await withAck<{ runId: string }>((socket, done) => {
          socket.emit('story-daily', done);
        });
        return !!ack?.ok;
      },

      abandon: async () => {
        const run = get().run;
        if (!run) return false;
        const ack = await withAck((socket, done) => {
          socket.emit('abandon-story', { runId: run.runId }, done);
        });
        if (ack?.ok) void get().load();
        return !!ack?.ok;
      },

      receiveRun: view => {
        const previous = get().run;
        const drillChanged = !!previous?.drill && !!view.drill
          && (previous.drill.setId !== view.drill.setId || previous.drill.index !== view.drill.index);
        // 끝난 런(phase 'ended')도 결산 화면을 위해 보관 — dismissRun()이 지운다
        set({
          run: view,
          ...(drillChanged ? { hint: null, lastDrillResult: null } : {}),
        });
        if (view.phase === 'ended') {
          if (view.result) {
            emitGameEvent({
              type: 'story-chapter-complete',
              chapterId: view.chapterId,
              grade: view.result.grade,
              passed: view.result.passed,
            });
          }
          void get().load();
        }
      },

      dismissRun: () => {
        if (get().run?.phase === 'ended') set({ run: null, hint: null, lastDrillResult: null });
      },

      setProfileIdentity: profileId => {
        if (get().profileId === profileId) return;
        identityGeneration += 1;
        for (const controller of controllers) controller.abort();
        controllers.clear();
        set({
          profileId,
          progress: null,
          progressStatus: 'idle',
          run: null,
          pending: false,
          error: null,
          lastDrillResult: null,
          hint: null,
        });
      },

      bindSocket: socket => {
        if (boundSocket === socket) {
          bindCount += 1;
        } else {
          if (boundSocket && onRun) boundSocket.off('story-update', onRun);
          boundSocket = socket;
          bindCount = 1;
          onRun = view => get().receiveRun(view);
          socket.on('story-update', onRun);
        }
        let cleaned = false;
        return () => {
          if (cleaned) return;
          cleaned = true;
          bindCount -= 1;
          if (bindCount > 0 || boundSocket !== socket) return;
          if (onRun) socket.off('story-update', onRun);
          boundSocket = null;
          onRun = null;
        };
      },

      reset: () => {
        identityGeneration += 1;
        for (const controller of controllers) controller.abort();
        controllers.clear();
        set({
          profileId: null,
          progress: null,
          progressStatus: 'idle',
          run: null,
          pending: false,
          error: null,
          lastDrillResult: null,
          hint: null,
        });
      },

      clearError: () => set({ error: null }),
    };
  });
}

export const useStoryStore = createStoryStore({
  fetch: (input, init) => fetch(input, init),
});
