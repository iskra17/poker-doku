import { randomUUID } from 'node:crypto';
import type { PokerDatabase } from './persistence/database';

const ACCOUNT_ID = 'global' as const;
const MAX_LEDGER_DELTA = 2_000_000_000;
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 200;
const RESERVE_REASON = 'Freeroll prize reserve';
const REFUND_REASON = 'Freeroll prize refund';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PromotionFundErrorCode =
  | 'invalid-input'
  | 'promotion-insufficient'
  | 'idempotency-conflict'
  | 'not-found'
  | 'not-visible'
  | 'not-claimable'
  | 'financial-invariant';

export class PromotionFundError extends Error {
  constructor(readonly code: PromotionFundErrorCode) {
    super(code);
    this.name = 'PromotionFundError';
  }
}

export interface PromotionFundActor {
  readonly kind: 'backoffice-admin' | 'operator-profile' | 'system';
  readonly id: string;
}

export type PromotionFundLedgerKind =
  | 'admin-adjustment'
  | 'freeroll-prize-reserve'
  | 'freeroll-bot-prize-return'
  | 'freeroll-prize-refund';

export interface PromotionFundAccount {
  readonly accountId: typeof ACCOUNT_ID;
  readonly availableBalance: number;
  readonly version: number;
  readonly updatedAt: number;
}

export interface PromotionFundLedgerEntry {
  readonly id: string;
  readonly accountId: typeof ACCOUNT_ID;
  readonly kind: PromotionFundLedgerKind;
  readonly delta: number;
  readonly balanceAfter: number;
  readonly instanceId: string | null;
  readonly actor: PromotionFundActor;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly createdAt: number;
}

export interface PromotionFundPage extends PromotionFundAccount {
  readonly reservedTotal: number;
  readonly ledger: readonly PromotionFundLedgerEntry[];
  readonly nextCursor: string | null;
}

export interface PromotionFundAdjustment {
  readonly account: PromotionFundAccount;
  readonly ledger: PromotionFundLedgerEntry;
  readonly replayed: boolean;
}

export interface PrizeEscrow {
  readonly instanceId: string;
  readonly accountId: typeof ACCOUNT_ID;
  readonly amount: number;
  readonly status: 'reserved' | 'settled' | 'refunded';
  readonly humanPaid: number;
  readonly botReturned: number;
  readonly settlementFingerprint: string | null;
  readonly reservedAt: number;
  readonly settledAt: number | null;
  readonly refundedAt: number | null;
  readonly updatedAt: number;
}

interface LedgerFingerprint {
  readonly kind: PromotionFundLedgerKind;
  readonly delta: number;
  readonly instanceId: string | null;
  readonly actor: PromotionFundActor;
  readonly reason: string;
}

interface Cursor {
  readonly rowId: number;
}

type SqlRow = Record<string, unknown>;

export class PromotionFundRepository {
  constructor(private readonly database: PokerDatabase) {}

