# Experience refresh implementation plan — 2026-09-09

Approved by user: implement the recommended direction across UI, contextual tutorial, reward structure, and Arena. Preserve the character/galgame identity, reduce visual noise using official mobile game references. No push or deployment requested.

## Ownership and design

- Root Astra: integration, contextual guides, reward supplements and rescue defaults, Arena composition, QA.
- Luna gpt-5.6-luna with max effort: isolated lobby/story surface cleanup. Delivered afa6d642, integrated as30ff375.
- Opus CLI (actual claude-opus-5, high effort): durable weekly dojo, realtime/persistence contracts, tests, standalone panel. Separate worktree weekly-dojo.
- Fable claude-fable-5-1 with high effort: independent review of wallet receipts and weekly lifecycle. At most two workers besides root.

## UI contract

- Keep real character artwork and dialogue, use quiet neutral dark surfaces, muted rose for one main action and meaningful gold for chips/results.
- Main navigation: four short mode names, no mode subtitles. Collapse utility actions and filter detail while retaining join/rejoin, room locks, operator capabilities and MTT visibility.
- Readable Korean, primary actions at least44px, preserve all explicit mission details in the table ObjectiveHud.
- Reference-to-change evidence: docs/planning-ui-economy-arena-2026-09-09.md. Official Mahjong Soul start guide/screenshot, Clash Royale mode navigation, Pokemon TCG Pocket contextual Guide.

## Contextual tutorial

- Point at the real lobby start button, lesson next, drill answer/submit/next and real table action row. Advance only through the existing action handlers.
- Pointer-through highlight plus one short instruction. Never intercept server actions, reveal answers, pause a public table or steal focus.
- Reposition on scroll/resize/mobile keyboard, hide if target is unavailable or another modal blocks it. Close/reopen controls, pending/offline guards, existing profile preference preserved.
- Pure placement boundary tests, browser inspection at320/390/430 and1280px; original control must remain clickable.

## Economy

- New course totals: first clear1000, firstS bonus500, act completion2000. Twelve chapters/four acts =26000 maximum;20000 withoutS bonuses.
- Preserve old13,600 course catalogue receipts. Append v2 items with delta500/200/1000 and migration41; reconcile uses existing eligibility and same transaction/ledger. Existing eligible players receive only missing difference once. Never mutate old ledger amounts.
- Display story reward chips as wallet chips. Practice table stacks remain separate. Daily1000 and storydaily100 unchanged; admin overrides unchanged.
- Default rescue eligibility balance<2000, refill to2000. Preserve cooldown4h, dailycap3, active escrow block. Threshold equal to target is valid because eligible balances are strictly lower.
- Verify old player migration/idempotency, newplayer totals, catalogue/SQL parity, reward view, rescue boundaries and config.

## Weekly dojo

- Actual private6-max practice competition, starting100BB, BB20, maximum20hands/session, first3sessions perKSTweek. Fixed versioned fivebot lineup/difficulty and secure fresh deck.
- No wallet/ticket/MMR effect. Score netBB, first3 completed required for ranking, equal scores share rank. Mark uncertainty of short samples in rules.
- Durable attempt reservation beforeplay, one liveattempt/profile, hand-boundary checkpoint and idempotent settlement. Reconnect/serverrestart resumes last committed boundary. Ordinaryquit cannot erase a losinghand. No rebuy/topup/foreignjoin/publicroomlisting.
- Pause at boundary when away, resume the saved bot stacks and dealer anchor. Explicit forfeit surrenders the remaining stack (-100BB); zero-hand forfeits also consume a slot. Server recovery failures use the last committed score. KST rollover and cap remain server-owned. Migration42 after root41.
- Authenticated bounded/rate-limited sockets and standalone WeeklyDojoPanel in Arena; works independently of official Arena enabledflag.
- Test cap, ties, bust,20hands, rejoin/restart, duplicate callbacks, rollover, wallet isolation and untrusted inputs.

## Integration and completion

- Review worker diffs and independent findings; fix reproduced failures.
- Full Vitest one integrated batch with --maxWorkers=2, after worker testing stops. Lint, tsc, diff checks.
- Commit and fast-forward main; productionbuild on main (Turbopack cannot build a junction node_modules worktree).
- Real browser QA using isolated SQLite profiles, screenshot review and overflow/click checks. Save evidence, update implementation notes/contracts. No realuser data mutation.
- No push or deploy without a later user request.
