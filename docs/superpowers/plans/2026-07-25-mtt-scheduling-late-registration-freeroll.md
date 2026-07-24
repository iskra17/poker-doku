# MTT Scheduling, Late Registration, and Freeroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영속 예약·반복 MTT, 공정한 레이트 레지, 공용 운영 자금 기반 프리롤을 승인된 세 설계대로 한 배포 단위로 완성한다.

**Architecture:** SQLite v27/v28을 예약 회차·등록·자금·정산의 정본으로 두고, 스케줄러와 명령 서비스가 composite CAS와 lease를 소유한다. `TournamentManager`와 `RoomManager`는 DB에서 claim된 스냅샷을 준비·활성화하고, 클라이언트는 서버가 계산한 lifecycle·등록 가능 여부·상금 projection만 표시한다.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Socket.IO, `node:sqlite`, Vitest, Zustand.

**Canonical specs:**

- `docs/superpowers/specs/2026-07-24-mtt-scheduling-admin-design.md`
- `docs/superpowers/specs/2026-07-24-mtt-late-registration-design.md`
- `docs/superpowers/specs/2026-07-25-mtt-freeroll-promotion-fund-design.md`

---

## File structure

New shared domain files:

- `src/lib/tournament/tournament-config.ts`: v2 immutable config, recurrence, schedule, field, economy, late-registration validators.
- `src/lib/tournament/tournament-state.ts`: instance/registration/row state unions and legal composite transitions.
- `src/lib/tournament/late-registration-clock.ts`: absolute close deadline and close-reason evaluation.
- `src/lib/tournament/late-registration-seating.ts`: pure, capacity-safe multi-table seating planner.
- `src/lib/tournament/tournament-settlement.ts`: payout freeze and final settlement canonical fingerprints.
- `src/lib/tournament/tournament-presenter.ts`: Korean public labels, CTA, and deadline presentation.

New server files:

- `src/server/tournament-command-parser.ts`: socket/admin shared ingress parser; the only `practice → freeroll` adapter.
- `src/server/tournament-instance-repository.ts`: template/instance CRUD, composite CAS, leases, public/admin queries.
- `src/server/tournament-enrollment-repository.ts`: request/attempt registration and wallet/freeroll enrollment transactions.
- `src/server/promotion-fund-repository.ts`: promotion balance, immutable ledger, prize escrow, freeroll settlement.
- `src/server/tournament-scheduler.ts`: recurrence reconciliation, funding, opening, start claims, retry scheduling.
- `src/server/tournament-recovery-service.ts`: pre-listen preserve/defer/refund/payout recovery classification.
- `src/server/late-registration-coordinator.ts`: generation/owner scoped seating, closing, rollback, and cancel handoff.
- `src/server/admin-session.ts`: opaque admin sessions, cookie, CSRF, origin and rate limits.

New UI files:

- `src/components/tournament/TournamentCreateForm.tsx`: lobby/admin shared seven-stage form.
- `src/components/lobby/TournamentCard.tsx`: public lifecycle, field, late-registration and funding card.

Existing integration points:

- `src/server/persistence/migrations.ts`
- `src/server/economy-repository.ts`
- `src/server/economy-service.ts`
- `src/server/economy-runtime.ts`
- `src/server/tournament-manager.ts`
- `src/server/tournament-command-service.ts`
- `src/server/room-manager.ts`
- `src/server/session-manager.ts`
- `src/server/socket-handler.ts`
- `src/server/admin-http.ts`
- `src/server/http-handler.ts`
- `src/server/index.ts`
- `src/server/ops-log.ts`
- `src/lib/realtime/protocol.ts`
- `src/lib/store/game-store.ts`
- `src/app/admin/page.tsx`
- `src/components/lobby/CreateTournamentModal.tsx`
- `src/components/lobby/RoomList.tsx`
- `src/components/lobby/TournamentDetailModal.tsx`
- `src/components/layout/TopBar.tsx`

## Delivery gates

The three feature flags remain off until their gate is green:

```ts
MTT_SCHEDULER_V2_ENABLED=false
MTT_LATE_REG_ENABLED=false
MTT_WALLET_LATE_REG_ENABLED=false
```

Gate order is schema/contracts → persistent repositories → scheduler/recovery → prepared runtime → late registration → settlement → API/UI → full verification. A failing gate blocks every later gate.

---

### Task 1: Shared v2 contracts, state machine, and ingress parser

**Files:**

- Create: `src/lib/tournament/tournament-config.ts`
- Create: `src/lib/tournament/tournament-state.ts`
- Create: `src/server/tournament-command-parser.ts`
- Create: `src/server/tournament-command-parser.test.ts`
- Modify: `src/lib/realtime/protocol.ts`

- [ ] **Step 1: Write failing parser and state tests**

```ts
it('normalizes legacy practice only at ingress and emits freeroll', () => {
  const parsed = parseCreateTournamentCommand({
    requestId: crypto.randomUUID(),
    economyMode: 'practice',
    minEntrants: 8,
    maxEntrants: 24,
    botFillToMinimum: true,
    prizePool: { kind: 'promotion-funded', totalPrize: 100_000 },
  }, NOW);
  expect(parsed.config.economy.mode).toBe('freeroll');
});

it('rejects wallet bot fill instead of coercing it', () => {
  expect(() => parseCreateTournamentCommand({
    requestId: crypto.randomUUID(),
    economyMode: 'wallet',
    minEntrants: 8,
    maxEntrants: 24,
    botFillToMinimum: true,
    prizePool: { kind: 'entry-pool' },
  }, NOW)).toThrow('wallet-bot-fill');
});

it('accepts only legal lifecycle and registration pairs', () => {
  expect(isTournamentStatePair('running', 'open-late')).toBe(true);
  expect(isTournamentStatePair('payout-pending', 'open-late')).toBe(false);
  expect(isTournamentStatePair('refund-pending', 'closed')).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/server/tournament-command-parser.test.ts
```

