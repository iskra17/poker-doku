# Tournament recurrence and field policy handoff

Date: 2026-07-25 KST  
Target agent: Claude Opus  
Repository: `C:\code\claude\poker-doku`  
Implementation worktree:
`C:\code\claude\poker-doku\.worktrees\tournament-recurrence-policy`  
Branch: `feat/tournament-recurrence-policy`

## Start here

Continue in the implementation worktree, not the main checkout:

```powershell
Set-Location 'C:\code\claude\poker-doku\.worktrees\tournament-recurrence-policy'
git status --short
git log --oneline -6
```

Read these two approved documents before editing:

- `docs/superpowers/specs/2026-07-25-tournament-recurrence-field-policy-design.md`
- `docs/superpowers/plans/2026-07-25-tournament-recurrence-field-policy.md`

The root checkout is on `main` and contains the design and plan commits. Do not
implement in the root checkout. Preserve the user's untracked `.superpowers/`
directory there.

## Approved product decisions

The user approved the recommended policy:

1. Every recurring template requires an explicit inclusive end time.
2. A recurring template materializes at most five active occurrences at once,
   independent of hourly/daily/weekly cadence.
3. The public lobby shows at most five occurrences from the same template.
   A viewer's own engaged occurrence remains visible even if it is beyond the
   normal five.
4. Existing incident templates/instances must be removed from the public lobby,
   but records and audit history must remain. Disable templates first, then use
   existing cancellation/refund command paths. Never issue raw `DELETE`.
5. Add clear adjacent help/tooltips:
   - Lobby exposure lead: how long before scheduled start the tournament card
     first appears in the lobby.
   - Registration start lead: how long before scheduled start registration
     opens.
   Include a concrete KST example.
6. Field controls:
   - Minimum custom default: 6.
   - Minimum "unlimited": persisted as 2, because poker cannot start solo.
   - Maximum custom or "unlimited"; unlimited maps to the current safe service
     cap of 48.
   - Equal min/max means a fixed-size tournament.
   - Scheduled tournaments do not start early merely because minimum is met.
   - Freeroll minimum remains total field (humans plus configured bot fill),
     with at least one human.
   - Wallet tournaments remain human-only.
7. Two through six entrants start directly as one final table. Seven or more
   use the existing multi-table flow.
8. New tournaments use payout table v3 while existing v2 settlements stay
   immutable:
   - 2 entrants: 100% to first for every preset.
   - 3 entrants: standard 70/30, flat 60/40, top-heavy 100.
   - 4–5 entrants: standard 65/35, flat 60/40, top-heavy 75/25.
   - 6+ entrants: existing v2 bands unchanged.

## Completed commits

The branch currently contains:

```text
a1ed91a fix: bound recurring tournament materialization
6965e1f feat: validate tournament recurrence end dates
5c067d6 feat: persist tournament recurrence boundaries
bde96ba docs: plan tournament recurrence policy implementation
e6624bc docs: design bounded tournament recurrence policy
```

### Task 1: persisted recurrence boundaries

Commit `5c067d6`:

- Added `firstStartsAt` and `recurrenceEndsAt` to shared commands and template
  records.
- Added migration v29 with nullable boundary columns.
- Migration disables legacy enabled templates rather than guessing an end.
- Repository create/patch/decode/idempotency validation now persists boundaries.
- An enabled persisted template without valid ordered boundaries is rejected.
- Database and repository focused tests passed.

### Task 2: parser and command service propagation

Commit `6965e1f`:

- Standalone commands require both boundary fields to be null/absent.
- Recurring commands require safe epoch values.
- `firstStartsAt` must equal `schedule.startsAt`.
- `recurrenceEndsAt >= firstStartsAt`.
- Create and patch propagate exact reviewed boundaries.
- Admin template reads include both fields.
- Focused parser/service tests passed.

The patch service test deliberately uses `Date.now()` as its transition time.
SQLite terminal-transition triggers reject test timestamps more than five
minutes away from wall clock when old hidden occurrences are superseded.

### Task 3: rolling five-occurrence materialization

Commit `a1ed91a`:

- Replaced the old 48-hour horizon with inclusive first/end boundaries.
- `kstOccurrenceStarts` returns at most five by default.
- Scheduler keeps five non-terminal occurrences for the current template
  revision.
- Completed/operator-cancelled occurrence keys are tombstones and are not
  recreated; reconciliation scans forward for successors.
- No refill occurs beyond the inclusive end.
- Disabled legacy templates with null boundaries remain readable but cannot
  generate.
- Scheduler, rollout, parser, and service focused tests passed.
- `npx tsc --noEmit` passed at this checkpoint.

## Current intentional RED state

There is exactly one uncommitted file:

```text
M src/server/tournament-instance-repository.test.ts
```

It contains the new Task 4 test:

```text
caps each recurring template at five public rows and keeps my engaged overflow
```

Current focused result:

```text
expected recurring public rows length 5, received 6
```

This is the expected RED failure. The fixture is now valid:

- six visible wallet occurrences under one template;
- two visible standalone tournaments;
- `profile-a` is registered in the sixth occurrence with a valid reserved wallet
  entry and registration attempt.

Do not remove or weaken this test.

## Exact next implementation step: Task 4

Modify `TournamentInstanceRepository.listPublicProjections` in
`src/server/tournament-instance-repository.ts`.

Current implementation fetches IDs, projects every public detail, and returns
all summaries. Keep `templateId` internal to the filtering operation; do not add
template internals to `PublicTournamentSummary` unless truly necessary.

Recommended shape:

