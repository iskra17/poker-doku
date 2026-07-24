import { afterEach, describe, expect, it, vi } from 'vitest';

const socketHarness = vi.hoisted(() => {
  const listeners = new Map<string, (payload: never) => void>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, listener: (payload: never) => void) => {
      listeners.set(event, listener);
      return socket;
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  return { listeners, socket };
});

vi.mock('socket.io-client', () => ({
  io: () => socketHarness.socket,
}));

import { useGameStore } from './game-store';

afterEach(() => {
  useGameStore.setState({
    socket: null,
    connected: false,
    currentRoomId: null,
    pendingRoomId: null,
    pendingAction: null,
    gameState: null,
    chatMessages: [],
    tableNotice: null,
  });
  socketHarness.listeners.clear();
  vi.clearAllMocks();
});

describe('game store table-move isolation', () => {
  it('현재 방에서 출발한 이동만 적용한다', () => {
    useGameStore.setState({
      currentRoomId: 'room-current',
      gameState: { id: 'room-current' } as never,
    });
    useGameStore.getState().connect();
    const onMove = socketHarness.listeners.get('table-move');
    if (!onMove) throw new Error('table-move listener missing');

    onMove({
      tournamentId: 'mtt-1',
      fromRoomId: 'room-stale',
      roomId: 'room-wrong',
      gameState: { id: 'room-wrong' },
      chatHistory: [],
    } as never);
    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: 'room-current',
      gameState: { id: 'room-current' },
      tableNotice: null,
    });

    onMove({
      tournamentId: 'mtt-1',
      fromRoomId: 'room-current',
      roomId: 'room-next',
      gameState: { id: 'room-next' },
      chatHistory: [],
    } as never);
    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: 'room-next',
      gameState: { id: 'room-next' },
    });
  });
});