Expected: FAIL because the parser, v2 config and state pair functions do not exist.

- [ ] **Step 3: Implement the immutable domain contract**

Use these public shapes:

```ts
export interface TournamentFieldPolicy {
  minEntrants: number;
  maxEntrants: number;
  botFillToMinimum: boolean;
}

export type TournamentEconomyPolicy =
  | { mode: 'freeroll'; promotionAccountId: 'global' }
  | { mode: 'wallet'; productVersion: number; buyIn: number; fee: number };

export type PrizePoolPolicy =
  | { kind: 'promotion-funded'; totalPrize: number }
  | { kind: 'entry-pool' };

export type TournamentInstanceStatus =
  | 'scheduled-hidden' | 'scheduled-visible' | 'registering'
  | 'start-delayed' | 'starting' | 'running'
  | 'payout-pending' | 'refund-pending' | 'completed' | 'cancelled';

export type TournamentRegistrationState =
  | 'not-open' | 'open-prestart' | 'locked-for-start'
  | 'open-late' | 'closing' | 'closed';
```

The parser must validate safe integers, `2 <= min <= max <= 48`, automatic/manual schedule exclusivity, wallet registration lead and manual expiry at most 20 minutes, recurrence bounds, segment ordering, late-registration levels 0..3, and the exact `freeroll+promotion-funded` / `wallet+entry-pool` combinations.

- [ ] **Step 4: Expand public protocol without making the client infer state**

Add `PublicTournamentLifecycle`, schedule, structure, payout, registration state/reason, field counters, `canRegister`, `canCancelRegistration`, personalized registration/seat state, `RegisterTournamentCommand/Result`, `TournamentSeatAssigned`, and `{serverNow,tournaments}` list envelope. Keep `phase` as an optional deprecated adapter for one compatibility release.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/tournament-command-parser.test.ts
npx tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src/lib/tournament/tournament-config.ts src/lib/tournament/tournament-state.ts src/server/tournament-command-parser.ts src/server/tournament-command-parser.test.ts src/lib/realtime/protocol.ts
git commit -m "feat: define persistent mtt v2 contracts"
```

---

### Task 2: SQLite v27/v28 tournament and economic schema

**Files:**

- Modify: `src/server/persistence/migrations.ts`
- Modify: `src/server/persistence/database.test.ts`

- [ ] **Step 1: Add failing migration tests**

Add tests named:

```ts
it('adds v27 scheduled tournament and promotion fund schema', () => {});
it('enforces lifecycle registration composite states and close ownership', () => {});
it('keeps ledgers settlement results and terminal identities immutable', () => {});
it('allows only one active mtt claim per profile', () => {});
it('rebuilds v28 sng entries with attempt generations without losing v26 rows', () => {});
it('rolls all v27 and v28 objects back when a middle statement fails', () => {});
```

The assertions must query `sqlite_schema`, insert valid boundary rows, reject invalid status pairs, reject ledger/settlement UPDATE and DELETE, verify partial unique indexes, and reopen a v26 fixture after migration.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/persistence/database.test.ts
```

Expected: FAIL because latest version is 26 and the new tables do not exist.

- [ ] **Step 3: Add v27 STRICT tables and constraints**

Add the exact schema from the canonical specs for:

```text
tournament_template
tournament_instance
tournament_registration
tournament_registration_attempt
tournament_forfeit
promotion_fund
promotion_fund_ledger
tournament_prize_escrow
tournament_settlement
tournament_settlement_result
```

Seed `promotion_fund(account_id='global', balance=0, version=0)`. Add partial unique indexes for effective template occurrences and one active MTT claim per profile. Add immutable identity/ledger/result triggers, legal escrow/settlement transition triggers, schedule CHECKs, and the instance-status × registration-state composite CHECK.

- [ ] **Step 4: Add the atomic v28 `sng_entries` rebuild**

Preserve all v26 columns and rows, add `entry_attempt >= 1`, replace the old tournament/profile uniqueness with:

```sql
UNIQUE (tournament_id, profile_id, entry_attempt)
```

