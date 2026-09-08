import { afterEach, describe, expect, it } from 'vitest';
import type {
  RealtimeAck,
  WeeklyDojoCloseAck,
  WeeklyDojoStartAck,
} from '../lib/realtime/protocol';
import type { WeeklyDojoView } from '../lib/weekly-dojo/types';
import { createSocketTestHarness } from './socket-test-harness';
import type { ConnectedTestClient, SocketTestHarness } from './socket-test-harness';

/**
 * 주간 도장 소켓 계약 회귀:
 * - 스냅샷은 서버 계산값만 싣는다 (클라가 점수·완료를 제출할 필드가 없다)
 * - 시작하면 실제 개인 전용 방이 열리고, 로비 목록·다른 프로필의 입장에서 숨는다
 * - 다른 테이블에 앉아 있으면 시작을 거절한다 (좌석·뱅크롤 이중화 차단)
 * - 나가기는 기록을 남기고, 포기만 시도를 소비한다
 * - 지갑 잔액은 어느 경로에서도 변하지 않는다
 */

function withAck<T>(
  send: (done: (ack: RealtimeAck<T>) => void) => void,
): Promise<RealtimeAck<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ack timeout')), 2_000);
    send(ack => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

describe('weekly dojo socket events', () => {
  let harness: SocketTestHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  async function setup() {
    harness = await createSocketTestHarness();
    const profile = await harness.createProfile();
    const client = await harness.connect('token-dojo', { profileCookie: profile.cookie });
    return { h: harness, profile, client };
  }

  const view = (client: ConnectedTestClient) =>
    withAck<WeeklyDojoView>(done => (
      (client.socket as unknown as {
        emit: (name: string, cb: unknown) => void;
      }).emit('get-weekly-dojo', done)
    ));

  const startDojo = (client: ConnectedTestClient) =>
    withAck<WeeklyDojoStartAck>(done => (
      (client.socket as unknown as {
        emit: (name: string, payload: unknown, cb: unknown) => void;
      }).emit('weekly-dojo-start', {}, done)
    ));

  const forfeitDojo = (client: ConnectedTestClient) =>
    withAck<WeeklyDojoCloseAck>(done => (
      (client.socket as unknown as {
        emit: (name: string, payload: unknown, cb: unknown) => void;
      }).emit('weekly-dojo-forfeit', {}, done)
    ));

  it('serves a server-owned snapshot with three empty slots and no leaderboard entry', async () => {
    const { client } = await setup();

    const snapshot = await view(client);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok || !snapshot.data) return;
    const data = snapshot.data;

    expect(data.rules.startingChips).toBe(2_000);
    expect(data.rules.bigBlind).toBe(20);
    expect(data.rules.startingBB).toBe(100);
    expect(data.rules.maxHands).toBe(20);
    expect(data.rules.attemptsPerWeek).toBe(3);
    expect(data.rules.lineup).toHaveLength(5);
    expect(data.attempts.map(attempt => attempt.status)).toEqual(['empty', 'empty', 'empty']);
    expect(data.live).toBeNull();
    expect(data.totalNetBB).toBeNull();
    expect(data.rank).toBeNull();
    expect(data.weekEndsAt).toBeGreaterThan(data.serverNow);
    // 점수·완료 권위가 클라로 새지 않는다
    expect(JSON.stringify(data)).not.toMatch(/scoreMilliBB|committedChips|attemptId/);
  });

  it('opens a private table that stays out of the lobby and rejects other profiles', async () => {
    const { h, client } = await setup();

    const started = await startDojo(client);
    expect(started.ok).toBe(true);
    if (!started.ok || !started.data) return;
    const { roomId, slot } = started.data;
    expect(slot).toBe(1);

    const room = h.runtime.roomManager.getRoom(roomId);
    expect(room?.config.weeklyDojoAttemptId).toBeTruthy();
    expect(room?.engine.state.players).toHaveLength(6);
    expect(h.runtime.roomManager.getRoomList(client.playerId)
      .some(entry => entry.id === roomId)).toBe(false);

    const otherProfile = await h.createProfile();
    const other = await h.connect('token-other', { profileCookie: otherProfile.cookie });
    const rejected = await withAck<{ roomId: string }>(done => (
      (other.socket as unknown as {
        emit: (name: string, payload: unknown, cb: unknown) => void;
      }).emit('join-room', { roomId, buyIn: 2_000, seatIndex: 2 }, done)
    ));
    expect(rejected.ok).toBe(false);
    // 존재 자체를 드러내지 않는다
    expect(rejected.ok === false && rejected.code).toBe('room-not-found');
    expect(h.runtime.roomManager.getRoom(roomId)?.engine.state.players).toHaveLength(6);

    // 진행 중 시도는 live 뷰로만 노출된다
    const snapshot = await view(client);
    expect(snapshot.ok && snapshot.data?.live?.roomId).toBe(roomId);
    expect(snapshot.ok && snapshot.data?.attempts[0].status).toBe('live');
  });

  it('never grants a rebuy or a top-up to a busted challenge seat', async () => {
    const { h, client } = await setup();
    const started = await startDojo(client);
    const roomId = started.ok ? started.data!.roomId : '';
    const attemptId = started.ok ? started.data!.attemptId : '';

    // 파산 상태를 만든다 — 리바이/탑업이 열리면 기록이 무의미해진다
    const seat = h.runtime.roomManager.getRoom(roomId)!.engine.state.players
      .find(player => player.id === client.playerId)!;
    seat.chips = 0;

    const rejoin = await withAck<{ roomId: string }>(done => (
      (client.socket as unknown as {
        emit: (name: string, payload: unknown, cb: unknown) => void;
      }).emit('join-room', { roomId, buyIn: 2_000, seatIndex: 0 }, done)
    ));
    expect(rejoin.ok).toBe(true);
    expect(h.runtime.roomManager.getRoom(roomId)!.engine.state.players
      .find(player => player.id === client.playerId)!.chips).toBe(0);

    const topUp = await withAck<{ status: string; chips: number }>(done => (
      (client.socket as unknown as {
        emit: (name: string, payload: unknown, cb: unknown) => void;
      }).emit('cash-top-up', { targetChips: 2_000 }, done)
    ));
    expect(topUp.ok).toBe(false);
    expect(h.runtime.roomManager.getRoom(roomId)!.engine.state.players
      .find(player => player.id === client.playerId)!.chips).toBe(0);
    // 기록은 여전히 확정 스택(시작값) 기준으로만 남는다
    expect(h.weeklyDojoRepository.findAttempt(attemptId)?.committedChips).toBe(2_000);
  });

  it('settles the live hand before leaving so the loss cannot be erased', async () => {
    const { h, client } = await setup();
    const started = await startDojo(client);
    const roomId = started.ok ? started.data!.roomId : '';
    const attemptId = started.ok ? started.data!.attemptId : '';

    // 히어로가 칩을 넣고 그 핸드에 살아 있는 상태를 만든다
    const engine = h.runtime.roomManager.getRoom(roomId)!.engine;
    const state = engine.state;
    const hero = state.players.find(player => player.id === client.playerId)!;
    const villain = state.players.find(player => player.type === 'bot')!;
    state.isHandInProgress = true;
    state.handNumber = 1;
    state.street = 'preflop';
    hero.status = 'active';
    hero.chips = 1_700;
    hero.totalContributed = 300;
    villain.status = 'active';
    villain.chips = 1_700;
    villain.totalContributed = 300;
    state.pots = [{ amount: 600, eligiblePlayerIds: [hero.id, villain.id] }];
    state.activePlayerIndex = state.players.indexOf(villain);

    const left = await withAck<{ status?: string }>(done => (
      (client.socket as unknown as {
        emit: (name: string, payload: unknown, cb: unknown) => void;
      }).emit('leave-room', { mode: 'exit' }, done)
    ));
    expect(left.ok).toBe(true);

    // 나가는 순간 기여금 포기 스택이 기록된다 (진 핸드가 사라지지 않는다)
    const row = h.weeklyDojoRepository.findAttempt(attemptId)!;
    expect(row.handsPlayed).toBe(1);
    expect(row.committedChips).toBe(1_700);
    expect(row.status).toBe('live');
  });

  it('refuses to start while the player is seated at another table', async () => {
    const { h, client } = await setup();
    const roomId = h.runtime.roomManager.createRoom({
      name: '연습', smallBlind: 10, bigBlind: 20, minBuyIn: 800, maxBuyIn: 4_000,
      maxPlayers: 6, economyMode: 'practice', turnTime: 15, tableType: 'bots', botCount: 1,
    });
    const joined = await withAck<{ roomId: string }>(done => (
      (client.socket as unknown as {
        emit: (name: string, payload: unknown, cb: unknown) => void;
      }).emit('join-room', { roomId, buyIn: 2_000, seatIndex: 0 }, done)
    ));
    expect(joined.ok).toBe(true);

    const blocked = await startDojo(client);
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.code).toBe('action-rejected');
    // 좌석이 회수되지 않았다 — 거절은 아무것도 바꾸지 않는다
    expect(h.runtime.roomManager.getRoom(roomId)?.engine.state.players
      .some(player => player.id === client.playerId)).toBe(true);
  });

  it('keeps the attempt live when the table is left and resumes the same slot', async () => {
    const { h, client, profile } = await setup();

    const started = await startDojo(client);
    expect(started.ok && started.data).toBeTruthy();
    const attemptId = started.ok ? started.data!.attemptId : '';

    const left = await withAck<{ status?: string }>(done => (
      (client.socket as unknown as {
        emit: (name: string, payload: unknown, cb: unknown) => void;
      }).emit('leave-room', { mode: 'exit' }, done)
    ));
    expect(left.ok).toBe(true);
    // 나가기는 기록을 닫지 않는다 — 시도는 그대로 살아 있다
    expect(h.weeklyDojoRepository.findAttempt(attemptId)?.status).toBe('live');

    const resumed = await startDojo(client);
    expect(resumed.ok && resumed.data?.attemptId).toBe(attemptId);
    expect(resumed.ok && resumed.data?.resumed).toBe(true);
    expect(resumed.ok && resumed.data?.slot).toBe(1);
    expect(h.weeklyDojoRepository.listAttempts(
      client.playerId,
      h.weeklyDojoRepository.findAttempt(attemptId)!.weekKey,
    )).toHaveLength(1);

    const wallet = h.walletState(profile.profile.id);
    expect(wallet.activeEscrow).toBe(0);
    expect(wallet.activeRoomId).toBeNull();
  });

  it('closes the record on forfeit and hands the next start a new slot', async () => {
    const { h, client, profile } = await setup();
    const balanceBefore = h.walletState(profile.profile.id).balance;

    const started = await startDojo(client);
    const attemptId = started.ok ? started.data!.attemptId : '';

    const forfeited = await forfeitDojo(client);
    expect(forfeited.ok).toBe(true);
    const closed = h.weeklyDojoRepository.findAttempt(attemptId)!;
    expect(closed.status).toBe('completed');
    expect(closed.finishReason).toBe('forfeit');
    // 한 핸드도 확정되지 않았으니 시작 스택 그대로 = 0BB
    expect(closed.scoreMilliBB).toBe(0);

    const next = await startDojo(client);
    expect(next.ok && next.data?.slot).toBe(2);
    expect(next.ok && next.data?.attemptId).not.toBe(attemptId);

    // 3시도를 끝내기 전에는 공식 순위가 없다
    const snapshot = await view(client);
    expect(snapshot.ok && snapshot.data?.completedCount).toBe(1);
    expect(snapshot.ok && snapshot.data?.rank).toBeNull();
    expect(snapshot.ok && snapshot.data?.totalNetBB).toBeNull();

    // 지갑은 어느 경로에서도 움직이지 않는다
    expect(h.walletState(profile.profile.id).balance).toBe(balanceBefore);
    expect(h.walletState(profile.profile.id).activeEscrow).toBe(0);
  });
});
