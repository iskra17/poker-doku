# A2 implementation handoff

## Completed without GPU submission

- Dedicated `feat/art-library-pilot` worktree only. Existing A1c runner, manifest and outputs are untouched by A2.
- Independent SQLite ledger, global OS GPU lock, committed intent before POST, recipe bindings, queue/history/embedded-metadata recovery, job-local unknown isolation, pause/resume, explicit bounded retry, media validation, exact-byte review and no-overwrite idempotent export.
- CPU-only fake HTTP Comfy and real subprocess-death tests: **31 passed, 17.030 seconds**. Sixteen Python files compiled in memory, no bytecode committed. `git diff --check` passed.
- Four process-death checkpoints: before intent, before POST, after POST response, before generated-result commit. Response loss and missing history recover matching outputs without second submission. Other tests cover duplicate history, wrong PNG metadata, corrupt PNG, model/workflow/reference changes, output escape/collision, external queue, pause during active generation, two OS processes across DB roots/endpoint aliases, timeout preservation, three-attempt ceiling, review/export hash and path guards, export crash recovery, video decode and approved parent requirements.
- All fixture approval/export occurs under temporary directories. No real candidate is approved or exported by these tests.

## Prepared actual queue

DB: `D:/AI-Image-Video/output/poker-doku-library/a1c2-20260905/library.sqlite3`.

Immutable target root: `C:/code/claude/poker-doku/.worktrees/story-expansion-control`, explicitly designated by the root operator. Immutable input/output roots: `D:/AI-Image-Video/input` and `D:/AI-Image-Video/output`.

`scripts/art/library/recipes/a1c2-20260905.manifest.json` contains exactly the approved twelve IDs/seeds from `2026-09-05-art-a1c-followup.md`. Seeds run from 509020261400 through 509020261411. q1/q2 map to eight distinct (character, scene) pairs, not twelve distinct scenes. Original outfit/color/identity/style preservation and fully clothed adult scope remain in every prompt.

The Qwen graph is copied byte-for-byte from the successful A1c graph (SHA256 `1963823eb7698d63bb94be07ea1781d59cc83e4bb3879f4f1cb4cf6f215799a5`). The separate A2 recipe retains four steps, CFG1, Euler/simple, official int8 checkpoint, fp8 encoder, Qwen VAE and Lightning LoRA. It records complete model SHA256 and repository revisions. `prepare_a1c2.py` only builds these bounded configuration files; it neither imports nor submits. Existing files with different bytes are refused.

Import completed after reading/verifying all four actual model files and canonical/input reference hashes. At this handoff the twelve rows are pending, attempts=0, reviews=0, exports=0. No actual Comfy request or GPU sampling was made for A2. GPU ownership is still with the root operator until an explicit handover.

## Actual GPU verification next

Use the portable Python and commands in `scripts/art/library/README.md`: first `run --limit 4`, allow normal process exit, inspect the four full-resolution outputs and metadata, then start a new process with `run --limit 8`. Each new submit rehashes model files. `attempts.preflight_seconds` measures preflight separately; `started/submitted/finished` provide generation/recovery wall timing. Measure before deciding whether a validated per-process model-hash cache is justified. Root may observe VRAM independently; this version does not invoke nvidia-smi.

Verify twelve distinct attempt IDs/prompt IDs, twelve decoded PNGs with matching embedded intent/attempt/recipe metadata, no extra submissions, and no duplicate prior-four outputs. Per-intent submitted graphs and completed Comfy history snapshots are saved in `requests/` and `history/`. Generate `sheet`, inspect canonical comparisons/full PNGs, and record each exact output hash with the CLI review command only after explicit visual approval.

Actual GPU validation, eight accepted distinct scenes and game integration/export are **not complete at this handoff**. Video queue contracts are CPU tested, but H3 needs a separately reviewed metadata-preserving recipe binding and actual video validation before use. No H3/extra artwork is authorized by the twelve-image manifest.

## Actual GPU validation completed after ownership handover

The root operator reviewed commit `25fb002` and handed over the idle Comfy service. The approved twelve jobs completed with the same full per-job hash verification; no retry, extra job, model change, service change or export occurred.

| Measurement | Result |
|---|---:|
| First process, `run --limit 4` | exit0, 92.189 seconds |
| Second process, `run --limit 8`, PID52448 | exit0, 178.171 seconds |
| Sum of process wall times | 270.359 seconds |
| Twelve preflights total / median | 217.415 / 18.048 seconds |
| Preflight min / max | 15.745 / 20.452 seconds |
| Submit-to-result-registration total / median | 51.889 / 4.164 seconds |
| Submit-to-registration min / max | 4.061 / 6.074 seconds |
| Observed total GPU memory peak, 68 samples during second process | 31,469 MiB |

Registration times include polling and decoding; they are not pure kernel execution durations. GPU sampling began after the second process started and is an observed peak, not an exhaustive maximum. Full model checks dominate this batch's wall time. A separately scoped A2.1 can consider a nonpersistent per-process model hash cache with dev/ino/size/mtime_ns/ctime_ns invalidation and mutation tests; this batch did not relax verification.

Actual recipe hash: `2e0585cb9edd5f58eb9cd405ef2a3f1c43a139a45f2cf76df31b5b74269fd0b3`.

The completed audit verifies twelve distinct intents, twelve distinct prompt IDs, twelve PNGs, attempt1 for every job, and twelve `generated` rows. Every image fully decodes at 832x1248 with matching embedded intent/attempt/recipe hash and output SHA256. Every corresponding Comfy history entry matches the same metadata. The first process's four intent IDs, prompt IDs and output hashes remain unchanged after the second process. No duplicate attempt or output appeared. Reviews=0, exports=0.

Evidence under `D:/AI-Image-Video/output/poker-doku-library/a1c2-20260905`:

- `audit-first4.json` and `audit-complete.json`: per-output hashes/IDs/timings and empty queue snapshots.
- `run-first4.json`, `run-next8.json`, stdout/stderr logs; the first stderr log includes PowerShell's native stderr formatting, while exit0 and the independent audit confirm normal completion.
- `run-next8.gpu.json`: 68 timestamped memory/utilization observations.
- `requests/`, `history/`, `results/`: per-intent graph, Comfy history and immutable PNG.
- `review/contact-001.jpg`, `review/index.html`: twelve-candidate contact sheet and full output links.

Both worker processes and the GPU monitor exited. Comfy running/pending queues were empty at the final audit and GPU ownership was returned to the root operator. **A2 infrastructure's actual image queue/restart validation is complete.** Full-resolution quality approval, eight accepted distinct scenes and game export/integration remain the root operator's next steps; no quality approval is inferred from successful generation. The initial sheet suggests checking garden-walk q1's turn/gaze, rain-veranda's left/right direction and railing hand contact carefully.