  getFundPage(input: {
    readonly limit: number;
    readonly before?: string;
  }): PromotionFundPage {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      invalid();
    }
    const before = input.before === undefined
      ? null
      : decodeCursor(input.before);
    const rows = this.database.db.prepare(`
      SELECT
        rowid AS ledger_row_id,
        id, account_id, kind, delta, balance_after, instance_id,
        actor_kind, actor_id, reason, idempotency_key, created_at
      FROM promotion_fund_ledger
      WHERE (? IS NULL OR rowid < ?)
      ORDER BY rowid DESC
      LIMIT ?
    `).all(
      before?.rowId ?? null,
      before?.rowId ?? null,
      input.limit + 1,
    ) as SqlRow[];
    const hasMore = rows.length > input.limit;
    const ledger = rows.slice(0, input.limit).map(decodeLedger);
    const lastRow = rows[input.limit - 1];
    const account = this.#account();
    const reserved = this.database.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM tournament_prize_escrow
      WHERE status = 'reserved'
    `).get() as SqlRow;
    return {
      ...account,
      reservedTotal: nonNegativeInteger(reserved.total),
      ledger,
      nextCursor: hasMore && lastRow
        ? encodeCursor({ rowId: positiveInteger(lastRow.ledger_row_id) })
        : null,
    };
  }

  adjustFund(input: {
    readonly requestId: string;
    readonly delta: number;
    readonly reason: string;
    readonly actor: PromotionFundActor;
    readonly at: number;
  }): PromotionFundAdjustment {
    assertUuid(input.requestId);
    assertDelta(input.delta);
    assertReason(input.reason);
    assertActor(input.actor);
    assertTimestamp(input.at);
    if (input.actor.kind !== 'backoffice-admin') invalid();

    return this.database.transaction(() => {
      const fingerprint: LedgerFingerprint = {
        kind: 'admin-adjustment',
        delta: input.delta,
        instanceId: null,
        actor: input.actor,
        reason: input.reason,
      };
      const existing = this.#ledgerByIdempotency(input.requestId);
      if (existing) {
        assertLedgerReplay(existing, fingerprint);
        return {
          account: this.#account(),
          ledger: existing,
          replayed: true,
        };
      }

      const account = this.#account();
      const balanceAfter = account.availableBalance + input.delta;
      if (
        !Number.isSafeInteger(balanceAfter)
        || balanceAfter < 0
      ) {
        throw new PromotionFundError('promotion-insufficient');
      }
      const ledger = this.#insertLedger({
        ...fingerprint,
        balanceAfter,
        idempotencyKey: input.requestId,
        createdAt: input.at,
      });
      return {
        account: this.#account(),
        ledger,
        replayed: false,
      };
    });
  }

  reserveFreerollPrize(input: {
    readonly instanceId: string;
    readonly amount: number;
    readonly idempotencyKey: string;
    readonly actor: PromotionFundActor;
    readonly at: number;
  }): PrizeEscrow {
    assertIdentifier(input.instanceId);
    assertPositiveAmount(input.amount);
    assertUuid(input.idempotencyKey);
    assertActor(input.actor);
    assertTimestamp(input.at);

    const result = this.database.transaction(():
      | { readonly kind: 'reserved'; readonly escrow: PrizeEscrow }
      | { readonly kind: 'insufficient' } => {
      const fingerprint: LedgerFingerprint = {
        kind: 'freeroll-prize-reserve',
        delta: -input.amount,
        instanceId: input.instanceId,
        actor: input.actor,
        reason: RESERVE_REASON,
      };
      const existingLedger = this.#ledgerByIdempotency(input.idempotencyKey);
      if (existingLedger) {
        assertLedgerReplay(existingLedger, fingerprint);
        const replay = this.#escrow(input.instanceId);
        if (!replay || replay.status !== 'reserved' || replay.amount !== input.amount) {
          invariant();
        }
        return { kind: 'reserved', escrow: replay };
      }

      const instance = this.database.db.prepare(`
        SELECT
          status, economy_mode, config_json, visible_at,
          registration_opens_at
        FROM tournament_instance
        WHERE id = ?
      `).get(input.instanceId) as SqlRow | undefined;
      if (!instance) throw new PromotionFundError('not-found');
      if (stringValue(instance.status) !== 'scheduled-hidden') {
        throw new PromotionFundError('not-claimable');
      }
      if (stringValue(instance.economy_mode) !== 'freeroll') invariant();
      const configuredPrize = configuredFreerollPrize(instance.config_json);
      if (configuredPrize !== input.amount) invariant();
      const visibleAt = nonNegativeInteger(instance.visible_at);
      if (input.at < visibleAt) throw new PromotionFundError('not-visible');

      const account = this.#account();
      if (account.availableBalance < input.amount) {
        const cancelled = this.database.db.prepare(`
          UPDATE tournament_instance
          SET status = 'cancelled',
              status_reason = 'promotion-insufficient',
              registration_state = 'closed',
              registration_close_reason = 'tournament-cancelled',
              registration_generation = registration_generation + 1,
              completed_at = ?,
              updated_at = ?
          WHERE id = ?
            AND status = 'scheduled-hidden'
            AND registration_state = 'not-open'
        `).run(input.at, input.at, input.instanceId);
        if (cancelled.changes !== 1) {
          throw new PromotionFundError('not-claimable');
        }
        return { kind: 'insufficient' };
      }

      this.#insertLedger({
        ...fingerprint,
        balanceAfter: account.availableBalance - input.amount,
        idempotencyKey: input.idempotencyKey,
        createdAt: input.at,
      });
      this.database.db.prepare(`
        INSERT INTO tournament_prize_escrow (
          instance_id, account_id, amount, status, human_paid, bot_returned,
          settlement_fingerprint, reserved_at, settled_at, refunded_at,
          updated_at
        ) VALUES (?, 'global', ?, 'reserved', 0, 0, NULL, ?, NULL, NULL, ?)
      `).run(input.instanceId, input.amount, input.at, input.at);

      const registrationOpensAt =
        nonNegativeInteger(instance.registration_opens_at);
      const registrationOpen = input.at >= registrationOpensAt;
      const exposed = this.database.db.prepare(`
        UPDATE tournament_instance
        SET status = ?,
            registration_state = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'scheduled-hidden'
          AND registration_state = 'not-open'
      `).run(
        registrationOpen ? 'registering' : 'scheduled-visible',
        registrationOpen ? 'open-prestart' : 'not-open',
        input.at,
        input.instanceId,
      );
      if (exposed.changes !== 1) invariant();
      const escrow = this.#escrow(input.instanceId);
      if (!escrow) invariant();
      return { kind: 'reserved', escrow };
    });

    if (result.kind === 'insufficient') {
      throw new PromotionFundError('promotion-insufficient');
    }
    return result.escrow;
  }

  refundFreerollPrize(input: {
    readonly instanceId: string;
    readonly generation: number;
    readonly idempotencyKey: string;
    readonly actor: PromotionFundActor;
    readonly at: number;
  }): PrizeEscrow {
    assertIdentifier(input.instanceId);
    if (!Number.isSafeInteger(input.generation) || input.generation < 0) invalid();
    assertUuid(input.idempotencyKey);
    assertActor(input.actor);
    assertTimestamp(input.at);

    return this.database.transaction(() => {
      const currentEscrow = this.#escrow(input.instanceId);
      if (!currentEscrow) throw new PromotionFundError('not-found');
      const fingerprint: LedgerFingerprint = {
        kind: 'freeroll-prize-refund',
        delta: currentEscrow.amount,
        instanceId: input.instanceId,
        actor: input.actor,
        reason: REFUND_REASON,
      };
      const existingLedger = this.#ledgerByIdempotency(input.idempotencyKey);
      if (existingLedger) {
        assertLedgerReplay(existingLedger, fingerprint);
        const replay = this.#escrow(input.instanceId);
        const instance = this.#instanceLifecycle(input.instanceId);
        if (
          !replay
          || replay.status !== 'refunded'
          || instance?.status !== 'cancelled'
          || instance.generation !== input.generation
        ) {
          invariant();
        }
        return replay;
      }
      if (currentEscrow.status !== 'reserved') {
        throw new PromotionFundError('idempotency-conflict');
      }
      const instance = this.#instanceLifecycle(input.instanceId);
      if (
        !instance
        || instance.status !== 'refund-pending'
        || instance.registrationState !== 'closed'
        || instance.generation !== input.generation
      ) {
        throw new PromotionFundError('not-claimable');
      }
      const account = this.#account();
      const balanceAfter = account.availableBalance + currentEscrow.amount;
      if (!Number.isSafeInteger(balanceAfter)) invariant();
      this.#insertLedger({
        ...fingerprint,
        balanceAfter,
        idempotencyKey: input.idempotencyKey,
        createdAt: input.at,
      });
      const escrowUpdate = this.database.db.prepare(`
        UPDATE tournament_prize_escrow
        SET status = 'refunded',
            refunded_at = ?,
            updated_at = ?
        WHERE instance_id = ?
          AND status = 'reserved'
          AND amount = ?
      `).run(
        input.at,
        input.at,
        input.instanceId,
        currentEscrow.amount,
      );
      if (escrowUpdate.changes !== 1) invariant();
      const instanceUpdate = this.database.db.prepare(`
        UPDATE tournament_instance
        SET status = 'cancelled',
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'refund-pending'
          AND registration_state = 'closed'
          AND registration_generation = ?
      `).run(input.at, input.at, input.instanceId, input.generation);
      if (instanceUpdate.changes !== 1) invariant();
      const escrow = this.#escrow(input.instanceId);
      if (!escrow) invariant();
      return escrow;
    });
  }

  #account(): PromotionFundAccount {
    const row = this.database.db.prepare(`
      SELECT account_id, balance, version, updated_at
      FROM promotion_fund
      WHERE account_id = 'global'
    `).get() as SqlRow | undefined;
    if (!row || stringValue(row.account_id) !== ACCOUNT_ID) invariant();
    return {
      accountId: ACCOUNT_ID,
      availableBalance: nonNegativeInteger(row.balance),
      version: nonNegativeInteger(row.version),
      updatedAt: nonNegativeInteger(row.updated_at),
    };
  }

  #ledgerByIdempotency(
    idempotencyKey: string,
  ): PromotionFundLedgerEntry | null {
    const row = this.database.db.prepare(`
      SELECT
        id, account_id, kind, delta, balance_after, instance_id,
        actor_kind, actor_id, reason, idempotency_key, created_at
      FROM promotion_fund_ledger
      WHERE idempotency_key = ?
    `).get(idempotencyKey) as SqlRow | undefined;
    return row ? decodeLedger(row) : null;
  }

  #insertLedger(input: LedgerFingerprint & {
    readonly balanceAfter: number;
    readonly idempotencyKey: string;
    readonly createdAt: number;
  }): PromotionFundLedgerEntry {
    const id = randomUUID();
    try {
      this.database.db.prepare(`
        INSERT INTO promotion_fund_ledger (
          id, account_id, kind, delta, balance_after, instance_id,
          actor_kind, actor_id, reason, idempotency_key, created_at
        ) VALUES (?, 'global', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.kind,
        input.delta,
        input.balanceAfter,
        input.instanceId,
        input.actor.kind,
        input.actor.id,
        input.reason,
        input.idempotencyKey,
        input.createdAt,
      );
    } catch {
      const replay = this.#ledgerByIdempotency(input.idempotencyKey);
      if (replay) {
        assertLedgerReplay(replay, input);
        return replay;
      }
      throw new PromotionFundError('financial-invariant');
    }
    const inserted = this.#ledgerByIdempotency(input.idempotencyKey);
    if (!inserted) invariant();
    return inserted;
  }

  #escrow(instanceId: string): PrizeEscrow | null {
    const row = this.database.db.prepare(`
      SELECT
        instance_id, account_id, amount, status, human_paid, bot_returned,
        settlement_fingerprint, reserved_at, settled_at, refunded_at,
        updated_at
      FROM tournament_prize_escrow
      WHERE instance_id = ?
    `).get(instanceId) as SqlRow | undefined;
    return row ? decodeEscrow(row) : null;
  }

  #instanceLifecycle(instanceId: string): {
    readonly status: string;
    readonly registrationState: string;
    readonly generation: number;
  } | null {
    const row = this.database.db.prepare(`
      SELECT status, registration_state, registration_generation
      FROM tournament_instance
      WHERE id = ?
    `).get(instanceId) as SqlRow | undefined;
    return row
      ? {
          status: stringValue(row.status),
          registrationState: stringValue(row.registration_state),
          generation: nonNegativeInteger(row.registration_generation),
        }
      : null;
  }
}

