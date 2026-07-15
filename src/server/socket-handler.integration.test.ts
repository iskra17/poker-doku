import { afterEach, describe, expect, it } from 'vitest';
import type { RealtimeAck } from '../lib/realtime/protocol';
import { createSocketTestHarness } from './socket-test-harness';
import type { SocketTestHarness } from './socket-test-harness';

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
});
