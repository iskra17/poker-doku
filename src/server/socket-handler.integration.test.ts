import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameUpdatePayload, RealtimeAck } from '../lib/realtime/protocol';
import type { RoomConfig } from '../lib/poker/types';
import { createSocketTestHarness } from './socket-test-harness';
import type { ConnectedTestClient, SocketTestHarness } from './socket-test-harness';
import type { ProfileKdf } from './profile-manager';

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

const WALLET_CASH_ROOM: RoomConfig = {
  ...HUMAN_ROOM,
  name: '지갑 캐시 방',
  economyMode: 'wallet',
};

const WALLET_SNG_ROOM: RoomConfig = {
  ...HUMAN_ROOM,
  name: '지갑 Sit & Go',
  gameMode: 'sng',
  economyMode: 'wallet',
  startingStack: 1_500,
  minBuyIn: 1_500,
  maxBuyIn: 1_500,
  entryBuyIn: 1_500,
  entryFee: 150,
  tableType: 'mixed',
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

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Socket.IO 멀티클라이언트 경계', () => {
  let harness: SocketTestHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it('rejects missing and invalid profile cookies with a safe handshake error', async () => {
    harness = await createSocketTestHarness();

    await expect(harness.connect('missing-cookie-token', { profileCookie: null }))
      .rejects.toMatchObject({ message: 'profile-required' });
    await expect(harness.connect('invalid-cookie-token', {
      profileCookie: 'poker_doku_profile=invalid',
    })).rejects.toMatchObject({ message: 'profile-required' });
    await expect(harness.connect('empty-cookie-token', {
      profileCookie: 'poker_doku_profile=',
    })).rejects.toMatchObject({ message: 'profile-required' });
    await expect(harness.connect('duplicate-cookie-token', {
      profileCookie: 'poker_doku_profile=first; poker_doku_profile=second',
    })).rejects.toMatchObject({ message: 'profile-required' });
  });

  it('applies the shared remote-address auth limit before profile authentication', async () => {
    harness = await createSocketTestHarness({ profileAuthLimit: 1 });
    const authenticate = vi.spyOn(harness.profileManager, 'authenticateCredential');
    const invalidCookie = `poker_doku_profile=${'a'.repeat(43)}`;

    const first = harness.connect('rate-first-token', { profileCookie: invalidCookie });
    const limited = harness.connect('rate-second-token', { profileCookie: invalidCookie });

    await expect(first).rejects.toMatchObject({ message: 'profile-required' });
    await expect(limited).rejects.toMatchObject({ message: 'profile-required' });
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('rejects excess profile KDF concurrency and releases the shared gate capacity', async () => {
    harness = await createSocketTestHarness({ profileConcurrency: 1 });
    const created = await harness.createProfile({ avatarId: 'hana' });
    let release!: () => void;
    const authenticate = vi.spyOn(harness.profileManager, 'authenticateCredential');
    authenticate.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve(created.profile);
    }));

    const firstPromise = harness.connect('gate-first-token', { profileCookie: created.cookie });
    for (let attempt = 0; attempt < 100 && authenticate.mock.calls.length === 0; attempt += 1) {
      await wait(1);
    }
    expect(authenticate).toHaveBeenCalledTimes(1);

    await expect(harness.connect('gate-limited-token', { profileCookie: created.cookie }))
      .rejects.toMatchObject({ message: 'profile-required' });
    expect(authenticate).toHaveBeenCalledTimes(1);

    release();
    const first = await firstPromise;
    expect(first.playerId).toBe(created.profile.id);
    const afterRelease = await harness.connect('gate-after-token', { profileCookie: created.cookie });
    expect(afterRelease.playerId).toBe(created.profile.id);
  });

  it('never retains or prefix-logs arbitrary transport tokens', async () => {
    harness = await createSocketTestHarness();
    const created = await harness.createProfile({ avatarId: 'hana' });
    const credential = created.cookie.split('=', 2)[1];
    const transportTokens = [
      `${credential}x`,
      '잘못된-복구문구-password-credential',
    ];

    for (const transportToken of transportTokens) {
      const client = await harness.connect(transportToken, {
        profileCookie: created.cookie,
      });

      expect(client.playerId).toBe(created.profile.id);
      const serverData = harness.getServerSocketData(client.socket.id!);
      expect(serverData).toMatchObject({
        profileId: created.profile.id,
        profileAlias: created.profile.alias,
        profileAvatarId: created.profile.avatarId,
        hadTransportToken: true,
        transportTokenHint: expect.stringMatching(/^t_[A-Za-z0-9_-]{12}$/),
      });
      expect(harness.getServerSocketAuth(client.socket.id!)).not.toHaveProperty('sessionToken');
      expect(harness.getServerSocketCookie(client.socket.id!)).toBeUndefined();
      expect(JSON.stringify(
        harness.getServerSocketRawHeaders(client.socket.id!),
      )).not.toContain(credential);
      expect(JSON.stringify(serverData)).not.toContain(transportToken);
      expect(JSON.stringify(
        harness.runtime.sessions.getByPlayerId(client.playerId),
      )).not.toContain(transportToken.slice(0, 6));
      expect(JSON.stringify(harness.recentEvents())).not.toContain(transportToken);
      expect(JSON.stringify(harness.recentEvents())).not.toContain(transportToken.slice(0, 6));
    }
  });

  it('replaces the old socket for the same profile even with a different transport token', async () => {
    harness = await createSocketTestHarness();
    const created = await harness.createProfile({ avatarId: 'sakura' });
    const first = await harness.connect('first-profile-token', { profileCookie: created.cookie });
    const replaced = new Promise<{ message: string }>(resolve => {
      first.socket.once('session-replaced', resolve);
    });

    const second = await harness.connect('second-profile-token', { profileCookie: created.cookie });

    await expect(replaced).resolves.toMatchObject({ message: expect.any(String) });
    expect(first.socket.connected).toBe(false);
    expect(second.playerId).toBe(created.profile.id);
    expect(harness.runtime.sessions.stats().sessions).toBe(1);
  });

  it('isolates different authenticated profiles that reuse a transport token', async () => {
    harness = await createSocketTestHarness();
    const firstProfile = await harness.createProfile({ avatarId: 'ara' });
    const secondProfile = await harness.createProfile({ avatarId: 'elena' });

    const first = await harness.connect('shared-profile-token', { profileCookie: firstProfile.cookie });
    const second = await harness.connect('shared-profile-token', { profileCookie: secondProfile.cookie });

    expect(first.socket.connected).toBe(true);
    expect(second.socket.connected).toBe(true);
    expect(first.playerId).toBe(firstProfile.profile.id);
    expect(second.playerId).toBe(secondProfile.profile.id);
    expect(harness.runtime.sessions.stats()).toMatchObject({ sessions: 2, sockets: 2 });
  });

  it('seats the authenticated alias and avatar and rejects legacy identity fields', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '프로필 권위 방' });
    const created = await harness.createProfile({ avatarId: 'vivian' });
    const client = await harness.connect('identity-authority-token', { profileCookie: created.cookie });

    const malicious = await withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 2000,
      seatIndex: 0,
      playerName: '공격자 지정 이름',
      avatar: 'ara',
    }, done));
    expect(malicious).toMatchObject({ ok: false, code: 'invalid-payload' });

    await expect(joinRoom(client, roomId, 0)).resolves.toMatchObject({ ok: true });
    const player = harness.runtime.roomManager.getRoom(roomId)?.engine.state.players
      .find(candidate => candidate.id === created.profile.id);
    expect(player).toMatchObject({
      name: created.profile.alias,
      avatar: created.profile.avatarId,
    });
    const credential = created.cookie.split('=', 2)[1];
    expect(JSON.stringify(
      harness.runtime.roomManager.getRoom(roomId)?.engine.getPublicState(client.playerId),
    )).not.toContain(credential);
  });

  it('atomically funds a wallet cash seat, reuses it on rejoin, and cashes out on clean exit', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_CASH_ROOM);
    const created = await harness.createProfile();
    const client = await harness.connect('wallet-seat-token', {
      profileCookie: created.cookie,
    });

    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 4_000,
      seatIndex: 0,
    }, done))).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 6_000,
      activeEscrow: 4_000,
      activeRoomId: roomId,
    });

    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 4_000,
      seatIndex: 0,
    }, done))).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(created.profile.id).balance).toBe(6_000);

    await expect(withAck(done => client.socket.emit(
      'leave-room',
      { mode: 'exit' },
      done,
    ))).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 10_000,
      activeEscrow: 0,
      activeRoomId: null,
    });
  });

  it('refunds wallet admission when seat insertion fails', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_CASH_ROOM);
    const created = await harness.createProfile();
    const client = await harness.connect('wallet-rollback-token', {
      profileCookie: created.cookie,
    });
    vi.spyOn(harness.runtime.roomManager, 'joinRoom').mockReturnValueOnce(false);

    const joined = await withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 4_000,
      seatIndex: 0,
    }, done));

    expect(joined).toMatchObject({ ok: false, code: 'room-full' });
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 10_000,
      activeEscrow: 0,
      activeRoomId: null,
    });
  });

  it('forces casual SNG economy config and refuses paid bot filling', async () => {
    harness = await createSocketTestHarness();
    const created = await harness.createProfile();
    const client = await harness.connect('sng-config-token', {
      profileCookie: created.cookie,
    });
    const createdRoom = await withAck<{ roomId: string }>(done => client.socket.emit(
      'create-room',
      {
        name: '일반 토너먼트',
        bigBlind: 999,
        turnTime: 8,
        gameMode: 'sng',
        difficulty: 'normal',
        tableType: 'mixed',
        botCount: 5,
      },
      done,
    ));
    expect(createdRoom.ok).toBe(true);
    if (!createdRoom.ok) throw new Error('room creation failed');
    const roomId = createdRoom.data!.roomId;
    expect(harness.runtime.roomManager.getRoom(roomId)?.config).toMatchObject({
      gameMode: 'sng',
      economyMode: 'wallet',
      startingStack: 1_500,
      minBuyIn: 1_500,
      maxBuyIn: 1_500,
      entryBuyIn: 1_500,
      entryFee: 150,
    });

    await expect(joinRoom(client, roomId, 0)).resolves.toMatchObject({ ok: true });
    await expect(withAck(done => client.socket.emit('sng-fill-bots', done)))
      .resolves.toMatchObject({ ok: false, code: 'action-rejected' });
  });

  it('reserves a fixed SNG entry before seating, reuses it, and compensates seat failure', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_SNG_ROOM);
    const created = await harness.createProfile();
    const client = await harness.connect('sng-reserve-token', {
      profileCookie: created.cookie,
    });

    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 99_999,
      seatIndex: 0,
    }, done))).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 8_350,
      activeEscrow: 1_650,
      activeRoomId: roomId,
    });
    expect(harness.runtime.roomManager.getRoom(roomId)?.engine.state.players[0].chips)
      .toBe(1_500);

    await expect(joinRoom(client, roomId, 0)).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(created.profile.id).balance).toBe(8_350);

    const failedRoomId = harness.runtime.roomManager.createRoom(WALLET_SNG_ROOM);
    await expect(withAck(done => client.socket.emit(
      'leave-room', { mode: 'exit' }, done,
    ))).resolves.toMatchObject({ ok: true });
    vi.spyOn(harness.runtime.roomManager, 'joinRoom').mockReturnValueOnce(false);
    await expect(joinRoom(client, failedRoomId, 0)).resolves.toMatchObject({
      ok: false,
      code: 'room-full',
    });
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 10_000,
      activeEscrow: 0,
      activeRoomId: null,
    });
  });

  it('retires a refunded stale SNG memory seat before a fresh reserve', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_SNG_ROOM);
    const created = await harness.createProfile();
    const client = await harness.connect('sng-stale-seat-token', {
      profileCookie: created.cookie,
    });
    await expect(joinRoom(client, roomId, 0)).resolves.toMatchObject({ ok: true });
    harness.economyRuntime.cancelSngEntry(created.profile.id, roomId);
    expect(harness.walletState(created.profile.id).balance).toBe(10_000);

    await expect(joinRoom(client, roomId, 0)).resolves.toMatchObject({ ok: true });

    expect(harness.runtime.roomManager.getRoom(roomId)?.engine.state.players
      .filter(player => player.id === created.profile.id)).toHaveLength(1);
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 8_350,
      activeEscrow: 1_650,
      activeRoomId: roomId,
    });
  });

  it('refunds all waiting SNG entries when the room is disposed', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_SNG_ROOM);
    const profiles = await Promise.all([
      harness.createProfile(),
      harness.createProfile(),
    ]);
    const clients = await Promise.all(profiles.map((profile, index) => (
      harness!.connect(`sng-dispose-${index}`, { profileCookie: profile.cookie })
    )));
    await expect(joinRoom(clients[0], roomId, 0)).resolves.toMatchObject({ ok: true });
    await expect(joinRoom(clients[1], roomId, 1)).resolves.toMatchObject({ ok: true });

    expect(harness.runtime.roomManager.disposeRoom(roomId)).toBe(true);
    expect(profiles.map(profile => harness!.walletState(profile.profile.id).balance))
      .toEqual([10_000, 10_000]);
    expect(profiles.map(profile => harness!.walletState(profile.profile.id).activeEscrow))
      .toEqual([0, 0]);
  });

  it('preserves a waiting SNG reservation on disconnect and refunds explicit pre-start leave', async () => {
    harness = await createSocketTestHarness({ graceMs: 500 });
    const roomId = harness.runtime.roomManager.createRoom(WALLET_SNG_ROOM);
    const firstProfile = await harness.createProfile();
    const first = await harness.connect('sng-disconnect-token', {
      profileCookie: firstProfile.cookie,
    });
    await expect(joinRoom(first, roomId, 0)).resolves.toMatchObject({ ok: true });
    first.socket.disconnect();
    await wait(30);
    expect(harness.walletState(firstProfile.profile.id)).toEqual({
      balance: 8_350,
      activeEscrow: 1_650,
      activeRoomId: roomId,
    });

    const secondProfile = await harness.createProfile();
    const second = await harness.connect('sng-leave-token', {
      profileCookie: secondProfile.cookie,
    });
    await expect(joinRoom(second, roomId, 1)).resolves.toMatchObject({ ok: true });
    await expect(withAck(done => second.socket.emit(
      'leave-room', { mode: 'exit' }, done,
    ))).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(secondProfile.profile.id)).toEqual({
      balance: 10_000,
      activeEscrow: 0,
      activeRoomId: null,
    });
  });

  it('starts only after six paid humans, keeps started exits charged, and settles exact prizes', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_SNG_ROOM);
    const profiles = await Promise.all(Array.from({ length: 6 }, () => (
      harness!.createProfile()
    )));
    const clients = await Promise.all(profiles.map((profile, index) => (
      harness!.connect(`sng-six-${index}`, { profileCookie: profile.cookie })
    )));
    for (let index = 0; index < clients.length; index += 1) {
      await expect(joinRoom(clients[index], roomId, index))
        .resolves.toMatchObject({ ok: true });
    }
    await wait(2_100);
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    expect(room.engine.state.tournament).toMatchObject({
      entrants: 6,
      prizes: [4_500, 2_700, 1_800],
    });
    expect(profiles.map(profile => harness!.walletState(profile.profile.id).activeEscrow))
      .toEqual(Array(6).fill(1_500));

    await expect(withAck(done => clients[5].socket.emit(
      'leave-room', { mode: 'exit' }, done,
    ))).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(profiles[5].profile.id)).toEqual({
      balance: 8_350,
      activeEscrow: 1_500,
      activeRoomId: roomId,
    });

    room.engine.state.isHandInProgress = false;
    room.engine.state.tournament!.finished = true;
    room.engine.state.tournament!.results = profiles.map((profile, index) => ({
      playerId: profile.profile.id,
      name: profile.profile.alias,
      place: index + 1,
      prize: [4_500, 2_700, 1_800, 0, 0, 0][index],
    }));
    (harness.runtime.roomManager as unknown as {
      handleCompletedHand(roomId: string): void;
    }).handleCompletedHand(roomId);

    expect(profiles.map(profile => harness!.walletState(profile.profile.id).balance))
      .toEqual([12_850, 11_050, 10_150, 8_350, 8_350, 8_350]);
    expect(profiles.map(profile => harness!.walletState(profile.profile.id).activeEscrow))
      .toEqual(Array(6).fill(0));
  });

  it('does not start a full paid SNG when the storage start commit fails', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_SNG_ROOM);
    const profiles = await Promise.all(Array.from({ length: 6 }, () => (
      harness!.createProfile()
    )));
    const clients = await Promise.all(profiles.map((profile, index) => (
      harness!.connect(`sng-fail-${index}`, { profileCookie: profile.cookie })
    )));
    vi.spyOn(harness.economyRuntime, 'beforeTournament')
      .mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    for (let index = 0; index < clients.length; index += 1) {
      await expect(joinRoom(clients[index], roomId, index))
        .resolves.toMatchObject({ ok: true });
    }
    await wait(2_100);

    const state = harness.runtime.roomManager.getRoom(roomId)!.engine.state;
    expect(state.tournament?.entrants).toBe(0);
    expect(state.handNumber).toBe(0);
    expect(profiles.map(profile => harness!.walletState(profile.profile.id).activeEscrow))
      .toEqual(Array(6).fill(1_650));
  });

  it('keeps wallet cash escrow during disconnect grace', async () => {
    harness = await createSocketTestHarness({ graceMs: 500 });
    const roomId = harness.runtime.roomManager.createRoom(WALLET_CASH_ROOM);
    const created = await harness.createProfile();
    const client = await harness.connect('wallet-disconnect-token', {
      profileCookie: created.cookie,
    });
    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 4_000,
      seatIndex: 0,
    }, done))).resolves.toMatchObject({ ok: true });

    client.socket.disconnect();
    await wait(30);

    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 6_000,
      activeEscrow: 4_000,
      activeRoomId: roomId,
    });
  });

  it('debits exactly once when a busted wallet seat rebuys on rejoin', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_CASH_ROOM);
    const created = await harness.createProfile();
    const client = await harness.connect('wallet-rebuy-token', {
      profileCookie: created.cookie,
    });
    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 4_000,
      seatIndex: 0,
    }, done))).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    room.engine.addPlayer({
      id: 'rebuy-bot',
      name: '리바이 봇',
      type: 'bot',
      avatar: 'bot',
      chips: 4_000,
      seatIndex: 1,
      holeCards: [],
      currentBet: 0,
      totalContributed: 0,
      status: 'waiting',
      hasActed: false,
    });
    harness.economyRuntime.beforeHand(roomId, room.engine);
    room.engine.startHand();
    room.engine.state.players.find(player => player.id === created.profile.id)!.chips = 0;
    room.engine.state.players.find(player => player.id === 'rebuy-bot')!.chips = 8_000;
    room.engine.state.handRake = 0;
    room.engine.state.isHandInProgress = false;
    harness.economyRuntime.afterHand(roomId, room.engine);

    const rebuy = () => withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 2_000,
      seatIndex: 0,
    }, done));
    await expect(rebuy()).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 4_000,
      activeEscrow: 2_000,
      activeRoomId: roomId,
    });
    await expect(rebuy()).resolves.toMatchObject({ ok: true });
    expect(harness.walletState(created.profile.id).balance).toBe(4_000);
  });

  it('retires a cashed-out pending wallet seat before fresh same-room admission', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_CASH_ROOM);
    const created = await harness.createProfile();
    const opponentProfile = await harness.createProfile();
    const client = await harness.connect('wallet-pending-fresh-token', {
      profileCookie: created.cookie,
    });
    const opponent = await harness.connect('wallet-pending-opponent-token', {
      profileCookie: opponentProfile.cookie,
    });
    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 4_000,
      seatIndex: 1,
    }, done))).resolves.toMatchObject({ ok: true });
    await expect(withAck(done => opponent.socket.emit('join-room', {
      roomId,
      buyIn: 4_000,
      seatIndex: 0,
    }, done))).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    await wait(2_100);
    expect(room.engine.state.isHandInProgress).toBe(true);
    const beforeExit = room.engine.state.players.find(
      player => player.id === created.profile.id,
    )!.chips;

    await expect(withAck(done => client.socket.emit(
      'leave-room',
      { mode: 'exit' },
      done,
    ))).resolves.toMatchObject({ ok: true });
    expect(room.engine.state.players.find(player => player.id === created.profile.id))
      .toMatchObject({ chips: beforeExit, pendingRemoval: true });
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 6_000 + beforeExit,
      activeEscrow: 0,
      activeRoomId: null,
    });

    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 2_000,
      seatIndex: 1,
    }, done))).resolves.toMatchObject({ ok: true });
    const freshSeats = room.engine.state.players.filter(
      player => player.id === created.profile.id,
    );
    expect(freshSeats).toEqual([expect.objectContaining({ chips: 2_000 })]);
    expect(freshSeats[0]).not.toHaveProperty('pendingRemoval');
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 4_000 + beforeExit,
      activeEscrow: 2_000,
      activeRoomId: roomId,
    });

    await wait(2_100);
    expect(room.engine.state.handNumber).toBe(2);
    expect(room.engine.state.isHandInProgress).toBe(true);
  });

  it('revives an escrow-backed pending wallet seat without another debit', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom(WALLET_CASH_ROOM);
    const created = await harness.createProfile();
    const client = await harness.connect('wallet-backed-pending-token', {
      profileCookie: created.cookie,
    });
    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 4_000,
      seatIndex: 0,
    }, done))).resolves.toMatchObject({ ok: true });
    const seated = harness.runtime.roomManager.getRoom(roomId)!.engine.state.players[0];
    seated.pendingRemoval = true;
    seated.status = 'folded';

    await expect(withAck(done => client.socket.emit('join-room', {
      roomId,
      buyIn: 2_000,
      seatIndex: 0,
    }, done))).resolves.toMatchObject({ ok: true });

    expect(seated).toMatchObject({ chips: 4_000, pendingRemoval: false });
    expect(harness.walletState(created.profile.id)).toEqual({
      balance: 6_000,
      activeEscrow: 4_000,
      activeRoomId: roomId,
    });
  });

  it('rejects an old credential after recovery rotates it', async () => {
    harness = await createSocketTestHarness();
    const created = await harness.createProfile({ avatarId: 'chloe' });
    const recovered = await harness.recoverProfile(created.recoveryWords);

    expect(recovered?.profile.id).toBe(created.profile.id);
    await expect(harness.connect('old-credential-token', { profileCookie: created.cookie }))
      .rejects.toMatchObject({ message: 'profile-required' });
    const current = await harness.connect('new-credential-token', {
      profileCookie: recovered!.cookie,
    });
    expect(current.playerId).toBe(created.profile.id);
  });

  it('rejects a paused old-credential handshake when recovery commits during its KDF', async () => {
    let pauseNext = false;
    let signalStarted!: () => void;
    let releaseKdf!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const kdf: ProfileKdf = {
      derive: async (secret, salt) => {
        const result = createHash('sha256').update(secret, 'utf8').update(salt).digest();
        if (pauseNext) {
          pauseNext = false;
          signalStarted();
          await new Promise<void>(resolve => { releaseKdf = resolve; });
        }
        return result;
      },
    };
    harness = await createSocketTestHarness({ profileKdf: kdf });
    const created = await harness.createProfile({ avatarId: 'elena' });
    pauseNext = true;

    const staleHandshake = harness.connect('paused-old-token', {
      profileCookie: created.cookie,
    });
    await started;
    const recovered = await harness.recoverProfile(created.recoveryWords);
    releaseKdf();

    await expect(staleHandshake).rejects.toMatchObject({ message: 'profile-required' });
    const current = await harness.connect('paused-new-token', {
      profileCookie: recovered!.cookie,
    });
    expect(current.playerId).toBe(created.profile.id);
  });

  it('rejects a handshake if recovery commits after authentication returns its stale profile', async () => {
    harness = await createSocketTestHarness();
    const created = await harness.createProfile({ avatarId: 'ara' });
    const authenticate = harness.profileManager.authenticateCredential
      .bind(harness.profileManager);
    let recovered: Awaited<ReturnType<SocketTestHarness['recoverProfile']>> = null;
    vi.spyOn(harness.profileManager, 'authenticateCredential').mockImplementationOnce(async credential => {
      const staleProfile = await authenticate(credential);
      recovered = await harness!.recoverProfile(created.recoveryWords);
      return staleProfile;
    });

    await expect(harness.connect('post-auth-race-old', { profileCookie: created.cookie }))
      .rejects.toMatchObject({ message: 'profile-required' });
    const current = await harness.connect('post-auth-race-new', {
      profileCookie: recovered!.cookie,
    });
    expect(current.playerId).toBe(created.profile.id);
  });

  it('runtime revocation disconnects once, starts grace, and restores the seat with the new credential', async () => {
    harness = await createSocketTestHarness({ graceMs: 500 });
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '폐기 복귀 방' });
    const created = await harness.createProfile({ avatarId: 'sakura' });
    const oldClient = await harness.connect('revoked-transport-token', { profileCookie: created.cookie });
    await expect(joinRoom(oldClient, roomId, 0)).resolves.toMatchObject({ ok: true });
    const recovered = await harness.recoverProfile(created.recoveryWords);
    const replaced = new Promise<{ message: string }>(resolve => {
      oldClient.socket.once('session-replaced', resolve);
    });
    const disconnected = new Promise<string>(resolve => {
      oldClient.socket.once('disconnect', resolve);
    });

    harness.runtime.revokeProfile(created.profile.id);

    await expect(replaced).resolves.toMatchObject({ message: expect.any(String) });
    await expect(disconnected).resolves.toBe('io server disconnect');
    expect(harness.runtime.sessions.stats()).toEqual({ sessions: 1, sockets: 0, grace: 1 });
    const player = harness.runtime.roomManager.getRoom(roomId)?.engine.state.players
      .find(candidate => candidate.id === created.profile.id);
    expect(player?.isDisconnected).toBe(true);

    const restored = await harness.connect('fresh-transport-token', {
      profileCookie: recovered!.cookie,
    });
    expect(restored.playerId).toBe(created.profile.id);
    expect(harness.runtime.sessions.getByPlayerId(created.profile.id)?.roomId).toBe(roomId);
    expect(harness.runtime.sessions.stats()).toEqual({ sessions: 1, sockets: 1, grace: 0 });
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
    await expect(joinRoom(first, roomId, 0)).resolves.toMatchObject({ ok: true });

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
        buyIn: Infinity,
        seatIndex: 0,
      }, done)),
      withAck(done => client.socket.emit('join-room', {
        roomId: 'r'.repeat(101),
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
    await expect(joinRoom(mover, roomA, 0)).resolves.toMatchObject({ ok: true });
    await expect(joinRoom(supporter, roomA, 1)).resolves.toMatchObject({ ok: true });
    const source = harness.runtime.roomManager.getRoom(roomA)!;
    source.engine.startHand();
    expect(source.engine.state.isHandInProgress).toBe(true);

    await expect(joinRoom(mover, roomB, 0)).resolves.toMatchObject({ ok: true });
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
    await expect(joinRoom(mover, sourceId, 0)).resolves.toMatchObject({ ok: true });
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

    const failed = await joinRoom(mover, targetId, 0);

    expect(failed).toMatchObject({ ok: false, code: 'room-full' });
    expect(source.engine.state.players.some(player => player.id === mover.playerId)).toBe(true);
    expect(harness.runtime.roomManager.getRoom(targetId)?.engine.state.players).toHaveLength(6);
  });

  it('같은 상태 버전의 중복 액션은 한 번만 처리한다', async () => {
    harness = await createSocketTestHarness();
    const roomId = harness.runtime.roomManager.createRoom({ ...HUMAN_ROOM, name: '중복 액션 방' });
    const first = await harness.connect('double-first-1234');
    const second = await harness.connect('double-second-1234');
    await expect(joinRoom(first, roomId, 0)).resolves.toMatchObject({ ok: true });
    await expect(joinRoom(second, roomId, 1)).resolves.toMatchObject({ ok: true });
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
    await expect(joinRoom(first, roomId, 2)).resolves.toMatchObject({ ok: true });
    const room = harness.runtime.roomManager.getRoom(roomId)!;
    const before = room.engine.state.players.find(player => player.id === first.playerId)!;
    const original = { id: before.id, seatIndex: before.seatIndex, chips: before.chips };
    const reconnectMessageCount = (): number => harness!.runtime.roomManager.getChatHistory(roomId)
      .filter(message => message.message === `${before.name}님이 다시 연결됐어요!`).length;
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
    await expect(joinRoom(seated, roomId, 0)).resolves.toMatchObject({ ok: true });
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
    await expect(joinRoom(client, roomId, 0)).resolves.toMatchObject({ ok: true });
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
    await expect(joinRoom(client, roomId, 0)).resolves.toMatchObject({ ok: true });
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

    await expect(joinRoom(first, roomId, 0)).resolves.toMatchObject({ ok: true });
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