function assertLedgerReplay(
  ledger: PromotionFundLedgerEntry,
  expected: LedgerFingerprint,
): void {
  if (
    ledger.kind !== expected.kind
    || ledger.delta !== expected.delta
    || ledger.instanceId !== expected.instanceId
    || ledger.actor.kind !== expected.actor.kind
    || ledger.actor.id !== expected.actor.id
    || ledger.reason !== expected.reason
  ) {
    throw new PromotionFundError('idempotency-conflict');
  }
}

function decodeLedger(row: SqlRow): PromotionFundLedgerEntry {
  const accountId = stringValue(row.account_id);
  const kind = stringValue(row.kind);
  const actorKind = stringValue(row.actor_kind);
  if (
    accountId !== ACCOUNT_ID
    || !isLedgerKind(kind)
    || !isActorKind(actorKind)
  ) {
    invariant();
  }
  return {
    id: stringValue(row.id),
    accountId,
    kind,
    delta: integer(row.delta),
    balanceAfter: nonNegativeInteger(row.balance_after),
    instanceId: nullableString(row.instance_id),
    actor: { kind: actorKind, id: stringValue(row.actor_id) },
    reason: stringValue(row.reason),
    idempotencyKey: stringValue(row.idempotency_key),
    createdAt: nonNegativeInteger(row.created_at),
  };
}

