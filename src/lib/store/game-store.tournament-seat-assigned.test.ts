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
    pendingTournamentId: null,
    pendingTournamentRequestId: null,
    tournamentRegistrationStatus: null,
    gameState: null,
    chatMessages: [],
    tableNotice: null,
  });
  socketHarness.listeners.clear();
  vi.clearAllMocks();
});

describe('game store tournament-seat-assigned isolation', () => {
  it('ignores a seat assignment for a different pending tournament', () => {
    useGameStore.setState({
      currentRoomId: null,
      pendingTournamentId: 'mtt-pending',
      pendingTournamentRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tournamentRegistrationStatus: 'late-pending',
    });
    useGameStore.getState().connect();
    const assign = socketHarness.listeners.get('tournament-seat-assigned');
    if (!assign) throw new Error('tournament-seat-assigned listener missing');

    assign({
      tournamentId: 'mtt-other',
      roomId: 'room-wrong',
      state: { id: 'room-wrong' },
      chat: [{ id: 'wrong-chat' }],
    } as never);

    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: null,
      pendingTournamentId: 'mtt-pending',
      tournamentRegistrationStatus: 'late-pending',
      gameState: null,
      chatMessages: [],
    });
  });

  it('replaces lobby snapshots for the matching tournament without table-move', () => {
    useGameStore.setState({
      currentRoomId: null,
      pendingTournamentId: 'mtt-pending',
      pendingTournamentRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tournamentRegistrationStatus: 'late-pending',
      gameState: { id: 'stale-lobby' } as never,
      chatMessages: [{ id: 'stale-chat' } as never],
    });
    useGameStore.getState().connect();
    const assign = socketHarness.listeners.get('tournament-seat-assigned');
    if (!assign) throw new Error('tournament-seat-assigned listener missing');

    assign({
      tournamentId: 'mtt-pending',
      roomId: 'room-seat',
      state: { id: 'room-seat' },
      chat: [{ id: 'fresh-chat' }],
    } as never);

    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: 'room-seat',
      pendingTournamentId: null,
      pendingTournamentRequestId: null,
      tournamentRegistrationStatus: 'seated',
      gameState: { id: 'room-seat' },
      chatMessages: [{ id: 'fresh-chat' }],
    });
  });

  it('keeps table-move isolated from first late seating', () => {
    useGameStore.setState({
      currentRoomId: null,
      pendingTournamentId: 'mtt-pending',
      pendingTournamentRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tournamentRegistrationStatus: 'late-pending',
    });
    useGameStore.getState().connect();
    const move = socketHarness.listeners.get('table-move');
    if (!move) throw new Error('table-move listener missing');

    move({
      tournamentId: 'mtt-pending',
      fromRoomId: 'room-not-current',
      roomId: 'room-next',
      gameState: { id: 'room-next' },
      chatHistory: [],
    } as never);

    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: null,
      pendingTournamentId: 'mtt-pending',
      tournamentRegistrationStatus: 'late-pending',
    });
  });
});
