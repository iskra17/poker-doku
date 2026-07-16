# Progression Reward Lifecycle Final Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final deletion, migration, and streak-fragment source-proof gaps without breaking normal profile deletion, service save ordering, or duplicate replay.

**Architecture:** Keep the committed V9 migration behavior compatible while adding the pre-rebuild checks that an unshipped V8 upgrade needs, then add a V10 validation-and-trigger layer for databases already at V9. Share reward-summary semantic validation between the repository and service, while SQLite independently enforces the minimum canonical claim needed for a durable fragment receipt.

**Tech Stack:** TypeScript, Node.js 22.17, node:sqlite, Vitest, SQLite JSON1, Next.js 16.

---

### Task 1: Protect progression-root deletion

**Files:**
- Modify: `src/server/persistence/database.test.ts`
- Modify: `src/server/persistence/migrations.ts`

- [x] **Step 1: Write the failing deletion-boundary test**

Create a profile with progression children, assert direct `DELETE FROM progression_profiles` throws and preserves the root, then call `ProfileRepository.deleteProfile()` and assert every profile/progression child is gone.

- [x] **Step 2: Run the test and verify RED**

Run: `npx -p node@22.17.0 node node_modules/vitest/vitest.mjs run src/server/persistence/database.test.ts -t "rejects direct progression root deletion"`

Expected: direct deletion succeeds instead of throwing.

- [x] **Step 3: Add the V10 deletion guard**

Add a `BEFORE DELETE ON progression_profiles` trigger guarded by `EXISTS (SELECT 1 FROM profiles WHERE id = OLD.profile_id)`. This rejects direct deletion while allowing the base-profile cascade after SQLite has removed the owning row.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2 and expect PASS.

### Task 2: Validate legacy receipt/inventory correspondence atomically

**Files:**
- Modify: `src/server/persistence/database.test.ts`
- Modify: `src/server/persistence/migrations.ts`

- [x] **Step 1: Write failing V8 upgrade tests**

Create valid V8 databases, remove or corrupt the fragment inventory row (quantity, granted time, updated time), open them with the latest schema, and assert the upgrade throws with `MAX(schema_migrations.version) = 8` and the V8 grant shape intact.

- [x] **Step 2: Run the tests and verify RED**

Run: `npx -p node@22.17.0 node node_modules/vitest/vitest.mjs run src/server/persistence/database.test.ts -t "V8 fragment inventory"`

Expected: at least one corrupt V8 database reaches V9.

- [x] **Step 3: Add exact inventory validation**

Before the V9 grant rebuild, validate each grant group has exactly one inventory row with `quantity = COUNT(*)`, `granted_at = MIN(grant.granted_at)`, and `updated_at = MAX(grant.granted_at)`, and reject fragment inventory rows without a matching grant group. Repeat the invariant in V10 validation for existing V9 databases.

- [x] **Step 4: Run the tests and verify GREEN**

Run the command from Step 2 and expect every corruption to roll back atomically.

### Task 3: Prove every fragment grant from its source summary

**Files:**
- Create: `src/lib/progression/reward-summary.ts`
- Modify: `src/server/progression-service.ts`
- Modify: `src/server/progression-repository.ts`
- Modify: `src/server/progression-repository.test.ts`
- Modify: `src/server/progression-service.test.ts`
- Modify: `src/server/persistence/database.test.ts`
- Modify: `src/server/persistence/migrations.ts`

- [x] **Step 1: Write failing source-proof tests**

Cover `{}` and malformed source summaries in raw current inserts and V8 upgrades. Assert receipt and inventory writes roll back, while a canonical seven-day service event still commits and replays idempotently.

- [x] **Step 2: Run the tests and verify RED**

Run: `npx -p node@22.17.0 node node_modules/vitest/vitest.mjs run src/server/persistence/database.test.ts src/server/progression-repository.test.ts src/server/progression-service.test.ts -t "fragment source summary|seven-day"`

Expected: `{}` can currently back a grant at the database/repository boundary.

- [x] **Step 3: Share fail-closed TypeScript validation**

Move the existing exact reward-summary checks into `reward-summary.ts`. Have the service translate validation failure to `PROGRESSION_STORED_SUMMARY_INVALID`; have the repository reject an existing noncanonical source event before inserting a grant. Require the streak result to be a balance-defined fragment interval and the item list to equal `['streak-fragment']` for a fragment receipt.

- [x] **Step 4: Add SQLite source-claim enforcement**

Validate legacy source summaries before the V9 rebuild. In V10, create a canonical source-claim view and use it from grant-insert and source-event-insert triggers, retaining source update/delete protection. The claim requires exact top-level keys, matching event id, typed reward fields, a canonical streak object whose current value is divisible by seven, and exactly one known fragment id.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2 and expect PASS, including grant-before-event ordering inside the service transaction and duplicate replay.

### Task 4: Full verification and commit

**Files:**
- Verify all modified files.

- [x] **Step 1: Run focused and full Node 22.17 tests**

Run the progression-focused suite, then `npx -p node@22.17.0 node node_modules/vitest/vitest.mjs run`.

- [x] **Step 2: Run static and build checks**

Run `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check`.

- [x] **Step 3: Perform bounded self-review**

Review only the touched migration, deletion trigger, summary validator, and their tests for false positives in base-profile cascade, service ordering, and duplicate replay.

- [x] **Step 4: Commit**

Commit with: `fix: prove progression fragment reward sources`.
