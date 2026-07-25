# Tournament Recurrence and Field Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound recurring tournament generation and lobby exposure to five occurrences per template, require an explicit recurrence end, support 2–48 entrant field policies, and add versioned small-field payouts without changing existing tournament settlements.

**Architecture:** Persist an inclusive first/last occurrence boundary on recurring templates and let the scheduler maintain a rolling five-instance window. Keep public-list limiting as a second defensive layer with a personalized registration exception. Preserve integer field limits in storage, add UI aliases for “unlimited,” and route all new tournaments through payout table v3 while retaining v2 calculators.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Node 22 `node:sqlite`, Vitest, custom HTTP/Socket.io server

---

## File map

- `src/lib/tournament/tournament-config.ts`: shared recurrence boundary and payout-version types.
- `src/server/persistence/migrations.ts`: v29 nullable template-boundary columns and legacy-template disable migration.
- `src/server/persistence/database.test.ts`: migration and legacy data regression.
- `src/server/tournament-instance-repository.ts`: template persistence, validation, decoding, and public projection limiting.
- `src/server/tournament-instance-repository.test.ts`: template-boundary and personalized five-item projection tests.
- `src/server/tournament-command-parser.ts`: ingress validation for recurrence boundaries and payout v3.
- `src/server/tournament-command-parser.test.ts`: recurrence and field-policy parser tests.
- `src/server/tournament-command-service.ts`: template create/patch plumbing.
- `src/server/tournament-command-service.test.ts`: template boundary propagation and revision behavior.
- `src/server/tournament-scheduler.ts`: rolling five-occurrence reconciliation.
- `src/server/tournament-scheduler.test.ts`: hourly/daily/weekly boundaries, refill, and tombstone tests.
- `src/lib/poker/payout-table.ts`: versioned v2/v3 payout calculators.
- `src/lib/poker/payout-table.test.ts`: v2 compatibility and v3 small-field ladder tests.
- `src/server/tournament-manager.ts`: pass payout table version through runtime calculations.
- `src/server/tournament-manager.test.ts`: 2–6 entrant single-final-table and seven-entrant split regressions.
- `src/components/tournament/tournament-create-policy.ts`: pure form normalization and recurrence-preview helpers.
- `src/components/tournament/tournament-create-policy.test.ts`: UI policy helper tests.
- `src/components/tournament/TournamentCreateForm.tsx`: recurrence end, lead help, min/max modes, and v3 drafts.
- `src/app/admin/page.tsx`: template boundary summary and clearer recurrence labels.

### Task 1: Persist explicit recurrence boundaries

**Files:**
- Modify: `src/lib/tournament/tournament-config.ts`
- Modify: `src/server/persistence/migrations.ts`
- Modify: `src/server/persistence/database.test.ts`
- Modify: `src/server/tournament-instance-repository.ts`
- Modify: `src/server/tournament-instance-repository.test.ts`

- [ ] **Step 1: Write failing migration and repository tests**

Add a database migration test that creates a v28 database with an enabled legacy
template, applies migrations, and asserts:

```ts
const template = database.db.prepare(`
  SELECT enabled, first_starts_at, recurrence_ends_at
  FROM tournament_template WHERE id = 'legacy-template'
`).get() as {
  enabled: number;
  first_starts_at: number | null;
  recurrence_ends_at: number | null;
};
expect(template.enabled).toBe(0);
expect(template.recurrence_ends_at).toBeNull();
```

Extend repository template fixtures and assert round-trip persistence:

```ts
const created = repository.createTemplate({
  ...templateCommand(),
  firstStartsAt: NOW + HOUR,
  recurrenceEndsAt: NOW + 7 * DAY,
});
expect(created).toMatchObject({
  firstStartsAt: NOW + HOUR,
  recurrenceEndsAt: NOW + 7 * DAY,
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test -- src/server/persistence/database.test.ts src/server/tournament-instance-repository.test.ts
```

Expected: failures for missing v29 columns and missing template boundary properties.

- [ ] **Step 3: Add shared types and migration v29**

Extend `CreateTournamentCommand`:

```ts
readonly firstStartsAt: number | null;
readonly recurrenceEndsAt: number | null;
```

Extend template command/record/patch types with non-null numeric fields for new
recurring templates. Add migration v29:

```sql
ALTER TABLE tournament_template ADD COLUMN first_starts_at INTEGER;
ALTER TABLE tournament_template ADD COLUMN recurrence_ends_at INTEGER;

UPDATE tournament_template
SET
  first_starts_at = (
    SELECT MIN(starts_at)
    FROM tournament_instance
    WHERE template_id = tournament_template.id
      AND starts_at IS NOT NULL
  ),
  enabled = 0;
```