function decodeEscrow(row: SqlRow): PrizeEscrow {
  const accountId = stringValue(row.account_id);
  const status = stringValue(row.status);
  if (
    accountId !== ACCOUNT_ID
    || (status !== 'reserved' && status !== 'settled' && status !== 'refunded')
  ) {
    invariant();
  }
  return {
    instanceId: stringValue(row.instance_id),
    accountId,
    amount: positiveInteger(row.amount),
    status,
    humanPaid: nonNegativeInteger(row.human_paid),
    botReturned: nonNegativeInteger(row.bot_returned),
    settlementFingerprint: nullableString(row.settlement_fingerprint),
    reservedAt: nonNegativeInteger(row.reserved_at),
    settledAt: nullableInteger(row.settled_at),
    refundedAt: nullableInteger(row.refunded_at),
    updatedAt: nonNegativeInteger(row.updated_at),
  };
}

function configuredFreerollPrize(raw: unknown): number {
  if (typeof raw !== 'string') invariant();
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch {
    invariant();
  }
  if (!isRecord(config) || !isRecord(config.prizePool)) invariant();
  if (config.prizePool.kind !== 'promotion-funded') invariant();
  return positiveInteger(config.prizePool.totalPrize);
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.rowId]), 'utf8')
    .toString('base64url');
}

