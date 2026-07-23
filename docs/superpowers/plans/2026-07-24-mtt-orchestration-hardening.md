# MTT Orchestration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MTT hand barriers, final-table formation, simultaneous eliminations, director authority, level changes, seat moves, and registration lifecycle deterministic and safe.

**Architecture:** `TournamentManager` remains the sole MTT orchestrator. It exposes a public stage/deadline mirror to each table while internally tracking composable hold reasons and pending levels. Final formation is a barrier transition, not a chat side effect.

**Tech Stack:** TypeScript, Socket.io, Vitest, in-memory `TournamentManager`, SQLite economy repository

---

### Task 1: Introduce public stage and composable holds

**Files:**
- Modify: `src/lib/poker/types.ts`
- Modify: `src/lib/realtime/protocol.ts`
- Modify: `src/server/tournament-manager.ts`
- Test: `src/server/tournament-manager.break.test.ts`

- [ ] **Step 1: Add a failing overlapping-holds test**

Pause a tournament while a table is held for H4H, release H4H, and assert the room is not resumed until pause is
released. Repeat with `scheduled-break` and `final-intro`.

- [ ] **Step 2: Run the test**

```bash
npm test -- src/server/tournament-manager.break.test.ts
```

Expected: FAIL because `held` stores one reason and releasing it resumes the room.

- [ ] **Step 3: Add shared types**

```ts
export type TournamentStage =
  | 'multi-table'
  | 'final-forming'
  | 'final-intro'
  | 'final-playing'
  | 'complete';

export type TournamentHoldReason =
  | 'director-pause'
  | 'scheduled-break'
  | 'h4h-barrier'
  | 'final-forming'
  | 'final-intro';
```

Extend `TournamentState`, `TournamentSummary`, and `TournamentDetailView` with optional `stage`, `holdReasons`,
`stageEndsAt`, and `finalTheme`.

- [ ] **Step 4: Replace single holds with sets**

Use:

```ts
holds: Map<string, Set<TournamentHoldReason>>;
```

Add `addHold`, `removeHold`, `hasHolds`, and `resumeIfUnheld`. `removeHold` must never resume directly when another
reason remains.

- [ ] **Step 5: Mirror state to every table**

Create `syncTournamentPresentation(t)` that writes the stage, sorted hold reasons, deadline, theme, remaining field,
and clock values into every live table engine before broadcasts.

- [ ] **Step 6: Run tests**

```bash
npm test -- src/server/tournament-manager.break.test.ts src/server/tournament-manager.director.test.ts
```

Expected: PASS.

### Task 2: Form the final table before another hand starts

**Files:**
- Modify: `src/server/tournament-manager.ts`
- Modify: `src/server/room-manager.ts`
- Test: `src/server/tournament-manager.test.ts`
- Test: `src/server/tournament-manager.break.test.ts`

- [ ] **Step 1: Add the 1-versus-4 failing scenario**

Create two tables at the bubble with one and four survivors, complete the triggering hand, and assert:

```ts
expect(detail.tables).toHaveLength(1);
expect(finalEngine.state.handNumber).toBe(firstFinalHandNumber);
expect(finalEngine.state.tournament?.stage).toBe('final-intro');
expect(resumeRoom).not.toHaveStartedAHand();
```

- [ ] **Step 2: Add a single-table-at-start test**

Start an eight-player or smaller configured MTT that seats to one table and assert its first hand waits behind the
same final intro once.

- [ ] **Step 3: Run the tests**

```bash
npm test -- src/server/tournament-manager.test.ts src/server/tournament-manager.break.test.ts
```

Expected: FAIL because H4H currently runs before final formation and destination rooms resume per moved seat.

- [ ] **Step 4: Implement the final state transition**

Add `beginFinalFormation(t)`, `finishFinalFormation(t)`, and `finishFinalIntro(t)`.

```ts
private beginFinalFormation(t: TournamentRuntime): boolean {
  if (t.remaining > t.config.tableSize || t.stage !== 'multi-table') return false;
  t.stage = 'final-forming';
  for (const roomId of t.tables.keys()) this.addHold(t, roomId, 'final-forming');
  return true;
}
```

Wait for every source room to become idle, move all survivors without calling `resumeRoom` per move, dispose emptied
tables, then set `stage='final-intro'`, `stageEndsAt=clock()+4500`, replace the hold with `final-intro`, and arm one
timer. On expiry set `final-playing`, clear only `final-intro`, and resume the final room if unheld.

- [ ] **Step 5: Reorder hand completion**

Make final formation/completion checks occur before arming a new H4H round or resuming balanced tables. Preserve the
current rule that in-progress hands finish before a barrier owns the next hand.

- [ ] **Step 6: Commit H4H permits only after successful hand start**

Change the RoomManager/TournamentManager hook contract so `applyLevel` does not consume the permit. Add an
`onHandStarted(roomId, handNumber)` hook that consumes the armed room only after `startHand()` increments the hand.

- [ ] **Step 7: Run focused tests**

```bash
npm test -- src/server/tournament-manager.test.ts src/server/tournament-manager.break.test.ts src/server/tournament-manager.sim.test.ts
```

