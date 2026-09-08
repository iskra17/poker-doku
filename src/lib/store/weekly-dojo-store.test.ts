import { describe, expect, it, vi } from 'vitest';
import type { PokerClientSocket } from '@/lib/realtime/protocol';
import type { WeeklyDojoView } from '@/lib/weekly-dojo/types';
import { createWeeklyDojoStore } from './weekly-dojo-store';

/**
 * 주간 도장 클라이언트 미러 회귀 — 수신 전용 계약.
 * 스토어는 점수를 만들지 않고, 끊긴 상태에서는 서버로 아무것도 보내지 않는다.
 */

const VIEW: WeeklyDojoView = {
  weekKey: '2026-W37',
  weekEndsAt: 3_000,
  serverNow: 1_000,
  rules: {
    startingChips: 2_000,
    smallBlind: 10,
    bigBlind: 20,
    startingBB: 100,
    maxHands: 20,
    attemptsPerWeek: 3,
    lineupVersion: 'wd-v1',
    lineup: [{ seatIndex: 1, characterId: 'mochi', name: '모찌' }],
  },
  attempts: [
    { slot: 1, status: 'completed', handsPlayed: 20, netBB: 4.5, finishReason: 'max-hands', completedAt: 900 },
    { slot: 2, status: 'empty', handsPlayed: 0, netBB: 0, finishReason: null, completedAt: null },
    { slot: 3, status: 'empty', handsPlayed: 0, netBB: 0, finishReason: null, completedAt: null },
  ],
  live: null,
  completedCount: 1,
  totalNetBB: null,
  rank: null,
  entrants: 0,
  top: [],
  nearby: [],
};

interface FakeSocket {
  connected: boolean;
  emitted: { event: string; payload?: unknown }[];
  handlers: Map<string, (payload: unknown) => void>;
  acks: { event: string; ack: (response: unknown) => void }[];
  respondWith: unknown;
  autoAck: boolean;
  emit(event: string, ...args: unknown[]): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
}

function fakeSocket(connected = true, autoAck = true): FakeSocket {
  const socket: FakeSocket = {
    connected,
    emitted: [],
    handlers: new Map(),
    acks: [],
    respondWith: { ok: true, data: VIEW },
    autoAck,
    emit(event, ...args) {
      const ack = args.find(arg => typeof arg === 'function') as
        | ((response: unknown) => void)
        | undefined;
      const payload = args.find(arg => typeof arg !== 'function');
      socket.emitted.push({ event, payload });
      if (ack) {
        socket.acks.push({ event, ack });
        if (socket.autoAck) ack(socket.respondWith);
      }
    },
    on(event, handler) {
      socket.handlers.set(event, handler);
    },
    off(event) {
      socket.handlers.delete(event);
    },
  };
  return socket;
}

const bind = (socket: FakeSocket) => socket as unknown as PokerClientSocket;

