import { createHmac, randomBytes } from 'node:crypto';

/**
 * 플레이 이벤트 로그 — 버그 역추적용.
 *
 * 왜 이런 형태인가:
 * - Fly 머신엔 볼륨이 없어 파일에 써도 재배포 때 사라지고, `fly logs`는 보관 기간이 짧아
 *   "어제 그 핸드"를 되짚기 어렵다. 그래서 프로세스 메모리에 링 버퍼로 최근 이벤트를 들고
 *   `/api/debug/log`로 즉시 조회할 수 있게 한다 (재시작 시 소멸 — 영속이 필요해지면 볼륨 추가).
 * - 동시에 stdout으로 JSON 한 줄씩 흘려 `fly logs`로 실시간 관찰도 가능하게 한다.
 *
 * 절대 로그에 넣지 말 것: 세션 토큰 원문, 방 비밀번호, 홀카드.
 * (transport token은 프로세스별 HMAC hint만 기록 — 원문/접두사 기록 금지)
 */

export interface LogEvent {
  seq: number;
  t: number; // epoch ms
  type: string; // 'join-room' | 'player-action' | 'hand-start' | ...
  roomId?: string;
  playerId?: string;
  /** 이벤트별 부가 정보 — 민감 정보 금지 */
  data?: Record<string, unknown>;
}

const MAX_EVENTS = 5000; // 6인 테이블 기준 수백 핸드 분량

class EventLog {
  private buf: LogEvent[] = [];
  private seq = 0;

  log(type: string, fields: { roomId?: string; playerId?: string; data?: Record<string, unknown> } = {}): void {
    const event: LogEvent = {
      seq: ++this.seq,
      t: Date.now(),
      type,
      ...(fields.roomId ? { roomId: fields.roomId } : {}),
      ...(fields.playerId ? { playerId: fields.playerId } : {}),
      ...(fields.data ? { data: fields.data } : {}),
    };
    this.buf.push(event);
    if (this.buf.length > MAX_EVENTS) this.buf.splice(0, this.buf.length - MAX_EVENTS);
    // fly logs 실시간 관찰용 — 한 줄 JSON (grep/jq 하기 쉽게)
    console.log(`[evt] ${JSON.stringify(event)}`);
  }

  /** 최근 이벤트 조회 (필터는 AND). limit은 뒤에서부터 자른다 */
  recent(opts: { roomId?: string; playerId?: string; type?: string; limit?: number } = {}): LogEvent[] {
    let list = this.buf;
    if (opts.roomId) list = list.filter(e => e.roomId === opts.roomId);
    if (opts.playerId) list = list.filter(e => e.playerId === opts.playerId);
    if (opts.type) list = list.filter(e => e.type === opts.type);
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), MAX_EVENTS);
    return list.slice(-limit);
  }

  stats(): { total: number; oldest: number | null; newest: number | null } {
    return {
      total: this.buf.length,
      oldest: this.buf[0]?.t ?? null,
      newest: this.buf[this.buf.length - 1]?.t ?? null,
    };
  }
}

/**
 * 싱글톤 — Next 번들과 커스텀 서버가 이 모듈을 각각 로드해도 같은 인스턴스를 보도록
 * globalThis에 고정한다 (번들 경계가 갈리면 링 버퍼가 두 개로 쪼개져 조회가 비어 보인다).
 */
const g = globalThis as typeof globalThis & { __pokerEventLog?: EventLog };
export const eventLog: EventLog = g.__pokerEventLog ?? (g.__pokerEventLog = new EventLog());

const TOKEN_HINT_KEY = randomBytes(32);

/** transport token의 프로세스 한정 opaque 진단값. 원문/접두사를 복원할 수 없어야 한다. */
export function tokenHint(
  token: string | undefined,
  key: Uint8Array = TOKEN_HINT_KEY,
): string {
  if (!token) return 'none';
  const digest = createHmac('sha256', key)
    .update(token, 'utf8')
    .digest('base64url');
  return `t_${digest.slice(0, 12)}`;
}

export interface HandSettlementLogFields {
  rake: number;
  paidTotal: number;
  settlementOk: boolean;
}

/** 민감한 경제 상태 대신 핸드 단위 합계와 성공 여부만 로그에 싣는다. */
export function handSettlementLogFields(
  input: HandSettlementLogFields,
): HandSettlementLogFields {
  if (
    !Number.isSafeInteger(input.rake)
    || input.rake < 0
    || !Number.isSafeInteger(input.paidTotal)
    || input.paidTotal < 0
    || typeof input.settlementOk !== 'boolean'
  ) {
    throw new Error('invalid hand settlement log fields');
  }
  return {
    rake: input.rake,
    paidTotal: input.paidTotal,
    settlementOk: input.settlementOk,
  };
}
