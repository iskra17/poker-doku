# Final Table Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present a one-time server-authoritative final-table intro and a readable Sakura Championship table while shipping reusable Gold Spotlight and Neon Arena presets.

**Architecture:** A small theme registry converts the server's `finalTheme` key into CSS custom properties. `GameRoomView` renders stage overlays and passes the theme to the existing table shell; no poker state is owned by the animation components.

**Tech Stack:** React 19, Next.js 16, Tailwind CSS 4, Framer Motion, Zustand, Vitest

---

### Task 1: Add the theme registry and table shell

**Files:**
- Create: `src/lib/tournament/final-table-themes.ts`
- Create: `src/components/table/FinalTableAtmosphere.tsx`
- Modify: `src/components/table/PokerTable.tsx`
- Modify: `src/components/layout/GameRoomView.tsx`

- [ ] **Step 1: Define all three presets**

```ts
export const FINAL_TABLE_THEMES = {
  'sakura-championship': {
    label: '벚꽃 챔피언십',
    felt: '#23544b',
    feltGlow: '#4b8b78',
    accent: '#f6b9c9',
    highlight: '#ffe4a3',
  },
  'gold-spotlight': {
    label: '골드 스포트라이트',
    felt: '#172c29',
    feltGlow: '#355047',
    accent: '#d8aa4d',
    highlight: '#fff0b5',
  },
  'neon-arena': {
    label: '네온 아레나',
    felt: '#102a35',
    feltGlow: '#164e63',
    accent: '#2dd4bf',
    highlight: '#f472b6',
  },
} as const;
```

Export `FinalTableTheme` from the keys and a safe fallback resolver that returns Sakura.

- [ ] **Step 2: Render atmosphere without owning game state**

`FinalTableAtmosphere` receives `{ theme, reducedMotion }` and renders lighting, vignette, and decorative layers
behind the table. Sakura uses a bounded set of deterministic petals; do not call `Math.random()` or `Date.now()`
during render.

- [ ] **Step 3: Apply CSS variables**

Wrap the final-stage table in a container whose inline custom properties come from the registry. Update
`PokerTable` felt, rail, and ambient shadows to consume those properties only while final mode is active.

- [ ] **Step 4: Verify types**

```bash
npx tsc --noEmit
```

Expected: PASS.

### Task 2: Render the deadline-based intro and state banners

**Files:**
- Create: `src/components/table/FinalTableIntro.tsx`
- Create: `src/components/table/TournamentStatusBanner.tsx`
- Modify: `src/components/layout/GameRoomView.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/table/ActionBar.tsx`

- [ ] **Step 1: Build the intro from server state**

Render `FinalTableIntro` only for `tournament.stage === 'final-intro'` and calculate remaining time from
`stageEndsAt` with the existing countdown utility. Display FINAL TABLE, tournament name when available, remaining
field, and first prize.

- [ ] **Step 2: Respect reduced motion**

Use CSS/Framer Motion media-query support so reduced-motion users get an immediate fade with no petal travel,
scaling, or spotlight sweep.

- [ ] **Step 3: Disable actions**

Derive:

```ts
const tournamentHeld = (gameState?.tournament?.holdReasons?.length ?? 0) > 0;
```

Hide or disable ActionBar while held. The server remains authoritative and does not start the first final hand
before the deadline.

- [ ] **Step 4: Add status priority**

`TournamentStatusBanner` maps the highest-priority reason to Korean copy:

```ts
director-pause  -> 운영자 일시정지
scheduled-break -> 브레이크
final-forming   -> 파이널 테이블 재편성 중
final-intro     -> 파이널 테이블
h4h-barrier     -> 핸드 포 핸드 · 다른 테이블 대기 중
```

On mobile, keep level/blinds/remaining/status in the TopBar and move next-level detail behind the tournament modal.

- [ ] **Step 5: Run lint and types**

```bash
npm run lint
npx tsc --noEmit
```

Expected: PASS.

### Task 3: Correct MTT copy and history rendering

**Files:**
- Modify: `src/components/table/EliminationNotice.tsx`
- Modify: `src/components/table/TournamentResultOverlay.tsx`
- Modify: `src/components/lobby/TournamentDetailModal.tsx`
- Modify: `src/components/help/HelpModal.tsx`
- Modify: `src/components/history/HandHistoryModal.tsx`

- [ ] **Step 1: Split SnG and MTT wording**

For MTT, replace `Sit & Go` with `토너먼트`, remove the fake ongoing spectator CTA, and explain that the player
returns to the lobby while the final result remains available in tournament detail.

- [ ] **Step 2: State the product rules**

In detail/help text state: freezeout, no late registration, no re-entry, start-time online check-in, and the actual
minimum field enforced by the server.

- [ ] **Step 3: Render returns in hand history**

Add:

```ts
case 'uncalled-return':
  return `매칭되지 않은 베팅 ${formatChips(amount)} 반환`;
```

In replay accounting subtract the returned amount from the displayed pot and the player's street contribution.

- [ ] **Step 4: Run types and focused tests**

```bash
npx tsc --noEmit
npm test -- src/lib/events src/lib/poker/engine.handrecord.test.ts
```

Expected: PASS.

### Task 4: Browser and production verification

**Files:**
- No source file required unless verification reveals a defect.

- [ ] **Step 1: Run the full required checks**

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run a local MTT scenario**

Start the custom server, create a practice MTT with bots, force the field to one table through normal play/test
controls, and verify:

- FINAL TABLE appears before the first final hand.
- No action or timer begins during intro.
- Sakura lighting keeps cards, chip amounts, and buttons readable.
- Refresh during intro shows only the remaining duration.
- Refresh after final play begins does not replay the intro.
- H4H, break, pause, and forming banners use the right priority.

- [ ] **Step 3: Check responsive layouts**

Capture desktop 1680×945 and mobile 390×844 screenshots for Sakura. Temporarily switch the server theme key in a
local-only verification path to inspect Gold and Neon, then restore Sakura before committing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tournament/final-table-themes.ts src/components/table src/components/layout src/components/lobby/TournamentDetailModal.tsx src/components/help/HelpModal.tsx src/components/history/HandHistoryModal.tsx
git commit -m "feat(mtt): add championship final table experience"
```

