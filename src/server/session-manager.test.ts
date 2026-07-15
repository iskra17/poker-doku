import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './session-manager';

describe('SessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('같은 토큰으로 재접속하면 같은 세션(playerId)을 돌려준다', () => {
    const sm = new SessionManager();
    const s1 = sm.resolve('token-aaaa', 'sock-1').session;
    const s2 = sm.resolve('token-aaaa', 'sock-2').session;

    expect(s2.playerId).toBe(s1.playerId);
    expect(s2.socketId).toBe('sock-2');
    // 이전 소켓 매핑은 제거된다
    expect(sm.getBySocketId('sock-1')).toBeUndefined();
    expect(sm.getBySocketId('sock-2')).toBe(s2);
  });

  it('다른 토큰은 다른 세션을 만든다', () => {
    const sm = new SessionManager();
    const s1 = sm.resolve('token-aaaa', 'sock-1').session;
    const s2 = sm.resolve('token-bbbb', 'sock-2').session;
    expect(s1.playerId).not.toBe(s2.playerId);
  });

  it('토큰이 없으면 socketId를 토큰 대용으로 쓴다', () => {
    const sm = new SessionManager();
    const s = sm.resolve(undefined, 'sock-1').session;
    expect(s.token).toBe('sock-1');
    expect(sm.getBySocketId('sock-1')).toBe(s);
  });

  it('detachSocket은 소켓 바인딩만 해제하고 세션은 유지한다', () => {
    const sm = new SessionManager();
    const s = sm.resolve('token-aaaa', 'sock-1').session;
    s.roomId = 'room-1';

    const detached = sm.detachSocket('sock-1');
    expect(detached).toBe(s);
    expect(s.socketId).toBeNull();
    expect(sm.getBySocketId('sock-1')).toBeUndefined();
    // 재접속하면 roomId가 남아 있다
    const again = sm.resolve('token-aaaa', 'sock-2').session;
    expect(again.roomId).toBe('room-1');
  });

  it('이미 새 소켓으로 교체된 구 소켓의 detach는 null (grace 미발동)', () => {
    const sm = new SessionManager();
    sm.resolve('token-aaaa', 'sock-1');
    sm.resolve('token-aaaa', 'sock-2'); // 중복 탭 — 새 소켓 승리

    expect(sm.detachSocket('sock-1')).toBeNull();
  });

  it('grace 타이머는 만료 시 콜백을 부르고, 재접속(resolve) 시 취소된다', () => {
    const sm = new SessionManager();
    const s = sm.resolve('token-aaaa', 'sock-1').session;

    const onExpire = vi.fn();
    sm.detachSocket('sock-1');
    sm.startGrace(s, 60_000, onExpire);

    // 30초 후 재접속 → grace 취소
    vi.advanceTimersByTime(30_000);
    sm.resolve('token-aaaa', 'sock-2');
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
    const first = sm.resolve('token-1234', 'sock-1');
    const second = sm.resolve('token-1234', 'sock-2');

    expect(first.replacedSocketId).toBeNull();
    expect(second.session.playerId).toBe(first.session.playerId);
    expect(second.replacedSocketId).toBe('sock-1');
    expect(sm.isCurrentSocket(second.session.playerId, 'sock-1')).toBe(false);
    expect(sm.isCurrentSocket(second.session.playerId, 'sock-2')).toBe(true);
  });

  it('비정상 토큰은 안정 세션 키로 쓰지 않는다', () => {
    const sm = new SessionManager();
    const a = sm.resolve('x', 'sock-1').session;
    const b = sm.resolve('x', 'sock-2').session;

    expect(a.playerId).not.toBe(b.playerId);
  });

  it('shutdown은 남은 grace 타이머를 모두 취소한다', () => {
    const sm = new SessionManager();
    const session = sm.resolve('shutdown-token-1234', 'sock-1').session;
    const onExpire = vi.fn();
    sm.detachSocket('sock-1');
    sm.startGrace(session, 50, onExpire);

    sm.shutdown();
    vi.advanceTimersByTime(100);

    expect(onExpire).not.toHaveBeenCalled();
  });

  it('소켓·방·grace가 없는 세션만 즉시 회수한다', () => {
    const sm = new SessionManager();
    const idle = sm.resolve('idle-token-1234', 'sock-1').session;
    sm.detachSocket('sock-1');

    expect(sm.releaseIfIdle(idle)).toBe(true);
    expect(sm.getByPlayerId(idle.playerId)).toBeUndefined();

    const seated = sm.resolve('seated-token-1234', 'sock-2').session;
    seated.roomId = 'room-1';
    sm.detachSocket('sock-2');
    expect(sm.releaseIfIdle(seated)).toBe(false);
    expect(sm.getByPlayerId(seated.playerId)).toBe(seated);
  });

  it('현재 세션·소켓·grace 수를 정확히 집계한다', () => {
    const sm = new SessionManager();
    const connected = sm.resolve('stats-connected-1234', 'sock-1').session;
    const grace = sm.resolve('stats-grace-1234', 'sock-2').session;
    sm.detachSocket('sock-2');
    sm.startGrace(grace, 1_000, vi.fn());

    expect(sm.stats()).toEqual({ sessions: 2, sockets: 1, grace: 1 });
    expect(sm.getByPlayerId(connected.playerId)).toBe(connected);
  });
});
