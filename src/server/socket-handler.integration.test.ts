import { afterEach, describe, expect, it } from 'vitest';
import type { GameUpdatePayload, RealtimeAck } from '../lib/realtime/protocol';
import type { RoomConfig } from '../lib/poker/types';
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

const HUMAN_ROOM: RoomConfig = {
  name: '테스트 방',
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 800,
  maxBuyIn: 4000,
  maxPlayers: 6,
  turnTime: 8,
  gameMode: 'cash',
  difficulty: 'normal',
  botCount: 0,
  tableType: 'humans',
};

function joinRoom(
  client: ConnectedTestClient,
  roomId: string,
  seatIndex: number,
  playerName = `테스터${seatIndex}`,
): Promise<RealtimeAck<{ roomId: string }>> {
  return withAck(done => client.socket.emit('join-room', {
    roomId,
    playerName,
    buyIn: 2000,
    seatIndex,
  }, done));
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Socket.IO 멀티클라이언트 경계', () => {
  let harness: SocketTestHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it('같은 토큰의 새 연결이 이전 소켓을 서버 종료하고 소유권을 가져간다', async () => {
    harness = await createSocketTestHarness();
    const first = await harness.connect('same-token-1234');
    const replaced = new Promise<{ message: string }>(resolve => {
      first.socket.once('session-replaced', resolve);
    });
    const disconnected = new Promise<string>(resolve => {
      first.socket.once('disconnect', resolve);
    });

    const second = await harness.connect('same-token-1234');

    await expect(replaced).resolves.toEqual({
      message: '다른 탭에서 게임을 열어 이 연결을 종료했어요.',
    });
    await expect(disconnected).resolves.toBe('io server disconnect');
    expect(first.socket.connected).toBe(false);
    expect(harness.runtime.sessions.isCurrentSocket(second.playerId, second.socket.id!)).toBe(true);
  });

  it('malformed payload를 거절한 뒤에도 소켓이 정상 응답한다', async () => {
    harness = await createSocketTestHarness();
    const client = await harness.connect('payload-token-1234');

    for (const payload of [null, [], {}]) {
      const acks = await Promise.all([
        withAck(done => client.socket.emit('join-room', payload, done)),
        withAck(done => client.socket.emit('player-action', payload, done)),
        withAck(done => client.socket.emit('create-room', payload, done)),
        withAck(done => client.socket.emit('send-chat', payload, done)),
        withAck(done => client.socket.emit('leave-room', payload, done)),
      ]);
      for (const ack of acks) {
        expect(ack).toMatchObject({ ok: false, code: 'invalid-payload' });
      }
    }

    const rooms = new Promise(resolve => client.socket.once('room-list', resolve));
    client.socket.emit('get-rooms');
    await expect(rooms).resolves.toEqual([]);
  });

  it('방을 옮긴 소켓에는 이전 방의 개인 업데이트를 보내지 않는다', async () => {
    harness = await createSocketTestHarness();
    const roomA = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'A 방' });
    const roomB = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'B 방' });
    const mover = await harness.connect('room-mover-1234');
    const supporter = await harness.connect('room-support-1234');
    await expect(joinRoom(mover, roomA, 0, '이동자')).resolves.toMatchObject({ ok: true });
    await expect(joinRoom(supporter, roomA, 1, '잔류자')).resolves.toMatchObject({ ok: true });
    const source = harness.runtime.roomManager.getRoom(roomA)!;
    source.engine.startHand();
    expect(source.engine.state.isHandInProgress).toBe(true);

    await expect(joinRoom(mover, roomB, 0, '이동자')).resolves.toMatchObject({ ok: true });
    const updates: GameUpdatePayload[] = [];
    const onUpdate = (payload: GameUpdatePayload): void => { updates.push(payload); };
    mover.socket.on('game-update', onUpdate);

    harness.runtime.roomManager.resumeRoom(roomA);
    await wait(100);

    mover.socket.off('game-update', onUpdate);
    expect(updates).toEqual([]);
  });

  it('가득 찬 방으로 전환 실패해도 기존 방 좌석을 보존한다', async () => {
    harness = await createSocketTestHarness();
    const sourceId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '출발 방' });
    const targetId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '만석 방' });
    const mover = await harness.connect('failed-mover-1234');
    await expect(joinRoom(mover, sourceId, 0, '이동자')).resolves.toMatchObject({ ok: true });
    const source = harness.runtime.roomManager.getRoom(sourceId)!;

    const occupants = await Promise.all(
      Array.from({ length: 6 }, (_, index) => harness!.connect(`target-user-${index}-1234`)),
    );
    const targetAcks = await Promise.all(
      occupants.map((client, index) => joinRoom(client, targetId, index)),
    );
    expect(targetAcks.every(ack => ack.ok)).toBe(true);

    const failed = await joinRoom(mover, targetId, 0, '이동자');

    expect(failed).toMatchObject({ ok: false, code: 'room-full' });
    expect(source.engine.state.players.some(player => player.id === mover.playerId)).toBe(true);
    expect(harness.runtime.roomManager.getRoom(targetId)?.engine.state.players).toHaveLength(6);
  });
});
