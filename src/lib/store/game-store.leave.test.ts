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
  it('signals only a replaced socket as requiring a fresh connection', () => {
    useGameStore.setState({ connectionState: 'connected' });
    expect(useGameStore.getState().needsFreshConnection()).toBe(false);
    useGameStore.setState({ connectionState: 'replaced' });
    expect(useGameStore.getState().needsFreshConnection()).toBe(true);
  });

  it('disconnect clears every realtime and table snapshot atomically', () => {
    const removeAllListeners = vi.fn();
    const disconnect = vi.fn();
    const socket = {
      connected: true,
      emit: vi.fn(),
      removeAllListeners,
      disconnect,
    } as unknown as PokerClientSocket;
    useGameStore.setState({
      socket,
      connected: true,
      connectionState: 'connected',
      publicProfileId: 'profile-1',
      playerName: '벚꽃 여우',
      publicAvatarId: 'sakura',
      myPlayerId: 'profile-1',
      currentRoomId: 'room-1',
      pendingRoomId: 'room-2',
      pendingAction: { handNumber: 3, actionSeq: 4 },
      gameState: { id: 'room-1' } as never,
      chatMessages: [{
        id: 'chat-1', roomId: 'room-1', playerId: 'profile-1',
        playerName: '벚꽃 여우', message: '안녕하세요', timestamp: 1, type: 'player',
      }],
      rooms: [{
        id: 'room-1', name: '방', playerCount: 1, maxPlayers: 6,
        blinds: '10/20', status: 'Playing',
      }],
      joinError: 'old error',
      tableNotice: 'old notice',
      showCreateRoom: true,
    });

    useGameStore.getState().disconnect();

    expect(removeAllListeners).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(useGameStore.getState()).toMatchObject({
      socket: null,
      connected: false,
      connectionState: 'connecting',
      publicProfileId: null,
      playerName: '',
      publicAvatarId: null,
      myPlayerId: null,
      currentRoomId: null,
      pendingRoomId: null,
      pendingAction: null,
      gameState: null,
      chatMessages: [],
      rooms: [],
      joinError: null,
      tableNotice: null,
      showCreateRoom: false,
    });
  });

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

  it('coerces a non-literal mode (leaked click event) to exit before emitting', async () => {
    // onClick={onLeave}류 실수로 React 이벤트 객체가 mode 인자로 새면, 순환 참조 payload가
    // socket.io hasBinary 무한 재귀를 일으켜 emit이 죽는다 (2026-07-22 SnG 종료 모달 먹통).
    const { socket, emit } = socketRespondingWith({ ok: true });
    useGameStore.setState({ socket, connected: true, currentRoomId: 'room-1' });

    const eventLike: Record<string, unknown> = { type: 'click' };
    eventLike.view = eventLike; // 실제 이벤트처럼 순환 참조
    const left = await useGameStore.getState().leaveRoom(
      eventLike as unknown as 'exit',
    );

    expect(left).toBe(true);
    expect(emit).toHaveBeenCalledWith('leave-room', { mode: 'exit' }, expect.any(Function));
  });
});
