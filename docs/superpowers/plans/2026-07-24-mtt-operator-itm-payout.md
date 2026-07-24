# MTT Operator, ITM Celebration, and Payout Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict MTT creation and operations to backoffice/operator profiles, add selectable payout presets, and show a server-authoritative one-shot ITM celebration.

**Architecture:** A new tournament command service is the sole authorization boundary shared by socket and admin HTTP entry points. Payout presets remain pure shared poker-domain functions and are threaded through MTT runtime and wallet settlement. ITM is a timestamped tournament milestone produced after elimination batches and copied into every active table snapshot for a non-blocking client overlay.

**Tech Stack:** TypeScript, Next.js 16, Socket.io, custom Node HTTP server, Zustand, React, Framer Motion, Vitest, SQLite

---

## File map

- Create `src/server/tournament-command-service.ts`: parse operator allowlist and authorize create/start/director commands.
- Create `src/server/tournament-command-service.test.ts`: authority boundary tests.
- Create `src/components/table/ItmCelebration.tsx`: accessible, reduced-motion-aware non-blocking overlay.
- Create `src/components/table/ItmCelebration.test.ts`: expiration/reconnect visibility rules.
- Modify `src/lib/poker/payout-table.ts`: preset registry and preset-aware computations.
- Modify `src/lib/poker/payout-table.test.ts`: all preset/domain invariants.
- Modify `src/lib/poker/types.ts`: public milestone type/state.
- Modify `src/lib/realtime/protocol.ts`: payout preset fields and session capability.
- Modify `src/server/tournament-manager.ts`: store selected preset, emit ITM milestone, remove host-only authorization assumption.
- Modify `src/server/tournament-manager.test.ts`: preset propagation and single-table ITM event.
- Modify `src/server/tournament-manager.break.test.ts`: H4H multi-bust ITM event.
- Modify `src/server/economy-repository.ts`: preset-aware wallet settlement validation.
- Modify `src/server/economy-mtt.test.ts`: selected-preset settlement and mismatch rejection.
- Modify `src/server/socket-handler.ts`: command service use and capability publication.
- Modify `src/server/socket-handler.integration.test.ts`: ordinary/operator socket authorization.
- Modify `src/server/admin-http.ts`: authenticated create/action POST endpoints.
- Modify `src/server/http-handler.ts`: inject admin tournament commands.
- Modify `src/server/index.ts`: construct and share the command service.
- Modify `src/server/ops-log.test.ts`: backoffice mutation authentication and behavior.
- Modify `src/lib/store/game-store.ts`: retain tournament creation capability.
- Modify `src/components/lobby/RoomList.tsx`: hide tournament creation for ordinary profiles.
- Modify `src/components/lobby/CreateTournamentModal.tsx`: payout preset selection and preview.
- Modify `src/components/lobby/TournamentDetailModal.tsx`: preset label.
- Modify `src/app/admin/page.tsx`: create and director controls with payout preview.
- Modify `src/components/layout/GameRoomView.tsx`: render ITM overlay.
- Create `.env.example`: document operator allowlist without copying local secrets.
- Modify `AGENTS.md`: document new authority, payout, and ITM contracts.

### Task 1: Add payout preset domain

**Files:**
- Modify: `src/lib/poker/payout-table.test.ts`
- Modify: `src/lib/poker/payout-table.ts`

- [ ] **Step 1: Write failing preset tests**

Add explicit expected bands and invariant coverage:

```ts
import {
  PAYOUT_PRESET_IDS,
  computePayouts,
  paidPlaces,
  payoutPercents,
} from './payout-table';

it('exposes the approved 8-player structures', () => {
  expect(payoutPercents(8, 'standard')).toEqual([50, 30, 20]);
  expect(payoutPercents(8, 'flat')).toEqual([40, 28, 19, 13]);
  expect(payoutPercents(8, 'top-heavy')).toEqual([65, 35]);
});

it.each(PAYOUT_PRESET_IDS)('%s stays valid for 2..48 entrants', preset => {
  for (let entrants = 2; entrants <= 48; entrants += 1) {
    const percents = payoutPercents(entrants, preset);
    expect(percents.length).toBeLessThanOrEqual(entrants);
    expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(computePayouts(480_001, entrants, preset).reduce((a, b) => a + b, 0))
      .toBe(480_001);
  }
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run src/lib/poker/payout-table.test.ts`  
Expected: FAIL because preset IDs and parameters do not exist.

