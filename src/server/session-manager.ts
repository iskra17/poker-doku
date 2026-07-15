/**
 * 세션 관리: 재접속 지원의 핵심.
 *
 * - token: 클라이언트가 localStorage에 보관하는 비밀값. gameState로 절대 노출하지 않는다.
 * - playerId: 서버가 발급하는 공개 식별자. gameState.players[].id로 브로드캐스트된다.
 * - socketId: 현재 연결된 소켓. 재접속 시 교체된다 (중복 탭은 최신 소켓 승리).
 * - grace: disconnect 후 일정 시간 좌석/칩을 보존하는 유예 타이머.
 */

export interface Session {
  token: string;
  playerId: string;
  socketId: string | null;
  roomId: string | null;
  graceTimer: NodeJS.Timeout | null;
}

export interface SessionResolution {
  session: Session;
  replacedSocketId: string | null;
}

export const GRACE_MS = 60_000;
const SESSION_TOKEN_RE = /^[A-Za-z0-9._~-]{8,128}$/;

export class SessionManager {
  private byToken = new Map<string, Session>();
  private byPlayerId = new Map<string, Session>();
  private bySocketId = new Map<string, Session>();
  private closed = false;

  /**
   * 접속 시 세션 확보. 같은 토큰으로 재접속하면 기존 세션(좌석/방 정보)을 되찾는다.
   * 토큰이 없는 구버전 클라이언트는 socketId를 토큰 대용으로 사용 (재접속 불가만 감수).
   */
  resolve(token: unknown, socketId: string): SessionResolution {
    const stableToken = typeof token === 'string' && SESSION_TOKEN_RE.test(token)
      ? token
      : null;
    const key = stableToken ?? socketId;
    let session = this.byToken.get(key);
    if (!session) {
      session = this.createSession(key);
    }
    this.clearGrace(session);
    const replacedSocketId = session.socketId && session.socketId !== socketId
      ? session.socketId
      : null;
    if (replacedSocketId) this.bySocketId.delete(replacedSocketId);
    session.socketId = socketId;
    this.bySocketId.set(socketId, session);
    return { session, replacedSocketId };
  }

  isCurrentSocket(playerId: string, socketId: string): boolean {
    return this.byPlayerId.get(playerId)?.socketId === socketId;
  }

  getBySocketId(socketId: string): Session | undefined {
    return this.bySocketId.get(socketId);
  }

  getByPlayerId(playerId: string): Session | undefined {
    return this.byPlayerId.get(playerId);
  }

  /**
   * disconnect 시 소켓 바인딩 해제. 이미 새 소켓으로 교체된 경우(중복 탭 정리 등)는
   * null을 반환해 grace가 시작되지 않도록 한다.
   */
  detachSocket(socketId: string): Session | null {
    const session = this.bySocketId.get(socketId);
    if (!session) return null;
    this.bySocketId.delete(socketId);
    if (session.socketId === socketId) session.socketId = null;
    return session;
  }

  startGrace(session: Session, ms: number, onExpire: () => void): void {
    if (this.closed) return;
    this.clearGrace(session);
    session.graceTimer = setTimeout(() => {
      session.graceTimer = null;
      onExpire();
    }, ms);
  }

  clearGrace(session: Session): void {
    if (session.graceTimer) {
      clearTimeout(session.graceTimer);
      session.graceTimer = null;
    }
  }

  shutdown(): void {
    this.closed = true;
    for (const session of this.byToken.values()) this.clearGrace(session);
    this.bySocketId.clear();
    this.byPlayerId.clear();
    this.byToken.clear();
  }

  private createSession(key: string): Session {
    const session: Session = {
      token: key,
      playerId: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      socketId: null,
      roomId: null,
      graceTimer: null,
    };
    this.byToken.set(key, session);
    this.byPlayerId.set(session.playerId, session);
    return session;
  }
}
