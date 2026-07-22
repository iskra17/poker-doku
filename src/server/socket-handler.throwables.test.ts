import { afterEach, describe, expect, it } from 'vitest';
import type { RealtimeAck, ThrowableThrownPayload } from '../lib/realtime/protocol';
import type { RoomConfig } from '../lib/poker/types';
import { THROW_COOLDOWN_MS } from '../lib/throwables/catalog';
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
  name: '투척 테스트 방',
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
): Promise<RealtimeAck<{ roomId: string }>> {
  return withAck(done => client.socket.emit('join-room', {
    roomId,
    buyIn: 2000,
    seatIndex,
  }, done));
}

function throwItem(
  client: ConnectedTestClient,
  itemId: string,
  targetPlayerId: string,
): Promise<RealtimeAck<{ cooldownMs: number }>> {
  return withAck(done => client.socket.emit('throw-item', { itemId, targetPlayerId }, done));
}

function collectThrown(client: ConnectedTestClient): ThrowableThrownPayload[] {
  const received: ThrowableThrownPayload[] = [];
  client.socket.on('throwable-thrown', payload => received.push(payload));
  return received;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('throw-item 소켓 핸들러', () => {
  let harness: SocketTestHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it('착석자 투척이 방 전체에 브로드캐스트되고 개인 쿨다운이 걸린다', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(HUMAN_ROOM);
    const alice = await harness.connect('alice-token');
    const bob = await harness.connect('bob-token');
    expect((await joinRoom(alice, roomId, 0)).ok).toBe(true);
    expect((await joinRoom(bob, roomId, 1)).ok).toBe(true);

    const aliceSeen = collectThrown(alice);
    const bobSeen = collectThrown(bob);

    const ack = await throwItem(alice, 'tomato', bob.playerId);
    expect(ack).toEqual({ ok: true, data: { cooldownMs: THROW_COOLDOWN_MS } });

    await wait(50);
    // 던진 본인 포함 방 전체 수신 (연출은 서버 에코 단일 경로)
    for (const seen of [aliceSeen, bobSeen]) {
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        roomId,
        itemId: 'tomato',
        fromPlayerId: alice.playerId,
        fromSeatIndex: 0,
        targetPlayerId: bob.playerId,
        targetSeatIndex: 1,
      });
      expect(seen[0].throwId.length).toBeGreaterThan(0);
    }

    // 같은 플레이어의 즉시 재투척은 쿨다운 거절
    const again = await throwItem(alice, 'tissue', bob.playerId);
    expect(again).toMatchObject({ ok: false, code: 'rate-limited' });

    // 쿨다운은 개인 단위 — 다른 플레이어는 바로 던질 수 있다
    const bobAck = await throwItem(bob, 'tissue', alice.playerId);
    expect(bobAck.ok).toBe(true);
    await wait(50);
    expect(aliceSeen).toHaveLength(2);
  });

  it('미착석·자기 자신·미지 아이템·부재 대상 투척을 거절한다', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(HUMAN_ROOM);
    const alice = await harness.connect('alice-token');
    const bob = await harness.connect('bob-token');
    const lobbyist = await harness.connect('lobby-token');
    expect((await joinRoom(alice, roomId, 0)).ok).toBe(true);
    expect((await joinRoom(bob, roomId, 1)).ok).toBe(true);

    // 방에 없는 클라이언트
    expect(await throwItem(lobbyist, 'tomato', alice.playerId))
      .toMatchObject({ ok: false, code: 'action-rejected' });

    // 미지 아이템 id — 카탈로그 조회 실패는 invalid-payload
    expect(await throwItem(alice, 'grenade', bob.playerId))
      .toMatchObject({ ok: false, code: 'invalid-payload' });

    // payload 형식 오류
    expect(await withAck<{ cooldownMs: number }>(done =>
      alice.socket.emit('throw-item', { itemId: 42 } as never, done),
    )).toMatchObject({ ok: false, code: 'invalid-payload' });

    // 자기 자신
    expect(await throwItem(alice, 'tomato', alice.playerId))
      .toMatchObject({ ok: false, code: 'action-rejected' });

    // 같은 방에 없는 대상
    expect(await throwItem(alice, 'tomato', lobbyist.playerId))
      .toMatchObject({ ok: false, code: 'action-rejected' });

    // 거절만 쌓인 상태에서는 쿨다운이 소모되지 않았어야 한다
    const finalAck = await throwItem(alice, 'tomato', bob.playerId);
    expect(finalAck.ok).toBe(true);
  });
});