- [ ] **Step 3: Implement the preset registry**

Add:

```ts
export const PAYOUT_PRESET_IDS = ['standard', 'flat', 'top-heavy'] as const;
export type PayoutPresetId = typeof PAYOUT_PRESET_IDS[number];

export const PAYOUT_PRESETS = {
  standard: { label: '표준형', bands: STANDARD_BANDS },
  flat: { label: '넓은 입상형', bands: FLAT_BANDS },
  'top-heavy': { label: '상위 집중형', bands: TOP_HEAVY_BANDS },
} satisfies Record<PayoutPresetId, {
  label: string;
  bands: readonly PayoutBand[];
}>;
```

Use the exact arrays in `docs/superpowers/specs/2026-07-24-mtt-operator-itm-payout-design.md`. Make all three exported functions accept `presetId: PayoutPresetId = 'standard'`, validate `entrants`, and retain the current first-place rounding remainder rule.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run src/lib/poker/payout-table.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/poker/payout-table.ts src/lib/poker/payout-table.test.ts
git commit -m "feat: add mtt payout presets"
```

### Task 2: Thread presets through MTT runtime and wallet settlement

**Files:**
- Modify: `src/lib/realtime/protocol.ts`
- Modify: `src/server/tournament-manager.test.ts`
- Modify: `src/server/tournament-manager.wallet.test.ts`
- Modify: `src/server/tournament-manager.ts`
- Modify: `src/server/economy-mtt.test.ts`
- Modify: `src/server/economy-repository.ts`

- [ ] **Step 1: Write failing manager and economy tests**

Create a flat tournament and assert:

```ts
const created = manager.createTournament({
  ...baseInput,
  payoutPreset: 'flat',
});
const detail = manager.getDetail(created.tournamentId)!;
expect(detail.summary.payoutPreset).toBe('flat');
expect(detail.payouts).toHaveLength(4);
```

In the wallet repository test, settle an 8-player event with:

```ts
const prizes = computePayouts(BUY_IN * 8, 8, 'top-heavy');
repository.settleMttTournament(id, resultsFor(prizes), BUY_IN, FEE, now, 'top-heavy');
expect(() => repository.settleMttTournament(
  id,
  resultsFor(computePayouts(BUY_IN * 8, 8, 'standard')),
  BUY_IN,
  FEE,
  now,
  'top-heavy',
)).toThrowError();
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run src/server/tournament-manager.test.ts src/server/tournament-manager.wallet.test.ts src/server/economy-mtt.test.ts`  
Expected: FAIL on missing `payoutPreset` arguments and fields.

- [ ] **Step 3: Store and publish the preset**

Add `payoutPreset: PayoutPresetId` to `CreateTournamentInput`, `CreateTournamentRequest`, `TournamentSummary`, and `AdminTournamentView`. Default omitted internal/test input to `standard`, reject unknown runtime values, and call:

```ts
t.prizes = computePayouts(t.prizePool, total, t.config.payoutPreset);
paidPlaces(t.seatedCount, t.config.payoutPreset);
```

Use the same preset in registration previews, H4H activation, standings, and ops events.

- [ ] **Step 4: Make economy validation preset-aware**

Extend `MttEconomyHooks.settle` and `EconomyRepository.settleMttTournament` with `payoutPreset`. Change the internal expected-prize calculation to:

```ts
const expectedPrizes = computePayouts(
  buyIn * results.length,
  results.length,
  payoutPreset,
);
```

Include the preset in duplicate-settlement validation by verifying the exact result array; no schema migration is added.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/lib/poker/payout-table.test.ts src/server/tournament-manager.test.ts src/server/tournament-manager.wallet.test.ts src/server/economy-mtt.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/realtime/protocol.ts src/server/tournament-manager.ts src/server/tournament-manager.test.ts src/server/tournament-manager.wallet.test.ts src/server/economy-repository.ts src/server/economy-mtt.test.ts
git commit -m "feat: apply payout presets to mtt settlement"
```