Expected: PASS with chip preservation and tournament completion.

### Task 3: Make simultaneous elimination deterministic

**Files:**
- Modify: `src/server/tournament-manager.ts`
- Modify: `src/server/economy-repository.ts`
- Test: `src/server/tournament-manager.test.ts`
- Test: `src/server/tournament-manager.wallet.test.ts`
- Test: `src/server/economy-mtt.test.ts`

- [ ] **Step 1: Add callback-order-independent tests**

Feed the same cross-table H4H bust group in reversed callback order. Assert both outputs have the same places and
prizes. Add a same-table equal-stack case and assert button-left seat order breaks the tie.

- [ ] **Step 2: Add a shared-prize repository test**

For two players tied across places 5 and 6, assert both may store `place: 5`, their prizes sum to prize 5 plus prize
6, and the full payout still equals the prize pool.

- [ ] **Step 3: Run tests and witness failure**

```bash
npm test -- src/server/tournament-manager.test.ts src/server/tournament-manager.wallet.test.ts src/server/economy-mtt.test.ts
```

Expected: FAIL because stable input order decides equal stacks and the repository requires unique places.

- [ ] **Step 4: Group busts**

Sort by `handStartChips` descending. For equal stacks, partition by `roomId`: same-table groups use button-left seat
distance; different-table members in the same H4H round form a tie group. Assign the same first occupied place to a
tie group and skip the following positions by group size.

- [ ] **Step 5: Split the occupied prize range**

```ts
const pool = occupiedPlaces.reduce((sum, place) => sum + (prizes[place - 1] ?? 0), 0);
const base = Math.floor(pool / group.length);
const remainder = pool - base * group.length;
```

Give `base` to each member and distribute the integer remainder by `playerId.localeCompare`.

- [ ] **Step 6: Relax only the place-uniqueness assertion**

Keep complete entrant enumeration, valid place range, non-negative integer prizes, idempotency, and total payout
checks. Permit repeated places only when their occupied prize-range sum matches the submitted group prizes.

- [ ] **Step 7: Run tests**

```bash
npm test -- src/server/economy-mtt.test.ts src/server/tournament-manager.wallet.test.ts src/server/tournament-manager.test.ts
```

Expected: PASS.

### Task 4: Harden director levels, wallet authority, and moves

**Files:**
- Modify: `src/server/tournament-manager.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/lib/store/game-store.ts`
- Test: `src/server/tournament-manager.director.test.ts`
- Test: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

```ts
expect(walletRunningRemove).toEqual({ ok: false });
expect(walletRunningSetLevel).toEqual({ ok: false });
expect(walletRunningCancel).toEqual({ ok: false });
```

Pause during a live hand, set a level, and assert the current engine blinds/minRaise do not change until the next
hand. Move a sitting-out lobby participant and assert no `table-move` event is emitted.

- [ ] **Step 2: Run tests**

```bash
npm test -- src/server/tournament-manager.director.test.ts src/server/socket-handler.integration.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Restrict wallet mutations**

In the manager's director entry point, reject `remove-player`, `set-level`, and `cancel` when
`economyMode === 'wallet' && phase === 'running'`. Keep practice behavior unchanged.

- [ ] **Step 4: Queue levels**

Store `pendingLevelIndex` on the runtime. `directorSetLevel` updates clock position and pending level only. Apply the
level in the existing hand-boundary hook immediately before the next successful `startHand()`.

- [ ] **Step 5: Guard table moves twice**

Server:

```ts
if (session.roomId === move.fromRoomId) {
  socket.leave(move.fromRoomId);
  socket.join(move.toRoomId);
  socket.emit('table-move', move);
}
```

Client:

```ts
if (get().currentRoomId !== move.fromRoomId) return;
```

Always update the server-side preserved seat destination so an explicit lobby return joins the new table.

- [ ] **Step 6: Run tests**

```bash
npm test -- src/server/tournament-manager.director.test.ts src/server/socket-handler.integration.test.ts
```

Expected: PASS.

### Task 5: Expire empty tournaments and cap ownership

**Files:**
- Modify: `src/server/tournament-manager.ts`
- Test: `src/server/tournament-manager.test.ts`
- Create: `src/server/tournament-manager.lifecycle.test.ts`

- [ ] **Step 1: Add fake-timer tests**

Assert an entrant-free registering tournament cancels after the configured TTL, registration cancels the timer,
unregistration of the last entrant rearms it, and one host cannot exceed the ownership cap.

- [ ] **Step 2: Implement lifecycle timers**

Track `emptyDeadline`, `emptyTimer`, and `hostId`. Reuse the idempotent cancel/dispose/refund path on expiry. Clear
the timer on registration, start, cancellation, completion, and manager disposal.

- [ ] **Step 3: Run tests**

```bash
npm test -- src/server/tournament-manager.test.ts src/server/tournament-manager.lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/poker/types.ts src/lib/realtime/protocol.ts src/server/tournament-manager.ts src/server/room-manager.ts src/server/socket-handler.ts src/server/economy-repository.ts src/lib/store/game-store.ts src/server/*.test.ts
git commit -m "fix(mtt): harden barriers rankings and director authority"
```
