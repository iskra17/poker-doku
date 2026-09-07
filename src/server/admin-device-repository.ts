import type { PokerDatabase } from './persistence/database';

/**
 * 운영 백오피스 등록 기기(90일 로그인 유지) 저장소.
 *
 * 이 저장소는 **원문 쿠키 자격도, 운영 토큰도 저장하지 않는다.** 호출자(AdminSessionManager)가
 * 원본 운영 토큰에서 파생한 키로 만든 `lookupKey`(HMAC)와 `sourceScope`만 넘긴다.
 * 따라서 원본 토큰이 바뀌거나 사라지면 기존 행은 조회 자체가 불가능해진다.
 *
 * 모든 조회/갱신은 `expires_at > now` 조건을 SQL에 담아 만료를 원자적으로 판정하고,
 * 갱신은 조건부 UPDATE ... RETURNING이라 해제와 경쟁해도 삭제된 행을 되살리지 않는다.
 */

/** 현재 운영 토큰 스코프당 등록 기기 상한 — 초과는 명시적 오류(409). */
export const ADMIN_DEVICE_LIMIT = 20;

export class AdminDeviceLimitError extends Error {
  readonly code = 'device-limit' as const;

  constructor() {
    super('ADMIN_DEVICE_LIMIT');
    this.name = 'AdminDeviceLimitError';
  }
}

/** 백오피스 UI에 노출해도 되는 필드만 — 자격/해시는 포함하지 않는다. */
export interface AdminDeviceRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly expiresAt: number;
}

/** 인증 경로 전용 — csrf 토큰과 공개 principal id를 포함한다. */
export interface AdminDeviceCredential extends AdminDeviceRecord {
  readonly principalId: string;
  readonly csrfToken: string;
}

export interface RegisterAdminDeviceInput {
  readonly id: string;
  readonly lookupKey: string;
  readonly sourceScope: string;
  readonly csrfToken: string;
  readonly principalId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** 같은 브라우저가 이미 들고 있던 자격 — 등록과 같은 트랜잭션에서만 폐기한다. */
  readonly replacesLookupKey?: string;
}

interface DeviceRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: number;
  readonly last_used_at: number;
  readonly expires_at: number;
  readonly principal_id: string;
  readonly csrf_token: string;
}

function toRecord(row: DeviceRow): AdminDeviceRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

function toCredential(row: DeviceRow): AdminDeviceCredential {
  return {
    ...toRecord(row),
    principalId: row.principal_id,
    csrfToken: row.csrf_token,
  };
}

const CREDENTIAL_COLUMNS =
  'id, name, created_at, last_used_at, expires_at, principal_id, csrf_token';

export class AdminDeviceRepository {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  findActive(
    lookupKey: string,
    sourceScope: string,
    now: number,
  ): AdminDeviceCredential | null {
    const row = this.#database.db.prepare(`
      SELECT ${CREDENTIAL_COLUMNS} FROM admin_trusted_devices
      WHERE lookup_key = ? AND source_scope = ? AND expires_at > ?
    `).get(lookupKey, sourceScope, now) as DeviceRow | undefined;
    return row ? toCredential(row) : null;
  }

  /**
   * 유효한 행만 조건부로 연장한다. 0행이면 null — 해제/만료된 자격은 절대 부활하지 않는다.
   */
  renew(
    lookupKey: string,
    sourceScope: string,
    now: number,
    expiresAt: number,
  ): AdminDeviceCredential | null {
    const row = this.#database.db.prepare(`
      UPDATE admin_trusted_devices
      SET last_used_at = ?, expires_at = ?
      WHERE lookup_key = ? AND source_scope = ? AND expires_at > ?
      RETURNING ${CREDENTIAL_COLUMNS}
    `).get(now, expiresAt, lookupKey, sourceScope, now) as DeviceRow | undefined;
    return row ? toCredential(row) : null;
  }

  /**
   * 교체 폐기 · 만료 정리 · 상한 검사 · 삽입을 하나의 트랜잭션으로 처리한다.
   * 상한 초과로 거절되면 롤백되므로 기존 자격은 그대로 남는다.
   */
  register(input: RegisterAdminDeviceInput): AdminDeviceCredential {
    return this.#database.transaction(() => {
      if (input.replacesLookupKey !== undefined) {
        this.#database.db.prepare(`
          DELETE FROM admin_trusted_devices
          WHERE lookup_key = ? AND source_scope = ?
        `).run(input.replacesLookupKey, input.sourceScope);
      }
      this.#database.db.prepare(`
        DELETE FROM admin_trusted_devices WHERE expires_at <= ?
      `).run(input.createdAt);
      if (this.countActive(input.sourceScope, input.createdAt) >= ADMIN_DEVICE_LIMIT) {
        throw new AdminDeviceLimitError();
      }
      this.#database.db.prepare(`
        INSERT INTO admin_trusted_devices (
          id, lookup_key, source_scope, csrf_token, principal_id,
          name, created_at, last_used_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.lookupKey,
        input.sourceScope,
        input.csrfToken,
        input.principalId,
        input.name,
        input.createdAt,
        input.createdAt,
        input.expiresAt,
      );
      return {
        id: input.id,
        name: input.name,
        createdAt: input.createdAt,
        lastUsedAt: input.createdAt,
        expiresAt: input.expiresAt,
        principalId: input.principalId,
        csrfToken: input.csrfToken,
      };
    });
  }

  revokeByLookupKey(lookupKey: string, sourceScope: string): boolean {
    const result = this.#database.db.prepare(`
      DELETE FROM admin_trusted_devices
      WHERE lookup_key = ? AND source_scope = ?
    `).run(lookupKey, sourceScope);
    return Number(result.changes) > 0;
  }

  revokeById(id: string, sourceScope: string): boolean {
    const result = this.#database.db.prepare(`
      DELETE FROM admin_trusted_devices WHERE id = ? AND source_scope = ?
    `).run(id, sourceScope);
    return Number(result.changes) > 0;
  }

  list(sourceScope: string, now: number): AdminDeviceRecord[] {
    return (this.#database.db.prepare(`
      SELECT ${CREDENTIAL_COLUMNS} FROM admin_trusted_devices
      WHERE source_scope = ? AND expires_at > ?
      ORDER BY created_at DESC, id ASC
    `).all(sourceScope, now) as unknown as DeviceRow[]).map(toRecord);
  }

  countActive(sourceScope: string, now: number): number {
    return (this.#database.db.prepare(`
      SELECT COUNT(*) AS n FROM admin_trusted_devices
      WHERE source_scope = ? AND expires_at > ?
    `).get(sourceScope, now) as { n: number }).n;
  }

  pruneExpired(now: number): number {
    return Number(this.#database.db.prepare(`
      DELETE FROM admin_trusted_devices WHERE expires_at <= ?
    `).run(now).changes);
  }
}