Recreate the one-active-entry-per-profile partial index and all foreign-key/amount/place constraints. Existing rows become attempt 1.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/persistence/database.test.ts
```

Expected: PASS with migration markers through 28.

Commit:

```bash
git add src/server/persistence/migrations.ts src/server/persistence/database.test.ts
git commit -m "feat: persist scheduled mtt lifecycle and funding"
```

---

### Task 3: Opaque backoffice admin session boundary

**Files:**

- Create: `src/server/admin-session.ts`
- Create: `src/server/admin-session.test.ts`
- Modify: `src/server/admin-http.ts`
- Modify: `src/server/http-handler.ts`
- Modify: `src/server/admin-config-http.test.ts`

- [ ] **Step 1: Write failing authentication tests**

```ts
it('issues a two-hour opaque HttpOnly Strict admin cookie', async () => {});
it('uses constant-time token verification and never returns the source token', async () => {});
it('requires exact same-origin and csrf for every mutation', async () => {});
it('limits login by client address and mutations by session', async () => {});
it('keeps profile tournament operators separate from fund administrators', async () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/admin-session.test.ts src/server/admin-config-http.test.ts
```

Expected: FAIL because admin APIs currently require a query-string debug token.

- [ ] **Step 3: Implement `AdminSessionManager`**

Required API:

```ts
class AdminSessionManager {
  login(rawToken: string, clientKey: string, now: number): AdminLoginResult;
  authenticate(cookieHeader: string | undefined, now: number): AdminPrincipal | null;
  requireMutation(input: {
    cookieHeader?: string;
    csrfHeader?: string;
    origin?: string;
    host?: string;
    now: number;
  }): AdminPrincipal;
  logout(cookieHeader: string | undefined): void;
}
```

Generate session and CSRF secrets with CSPRNG. Store only in memory. Cookie flags are `HttpOnly; SameSite=Strict; Path=/api/admin`, plus `Secure` in production. Login is 5 attempts/10 minutes per client key; mutation is 30/minute per session.

- [ ] **Step 4: Replace the admin UI API gate**

Implement:

```text
GET    /api/admin/session
POST   /api/admin/session
DELETE /api/admin/session
GET    /api/admin/feedback
```

All other `/api/admin/*` routes require the admin session. Mutations additionally require CSRF and exact origin. Keep legacy `/api/debug/*?token=` endpoints only for operational compatibility; `/admin` must no longer use them.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/admin-session.test.ts src/server/admin-config-http.test.ts
npx tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src/server/admin-session.ts src/server/admin-session.test.ts src/server/admin-http.ts src/server/http-handler.ts src/server/admin-config-http.test.ts
git commit -m "feat: secure the admin session boundary"
```

---

### Task 4: Template and tournament instance repository

**Files:**

- Create: `src/server/tournament-instance-repository.ts`
- Create: `src/server/tournament-instance-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

```ts
it('creates one idempotent standalone or recurring instance', () => {});
it('patches a template only at the expected revision', () => {});
it('replaces hidden old-revision occurrences but preserves visible occupancy', () => {});
it('claims exactly one concurrent start expiry cancel or close owner', () => {});
it('moves financial liability to refund-pending before terminal cancellation', () => {});
it('blocks payout-pending cancellation and refund transitions', () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/tournament-instance-repository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement immutable config storage and composite CAS**

Required repository surface:

```ts
createTemplate(command: CreateTemplateCommand): TournamentTemplateRecord;
patchTemplateIfRevision(id: string, revision: number, patch: TemplatePatch): TemplatePatchResult;
createInstance(command: CreateInstanceCommand): TournamentInstanceRecord;
claimStart(instanceId: string, ownerId: string, leaseUntil: number): StartClaim;
claimRegistrationClose(instanceId: string, ownerToken: string, reason: RegistrationCloseReason): CloseClaim;
claimRefundPending(instanceId: string, reason: StatusReason, ownerToken: string): RefundClaim;
claimPayoutPending(instanceId: string, freeze: TournamentPayoutFreezePlan): PayoutClaim;
getPublicProjection(instanceId: string, forPlayerId: string | undefined, now: number): TournamentDetailView;
```

Every transition uses `UPDATE ... WHERE` with the exact prior status, registration state, generation and owner; ownership requires `changes === 1`. Do not mutate immutable config/schedule/economy columns after insert.

- [ ] **Step 4: Add public/admin projections**

Public queries exclude `scheduled-hidden` and any freeroll whose matching reserved escrow is missing. Admin queries include hidden, lease, retry, status reason, registration generation, funding and invariant warnings. Both return `serverNow` at the HTTP/socket boundary.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/tournament-instance-repository.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/server/tournament-instance-repository.ts src/server/tournament-instance-repository.test.ts
git commit -m "feat: add persistent tournament instance lifecycle"
```

---

### Task 5: Promotion fund, prize escrow, and backoffice funding API

**Files:**

- Create: `src/server/promotion-fund-repository.ts`
- Create: `src/server/promotion-fund-repository.test.ts`
- Create: `src/server/admin-promotion-fund-http.test.ts`
- Modify: `src/server/admin-http.ts`
- Modify: `src/server/http-handler.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/ops-log.ts`
- Modify: `src/server/ops-log.test.ts`

- [ ] **Step 1: Write failing fund tests**

```ts
it('starts the global promotion account at zero', () => {});
it('adjusts once per uuid and rejects a different replay', () => {});
it('rejects a negative available balance and invalid reason', () => {});
it('reserves an immediate freeroll before exposing it', () => {});
it('funds one hidden occurrence exactly at visibility', () => {});
it('refunds a reserved freeroll exactly once', () => {});
it('keeps the immutable ledger and prize escrow tamper evident', () => {});
```

Add HTTP tests for admin-session-only GET cursor pagination and POST adjustment, CSRF/origin/rate-limit rejection, and `promotion-insufficient` response.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/promotion-fund-repository.test.ts src/server/admin-promotion-fund-http.test.ts src/server/ops-log.test.ts
```

Expected: FAIL because fund repository/API/event types are absent.

- [ ] **Step 3: Implement atomic fund operations**

Required operations:

```ts
getFundPage({limit, before}): PromotionFundPage;
adjustFund({requestId, delta, reason, actor, at}): PromotionFundAdjustment;
reserveFreerollPrize({instanceId, amount, idempotencyKey, actor, at}): PrizeEscrow;
refundFreerollPrize({instanceId, generation, idempotencyKey, actor, at}): PrizeEscrow;
```

Each operation updates account balance/version, inserts the immutable ledger row, updates/creates escrow, and changes instance lifecycle in one `PokerDatabase.transaction()`. An idempotency replay succeeds only when actor/kind/delta/reference/reason all match.

- [ ] **Step 4: Add admin routes and persisted event whitelist**

Implement:

```text
GET  /api/admin/promotion-fund?limit=1..100&before=<cursor>
POST /api/admin/promotion-fund/adjust
```

Add the approved `promotion-*`, scheduler, late-reg and payout event types to `OPS_PERSIST_TYPES`. Never put credentials, session IDs, CSRF tokens or transport tokens into event data. Ops persistence remains best-effort and never becomes the money source of truth.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/promotion-fund-repository.test.ts src/server/admin-promotion-fund-http.test.ts src/server/ops-log.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/server/promotion-fund-repository.ts src/server/promotion-fund-repository.test.ts src/server/admin-promotion-fund-http.test.ts src/server/admin-http.ts src/server/http-handler.ts src/server/index.ts src/server/ops-log.ts src/server/ops-log.test.ts
git commit -m "feat: reserve freeroll prizes from promotion funds"
```

---

### Task 6: Enrollment transactions and attempt generations

**Files:**

- Create: `src/server/tournament-enrollment-repository.ts`
- Create: `src/server/tournament-enrollment-repository.test.ts`
- Modify: `src/server/economy-repository.ts`
- Modify: `src/server/economy-service.ts`
- Modify: `src/server/economy-runtime.ts`
- Modify: `src/server/economy-mtt.test.ts`

- [ ] **Step 1: Write failing enrollment/economy tests**

```ts
it('registers prestart wallet debit and registration in one transaction', () => {});
it('registers freeroll without debit but with the same cap claim', () => {});
it('replays one request id without another attempt or debit', () => {});
it('permits attempt two only after attempt one is terminal', () => {});
it('rejects stale attempt commit release and refund', () => {});
it('preserves exact scheduled entries and defers active instances during recovery', () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/tournament-enrollment-repository.test.ts src/server/economy-mtt.test.ts
```

Expected: FAIL because enrollment rows do not drive the economy and v26 recovery refunds every active MTT.

- [ ] **Step 3: Extract narrow transaction-internal economy primitives**

Keep raw wallet mutation private. Expose only coordinator-safe methods that require an existing synchronous transaction:

```ts
reserveMttEntryInTransaction(profileId, instanceProduct, attempt, at): SngEntry;
startMttEntryInTransaction(entryId, expectedAttempt, at): SngEntry;
refundMttEntryInTransaction(entryId, expectedAttempt, reason, at): SngEntry;
creditFreerollPrizeInTransaction(profileId, instanceId, place, amount, at): void;
```

Product version/buy-in/fee come from the immutable instance snapshot, not current constants.

- [ ] **Step 4: Implement enrollment and recovery classification**

`registerPreStart`, `reserveLateMttEntry`, `commitLateMttBatch`, `releaseLateMttEntry`, `claimStartingRoster`, and `rollbackStartClaim` must atomically maintain registration row, attempt row, economy entry, request identity and instance counters. Replace blanket recovery with:

```ts
recoverIncompleteEntries({
  preserveReservedMttEntries,
  deferToMttVoidInstanceIds,
}): RecoveryResult;
```

Keep `recoverIncompleteSngEntries()` as an SnG-compatible wrapper only.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/tournament-enrollment-repository.test.ts src/server/economy-mtt.test.ts src/server/economy-service.test.ts src/server/economy-runtime.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/server/tournament-enrollment-repository.ts src/server/tournament-enrollment-repository.test.ts src/server/economy-repository.ts src/server/economy-service.ts src/server/economy-runtime.ts src/server/economy-mtt.test.ts
git commit -m "feat: make mtt enrollment attempts transactional"
```

---

### Task 7: Recurrence scheduler and pre-listen recovery

**Files:**

- Create: `src/server/tournament-scheduler.ts`
- Create: `src/server/tournament-scheduler.test.ts`
- Create: `src/server/tournament-recovery-service.ts`
- Create: `src/server/tournament-recovery-service.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing scheduler/recovery tests**

```ts
it('generates hourly daily and weekly occurrences across the full horizon', () => {});
it('reconciles the same template without duplicate occurrences', () => {});
it('tombstones superseded hidden occurrences and preserves visible occupancy', () => {});
it('funds and exposes a freeroll once at visibleAt', () => {});
it('honors wallet twenty-minute registration and manual expiry', () => {});
it('keeps starting plus running at or below four', () => {});
it('recovers a missed start within ten minutes and cancels beyond it', () => {});
it('preserves prestart entries before generic recovery and resumes pending money work', () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/tournament-scheduler.test.ts src/server/tournament-recovery-service.test.ts
```

Expected: FAIL because scheduler and classifier do not exist.

- [ ] **Step 3: Implement recurrence and due-state reconciliation**

The horizon is the furthest of now+48h, the next two occurrences, and `now + visibleLeadMs + 5m`. Use KST recurrence calculations and `(templateId, revision, startsAt)` idempotency. Every timer callback rechecks the database deadline and CAS; timer delay never authorizes late registration or start.

- [ ] **Step 4: Implement fail-safe startup order**

Before HTTP/socket listen:

```text
1. apply migrations
2. load and validate instances/config snapshots
3. classify exact preserve/defer/refund/payout sets
4. recover generic cash/SnG/orphan economy rows
5. resume instance-wide wallet void/freeroll refund
6. resume payout-pending settlement
7. reconcile templates and hydrate timers
8. accept network traffic
```

`starting|running` without a frozen result is not reconstructed: cancel safely and refund/return. `payout-pending` is never converted to refund.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/tournament-scheduler.test.ts src/server/tournament-recovery-service.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/server/tournament-scheduler.ts src/server/tournament-scheduler.test.ts src/server/tournament-recovery-service.ts src/server/tournament-recovery-service.test.ts src/server/index.ts
git commit -m "feat: reconcile scheduled tournaments durably"
```

---

### Task 8: Prepared start saga and field policy

**Files:**

- Modify: `src/server/tournament-command-service.ts`
- Modify: `src/server/tournament-command-service.test.ts`
- Modify: `src/server/tournament-manager.ts`
- Modify: `src/server/tournament-manager.lifecycle.test.ts`
- Modify: `src/server/tournament-manager.test.ts`
- Modify: `src/server/tournament-manager.wallet.test.ts`
- Modify: `src/server/room-manager.ts`

- [ ] **Step 1: Write failing saga and field tests**

```ts
it('prepares rooms without session projection broadcast timers or hands', () => {});
it('activates prepared rooms only after the running cas succeeds', () => {});
it('disposes every prepared room when economy room or activation fails', () => {});
it('fills a freeroll only from one human to minEntrants', () => {});
it('adds no bots when humans already meet minimum', () => {});
it('cancels a zero-human freeroll and a short wallet field', () => {});
it('restores the exact source pair after an early manual not-enough result', () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/tournament-command-service.test.ts src/server/tournament-manager.lifecycle.test.ts src/server/tournament-manager.test.ts src/server/tournament-manager.wallet.test.ts
```

Expected: FAIL because `attemptStart()` creates/broadcasts live rooms immediately and practice bots fill to max.

- [ ] **Step 3: Split runtime preparation from activation**

Add:

```ts
prepareFromInstance(snapshot, roster, ownerToken): PreparedTournamentRuntime;
activatePreparedTournament(instanceId, ownerToken, actualStartedAt): void;
discardPreparedTournament(instanceId, ownerToken, reason): void;
```

Prepared rooms carry an owner-scoped `mtt-setup` hold and cannot emit room membership, start clocks, player loops, bot actions or hands. The command service sequence is roster claim → mode economy start → prepare rooms → running CAS → activate and project sessions. Any failure disposes all rooms via `disposeRoom('mtt-start-rollback')` and hands off to durable refund.

- [ ] **Step 4: Replace max-fill and memory registration assumptions**

Use claimed humans and `TournamentFieldPolicy`. Wallet never has bots. Freeroll with bot fill adds exactly `max(0, minEntrants - claimedHumans)` bots when at least one human is claimed. Persist `initialEntrants`, `initialBotEntrants`, `committedEntrants`, and `everMultiTable`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/tournament-command-service.test.ts src/server/tournament-manager.lifecycle.test.ts src/server/tournament-manager.test.ts src/server/tournament-manager.wallet.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/server/tournament-command-service.ts src/server/tournament-command-service.test.ts src/server/tournament-manager.ts src/server/tournament-manager.lifecycle.test.ts src/server/tournament-manager.test.ts src/server/tournament-manager.wallet.test.ts src/server/room-manager.ts
git commit -m "feat: activate persistent mtt starts safely"
```

---

### Task 9: Late-registration clock and pure seating planner

**Files:**

- Create: `src/lib/tournament/late-registration-clock.ts`
- Create: `src/lib/tournament/late-registration-clock.test.ts`
- Create: `src/lib/tournament/late-registration-seating.ts`
- Create: `src/lib/tournament/late-registration-seating.test.ts`
- Modify: `src/lib/poker/mtt-structure.ts`
- Modify: `src/lib/poker/mtt-structure.test.ts`

- [ ] **Step 1: Write failing clock and property tests**

```ts
it('closes after level one two or three by absolute actual-start time', () => {});
it('does not extend late registration for pause or break', () => {});
it('closes at full twenty bb bubble final table or last player boundaries', () => {});
it.each(generatedFields)('plans within capacity with table size delta at most one', field => {});
it('mixes a five-player cohort with incumbents instead of one new-only table', () => {});
it('does not call Math.random in a seating path', () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/lib/tournament/late-registration-clock.test.ts src/lib/tournament/late-registration-seating.test.ts src/lib/poker/mtt-structure.test.ts
```

Expected: FAIL because late clock/planner and segment clock are absent.

- [ ] **Step 3: Implement segment clock and close evaluation**

`mttClockAt()` must accept immutable segments and actual start time, distinguish play and break segments, and expose current segment, BB/ante, segment end, and next play segment. `evaluateRegistrationClose()` applies the canonical close-reason priority and uses `effectiveRemaining = aliveSeated + pending`.

- [ ] **Step 4: Implement the pure planner**

Input is current tables/seats, pending cohort and table capacity. Output contains new table creation, silent incumbent moves, entrant seats, and final sizes. It must preserve capacity, final size difference ≤1, minimize incumbent moves, avoid new-only cohorts when mixing is possible, choose soon-BB empty seats, and receive a CSPRNG tie-break function instead of calling `Math.random`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/lib/tournament/late-registration-clock.test.ts src/lib/tournament/late-registration-seating.test.ts src/lib/poker/mtt-structure.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/tournament/late-registration-clock.ts src/lib/tournament/late-registration-clock.test.ts src/lib/tournament/late-registration-seating.ts src/lib/tournament/late-registration-seating.test.ts src/lib/poker/mtt-structure.ts src/lib/poker/mtt-structure.test.ts
git commit -m "feat: plan fair late registration seating"
```

---

### Task 10: Late-registration coordinator, batch transfer, and next-hand gate

**Files:**

- Create: `src/server/late-registration-coordinator.ts`
- Create: `src/server/late-registration-coordinator.test.ts`
- Modify: `src/server/tournament-manager.ts`
- Modify: `src/server/tournament-manager.break.test.ts`
- Modify: `src/server/tournament-manager.director.test.ts`
- Modify: `src/server/room-manager.ts`
- Create: `src/server/room-manager.mtt-gate.test.ts`

- [ ] **Step 1: Write failing coordination tests**

```ts
it('ignores every stale generation and owner callback', () => {});
it('upgrades a changed one-player target into global balance', () => {});
it('commits a silent batch before any session or room update', () => {});
it('rolls the journal back and disposes a new table after db failure', () => {});
it('holds all current hands during closing and starts no next hand before freeze', () => {});
it('lets cancel take ownership before freeze without deadlock', () => {});
it('fails the next-hand gate closed during db read faults and resumes once', () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/late-registration-coordinator.test.ts src/server/room-manager.mtt-gate.test.ts src/server/tournament-manager.break.test.ts src/server/tournament-manager.director.test.ts
```

Expected: FAIL because holds are reason-only memory sets and transfers broadcast immediately.

- [ ] **Step 3: Implement owner-scoped holds and single-flight operations**

Every operation captures `(registrationGeneration, ownerToken)`. Store holds as `(reason, ownerToken)` and remove only an exact owner hold. Closing/balance/seating/cancel handoffs adopt the DB projection before queueing continuation. No callback or `finally` block may release a newer owner's hold.

- [ ] **Step 4: Add silent batch journal and fail-closed hand gate**

`RoomManager.transferMttSeatsBatch(plan, {broadcast:false})` returns a reversible journal. Create late tables with current level/ante/deadline/field/payout/holds before first broadcast. Commit enrollment and seating in DB, then project sessions and broadcast. Before every next hand, `checkNextHandGate()` verifies DB generation/registration state; transient errors hold and retry with bounded backoff, terminal/dispose clears retries.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/late-registration-coordinator.test.ts src/server/room-manager.mtt-gate.test.ts src/server/tournament-manager.break.test.ts src/server/tournament-manager.director.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/server/late-registration-coordinator.ts src/server/late-registration-coordinator.test.ts src/server/tournament-manager.ts src/server/tournament-manager.break.test.ts src/server/tournament-manager.director.test.ts src/server/room-manager.ts src/server/room-manager.mtt-gate.test.ts
git commit -m "feat: coordinate late mtt seating safely"
```

---

### Task 11: Provisional eliminations, payout freeze, and durable settlement

**Files:**

- Create: `src/lib/tournament/tournament-settlement.ts`
- Create: `src/lib/tournament/tournament-settlement.test.ts`
- Modify: `src/server/promotion-fund-repository.ts`
- Modify: `src/server/economy-repository.ts`
- Modify: `src/server/tournament-manager.ts`
- Create: `src/server/tournament-manager.freeroll.test.ts`
- Modify: `src/server/tournament-manager.wallet.test.ts`
- Modify: `src/server/tournament-manager.test.ts`
- Modify: `src/server/tournament-recovery-service.ts`
- Modify: `src/server/tournament-recovery-service.test.ts`

- [ ] **Step 1: Write failing freeze/settlement tests**

```ts
it('keeps open-late eliminations provisional with monotonic batch sequence', () => {});
it('freezes final entrants and every place payout once at close', () => {});
it('requires a continuous one-to-n result with every participant once', () => {});
it('rejects a changed settlement fingerprint replay', () => {});
it('pays humans and returns bot prizes so totals equal the freeroll escrow', () => {});
it('never passes a bot id to a wallet credit path', () => {});
it('keeps failed settlement payout-pending across restart', () => {});
it('forbids cancel or refund once payout-pending exists', () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/lib/tournament/tournament-settlement.test.ts src/server/tournament-manager.freeroll.test.ts src/server/tournament-manager.wallet.test.ts src/server/tournament-recovery-service.test.ts
```

Expected: FAIL because results currently settle directly from memory and cleanup proceeds after failure.

- [ ] **Step 3: Implement freeze and final plan validation**

At registration close, persist only final field and the payout ladder checksum. At tournament completion, persist the immutable header plus all places 1..N, unique player IDs, human profile/attempt identity, bot null identity, disposition and exact totals. Same instance + same fingerprint is idempotent; a changed fingerprint is a financial invariant failure.

- [ ] **Step 4: Implement two-transaction completion**

Transaction 1 stores settlement/result rows and CASes `running → payout-pending`. Transaction 2 reads only the persisted plan:

- wallet: validate started entries from the instance product snapshot, credit payouts, settle entries/header/instance.
- freeroll: credit human prizes with `mtt-freeroll-prize:<instance>:<place>`, return total bot prizes to promotion fund, verify `humanPaid + botReturned === escrow.amount`, settle escrow/header/instance.

No cleanup timer runs until terminal `completed`. Refund-pending cannot create a settlement; payout-pending cannot cancel/refund. Startup recovery resumes the exact stored plan.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/lib/tournament/tournament-settlement.test.ts src/server/tournament-manager.freeroll.test.ts src/server/tournament-manager.wallet.test.ts src/server/tournament-manager.test.ts src/server/tournament-recovery-service.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/tournament/tournament-settlement.ts src/lib/tournament/tournament-settlement.test.ts src/server/promotion-fund-repository.ts src/server/economy-repository.ts src/server/tournament-manager.ts src/server/tournament-manager.freeroll.test.ts src/server/tournament-manager.wallet.test.ts src/server/tournament-manager.test.ts src/server/tournament-recovery-service.ts src/server/tournament-recovery-service.test.ts
git commit -m "feat: settle frozen mtt results durably"
```

---

### Task 12: Socket protocol, session engagement, and client store

**Files:**

- Modify: `src/server/session-manager.ts`
- Modify: `src/server/session-manager.test.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-payload.ts`
- Modify: `src/server/socket-handler.integration.test.ts`
- Modify: `src/lib/store/game-store.ts`
- Create: `src/lib/store/game-store.tournament-seat-assigned.test.ts`

- [ ] **Step 1: Write failing boundary tests**

```ts
it('returns an idempotent register result for one request id', async () => {});
it('keeps a late-pending engagement through disconnect and resync', async () => {});
it('emits tournament seat assigned only to the newest lobby socket', async () => {});
it('ignores a seat assignment for a different pending tournament', () => {});
it('keeps table-move isolated from first late seating', () => {});
it('rejects wallet bot fill before mutation and logging', async () => {});
it('emits tournament lists with serverNow and freeroll-only output', async () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/session-manager.test.ts src/server/socket-handler.integration.test.ts src/lib/store/game-store.tournament-seat-assigned.test.ts
```

Expected: FAIL because registration has no request ID/engagement and the event does not exist.

- [ ] **Step 3: Add server engagement and event guards**

Session engagement contains `{kind:'late-pending', tournamentId, requestId}` and prevents idle release/other wallet admission. Immediately before projection, verify latest socket ownership, `session.roomId === null`, matching engagement and committed live seat. Clear engagement, set room, then emit `tournament-seat-assigned`. Resync reconstructs the same snapshot from DB registration plus live seat.

- [ ] **Step 4: Update the client store**

Track server clock offset, pending tournament/request and registration status. Reuse one `crypto.randomUUID()` until the request reaches a terminal result. Apply `tournament-seat-assigned` only while in lobby and for the matching pending tournament, replace game/chat snapshots without `diffGameState()`, then set the new room. Keep existing `table-move` guard unchanged.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/session-manager.test.ts src/server/socket-handler.integration.test.ts src/lib/store/game-store.tournament-seat-assigned.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/server/session-manager.ts src/server/session-manager.test.ts src/server/socket-handler.ts src/server/socket-payload.ts src/server/socket-handler.integration.test.ts src/lib/store/game-store.ts src/lib/store/game-store.tournament-seat-assigned.test.ts
git commit -m "feat: deliver late tournament seats safely"
```

---

### Task 13: Template, instance, and promotion admin APIs

**Files:**

- Create: `src/server/admin-tournament-http.test.ts`
- Modify: `src/server/admin-http.ts`
- Modify: `src/server/http-handler.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/tournament-command-service.ts`
- Modify: `src/server/tournament-command-service.test.ts`

- [ ] **Step 1: Write failing admin command tests**

```ts
it('creates one standalone v2 instance through the shared parser', async () => {});
it('creates patches and toggles a recurring template with if-match', async () => {});
it('returns hidden occurrences leases retries and funding warnings to backoffice', async () => {});
it('returns serverNow on every response', async () => {});
it('limits body bytes and custom segment rows', async () => {});
it('keeps profile operators unable to adjust the promotion fund', async () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/server/admin-tournament-http.test.ts src/server/tournament-command-service.test.ts
```

Expected: FAIL because template/schedule endpoints and v2 command routing are absent.

- [ ] **Step 3: Implement authenticated APIs**

Add:

```text
GET    /api/admin/tournaments
POST   /api/admin/tournaments
GET    /api/admin/tournament-templates
POST   /api/admin/tournament-templates
PATCH  /api/admin/tournament-templates/:id
POST   /api/admin/tournament-templates/:id/actions
POST   /api/admin/tournaments/:id/actions
```

Template actions are `enable|disable|generate-next`; instance actions retain `start|pause|resume|set-level|remove-player|cancel`. Parse authorization before payload and logging. Use the same command parser as sockets. Return structured conflict/status codes and `serverNow`.

- [ ] **Step 4: Wire scheduler/repository services**

`TournamentCommandService` remains the sole mutation boundary for operator profile and backoffice actors, but promotion adjustment remains a separate backoffice-only service. Runtime admin projection merges persistent instances/templates with live table state without turning memory state into the source of truth.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/server/admin-tournament-http.test.ts src/server/tournament-command-service.test.ts
npx tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src/server/admin-tournament-http.test.ts src/server/admin-http.ts src/server/http-handler.ts src/server/index.ts src/server/tournament-command-service.ts src/server/tournament-command-service.test.ts
git commit -m "feat: expose scheduled mtt admin commands"
```

---

### Task 14: Public tournament presentation and lobby/admin UI

**Files:**

- Create: `src/lib/tournament/tournament-presenter.ts`
- Create: `src/lib/tournament/tournament-presenter.test.ts`
- Create: `src/components/tournament/TournamentCreateForm.tsx`
- Create: `src/components/lobby/TournamentCard.tsx`
- Modify: `src/components/lobby/CreateTournamentModal.tsx`
- Modify: `src/components/lobby/RoomList.tsx`
- Modify: `src/components/lobby/TournamentDetailModal.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Write failing pure presentation tests**

```ts
it('labels every lifecycle registration and funding state in Korean', () => {});
it('disables a stale register button using serverNow even before a delayed timer fires', () => {});
it('describes freeroll fixed prizes and bot returns without practice wording', () => {});
it('describes wallet human-only entry and full refunds', () => {});
it('shows seating close and payout/refund pending actions correctly', () => {});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/lib/tournament/tournament-presenter.test.ts
```

Expected: FAIL because the presenter does not exist and current UI branches on legacy phase.

- [ ] **Step 3: Implement the shared seven-stage create form**

Stages are:

```text
기본 → 일정/반복 → 필드/봇 → 구조 → 상금 → 레이트 레지 → 최종 검토
```

Lobby and admin wrappers inject submit transport. Freeroll shows “바이인 없음”, guaranteed prize input, funding reservation and bot-prize-return notice. Wallet hides the bot option and shows buy-in/fee, human-only and minimum-miss refund. Custom structure rows and recurrence fields are bounded by the shared parser.

- [ ] **Step 4: Replace legacy public/admin presentation**

Extract `TournamentCard` from `RoomList`. Use lifecycle, server deadlines, min/max counters, current BB, late-registration status, provisional/final payout, and funding state. Detail and TopBar show close countdown/20BB warning/seating status. Remove all MTT “연습”, “practice”, “표시용 상금” copy.

In `/admin`, remove token localStorage and query token calls; login via admin session cookie, retain CSRF in memory, migrate feedback to `/api/admin/feedback`, open the shared create modal, display templates/instances/retries/leases, and add promotion balance/reserved/ledger plus draft→review→execute adjustment without `confirm()`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/lib/tournament/tournament-presenter.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

Expected: PASS.

Commit:

```bash
git add src/lib/tournament/tournament-presenter.ts src/lib/tournament/tournament-presenter.test.ts src/components/tournament/TournamentCreateForm.tsx src/components/lobby/TournamentCard.tsx src/components/lobby/CreateTournamentModal.tsx src/components/lobby/RoomList.tsx src/components/lobby/TournamentDetailModal.tsx src/components/layout/TopBar.tsx src/app/admin/page.tsx
git commit -m "feat: present scheduled freeroll tournaments"
```

---

### Task 15: End-to-end feature gates, regression matrix, and documentation

**Files:**

- Modify: `src/server/index.ts`
- Modify: `src/server/server-shutdown.ts`
- Modify: `src/server/server-shutdown.test.ts`
- Modify: `AGENTS.md`
- Modify: `README.md` if the operator flow is documented there

- [ ] **Step 1: Add failing integrated lifecycle tests**

Cover:

```ts
it('runs scheduled visible register start late-seat close freeze settle across restart', async () => {});
it('returns a cancelled freeroll prize and a short wallet field exactly once', async () => {});
it('keeps payout-pending immutable and resumes the frozen plan after restart', async () => {});
it('shuts down every scheduler lease retry batch and admin session timer', async () => {});
```

- [ ] **Step 2: Verify RED and close uncovered gaps**

Run the focused integration files selected by the new tests. Expected: each test must initially fail for an integration gap, not a typo. Add only the missing wiring required to pass.

- [ ] **Step 3: Enable gates in order**

After each relevant focused suite is green, set:

```ts
MTT_SCHEDULER_V2_ENABLED=true
MTT_LATE_REG_ENABLED=true
MTT_WALLET_LATE_REG_ENABLED=true
```

Defaults must be production-safe and overridable only through the established configuration mechanism. Scheduler, coordinator, retry and admin-session resources must be stopped in server shutdown.

- [ ] **Step 4: Update durable architecture notes**

Document in `AGENTS.md`:

- instance/registration composite CAS ownership;
- promotion reserved escrow requirement;
- refund-pending and payout-pending terminal rules;
- prepare-before-running activation;
- owner-scoped late holds and DB next-hand gate;
- pre-listen recovery order;
- `practice` allowed only as the one-release ingress adapter, never public output.

- [ ] **Step 5: Run complete verification**

Run fresh:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
git status --short
```

Expected:

- all Vitest files pass with zero failures;
- TypeScript exits 0;
- ESLint exits 0;
- Next production build exits 0;
- `git diff --check` prints nothing;
- only intended feature files are modified.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md README.md src/server/index.ts src/server/server-shutdown.ts src/server/server-shutdown.test.ts
git commit -m "feat: complete persistent scheduled mtt rollout"
```

## Plan self-review

- Spec coverage: persistence, recurrence, admin session, promotion fund, field policy, start saga, late registration, owner-scoped holds, freeze/settlement, recovery, socket/session projection and UI are each assigned to a task.
- Placeholder scan: this plan contains no deferred product behavior; every task has a concrete test, command, implementation surface and commit.
- Type consistency: public MTT economy is always `freeroll|wallet`; `practice` appears only in Task 1’s ingress compatibility test. Lifecycle and registration state are separate types. `TournamentSeatAssigned` is reserved for first lobby seating; `table-move` remains for already seated players.
- Safety: money movement is always inside a SQLite transaction with the lifecycle transition. Ops logs are observational only. Payout-pending never becomes refund-pending. Runtime cleanup never precedes terminal economic state.
