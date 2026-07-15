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

  it('교체된 소켓은 좌석을 변경하지 못하고 현재 세션에 grace를 시작하지 않는다', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '세션 소유권 방' });
    const first = await harness.connect('owned-seat-token-1234');
    await expect(joinRoom(first, roomId, 0, '소유자')).resolves.toMatchObject({ ok: true });

    const second = await harness.connect('owned-seat-token-1234');
    first.socket.emit('leave-room', { mode: 'exit' });
    await wait(80);

    const player = harness.runtime.roomManager.getRoom(roomId)?.engine.state.players
      .find(candidate => candidate.id === second.playerId);
    expect(player).toMatchObject({ id: second.playerId, isDisconnected: false });
    expect(harness.runtime.sessions.getByPlayerId(second.playerId)?.roomId).toBe(roomId);
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

    const invalidValues = await Promise.all([
      withAck(done => client.socket.emit('join-room', {
        roomId: 'room-1',
        playerName: '유한값 검사',
        buyIn: Infinity,
        seatIndex: 0,
      }, done)),
      withAck(done => client.socket.emit('join-room', {
        roomId: 'r'.repeat(101),
        playerName: '길이 검사',
        buyIn: 2000,
        seatIndex: 0,
      }, done)),
      withAck(done => client.socket.emit('player-action', {
        roomId: 'room-1',
        action: 'raise',
        amount: Infinity,
        expectedHandNumber: 0,
        expectedActionSeq: 0,
      }, done)),
      withAck(done => client.socket.emit('create-room', {
        name: '비유한 블라인드',
        bigBlind: Infinity,
        turnTime: 8,
        gameMode: 'cash',
        difficulty: 'normal',
        tableType: 'humans',
        botCount: 0,
      }, done)),
    ]);
    for (const ack of invalidValues) {
      expect(ack).toMatchObject({ ok: false, code: 'invalid-payload' });
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

  it('6인이 동시에 고유 좌석에 입장하고 7번째 전환 실패는 기존 좌석을 보존한다', async () => {
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
    const targetPlayers = harness.runtime.roomManager.getRoom(targetId)!.engine.state.players;
    expect(targetPlayers).toHaveLength(6);
    expect(new Set(targetPlayers.map(player => player.id)).size).toBe(6);
    expect(new Set(targetPlayers.map(player => player.seatIndex)).size).toBe(6);

    const failed = await joinRoom(mover, targetId, 0, '이동자');

    expect(failed).toMatchObject({ ok: false, code: 'room-full' });
    expect(source.engine.state.players.some(player => player.id === mover.playerId)).toBe(true);
    expect(harness.runtime.roomManager.getRoom(targetId)?.engine.state.players).toHaveLength(6);
  });

  it('같은 상태 버전의 중복 액션은 한 번만 처리한다', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '중복 액션 방' });
    const first = await harness.connect('double-first-1234');
    const second = await harness.connect('double-second-1234');
    await expect(joinRoom(first, roomId, 0, '첫째')).resolves.toMatchObject({ ok: true });
    await expect(joinRoom(second, roomId, 1, '둘째')).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    room.engine.startHand();

    const clients = new Map([
      [first.playerId, first],
      [second.playerId, second],
    ]);
    const smallBlind = room.engine.state.players[room.engine.state.activePlayerIndex];
    const callVersion = {
      handNumber: room.engine.state.handNumber,
      actionSeq: room.engine.state.actionSeq,
    };
    const call = await withAck<{ handNumber: number; actionSeq: number }>(done => {
      clients.get(smallBlind.id)!.socket.emit('player-action', {
        roomId,
        action: 'call',
        expectedHandNumber: callVersion.handNumber,
        expectedActionSeq: callVersion.actionSeq,
      }, done);
    });
    expect(call).toMatchObject({ ok: true });

    const bigBlind = room.engine.state.players[room.engine.state.activePlayerIndex];
    const checkVersion = {
      handNumber: room.engine.state.handNumber,
      actionSeq: room.engine.state.actionSeq,
    };
    const sendCheck = (): Promise<RealtimeAck<{ handNumber: number; actionSeq: number }>> => (
      withAck(done => clients.get(bigBlind.id)!.socket.emit('player-action', {
        roomId,
        action: 'check',
        expectedHandNumber: checkVersion.handNumber,
        expectedActionSeq: checkVersion.actionSeq,
      }, done))
    );

    const results = await Promise.all([sendCheck(), sendCheck()]);

    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toEqual([
      expect.objectContaining({ code: 'stale-state' }),
    ]);
    expect(room.engine.state.street).toBe('flop');
    expect(room.engine.state.actionSeq).toBe(checkVersion.actionSeq + 1);
  });

  it('grace 내 재접속은 좌석과 칩을 보존하고 복귀 메시지를 한 번만 남긴다', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '재접속 방' });
    const token = 'reconnect-token-1234';
    const first = await harness.connect(token);
    await expect(joinRoom(first, roomId, 2, '재접속자')).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    const before = room.engine.state.players.find(player => player.id === first.playerId)!;
    const original = { id: before.id, seatIndex: before.seatIndex, chips: before.chips };
    const reconnectMessageCount = (): number => harness!.runtime.roomManager.getChatHistory(roomId)
      .filter(message => message.message === '재접속자님이 다시 연결됐어요!').length;
    const countBefore = reconnectMessageCount();

    first.socket.disconnect();
    const second = await harness.connect(token);
    await wait(20);
    const resync = await withAck(done => second.socket.emit('resync', done));

    expect(resync).toMatchObject({ ok: true });
    expect(second.playerId).toBe(original.id);
    expect(room.engine.state.players.find(player => player.id === second.playerId)).toMatchObject(original);
    expect(reconnectMessageCount()).toBe(countBefore + 1);
  });

  it('로비 연결과 제거된 좌석의 세션을 disconnect 수명주기에서 회수한다', async () => {
    harness = await createSocketTestHarness();
    const lobby = await harness.connect('lobby-prune-token-1234');
    lobby.socket.disconnect();
    await wait(20);
    expect(harness.runtime.sessions.stats()).toEqual({ sessions: 0, sockets: 0, grace: 0 });

    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: 'grace 만료 방' });
    const seated = await harness.connect('seat-prune-token-1234');
    await expect(joinRoom(seated, roomId, 0, '만료자')).resolves.toMatchObject({ ok: true });
    seated.socket.disconnect();
    await wait(80);

    expect(harness.runtime.roomManager.getRoom(roomId)).toBeUndefined();
    expect(harness.runtime.sessions.stats()).toEqual({ sessions: 0, sockets: 0, grace: 0 });
  });

  it('종료 SnG 보존 만료는 참가자를 room-lost로 보내고 세션 방을 비운다', async () => {
    harness = await createSocketTestHarness({ sngRetentionMs: 30 });
    const roomId = harness.runtime.roomManager.createRoom({
      ...HUMAN_ROOM,
      name: '만료 SnG',
      gameMode: 'sng',
      startingStack: 1500,
      minBuyIn: 1500,
      maxBuyIn: 1500,
      tableType: 'mixed',
    });
    const client = await harness.connect('expired-sng-token-1234');
    await expect(joinRoom(client, roomId, 0, '결과 관전자')).resolves.toMatchObject({ ok: true });
    const lost = new Promise<{ message?: string } | undefined>(resolve => {
      client.socket.once('room-lost', resolve);
    });
    harness.runtime.roomManager.getRoom(roomId)!.engine.state.tournament!.finished = true;

    expect(harness.runtime.roomManager.retainFinishedTournament(roomId)).toBe(true);

    await expect(lost).resolves.toMatchObject({ message: '종료된 Sit & Go 보존 시간이 끝나 로비로 돌아왔어요.' });
    expect(harness.runtime.roomManager.getRoom(roomId)).toBeUndefined();
    expect(harness.runtime.sessions.getByPlayerId(client.playerId)?.roomId).toBeNull();
    expect(harness.runtime.roomManager.getRoomList()).toEqual([]);
  });

  it('일반 캐시 방의 정상 퇴장은 종료 SnG room-lost 안내를 보내지 않는다', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '정상 퇴장 방' });
    const client = await harness.connect('cash-leave-token-1234');
    await expect(joinRoom(client, roomId, 0, '퇴장자')).resolves.toMatchObject({ ok: true });
    let lostCount = 0;
    client.socket.on('room-lost', () => { lostCount++; });

    const left = await withAck(done => client.socket.emit('leave-room', { mode: 'exit' }, done));
    await wait(20);

    expect(left).toMatchObject({ ok: true });
    expect(lostCount).toBe(0);
    expect(harness.runtime.sessions.getByPlayerId(client.playerId)?.roomId).toBeNull();
  });

  it('읽기와 액션 요청 폭주는 rate-limited 후에도 소켓 연결을 유지한다', async () => {
    harness = await createSocketTestHarness();
    const client = await harness.connect('rate-limit-token-1234');

    const reads = await Promise.all([
      ...Array.from({ length: 5 }, () => withAck(done => client.socket.emit('get-rooms', done))),
      ...Array.from({ length: 5 }, () => withAck(done => client.socket.emit('resync', done))),
      withAck(done => client.socket.emit('get-rooms', done)),
    ]);
    expect(reads.filter(ack => ack.ok)).toHaveLength(10);
    expect(reads.filter(ack => !ack.ok)).toEqual([
      expect.objectContaining({ code: 'rate-limited' }),
    ]);

    const actions = await Promise.all(Array.from({ length: 13 }, () => (
      withAck(done => client.socket.emit('player-action', {
        roomId: 'room-does-not-exist',
        action: 'check',
        expectedHandNumber: 0,
        expectedActionSeq: 0,
      }, done))
    )));
    expect(actions.filter(ack => !ack.ok && ack.code === 'action-rejected')).toHaveLength(12);
    expect(actions.filter(ack => !ack.ok && ack.code === 'rate-limited')).toHaveLength(1);

    const stillUsable = await withAck(done => client.socket.emit('leave-room', { mode: 'exit' }, done));
    expect(stillUsable).toMatchObject({ ok: true });
    expect(client.socket.connected).toBe(true);
  });

  it('입장·방 생성·채팅 폭주를 연결별로 제한하고 허용된 요청만 반영한다', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '빈도 제한 방' });
    const first = await harness.connect('mutation-limit-first-1234');

    await expect(joinRoom(first, roomId, 0, '첫 연결')).resolves.toMatchObject({ ok: true });
    const joins = await Promise.all([
      ...Array.from({ length: 4 }, (_, index) => joinRoom(first, `missing-${index}`, 0)),
      joinRoom(first, 'missing-limited', 0),
    ]);
    expect(joins.filter(ack => !ack.ok && ack.code === 'room-not-found')).toHaveLength(4);
    expect(joins.filter(ack => !ack.ok && ack.code === 'rate-limited')).toHaveLength(1);

    const chatCount = harness.runtime.roomManager.getChatHistory(roomId).length;
    const chats = await Promise.all(Array.from({ length: 2 }, () => (
      withAck(done => first.socket.emit('send-chat', { presetId: 'greet-1' }, done))
    )));
    expect(chats.filter(ack => ack.ok)).toHaveLength(1);
    expect(chats.filter(ack => !ack.ok && ack.code === 'rate-limited')).toHaveLength(1);
    expect(harness.runtime.roomManager.getChatHistory(roomId)).toHaveLength(chatCount + 1);

    const createRoom = () => withAck<{ roomId: string }>(done => first.socket.emit('create-room', {
      name: '새 빈도 제한 방',
      bigBlind: 20,
      turnTime: 8,
      gameMode: 'cash',
      difficulty: 'normal',
      tableType: 'humans',
      botCount: 0,
    }, done));
    const creations = await Promise.all([createRoom(), createRoom()]);
    expect(creations.filter(ack => ack.ok)).toHaveLength(1);
    expect(creations.filter(ack => !ack.ok && ack.code === 'rate-limited')).toHaveLength(1);

    const second = await harness.connect('mutation-limit-second-1234');
    const isolatedCreation = await withAck<{ roomId: string }>(done => second.socket.emit('create-room', {
      name: '다른 연결의 방',
      bigBlind: 20,
      turnTime: 8,
      gameMode: 'cash',
      difficulty: 'normal',
      tableType: 'humans',
      botCount: 0,
    }, done));
    expect(isolatedCreation).toMatchObject({ ok: true });
    expect(first.socket.connected).toBe(true);
  });
});
