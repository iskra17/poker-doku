import { afterEach, describe, expect, it } from 'vitest';
import type { RealtimeAck } from '../lib/realtime/protocol';
import type { RoomConfig } from '../lib/poker/types';
import { eventLog } from './event-log';
import { createSocketTestHarness } from './socket-test-harness';
import type { ConnectedTestClient, SocketTestHarness } from './socket-test-harness';

interface RawSocket {
  emit(event: string, ...args: unknown[]): void;
}

const HUMAN_ROOM: RoomConfig = {
  name: 'Socket boundary room',
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

function joinRoom(
  client: ConnectedTestClient,
  roomId: string,
): Promise<RealtimeAck<{ roomId: string }>> {
  return withAck(done => client.socket.emit('join-room', {
    roomId,
    buyIn: 2000,
    seatIndex: 0,
  }, done));
}

describe('Socket.IO runtime boundary', () => {
  let harness: SocketTestHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it('rejects malformed payloadless arguments before sit-out mutation and keeps the socket usable', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'Malformed ack room' });
    const client = await harness.connect('malformed-ack-toggle-1234');
    await expect(joinRoom(client, roomId)).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    const player = room.engine.state.players.find(candidate => candidate.id === client.playerId)!;
    const before = {
      sitOutNext: player.sitOutNext,
      status: player.status,
      chatCount: harness.runtime.roomManager.getChatHistory(roomId).length,
    };
    const rawSocket = client.socket as unknown as RawSocket;
    rawSocket.emit('toggle-sit-out', { forgedAck: true });
    const orderedUsable = await withAck(done => client.socket.emit('get-rooms', done));
    expect(orderedUsable).toMatchObject({ ok: true });
    expect(player.sitOutNext).toBe(before.sitOutNext);
    expect(player.status).toBe(before.status);
    expect(harness.runtime.roomManager.getChatHistory(roomId)).toHaveLength(before.chatCount);

    const rejected = await withAck(done => {
      rawSocket.emit('toggle-sit-out', { forgedAck: true }, done);
    });
    expect(rejected).toMatchObject({ ok: false, code: 'invalid-payload' });
    const usable = await withAck(done => client.socket.emit('get-rooms', done));

    expect(usable).toMatchObject({ ok: true });
    expect(player.sitOutNext).toBe(before.sitOutNext);
    expect(player.status).toBe(before.status);
    expect(harness.runtime.roomManager.getChatHistory(roomId)).toHaveLength(before.chatCount);
    expect(client.socket.connected).toBe(true);
  });

  it('rejects malformed payload-event arity before membership or payload logging', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'Malformed join room' });
    const client = await harness.connect('malformed-ack-join-1234');
    const rawSocket = client.socket as unknown as RawSocket;
    const joinLogsBefore = eventLog.recent({ playerId: client.playerId })
      .filter(event => event.type.startsWith('join-room')).length;
    rawSocket.emit('join-room', {
      roomId,
      buyIn: 2000,
      seatIndex: 0,
    }, { forgedAck: true });
    const orderedUsable = await withAck(done => client.socket.emit('get-rooms', done));
    expect(orderedUsable).toMatchObject({ ok: true });
    expect(harness.runtime.roomManager.getRoom(roomId)?.engine.state.players).toEqual([]);
    expect(eventLog.recent({ playerId: client.playerId })
      .filter(event => event.type.startsWith('join-room'))).toHaveLength(joinLogsBefore);

    const rejected = await withAck(done => {
      rawSocket.emit('join-room', {
        roomId,
        buyIn: 2000,
        seatIndex: 0,
      }, { forgedAck: true }, done);
    });
    expect(rejected).toMatchObject({ ok: false, code: 'invalid-payload' });
    const usable = await withAck(done => client.socket.emit('get-rooms', done));

    expect(usable).toMatchObject({ ok: true });
    expect(harness.runtime.roomManager.getRoom(roomId)?.engine.state.players).toEqual([]);
    expect(eventLog.recent({ playerId: client.playerId })
      .filter(event => event.type.startsWith('join-room'))).toHaveLength(joinLogsBefore);
    expect(client.socket.connected).toBe(true);
  });

  it('shares the player-action budget with sit-out without mutating the rejected toggle', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'Sit-out limit room' });
    const client = await harness.connect('sitout-limit-token-1234');
    await expect(joinRoom(client, roomId)).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    const player = room.engine.state.players.find(candidate => candidate.id === client.playerId)!;

    const before = {
      sitOutNext: player.sitOutNext,
      status: player.status,
      chatCount: harness.runtime.roomManager.getChatHistory(roomId).length,
    };
    const state = room.engine.state;
    const fillers: RealtimeAck<{ handNumber: number; actionSeq: number }>[] = [];
    for (let index = 0; index < 12; index++) {
      fillers.push(await withAck(done => client.socket.emit('player-action', {
        roomId,
        action: 'check',
        expectedHandNumber: state.handNumber,
        expectedActionSeq: state.actionSeq,
      }, done)));
    }
    expect(fillers).toEqual(Array.from({ length: 12 }, () => (
      expect.objectContaining({ ok: false, code: 'action-rejected' })
    )));

    const rejected = await withAck(done => client.socket.emit('toggle-sit-out', done));

    expect(rejected).toMatchObject({ ok: false, code: 'rate-limited' });
    expect(player.sitOutNext).toBe(before.sitOutNext);
    expect(player.status).toBe(before.status);
    expect(harness.runtime.roomManager.getChatHistory(roomId)).toHaveLength(before.chatCount);
  });

  it('returns action-rejected when sit-out cannot be toggled', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'Sit-out no-op room' });
    const client = await harness.connect('sitout-noop-token-1234');
    await expect(joinRoom(client, roomId)).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    const player = room.engine.state.players.find(candidate => candidate.id === client.playerId)!;
    player.pendingRemoval = true;
    const chatCount = harness.runtime.roomManager.getChatHistory(roomId).length;

    const rejected = await withAck(done => client.socket.emit('toggle-sit-out', done));

    expect(rejected).toMatchObject({ ok: false, code: 'action-rejected' });
    expect(player.sitOutNext).toBeFalsy();
    expect(harness.runtime.roomManager.getChatHistory(roomId)).toHaveLength(chatCount);
  });

  it('returns action-rejected when the time bank cannot be used', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'Time-bank no-op room' });
    const client = await harness.connect('timebank-noop-token-1234');
    await expect(joinRoom(client, roomId)).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    const player = room.engine.state.players.find(candidate => candidate.id === client.playerId)!;
    const chipCount = player.timeBankChips;

    const rejected = await withAck(done => client.socket.emit('use-time-bank', done));

    expect(rejected).toMatchObject({ ok: false, code: 'action-rejected' });
    expect(player.timeBankChips).toBe(chipCount);
  });

  it('rejects a stale connected socket after SessionManager ownership is superseded', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'Ownership guard room' });
    const token = 'ownership-guard-token-1234';
    const client = await harness.connect(token);
    await expect(joinRoom(client, roomId)).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    const player = room.engine.state.players.find(candidate => candidate.id === client.playerId)!;
    const before = {
      sitOutNext: player.sitOutNext,
      status: player.status,
      chatCount: harness.runtime.roomManager.getChatHistory(roomId).length,
    };
    harness.runtime.sessions.resolve(token, 'superseding-server-socket', client.playerId);

    const rejected = await withAck(done => client.socket.emit('toggle-sit-out', done));

    expect(rejected).toMatchObject({ ok: false, code: 'session-replaced' });
    expect(client.socket.connected).toBe(true);
    expect(player.sitOutNext).toBe(before.sitOutNext);
    expect(player.status).toBe(before.status);
    expect(harness.runtime.roomManager.getChatHistory(roomId)).toHaveLength(before.chatCount);
  });
});