### Task 3: Add the shared operator command boundary

**Files:**
- Create: `src/server/tournament-command-service.test.ts`
- Create: `src/server/tournament-command-service.ts`
- Modify: `src/server/tournament-manager.ts`

- [ ] **Step 1: Write failing authority tests**

Cover trimmed parsing, ordinary denial, operator success, backoffice success, and cross-operator administration:

```ts
expect(parseTournamentOperatorIds(' p1, ,p2,p1 ')).toEqual(new Set(['p1', 'p2']));
expect(service.create({ kind: 'operator-profile', profileId: 'guest' }, draft))
  .toMatchObject({ ok: false, reason: 'forbidden' });
expect(service.create({ kind: 'operator-profile', profileId: 'p1' }, draft).ok).toBe(true);
expect(service.act({ kind: 'operator-profile', profileId: 'p2' }, id, { kind: 'pause' }))
  .toBe('ok');
expect(service.create({ kind: 'backoffice' }, draft).ok).toBe(true);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run src/server/tournament-command-service.test.ts`  
Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the service**

Implement:

```ts
export type TournamentCreateDraft = CreateTournamentRequest;

export type TournamentAuthority =
  | { kind: 'backoffice' }
  | { kind: 'operator-profile'; profileId: string };

export class TournamentCommandService {
  constructor(
    private readonly manager: TournamentManager,
    private readonly operatorProfileIds: ReadonlySet<string>,
  ) {}

  canOperateProfile(profileId: string): boolean {
    return this.operatorProfileIds.has(profileId);
  }

  private allowed(authority: TournamentAuthority): boolean {
    return authority.kind === 'backoffice'
      || this.canOperateProfile(authority.profileId);
  }
}
```

Move authorization out of the manager’s `hostId` equality checks. Preserve creator metadata as `createdBy: 'backoffice' | 'operator-profile'` and optional `operatorProfileId`, but allow any authorized operator to administer any tournament.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/server/tournament-command-service.test.ts src/server/tournament-manager.director.test.ts`  
Expected: PASS after updating director fixtures to invoke the command service or manager’s authorization-free internal command.

- [ ] **Step 5: Commit**

```bash
git add src/server/tournament-command-service.ts src/server/tournament-command-service.test.ts src/server/tournament-manager.ts src/server/tournament-manager.director.test.ts
git commit -m "feat: centralize mtt operator authorization"
```

### Task 4: Enforce socket authority and publish capability

**Files:**
- Modify: `src/lib/realtime/protocol.ts`
- Modify: `src/lib/store/game-store.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.integration.test.ts`
- Modify: `src/components/lobby/RoomList.tsx`

- [ ] **Step 1: Write failing socket tests**

Start one server without an allowlisted profile and one with the test profile allowlisted. Assert:

```ts
const denied = await emitAck(guest, 'create-tournament', validDraft);
expect(denied).toMatchObject({ ok: false, code: 'forbidden' });

const allowed = await emitAck(operator, 'create-tournament', {
  ...validDraft,
  payoutPreset: 'standard',
});
expect(allowed.ok).toBe(true);
expect(latestSession.capabilities.createTournament).toBe(true);
```

Also assert ordinary profiles cannot use `start-tournament` or `tournament-admin`.

- [ ] **Step 2: Run the integration test and verify failure**

Run: `npx vitest run src/server/socket-handler.integration.test.ts`  
Expected: FAIL because all authenticated profiles currently create tournaments.

- [ ] **Step 3: Route socket commands through the service**

Construct the service once and use:

```ts
const authority = { kind: 'operator-profile', profileId: session.playerId } as const;
if (!tournamentCommands.canOperateProfile(session.playerId)) {
  ack?.({ ok: false, code: 'forbidden', message: '운영자만 사용할 수 있어요.' });
  return;
}
```

Perform authority checks before rate-limited mutation logging. Remove creator auto-registration from the lobby workflow.

- [ ] **Step 4: Publish and consume capability**

Extend the session event:

```ts
'session': (data: {
  playerId: string;
  capabilities: { createTournament: boolean };
}) => void;
```

Store `canCreateTournament` in Zustand, clear it on session reset, and render the RoomList create button only when true. This hiding is UX only; the server remains authoritative.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/server/socket-handler.integration.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/realtime/protocol.ts src/lib/store/game-store.ts src/server/socket-handler.ts src/server/socket-handler.integration.test.ts src/components/lobby/RoomList.tsx
git commit -m "feat: restrict mtt sockets to operators"
```