```ts
const candidates = ids.flatMap(row => {
  const instanceId = stringValue(row.id);
  const detail = this.getPublicProjection(instanceId, forPlayerId, now);
  if (!detail) return [];
  const instance = this.getInstance(instanceId);
  return instance
    ? [{
        templateId: instance.templateId,
        summary: detail.summary as PublicTournamentSummary,
      }]
    : [];
});

const perTemplate = new Map<string, number>();
return candidates.flatMap(candidate => {
  if (candidate.templateId === null) return [candidate.summary];
  const count = perTemplate.get(candidate.templateId) ?? 0;
  if (count < 5) {
    perTemplate.set(candidate.templateId, count + 1);
    return [candidate.summary];
  }
  return isEngagedRegistrationStatus(
    candidate.summary.myRegistrationStatus,
  )
    ? [candidate.summary]
    : [];
});
```

Avoid the extra `getInstance` query if convenient by selecting `template_id`
alongside `id` in the original list query.

The personalized overflow exception must include:

```text
registered
seat-claimed
late-pending
seated
eliminated
finished
```

The existing `isActiveRegistrationStatus` omits eliminated/finished because it
drives a different `registered` boolean. Add a separate helper for lobby
engagement instead of broadening that existing helper.

Then add the socket contract regression in
`src/server/socket-handler.integration.test.ts`:

- inject `persistentLateRegistration.listPublicTournaments`;
- return five normal summaries plus one sixth summary with
  `myRegistrationStatus: 'registered'`;
- connect a client and emit `get-tournaments`;
- assert the personalized sixth item survives the Socket.IO payload.

Run:

```powershell
npm test -- src/server/tournament-instance-repository.test.ts src/server/socket-handler.integration.test.ts
npx tsc --noEmit
```

Commit Task 4 as:

```powershell
git add src/server/tournament-instance-repository.ts `
  src/server/tournament-instance-repository.test.ts `
  src/server/socket-handler.integration.test.ts
git commit -m "feat: cap recurring tournament lobby exposure"
```

## Remaining plan

### Task 5: payout table v3 and table formation

Follow the approved plan exactly:

- Preserve v2 behavior byte-for-byte.
- Add table version `3`.
- Add the approved 2–5 entrant ladders.
- Thread `config.payout.tableVersion` through every payout calculation/freeze.
- New form drafts use v3.
- Add manager regressions:
  - 2–6 entrants produce one room and enter final formation.
  - 7 entrants produce two rooms.

Important observation: `TournamentManager` already calls final formation during
activation, and one-room fields appear structurally close to the desired
behavior. Prove it with tests before changing manager logic.

### Task 6: backoffice UI

Create the pure helper/test module specified in the plan, then update:

- `src/components/tournament/TournamentCreateForm.tsx`
- `src/app/admin/page.tsx`

Required UX:

- recurrence end is required only when recurrence is selected;
- show first five preview starts, total count, and last start;
- minimum default 6;
- minimum unlimited maps to 2;
- maximum unlimited maps to 48 and is labeled as the current service cap;
- clear fixed-size behavior when min equals max;
- accessible hover/focus/touch help next to both lead terms;
- concrete KST example;
- explain freeroll bot-fill versus wallet human-only semantics;
- submit payout table v3.

### Task 7: full verification and operations cleanup

Full local verification:

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Environment notes:

- Local Node is `v22.14`; `package.json` warns for `<22.16`.
- Baseline before implementation: 143 test files passed, 1815 tests passed,
  2 skipped.
- Existing npm audit state: 6 vulnerabilities (1 low, 5 high). Do not run an
  automatic destructive audit fix.
- This app deploys to Fly.io Tokyo through `fly.toml`/`Dockerfile`; it is a
  custom Next + Socket.IO server. Do not migrate or deploy it to Vercel.
- Fly CLI was not present during this session.
- The local `data/poker-doku.sqlite` is old and is not production data.

Production cleanup must be performed through authenticated backoffice/command
paths:

1. Read-only inventory incident templates and instances.
2. Exclude running and completed tournaments.
3. Disable each incident template using its current revision.
4. Re-read and verify disabled.
5. Cancel only eligible pre-start states:
   `scheduled-hidden`, `scheduled-visible`, `registering`, `start-delayed`.
6. Wait for wallet void/freeroll escrow return if status becomes
   `refund-pending`.
7. Verify zero public incident instances, zero enabled incident templates, and
   retained cancelled records plus audit/ops events.

Never hard-delete these records. The user explicitly changed the original
request and wants the mistake retained in history.

## Safety and repository constraints

- Follow the `AGENTS.md` supplied for this repository.
- Server authority, immutable tournament lifecycle, escrow/refund CAS, and
  audit history are hard contracts.
- Do not touch unrelated worktrees:
  - `.claude/worktrees/blind-position-buttons`
  - `.claude/worktrees/throwables`
  - `C:\code\claude\poker-doku-mtt`
  - `C:\code\claude\poker-doku-wt-gameconfig`
- Do not use `git reset --hard`, `git checkout --`, raw tournament deletes, or
  automatic audit fixes.
- No temporary debug logging remains in the branch.

## Suggested continuation prompt

Use this prompt for Claude Opus:

> Continue the approved tournament recurrence/field-policy implementation in
> `C:\code\claude\poker-doku\.worktrees\tournament-recurrence-policy` on branch
> `feat/tournament-recurrence-policy`. Read the repository AGENTS.md plus
> `docs/superpowers/handoffs/2026-07-25-tournament-recurrence-field-policy-handoff.md`,
> the linked design, and implementation plan. Preserve the current uncommitted
> Task 4 RED test and continue from the exact next step. Use TDD, commit each
> completed task separately, run the full verification suite, and perform
> production cleanup only through existing authenticated disable/cancel/refund
> paths while preserving history.