Persist, patch, decode, and validate the two fields. Permit null only when decoding
a disabled legacy row; reject enabling a template until both are valid and ordered.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- src/server/persistence/database.test.ts src/server/tournament-instance-repository.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/tournament/tournament-config.ts src/server/persistence/migrations.ts src/server/persistence/database.test.ts src/server/tournament-instance-repository.ts src/server/tournament-instance-repository.test.ts
git commit -m "feat: persist tournament recurrence boundaries"
```

### Task 2: Validate and propagate recurrence boundaries

**Files:**
- Modify: `src/server/tournament-command-parser.ts`
- Modify: `src/server/tournament-command-parser.test.ts`
- Modify: `src/server/tournament-command-service.ts`
- Modify: `src/server/tournament-command-service.test.ts`

- [ ] **Step 1: Write failing parser and service tests**

Add parser cases:

```ts
expect(() => parseCreateTournamentCommand(freeroll({
  recurrence: { kind: 'hourly', minute: 0 },
  firstStartsAt: NOW + HOUR,
  recurrenceEndsAt: null,
}), NOW)).toThrow('recurrence-boundary');

const parsed = parseCreateTournamentCommand(freeroll({
  recurrence: { kind: 'hourly', minute: 0 },
  firstStartsAt: NOW + HOUR,
  recurrenceEndsAt: NOW + 5 * HOUR,
}), NOW);
expect(parsed.firstStartsAt).toBe(NOW + HOUR);
expect(parsed.recurrenceEndsAt).toBe(NOW + 5 * HOUR);
```

Assert that standalone commands return both fields as null and that an end before
the first start is rejected. Extend service tests to verify create and patch pass
the exact boundaries into repository records.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm test -- src/server/tournament-command-parser.test.ts src/server/tournament-command-service.test.ts
```

Expected: missing boundary output and validation failures.

- [ ] **Step 3: Implement parser and service plumbing**

For recurring input require safe epoch values and enforce:

```ts
if (
  firstStartsAt !== schedule.startsAt
  || recurrenceEndsAt < firstStartsAt
) fail('recurrence-boundary');
```

For standalone input reject non-null boundary fields. Add the fields to template
create, patch-parser reconstruction, no-op comparison, and admin projection.

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
npm test -- src/server/tournament-command-parser.test.ts src/server/tournament-command-service.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/server/tournament-command-parser.ts src/server/tournament-command-parser.test.ts src/server/tournament-command-service.ts src/server/tournament-command-service.test.ts
git commit -m "feat: validate tournament recurrence end dates"
```

### Task 3: Maintain a rolling five-occurrence scheduler window

**Files:**
- Modify: `src/server/tournament-scheduler.ts`
- Modify: `src/server/tournament-scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Replace horizon-oriented expectations with explicit bounded cases:

```ts
expect(kstOccurrenceStarts(
  { kind: 'hourly', minute: 0 },
  NOW,
  FIRST_START,
  FIRST_START + 10 * HOUR,
  5,
)).toHaveLength(5);
```

Cover:

- first occurrence never precedes `firstStartsAt`;
- an occurrence exactly at `recurrenceEndsAt` is included;
- no occurrence after the end is returned;
- hourly, daily, and weekly templates return at most five;
- after one instance becomes completed, reconciliation adds exactly one successor;
- an operator-cancelled occurrence is not recreated;
- no refill occurs after the inclusive end boundary.

- [ ] **Step 2: Run scheduler tests and verify RED**

```powershell
npm test -- src/server/tournament-scheduler.test.ts
```

Expected: old horizon code returns more than five hourly occurrences and ignores
explicit start/end boundaries.

- [ ] **Step 3: Implement bounded occurrence calculation**

Replace the horizon calculation with:

```ts
export function kstOccurrenceStarts(
  recurrence: TournamentRecurrence,
  now: number,
  firstStartsAt: number,
  recurrenceEndsAt: number,
  limit = 5,
): number[] {
  const lowerBound = Math.max(now, firstStartsAt);
  const starts: number[] = [];
  let cursor = nextKstOccurrence(recurrence, lowerBound);
  while (cursor <= recurrenceEndsAt && starts.length < limit) {
    starts.push(cursor);
    cursor = nextKstOccurrence(recurrence, cursor + 1);
  }
  return starts;
}
```

During reconciliation, count existing non-terminal instances for the current
template revision and only create enough unoccupied occurrences to reach five.
Scan past completed, superseded, and operator-cancelled occurrence keys without
recreating their tombstones. Remove `MIN_HORIZON_MS` and `VISIBILITY_MARGIN_MS`.

- [ ] **Step 4: Run scheduler tests and verify GREEN**