### Task 5: Add backoffice creation and operations

**Files:**
- Modify: `src/server/ops-log.test.ts`
- Modify: `src/server/admin-http.ts`
- Modify: `src/server/http-handler.ts`
- Modify: `src/server/index.ts`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Write failing HTTP tests**

Test missing token 403, malformed JSON 400, valid create 201, and valid pause 200:

```ts
const created = await request('/api/admin/tournaments?token=secret', {
  method: 'POST',
  body: JSON.stringify(validDraft),
});
expect(created.status).toBe(201);
expect(commands.create).toHaveBeenCalledWith(
  { kind: 'backoffice' },
  expect.objectContaining({ payoutPreset: 'standard' }),
);
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/server/ops-log.test.ts`  
Expected: FAIL with 404/method rejection for POST.

- [ ] **Step 3: Add admin command injection and routes**

Extend admin options with:

```ts
interface AdminTournamentCommands {
  create(input: TournamentCreateDraft): CreateTournamentResult;
  start(tournamentId: string): TournamentCommandResult;
  act(tournamentId: string, action: TournamentDirectorAction): TournamentCommandResult;
}
```

Inject adapters bound to `{ kind: 'backoffice' }` from `src/server/index.ts`. Parse POST bodies with the existing bounded JSON helper, share draft/action parsing with the socket boundary, and return explicit 201/200/400/409 statuses.

- [ ] **Step 4: Add the backoffice UI**

In the tournament tab add:

- name, start time, speed, max entrants, bot fill, turn time, economy mode, payout preset
- live payout preview from the shared preset metadata
- Start/Pause/Resume/Set level/Remove player/Cancel buttons
- existing two-click confirmation pattern for remove/cancel
- refresh after successful mutation

Use the existing `api()` token plumbing; never place the token in state sent to tournament components or logs.

- [ ] **Step 5: Run focused tests and checks**

Run: `npx vitest run src/server/ops-log.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ops-log.test.ts src/server/admin-http.ts src/server/http-handler.ts src/server/index.ts src/app/admin/page.tsx
git commit -m "feat: manage tournaments from backoffice"
```

### Task 6: Emit one-shot ITM milestones

**Files:**
- Modify: `src/lib/poker/types.ts`
- Modify: `src/server/tournament-manager.test.ts`
- Modify: `src/server/tournament-manager.break.test.ts`
- Modify: `src/server/tournament-manager.ts`

- [ ] **Step 1: Write failing milestone tests**

For a single table and H4H multi-table round, assert:

```ts
expect(state.tournament?.milestone).toMatchObject({
  seq: 1,
  kind: 'itm',
  paidPlaces: expectedPaidPlaces,
});
expect(state.tournament!.milestone!.expiresAt - state.tournament!.milestone!.reachedAt)
  .toBe(4_500);
```

Apply another elimination and assert sequence remains `1`. Add a multi-bust case where remaining jumps below the paid-place count and still emits once on every surviving table.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run src/server/tournament-manager.test.ts src/server/tournament-manager.break.test.ts`  
Expected: FAIL because milestone does not exist.

- [ ] **Step 3: Implement server milestone transition**

Add:

```ts
export interface TournamentMilestone {
  seq: number;
  kind: 'itm';
  reachedAt: number;
  expiresAt: number;
  paidPlaces: number;
}
```

Capture `beforeRemaining` at the start of `assignEliminations()`, then after the complete batch:

```ts
this.maybeReachItm(t, beforeRemaining);
```

`maybeReachItm` compares the preset-aware paid-place count, increments once, posts the approved system chat to every active room, logs `mtt-itm`, and calls `syncTournamentPresentation(t)`. `flushTournamentPresentation()` copies the milestone into every table state. It does not add holds or timers.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/server/tournament-manager.test.ts src/server/tournament-manager.break.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/poker/types.ts src/server/tournament-manager.ts src/server/tournament-manager.test.ts src/server/tournament-manager.break.test.ts
git commit -m "feat: announce mtt in-the-money milestone"
```