function decodeCursor(value: string): Cursor {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 512
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    invalid();
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      !Array.isArray(decoded)
      || decoded.length !== 1
      || !Number.isSafeInteger(decoded[0])
      || decoded[0] < 1
      || encodeCursor({ rowId: decoded[0] }) !== value
    ) {
      invalid();
    }
    return { rowId: decoded[0] };
  } catch (error) {
    if (error instanceof PromotionFundError) throw error;
    invalid();
  }
}

function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid();
}

function assertIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < 1
    || value.length > 200
  ) {
    invalid();
  }
}

function assertActor(actor: PromotionFundActor): void {
  if (
    !actor
    || !isActorKind(actor.kind)
  ) {
    invalid();
  }
  assertIdentifier(actor.id);
}

function assertReason(reason: unknown): asserts reason is string {
  if (
    typeof reason !== 'string'
    || reason.trim() !== reason
    || reason.length < MIN_REASON_LENGTH
    || reason.length > MAX_REASON_LENGTH
  ) {
    invalid();
  }
}

function assertDelta(value: unknown): asserts value is number {
  if (
    !Number.isSafeInteger(value)
    || value === 0
    || Math.abs(value as number) > MAX_LEDGER_DELTA
  ) {
    invalid();
  }
}

function assertPositiveAmount(value: unknown): asserts value is number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 1
    || (value as number) > MAX_LEDGER_DELTA
  ) {
    invalid();
  }
}

function assertTimestamp(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
}

function isActorKind(value: string): value is PromotionFundActor['kind'] {
  return value === 'backoffice-admin'
    || value === 'operator-profile'
    || value === 'system';
}

function isLedgerKind(value: string): value is PromotionFundLedgerKind {
  return value === 'admin-adjustment'
    || value === 'freeroll-prize-reserve'
    || value === 'freeroll-bot-prize-return'
    || value === 'freeroll-prize-refund';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') invariant();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value);
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) invariant();
  return value as number;
}

function nonNegativeInteger(value: unknown): number {
  const result = integer(value);
  if (result < 0) invariant();
  return result;
}

function positiveInteger(value: unknown): number {
  const result = integer(value);
  if (result < 1) invariant();
  return result;
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value);
}

function invalid(): never {
  throw new PromotionFundError('invalid-input');
}

function invariant(): never {
  throw new PromotionFundError('financial-invariant');
}