```powershell
npm test -- src/server/tournament-scheduler.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/server/tournament-scheduler.ts src/server/tournament-scheduler.test.ts
git commit -m "fix: bound recurring tournament materialization"
```

### Task 4: Cap public exposure with a personalized exception

**Files:**
- Modify: `src/server/tournament-instance-repository.ts`
- Modify: `src/server/tournament-instance-repository.test.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: Write failing projection tests**

Create six public instances for one template and two standalone instances. Assert:

```ts
const anonymous = repository.listPublicProjections(undefined, NOW);
expect(anonymous.filter(row => row.templateId === templateId)).toHaveLength(5);
expect(anonymous.filter(row => row.templateId === null)).toHaveLength(2);
```

Register a player in the sixth template occurrence and assert their personalized
list contains all five normal rows plus their registered sixth row. Add a socket
integration assertion that `tournament-list` preserves this personalized entry.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm test -- src/server/tournament-instance-repository.test.ts src/server/socket-handler.integration.test.ts
```

Expected: anonymous list includes six same-template rows.

- [ ] **Step 3: Implement projection grouping**

Select public candidates in start order, project them, then retain:

```ts
const perTemplate = new Map<string, number>();
const visible = summaries.filter(summary => {
  if (!summary.templateId) return true;
  const count = perTemplate.get(summary.templateId) ?? 0;
  if (count < 5) {
    perTemplate.set(summary.templateId, count + 1);
    return true;
  }
  return isEngagedByViewer(summary);
});
```

Expose `templateId` in the internal projection used for grouping without leaking
template internals beyond the public summary contract unless already intended.
Treat registered, seat-claimed, late-pending, seated, eliminated, and finished
viewer states as engaged.

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
npm test -- src/server/tournament-instance-repository.test.ts src/server/socket-handler.integration.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/server/tournament-instance-repository.ts src/server/tournament-instance-repository.test.ts src/server/socket-handler.integration.test.ts
git commit -m "feat: cap recurring tournament lobby exposure"
```

### Task 5: Add payout table v3 without changing v2

**Files:**
- Modify: `src/lib/tournament/tournament-config.ts`
- Modify: `src/lib/poker/payout-table.ts`
- Modify: `src/lib/poker/payout-table.test.ts`
- Modify: `src/server/tournament-instance-repository.ts`
- Modify: `src/server/tournament-manager.ts`
- Modify: `src/server/tournament-manager.test.ts`

- [ ] **Step 1: Write failing payout-version tests**

Preserve current v2 assertions and add:

```ts
expect(payoutPercents(3, 'standard', 3)).toEqual([70, 30]);
expect(payoutPercents(3, 'flat', 3)).toEqual([60, 40]);
expect(payoutPercents(3, 'top-heavy', 3)).toEqual([100]);
expect(payoutPercents(5, 'standard', 3)).toEqual([65, 35]);
expect(payoutPercents(5, 'flat', 3)).toEqual([60, 40]);
expect(payoutPercents(5, 'top-heavy', 3)).toEqual([75, 25]);
expect(payoutPercents(4, 'standard', 2)).toEqual([100]);
```

Add a manager regression proving a two-to-six-player persistent start creates one
room and enters `final-intro`/`final-playing`, while seven entrants create two rooms.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm test -- src/lib/poker/payout-table.test.ts src/server/tournament-manager.test.ts
```

Expected: payout helpers do not accept a version and v3 expectations fail.

- [ ] **Step 3: Implement versioned tables and runtime propagation**

Add table version 3 to `TournamentPayoutPolicy`. Keep the existing bands under v2
unchanged and add v3 bands whose 6+ values delegate to v2:

```ts
const V3_SMALL_FIELD = {
  standard: [
    { maxEntrants: 2, percents: [100] },
    { maxEntrants: 3, percents: [70, 30] },
    { maxEntrants: 5, percents: [65, 35] },
  ],
  flat: [
    { maxEntrants: 2, percents: [100] },
    { maxEntrants: 3, percents: [60, 40] },
    { maxEntrants: 5, percents: [60, 40] },
  ],
  'top-heavy': [
    { maxEntrants: 3, percents: [100] },
    { maxEntrants: 5, percents: [75, 25] },
  ],
} as const;
```

Change payout APIs to accept `tableVersion: 2 | 3 = 2`, validate unknown versions,
and pass `snapshot.config.payout.tableVersion` through repository freezes and
manager runtime payout calculations. New form drafts use v3.

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
npm test -- src/lib/poker/payout-table.test.ts src/server/tournament-manager.test.ts src/server/tournament-instance-repository.test.ts
```

Expected: all tests pass and v2 output is unchanged.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/tournament/tournament-config.ts src/lib/poker/payout-table.ts src/lib/poker/payout-table.test.ts src/server/tournament-instance-repository.ts src/server/tournament-manager.ts src/server/tournament-manager.test.ts
git commit -m "feat: add small-field tournament payout table v3"
```