### Task 7: Render ITM celebration and payout labels

**Files:**
- Create: `src/components/table/ItmCelebration.test.ts`
- Create: `src/components/table/ItmCelebration.tsx`
- Modify: `src/components/layout/GameRoomView.tsx`
- Modify: `src/components/lobby/CreateTournamentModal.tsx`
- Modify: `src/components/lobby/TournamentDetailModal.tsx`

- [ ] **Step 1: Write the failing visibility test**

Export a pure helper and test:

```ts
expect(shouldShowItmMilestone(milestone, 1_500, null)).toBe(true);
expect(shouldShowItmMilestone(milestone, milestone.expiresAt, null)).toBe(false);
expect(shouldShowItmMilestone(milestone, 1_500, milestone.seq)).toBe(false);
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/table/ItmCelebration.test.ts`  
Expected: FAIL because the component/helper does not exist.

- [ ] **Step 3: Implement the overlay**

Implement an absolute `pointer-events-none` overlay with:

```tsx
<div role="status" aria-live="polite">
  <p>미야코가 축하드려요!</p>
  <h2>IN THE MONEY</h2>
  <p>축하합니다! 상금권 진입이 확정되었습니다</p>
  <p>{milestone.paidPlaces}명 입상</p>
</div>
```

Use fixed blossom/gold particle constants and Framer Motion only when `reducedMotion` is false. Drive unmounting from `expiresAt`; do not block table input and do not call random/time functions during render.

- [ ] **Step 4: Wire table and lobby**

Render after `PokerTable` in `GameRoomView`, pass the existing reduced-motion preference, and key by sequence. Add payout preset selector and preview to the operator creation modal. Add the preset label to tournament cards/detail; ordinary profiles never see the create entry point.

- [ ] **Step 5: Run focused tests and static checks**

Run: `npx vitest run src/components/table/ItmCelebration.test.ts src/lib/poker/payout-table.test.ts && npx tsc --noEmit && npm run lint`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/table/ItmCelebration.tsx src/components/table/ItmCelebration.test.ts src/components/layout/GameRoomView.tsx src/components/lobby/CreateTournamentModal.tsx src/components/lobby/TournamentDetailModal.tsx
git commit -m "feat: celebrate mtt in-the-money"
```

### Task 8: Document configuration and run full verification

**Files:**
- Create: `.env.example`
- Modify: `AGENTS.md`

- [ ] **Step 1: Document contracts**

Add:

```dotenv
# Comma-separated profile IDs allowed to create and operate MTTs in the game UI.
TOURNAMENT_OPERATOR_PROFILE_IDS=
```

Document that backoffice and allowlisted profiles are the only authorities, payout presets are immutable after creation, and ITM milestone is a one-shot non-blocking server event.

- [ ] **Step 2: Run targeted regression tests**

Run:

```bash
npx vitest run \
  src/lib/poker/payout-table.test.ts \
  src/server/tournament-command-service.test.ts \
  src/server/tournament-manager.test.ts \
  src/server/tournament-manager.break.test.ts \
  src/server/tournament-manager.wallet.test.ts \
  src/server/economy-mtt.test.ts \
  src/server/socket-handler.integration.test.ts \
  src/server/ops-log.test.ts \
  src/components/table/ItmCelebration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the complete verification suite**

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0. If root typechecking includes ignored `qa-tmp`, verify in the clean feature worktree and record the root-only pollution without deleting user QA files.

- [ ] **Step 4: Review secrets and authorization**

Run:

```bash
rg -n "DEBUG_LOG_TOKEN|TOURNAMENT_OPERATOR_PROFILE_IDS" src
rg -n "create-tournament|start-tournament|tournament-admin" src/server/socket-handler.ts
```

Expected: no token or full allowlist in payloads/logs; all mutation handlers route through `TournamentCommandService`.

- [ ] **Step 5: Commit**

```bash
git add .env.example AGENTS.md
git commit -m "docs: record mtt operator contracts"
```
