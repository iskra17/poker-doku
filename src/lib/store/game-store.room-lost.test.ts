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

function seatedInRoom() {
  useGameStore.setState({
    currentRoomId: 'story-room-1',
    gameState: { id: 'story-room-1' } as never,
    chatMessages: [{
      id: 'chat-1', roomId: 'story-room-1', playerId: 'p1',
      playerName: '수련생', message: '안녕하세요', timestamp: 1, type: 'player',
    }] as never,
    tableNotice: '무언가 안내',
    joinError: null,
  });
  useGameStore.getState().connect();
  const onRoomLost = socketHarness.listeners.get('room-lost');
  if (!onRoomLost) throw new Error('room-lost listener missing');
  return onRoomLost;
}

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
    joinError: null,
    joinErrorCode: null,
  });
  socketHarness.listeners.clear();
  vi.clearAllMocks();
});

describe('game store room-lost', () => {
  it('일반 회수는 안내 문구를 로비에 남긴다', () => {
    const onRoomLost = seatedInRoom();
    onRoomLost({ message: '자리가 회수되었어요.' } as never);
    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: null,
      gameState: null,
      chatMessages: [],
      joinError: '자리가 회수되었어요.',
    });
  });

  it('메시지가 없으면 기본 안내로 대체한다', () => {
    const onRoomLost = seatedInRoom();
    onRoomLost(undefined as never);
    expect(useGameStore.getState().joinError).toBe('게임 연결이 초기화되어 로비로 돌아왔어요.');
  });

  // 스토리 라이브 스텝의 정상 종료 — 서버가 방을 내리고 다음 스텝 story-update를 이어 보낸다.
  // 여기서 토스트를 띄우면 챕터가 정상 진행되는데도 "연결이 초기화되었다"는 오해를 준다.
  it('스토리 스텝 종료(reason: story-end)는 방만 정리하고 토스트를 띄우지 않는다', () => {
    const onRoomLost = seatedInRoom();
    onRoomLost({ message: '수련 테이블을 정리했어요.', reason: 'story-end' } as never);
    expect(useGameStore.getState()).toMatchObject({
      currentRoomId: null,
      gameState: null,
      chatMessages: [],
      tableNotice: null,
      joinError: null,
      joinErrorCode: null,
    });
  });
});