### Task 6: Improve backoffice recurrence and field controls

**Files:**
- Create: `src/components/tournament/tournament-create-policy.ts`
- Create: `src/components/tournament/tournament-create-policy.test.ts`
- Modify: `src/components/tournament/TournamentCreateForm.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Write failing pure policy tests**

Define the wished-for API:

```ts
expect(normalizeFieldPolicy({
  minimumMode: 'unlimited',
  minimumValue: 6,
  maximumMode: 'unlimited',
  maximumValue: 24,
})).toEqual({ minEntrants: 2, maxEntrants: 48 });

expect(recurrenceSummary({
  recurrence: { kind: 'hourly', minute: 0 },
  firstStartsAt: FIRST,
  recurrenceEndsAt: FIRST + 4 * HOUR,
})).toMatchObject({ totalOccurrences: 5, lastStartsAt: FIRST + 4 * HOUR });
```

Also test invalid field order and lead example formatting.

- [ ] **Step 2: Run policy tests and verify RED**

```powershell
npm test -- src/components/tournament/tournament-create-policy.test.ts
```

Expected: module does not exist.

- [ ] **Step 3: Implement helpers and form UI**

Create pure helpers for:

- `normalizeFieldPolicy`;
- recurrence preview/count using KST-stable hourly/daily/weekly arithmetic;
- lead-time example strings.

In `TournamentCreateForm`:

- default minimum to custom 6;
- default maximum to unlimited 48;
- offer `제한 없음` and `직접 설정` controls for both bounds;
- label maximum unlimited as `제한 없음(현재 서비스 상한 48명)`;
- add required `datetime-local` recurrence end when recurrence is selected;
- submit `firstStartsAt`, `recurrenceEndsAt`, and payout table v3;
- show first five occurrences, total count, and last occurrence;
- add keyboard/touch-accessible help buttons for both lead terms;
- show the concrete `20:00 / 60분 / 20분` example and computed KST times;
- explain freeroll bot-fill versus wallet human-only minimum semantics.

In the admin template panel, show localized recurrence labels plus first/end dates
and replace abbreviated lead labels with the full Korean terms.

- [ ] **Step 4: Run focused tests, typecheck, and lint changed UI**

```powershell
npm test -- src/components/tournament/tournament-create-policy.test.ts src/server/tournament-command-parser.test.ts
npx tsc --noEmit
npm run lint -- src/components/tournament/TournamentCreateForm.tsx src/components/tournament/tournament-create-policy.ts src/app/admin/page.tsx
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/tournament/tournament-create-policy.ts src/components/tournament/tournament-create-policy.test.ts src/components/tournament/TournamentCreateForm.tsx src/app/admin/page.tsx
git commit -m "feat: clarify tournament recurrence and field controls"
```

### Task 7: Verify the full flow and clean up current operations data

**Files:**
- Modify only if a regression is found: relevant test/implementation files above
- Operational data: production `tournament_template`, `tournament_instance`, registration, escrow, and ops-event rows through existing admin command paths

- [ ] **Step 1: Run the full verification suite**

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: every command exits 0 with no new warnings attributable to this change.

- [ ] **Step 2: Inspect production targets read-only**

Using the authenticated operations backoffice, record counts and IDs for:

- enabled recurring templates created in the incident;
- their `scheduled-hidden`, `scheduled-visible`, `registering`, and
  `start-delayed` instances;
- any wallet registrations or freeroll prize escrows requiring return;
- any running/completed instance, which must be excluded.

Do not print or persist admin credentials.

- [ ] **Step 3: Disable templates before cancelling instances**

For every target template, invoke the existing revision-checked `disable` action.
Re-read the template list and verify `enabled=false` before continuing.

- [ ] **Step 4: Cancel each eligible instance through the command service**

Invoke the existing tournament `cancel` action for each eligible instance. Do not
issue raw `DELETE` statements. Wait for any `refund-pending` instance to complete
its wallet void or freeroll escrow return before treating cleanup as complete.

- [ ] **Step 5: Verify cleanup and audit retention**

Re-read admin and public lists and verify:

- zero enabled incident templates;
- zero public incident instances;
- no incident instance left in a pre-start non-terminal state;
- cancelled template/instance records remain in admin history;
- cancellation and refund operations appear in ops/audit data;
- running and completed tournaments are unchanged.

- [ ] **Step 6: Commit any final test-only correction**

If verification required a code correction, repeat the RED/GREEN cycle and commit
only those files. Otherwise do not create an empty commit.