describe('weekly dojo store', () => {
  it('mirrors the server snapshot on refresh and on push updates', () => {
    const store = createWeeklyDojoStore();
    const socket = fakeSocket();
    const unbind = store.getState().bindSocket(bind(socket));

    store.getState().refresh();
    expect(socket.emitted.map(item => item.event)).toEqual(['get-weekly-dojo']);
    expect(store.getState().view).toEqual(VIEW);
    expect(store.getState().loadState).toBe('ready');

    const pushed: WeeklyDojoView = { ...VIEW, completedCount: 2 };
    socket.handlers.get('weekly-dojo-update')?.(pushed);
    expect(store.getState().view?.completedCount).toBe(2);

    unbind();
    expect(socket.handlers.has('weekly-dojo-update')).toBe(false);
  });

  it('ignores an older refresh response after a newer refresh or push update', () => {
    const store = createWeeklyDojoStore();
    const socket = fakeSocket(true, false);
    store.getState().bindSocket(bind(socket));

    store.getState().refresh();
    store.getState().refresh();
    expect(socket.acks).toHaveLength(2);

    socket.acks[1].ack({ ok: true, data: { ...VIEW, completedCount: 2 } });
    expect(store.getState().view?.completedCount).toBe(2);
    socket.acks[0].ack({ ok: true, data: VIEW });
    expect(store.getState().view?.completedCount).toBe(2);

    store.getState().refresh();
    socket.handlers.get('weekly-dojo-update')?.({ ...VIEW, completedCount: 3 });
    socket.acks[2].ack({ ok: true, data: { ...VIEW, completedCount: 1 } });
    expect(store.getState().view?.completedCount).toBe(3);
  });

  it('surfaces a rejection message without inventing a result', async () => {
    const store = createWeeklyDojoStore();
    const socket = fakeSocket();
    store.getState().bindSocket(bind(socket));
    socket.respondWith = {
      ok: false,
      code: 'action-rejected',
      message: '이번 주 도전 3회를 모두 사용했어요.',
    };

    const started = await store.getState().start();
    expect(started).toBeNull();
    expect(store.getState().error).toBe('이번 주 도전 3회를 모두 사용했어요.');
    expect(store.getState().pending).toBe(false);
    expect(store.getState().view).toBeNull();
  });

  it('ignores a late old command ack after reset and allows the next start', async () => {
    const store = createWeeklyDojoStore();
    const socket = fakeSocket(true, false);
    store.getState().bindSocket(bind(socket));

    const oldStart = store.getState().start();
    expect(store.getState().pending).toBe(true);
    store.getState().reset();
    expect(await oldStart).toBeNull();
    expect(store.getState().pending).toBe(false);

    const nextStart = store.getState().start();
    expect(store.getState().pending).toBe(true);
    socket.acks[0].ack({ ok: false, code: 'server-error', message: '오래된 응답' });
    expect(store.getState().pending).toBe(true);
    expect(store.getState().error).toBeNull();
    socket.acks[1].ack({ ok: true, data: { attemptId: 'a2', roomId: 'r2', slot: 2, resumed: false } });
    await expect(nextStart).resolves.toEqual({ attemptId: 'a2', roomId: 'r2', slot: 2, resumed: false });
  });

  it('times out a command ack and releases the pending lock', async () => {
    vi.useFakeTimers();
    try {
      const store = createWeeklyDojoStore();
      const socket = fakeSocket(true, false);
      store.getState().bindSocket(bind(socket));

      const command = store.getState().start();
      expect(store.getState().pending).toBe(true);
      vi.advanceTimersByTime(10_000);
      await expect(command).resolves.toBeNull();
      expect(store.getState().pending).toBe(false);
      expect(store.getState().error).toContain('응답이 지연');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up on disconnect so a reconnect can start a fresh command', async () => {
    const store = createWeeklyDojoStore();
    const socket = fakeSocket(true, false);
    store.getState().bindSocket(bind(socket));

    const oldStart = store.getState().start();
    socket.connected = false;
    socket.handlers.get('disconnect')?.(undefined);
    await expect(oldStart).resolves.toBeNull();
    expect(store.getState().pending).toBe(false);
    expect(store.getState().error).toContain('연결이 끊겨');

    socket.connected = true;
    const nextStart = store.getState().start();
    socket.acks[1].ack({ ok: true, data: { attemptId: 'a3', roomId: 'r3', slot: 3, resumed: true } });
    await expect(nextStart).resolves.toEqual({ attemptId: 'a3', roomId: 'r3', slot: 3, resumed: true });
  });

  it('never emits while offline and reports the disconnect', async () => {
    const store = createWeeklyDojoStore();
    const socket = fakeSocket(false);
    store.getState().bindSocket(bind(socket));

    store.getState().refresh();
    expect(await store.getState().start()).toBeNull();
    expect(await store.getState().forfeit()).toBe(false);

    expect(socket.emitted).toEqual([]);
    expect(store.getState().loadState).toBe('error');
    expect(store.getState().error).toContain('연결이 끊겨');
  });

  it('resets to an empty mirror', () => {
    const store = createWeeklyDojoStore();
    const socket = fakeSocket();
    store.getState().bindSocket(bind(socket));
    store.getState().refresh();

    store.getState().reset();
    expect(store.getState().view).toBeNull();
    expect(store.getState().loadState).toBe('idle');
    expect(store.getState().error).toBeNull();
  });
});
