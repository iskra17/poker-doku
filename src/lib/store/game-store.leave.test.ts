import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PokerClientSocket } from '@/lib/realtime/protocol';
import { useGameStore } from './game-store';

function socketRespondingWith(ack: { ok: true } | { ok: false; message: string }) {
  const emit = vi.fn((event: string, _payload: unknown, callback: (value: typeof ack) => void) => {
    if (event === 'leave-room') callback(ack);
  });
  return {
    socket: { connected: true, emit } as unknown as PokerClientSocket,
    emit,
  };
}

afterEach(() => {
  useGameStore.setState({
    socket: null,
    connected: false,
    currentRoomId: null,
    pendingRoomId: null,
    gameState: null,
    chatMessages: [],
    tableNotice: null,
  });
});

describe('game store leave acknowledgement', () => {
  it('keeps the table visible when server settlement rejects leaving', async () => {
    const { socket } = socketRespondingWith({ ok: false, message: '정산 저장에 실패했어요.' });
    useGameStore.setState({ socket, connected: true, currentRoomId: 'room-1' });

    const left = await useGameStore.getState().leaveRoom('exit');

    expect(left).toBe(false);
    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: 'room-1',
      tableNotice: '정산 저장에 실패했어요.',
    });
  });

  it('clears the table only after a successful acknowledgement', async () => {
    const { socket, emit } = socketRespondingWith({ ok: true });
    useGameStore.setState({
      socket,
      connected: true,
      currentRoomId: 'room-1',
      pendingRoomId: 'room-1',
      chatMessages: [{
        id: 'chat-1',
        roomId: 'room-1',
        playerId: 'profile-1',
        playerName: '벚꽃 여우',
        message: '좋은 승부예요!',
        timestamp: 1,
        type: 'player',
      }],
    });

    const left = await useGameStore.getState().leaveRoom('sitout');

    expect(left).toBe(true);
    expect(emit).toHaveBeenCalledWith('leave-room', { mode: 'sitout' }, expect.any(Function));
    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: null,
      pendingRoomId: null,
      chatMessages: [],
      tableNotice: null,
    });
  });
});
