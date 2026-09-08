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

## Completed verification — 2026-09-09

- Implementation integrated into local main through `d262f43`. Root Astra integrated the Luna/Opus work and resolved the reproduced Fable findings: legacy rescue overrides, retroactive wallet refresh, folded-hand loss persistence, grace expiry/all-in settlement, durable bot stacks/dealer, pending close retries and client lifecycle cleanup.
- One full Vitest batch, 239 files, `--maxWorkers=2`: 2,921 passed, two failed, two skipped. The two failures were the old navigation-label assertion and a four-sentence first lesson; both were corrected and the affected two files passed all 21 tests. Two additional regression tests were then added and passed with their related suites: runtime reconstruction preserves the challenge checkpoint; a submitted drill restores its server result after reload. Final aggregate: 2,925 passed, two skipped. The full batch was not repeated.
- Full ESLint: zero errors, one existing unused `_personalityId` warning in `engine.ts`. Later edited files passed targeted ESLint. `npx tsc --noEmit`, `git diff --check`, and the final main production build passed.
- Production-browser QA used isolated `qa-tmp/experience-qa.sqlite`, synthetic profiles and Node 22.17.0. Lobby/story/challenge layouts were checked at 320, 390, 430 and 1,280 px as applicable; screenshots were inspected and horizontal overflow checked. Real lobby/lesson/drill/table controls remained clickable; closing and reopening guidance worked. A submitted drill survived reload and advanced through both first questions without duplicate submission.
- Two real 20-hand weekly sessions reached durable `max-hands` completion. One used normal bot wait times; the final browser run used only the QA database's supported 10% bot wait setting. It included pause/resume and page reload, and preserved the 12,000-chip table pool. Two subsequent explicit forfeits recorded -100BB each; the third completion displayed the -206BB total, leaderboard rank, and disabled weekly entry. Every challenge profile's wallet remained 10,000. The final navigation fix was separately verified: reload a live challenge, pause, and return directly to Arena without a generic recap modal.
- Browser JavaScript errors were empty. The QA server was stopped and its temporary bot wait override removed. No production database, remote branch or deployed service was changed.
- Evidence (ignored local QA artifacts): `qa-tmp/experience-full-tests.log`, `experience-final-targets.log`, `experience-restart-check.log`, `experience-story-resync-green.log`, `experience-production-build-final.log`, `experience-weekly-browser-final.log`, `experience-weekly-ranking.log`, `experience-weekly-return.log`; images and wallet audit in `qa-tmp/experience-ui/`.
- Community perception, real-user comprehension and retention improvements still require post-release feedback; browser checks establish function and layout, not those outcomes.
