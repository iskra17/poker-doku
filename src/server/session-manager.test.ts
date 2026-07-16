import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './session-manager';

describe('SessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the authenticated profile id as the public player id', () => {
    const sm = new SessionManager();

    const session = sm.resolve('transport-token-1234', 'sock-1', 'p_profile_exact').session;

    expect(session.playerId).toBe('p_profile_exact');
  });

  it('keeps one session for the same profile across different transport tokens', () => {
    const sm = new SessionManager();
    const first = sm.resolve('transport-token-1234', 'sock-1', 'p_same_profile');

    const second = sm.resolve('different-token-5678', 'sock-2', 'p_same_profile');

    expect(second.session).toBe(first.session);
    expect(second.replacedSocketId).toBe('sock-1');
    expect(sm.stats()).toEqual({ sessions: 1, sockets: 1, grace: 0 });
  });

  it('isolates different profiles that present the same transport token', () => {
    const sm = new SessionManager();

    const first = sm.resolve('shared-transport-1234', 'sock-1', 'p_profile_one').session;
    const second = sm.resolve('shared-transport-1234', 'sock-2', 'p_profile_two').session;

    expect(second).not.toBe(first);
    expect(first.socketId).toBe('sock-1');
    expect(second.socketId).toBe('sock-2');
    expect(sm.stats()).toEqual({ sessions: 2, sockets: 2, grace: 0 });
  });

  it('revokes current ownership and lets the same profile resume the grace session', () => {
    const sm = new SessionManager();
    const session = sm.resolve('transport-token-1234', 'sock-1', 'p_revoked').session;

    const revoked = sm.revokeProfile('p_revoked');

    expect(revoked).toEqual({ session, socketId: 'sock-1' });
    expect(sm.isCurrentSocket('p_revoked', 'sock-1')).toBe(false);
    expect(sm.detachSocket('sock-1')).toBeNull();
    const onExpire = vi.fn();
    sm.startGrace(session, 60_000, onExpire);

    const resumed = sm.resolve('new-transport-token-5678', 'sock-2', 'p_revoked').session;
    vi.advanceTimersByTime(60_000);

    expect(resumed).toBe(session);
    expect(resumed.socketId).toBe('sock-2');
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('같은 프로필과 토큰으로 재접속하면 같은 세션을 돌려준다', () => {
    const sm = new SessionManager();
    const s1 = sm.resolve('token-aaaa', 'sock-1', 'p_same').session;
    const s2 = sm.resolve('token-aaaa', 'sock-2', 'p_same').session;

    expect(s2.playerId).toBe(s1.playerId);
    expect(s2.socketId).toBe('sock-2');
    // 이전 소켓 매핑은 제거된다
    expect(sm.getBySocketId('sock-1')).toBeUndefined();
    expect(sm.getBySocketId('sock-2')).toBe(s2);
  });

  it('서로 다른 프로필은 transport token이 달라도 별도 세션을 만든다', () => {
    const sm = new SessionManager();
    const s1 = sm.resolve('token-aaaa', 'sock-1', 'p_one').session;
    const s2 = sm.resolve('token-bbbb', 'sock-2', 'p_two').session;
    expect(s1.playerId).not.toBe(s2.playerId);
  });

  it('토큰이 없으면 socketId를 토큰 대용으로 쓴다', () => {
    const sm = new SessionManager();
    const s = sm.resolve(undefined, 'sock-1', 'p_socket_fallback').session;
    expect(s.token).toBe('sock-1');
    expect(sm.getBySocketId('sock-1')).toBe(s);
  });

  it('detachSocket은 소켓 바인딩만 해제하고 세션은 유지한다', () => {
    const sm = new SessionManager();
    const s = sm.resolve('token-aaaa', 'sock-1', 'p_detach').session;
    s.roomId = 'room-1';

    const detached = sm.detachSocket('sock-1');
    expect(detached).toBe(s);
    expect(s.socketId).toBeNull();
    expect(sm.getBySocketId('sock-1')).toBeUndefined();
    // 재접속하면 roomId가 남아 있다
    const again = sm.resolve('token-aaaa', 'sock-2', 'p_detach').session;
    expect(again.roomId).toBe('room-1');
  });

  it('이미 새 소켓으로 교체된 구 소켓의 detach는 null (grace 미발동)', () => {
    const sm = new SessionManager();
    sm.resolve('token-aaaa', 'sock-1', 'p_replaced');
    sm.resolve('token-aaaa', 'sock-2', 'p_replaced'); // 중복 탭 — 새 소켓 승리

    expect(sm.detachSocket('sock-1')).toBeNull();
  });

  it('grace 타이머는 만료 시 콜백을 부르고, 재접속(resolve) 시 취소된다', () => {
    const sm = new SessionManager();
    const s = sm.resolve('token-aaaa', 'sock-1', 'p_grace').session;

    const onExpire = vi.fn();
    sm.detachSocket('sock-1');
    sm.startGrace(s, 60_000, onExpire);

    // 30초 후 재접속 → grace 취소
    vi.advanceTimersByTime(30_000);
    sm.resolve('token-aaaa', 'sock-2', 'p_grace');
    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();

    // 다시 끊고 이번엔 만료까지 대기
    sm.detachSocket('sock-2');
    sm.startGrace(s, 60_000, onExpire);
    vi.advanceTimersByTime(60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('같은 토큰의 새 소켓은 교체된 socketId를 반환하고 최신 소켓만 소유자다', () => {
    const sm = new SessionManager();
    const first = sm.resolve('token-1234', 'sock-1', 'p_owner');
    const second = sm.resolve('token-1234', 'sock-2', 'p_owner');

    expect(first.replacedSocketId).toBeNull();
    expect(second.session.playerId).toBe(first.session.playerId);
    expect(second.replacedSocketId).toBe('sock-1');
    expect(sm.isCurrentSocket(second.session.playerId, 'sock-1')).toBe(false);
    expect(sm.isCurrentSocket(second.session.playerId, 'sock-2')).toBe(true);
  });

  it('비정상 토큰은 안정 세션 키로 쓰지 않는다', () => {
    const sm = new SessionManager();
    const a = sm.resolve('x', 'sock-1', 'p_invalid_one').session;
    const b = sm.resolve('x', 'sock-2', 'p_invalid_two').session;

    expect(a.playerId).not.toBe(b.playerId);
  });

  it('shutdown은 남은 grace 타이머를 모두 취소한다', () => {
    const sm = new SessionManager();
    const session = sm.resolve('shutdown-token-1234', 'sock-1', 'p_shutdown').session;
    const onExpire = vi.fn();
    sm.detachSocket('sock-1');
    sm.startGrace(session, 50, onExpire);

    sm.shutdown();
    vi.advanceTimersByTime(100);

    expect(onExpire).not.toHaveBeenCalled();
  });

  it('소켓·방·grace가 없는 세션만 즉시 회수한다', () => {
    const sm = new SessionManager();
    const idle = sm.resolve('idle-token-1234', 'sock-1', 'p_idle').session;
    sm.detachSocket('sock-1');

    expect(sm.releaseIfIdle(idle)).toBe(true);
    expect(sm.getByPlayerId(idle.playerId)).toBeUndefined();

    const seated = sm.resolve('seated-token-1234', 'sock-2', 'p_seated').session;
    seated.roomId = 'room-1';
    sm.detachSocket('sock-2');
    expect(sm.releaseIfIdle(seated)).toBe(false);
    expect(sm.getByPlayerId(seated.playerId)).toBe(seated);
  });

  it('현재 세션·소켓·grace 수를 정확히 집계한다', () => {
    const sm = new SessionManager();
    const connected = sm.resolve('stats-connected-1234', 'sock-1', 'p_connected').session;
    const grace = sm.resolve('stats-grace-1234', 'sock-2', 'p_stats_grace').session;
    sm.detachSocket('sock-2');
    sm.startGrace(grace, 1_000, vi.fn());

    expect(sm.stats()).toEqual({ sessions: 2, sockets: 1, grace: 1 });
    expect(sm.getByPlayerId(connected.playerId)).toBe(connected);
  });
});
