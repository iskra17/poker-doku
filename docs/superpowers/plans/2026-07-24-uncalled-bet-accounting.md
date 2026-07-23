# Uncalled Bet Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return unmatched bets before settlement in every game mode and keep pots, rake, public actions, hand history, and odd-chip awards correct.

**Architecture:** `PokerEngine` owns one settlement-boundary helper that normalizes the closed betting round before rebuilding pots or starting a runout. The helper adjusts the unique high bettor's stack and contribution ledger, records an internal history event, and leaves only contested pots for payout and rake.

**Tech Stack:** TypeScript, Vitest, server-authoritative `PokerEngine`

---

### Task 1: Lock the unmatched-bet contract

**Files:**
- Modify: `src/lib/poker/engine.sidepots.test.ts`
- Modify: `src/lib/poker/engine.handrecord.test.ts`

- [ ] **Step 1: Replace the incorrect solo-side-pot rake expectation**

Change the `[100, 200, 300]` wallet assertion so the last unmatched 100 chips return to `p3` before runout:

```ts
expect(engine.state.pots.map(pot => pot.amount)).toEqual([300, 200]);
expect(engine.state.players.find(p => p.id === 'p3')!.chips).toBe(100);
expect(engine.state.handRake).toBe(25);
expect(engine.state.winners?.map(({ playerId, amount, potIndex }) => ({
  playerId, amount, potIndex,
}))).toEqual([
  { playerId: 'p1', amount: 285, potIndex: 0 },
  { playerId: 'p2', amount: 190, potIndex: 1 },
]);
```

- [ ] **Step 2: Add a two-player short all-in regression**

```ts
it('returns unmatched preflop excess before all-in runout', () => {
  const { engine } = setupTable([1000, 150], undefined, { gameMode: 'mtt' });
  engine.startHand();
  act(engine, 'all-in');
  act(engine, 'call');

  expect(engine.state.allInRunout).toBe(true);
  expect(engine.state.players.find(p => p.id === 'p1')!.chips).toBe(850);
  expect(engine.state.players.find(p => p.id === 'p1')!.totalContributed).toBe(150);
  expect(engine.state.pots).toEqual([{
    amount: 300,
    eligiblePlayerIds: expect.arrayContaining(['p1', 'p2']),
  }]);
});
```

- [ ] **Step 3: Add a postflop fold/undercall regression**

Use three players, a matched preflop pot, a 200 flop bet, a 130-chip all-in call, and a fold. Assert that
70 returns to the bettor and the existing preflop contribution remains in the contested pot.

- [ ] **Step 4: Add hand-history assertions**

Extend `HandHistoryActionKind` expectation with:

```ts
{ street: 'preflop', playerId: 'p1', kind: 'uncalled-return', amount: 850 }
```

Assert `potTotal`, `totalContributed`, `profit`, and `won` exclude the returned amount.

- [ ] **Step 5: Run the focused tests and witness failure**

Run:

```bash
npm test -- src/lib/poker/engine.sidepots.test.ts src/lib/poker/engine.handrecord.test.ts
```

Expected: FAIL because the engine still creates a single-eligible-player pot and `uncalled-return` is not a valid history kind.

### Task 2: Normalize closed betting rounds

**Files:**
- Modify: `src/lib/poker/hand-history.ts`
- Modify: `src/lib/poker/engine.ts`

- [ ] **Step 1: Add the internal history action kind**

```ts
export type HandHistoryActionKind =
  | ActionType
  | 'post-sb'
  | 'post-bb'
  | 'post-ante'
  | 'uncalled-return';
```

- [ ] **Step 2: Add the engine helper**

Implement a private method with this contract:

```ts
private returnUncalledBet(): void {
  const ordered = this.state.players
    .filter(p => p.currentBet > 0)
    .sort((a, b) => b.currentBet - a.currentBet);
  if (ordered.length < 2 || ordered[0].currentBet === ordered[1].currentBet) return;

  const player = ordered[0];
  const amount = player.currentBet - ordered[1].currentBet;
  player.chips += amount;
  player.currentBet -= amount;
  player.totalContributed -= amount;
  this.state.currentBet = Math.max(0, ...this.state.players.map(p => p.currentBet));
  this.handRecordDraft?.actions.push({
    street: this.state.street,
    playerId: player.id,
    kind: 'uncalled-return',
    amount,
  });
  this.rebuildPots();
}
```

Guard every adjusted amount with safe-integer/non-negative invariants already used by settlement code.

- [ ] **Step 3: Invoke it at the settlement boundary**

In `advanceAfterAction`, call `returnUncalledBet()` after `isBettingRoundComplete()` becomes true and before
`advanceStreet()`. In the fold-win branch, call it before `endHand()` so a final uncalled raise is returned too.

- [ ] **Step 4: Normalize the public last action**

Replace:

```ts
this.state.lastAction = action;
```

with:

```ts
this.state.lastAction = { ...action, amount: recordedAmount };
```

This preserves the existing semantics: call amount is the committed delta; raise/all-in amount is the street total.

- [ ] **Step 5: Reject solo-eligible payout pots as an invariant**

Before rake allocation, throw a settlement invariant error when a positive pot has fewer than two eligible players
unless the hand ended by folds. This is a defensive assertion, not the primary return mechanism.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- src/lib/poker/engine.sidepots.test.ts src/lib/poker/engine.handrecord.test.ts src/lib/poker/engine.ante.test.ts
```

Expected: PASS.

### Task 3: Award odd chips left of the button

**Files:**
- Modify: `src/lib/poker/engine.sidepots.test.ts`
- Modify: `src/lib/poker/engine.ts`

- [ ] **Step 1: Write a failing seat-order test**

Create a tied pot whose evaluation order differs from button-left order and assert the remainder goes to the first
winning seat encountered clockwise from `dealerIndex + 1`.

- [ ] **Step 2: Run the test**

Run:

```bash
npm test -- src/lib/poker/engine.sidepots.test.ts
```

Expected: FAIL with the extra chip on the evaluation-array-first winner.

- [ ] **Step 3: Sort tied winners for the remainder only**

Add:

```ts
private distanceLeftOfButton(player: Player): number {
  const n = this.state.players.length;
  const index = this.state.players.findIndex(p => p.id === player.id);
  return (index - this.state.dealerIndex + n) % n;
}
```

Choose the remainder recipient from a copy of `potWinners` sorted by this distance. Keep equal shares unchanged and
update the matching `WinResult` entry for that player.

- [ ] **Step 4: Run engine regression tests**

Run:

```bash
npm test -- src/lib/poker
```

Expected: all poker engine tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/poker/engine.ts src/lib/poker/hand-history.ts src/lib/poker/engine.sidepots.test.ts src/lib/poker/engine.handrecord.test.ts
git commit -m "fix(poker): return unmatched bets before settlement"
```

