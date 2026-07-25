# MTT Rollout Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the ordered MTT scheduler, late-registration, and wallet late-registration rollout flags without allowing disabled v2 lifecycle mutations.

**Architecture:** Add a small rollout initializer that chooses exactly one recovery path and constructs v2 resources only when the scheduler flag is enabled. Keep the persistent pre-start registration adapter available in scheduler-only mode while injecting its live late-registration portion into `TournamentManager` only when the late-registration flag is enabled.

**Tech Stack:** TypeScript, Node.js, SQLite, Vitest.

---

### Task 1: Rollout initialization boundary

**Files:**
- Create: `src/server/mtt-rollout.ts`
- Create: `src/server/mtt-rollout.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing default-off integration test**

Create a real in-memory tournament template, invoke the wished-for rollout initializer with all flags false, and assert the scheduler factory and v2 recovery are never called, legacy recovery is called once, and no occurrence is materialized.

- [ ] **Step 2: Verify RED**

Run `npx vitest run src/server/mtt-rollout.test.ts`; expect failure because `initializeMttRollout` does not exist.

- [ ] **Step 3: Implement gated initialization**

Implement `initializeMttRollout(flags, factories)` so the false branch calls only `recoverLegacy`, while the true branch constructs registration ports and scheduler, then runs v2 recovery.

- [ ] **Step 4: Wire server startup**

Use the initializer in `src/server/index.ts`; configure persistent admin only when a scheduler exists and remove the unconditional scheduler assertion.

### Task 2: Registration flag matrix

**Files:**
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.persistent-late-registration.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing matrix tests**

Cover scheduler-only pre-start registration, disabled live freeroll registration, enabled freeroll late registration, disabled wallet late registration, and enabled wallet late registration.

- [ ] **Step 2: Verify RED**

Run the socket adapter and rollout tests; expect scheduler-only pre-start registration or disabled live registration assertions to fail.

- [ ] **Step 3: Split port injection**

Add a persistent pre-start socket registration option, keep `persistentLateRegistration` reserved for `TournamentManager` live gates, and make the adapter check `lateRegistrationEnabled` before every running reservation.

- [ ] **Step 4: Verify GREEN**

Run the focused flag-matrix tests and existing scheduler/command/recovery regressions.

### Task 3: Final verification and commit

**Files:**
- Test: all files above plus existing Task 13 server regressions

- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check -- src/server`.
- [ ] Stage only rollout-flag server files and commit with `fix: enforce ordered mtt rollout flags`.
