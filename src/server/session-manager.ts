/**
 * 세션 관리: 재접속 지원의 핵심.
 *
 * - playerId: 인증된 공개 profileId. gameState.players[].id로 브로드캐스트된다.
 * - socketId: 현재 연결된 소켓. 재접속 시 교체된다 (중복 탭은 최신 소켓 승리).
 * - grace: disconnect 후 일정 시간 좌석/칩을 보존하는 유예 타이머.
 */

export interface Session {
  playerId: string;
  socketId: string | null;
  roomId: string | null;
  graceTimer: NodeJS.Timeout | null;
}

export interface SessionResolution {
  session: Session;
  replacedSocketId: string | null;
}

export interface RevokedSession {
  session: Session;
  socketId: string;
}

export const GRACE_MS = 60_000;

export class SessionManager {
  private byPlayerId = new Map<string, Session>();
  private bySocketId = new Map<string, Session>();
  private closed = false;

  /**
   * 접속 시 인증된 profileId의 단일 세션(좌석/방 정보)을 되찾는다.
   * transport token 인자는 호환 경계에서 소비하되 세션에 보존하거나 권위로 사용하지 않는다.
   */
  resolve(
    transportToken: string | undefined,
    socketId: string,
    profileId: string,
  ): SessionResolution {
    void transportToken;
    let session = this.byPlayerId.get(profileId);
    if (!session) {
      session = this.createSession(profileId);
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

  revokeProfile(profileId: string): RevokedSession | null {
    const session = this.byPlayerId.get(profileId);
    const socketId = session?.socketId;
    if (!session || !socketId) return null;
    this.bySocketId.delete(socketId);
    session.socketId = null;
    return { session, socketId };
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

  releaseIfIdle(session: Session): boolean {
    if (session.socketId || session.roomId || session.graceTimer) return false;
    if (this.byPlayerId.get(session.playerId) === session) this.byPlayerId.delete(session.playerId);
    return true;
  }

  releaseByPlayerId(playerId: string): boolean {
    const session = this.byPlayerId.get(playerId);
    return session ? this.releaseIfIdle(session) : false;
  }

  /** 백오피스 관측용 세션 스냅샷 — 토큰 등 비밀 없이 접속/방 상태만 노출 */
  snapshot(): Array<{
    playerId: string;
    connected: boolean;
    roomId: string | null;
    graceActive: boolean;
  }> {
    return [...this.byPlayerId.values()].map(session => ({
      playerId: session.playerId,
      connected: session.socketId !== null,
      roomId: session.roomId,
      graceActive: session.graceTimer !== null && session.graceTimer !== undefined,
    }));
  }

  stats(): { sessions: number; sockets: number; grace: number } {
    let grace = 0;
    for (const session of this.byPlayerId.values()) {
      if (session.graceTimer) grace++;
    }
    return {
      sessions: this.byPlayerId.size,
      sockets: this.bySocketId.size,
      grace,
    };
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
    for (const session of this.byPlayerId.values()) this.clearGrace(session);
    this.bySocketId.clear();
    this.byPlayerId.clear();
  }

  private createSession(profileId: string): Session {
    const session: Session = {
      playerId: profileId,
      socketId: null,
      roomId: null,
      graceTimer: null,
    };
    this.byPlayerId.set(session.playerId, session);
    return session;
  }
}
