# A2.1 / A3 code handoff

Branch `feat/art-first-supply`, isolated at `C:/code/claude/poker-doku/.worktrees/art-first-supply`, based on control `db9ef5c`.

## Implemented

- Fable finding5: recovered single exports clean their receipt's exact matching pending file. Unrelated files are preserved; pending symlinks are rejected instead of following them for deletion.
- Worker-owned model SHA cache: first full hash; reuse only for unchanged resolved path + expected SHA + dev/ino/size/mtime_ns/ctime_ns. File replacement, same-size change, expected-hash change and a change during hash verification are covered. New workers start with an empty cache. Workflow/canonical/image input hashing remains per job, with no persistent cache.
- `export-video-pair` accepts approved 107-frame24fps768x1152 video, removes the last frame, encodes106-frame MP4 H264 and WebM VP9, fully probes/decodes, and limits each to2,500,000 bytes. Both paths/settings/source hash have a durable receipt and exclusive reservations. Both parts are ready before publication. Partial publication resumes without replacing existing files. Changed bytes, stale/rejected approval and collisions are rejected. The original MP4 single export remains available.
- Eight existing first-supply WebPs are registered with their approved titles and explicit chapter ownership. The catalog retains chapter-complete unlock; Ch9 assets appear locked before Ch9 completion even before that chapter is installed. File list, IDs, map keys and source-manifest SHA256 parity are tested.
- Ch2's original CGs, dialogue, seven-step sequence, IDs and rewards are preserved. Six new lines at the beginning of its existing epilogue lead from table cleanup to library, garden walk, rain shelter and the original night garden discussion. Ch9 writing and video availability remain with their assigned owners.

## Verification

- Python CPU suite:46 tests ran in27.921s:45 passed, one symlink-creation test skipped because this Windows host cannot create test symlinks. Includes fake HTTP Comfy/worker recovery and synthetic CPU video fixtures. Pair tests cover both formats/frame counts, one-part publication crash, receipt reservations, source/staged/published mutation, wrong source frame count, size ceiling and approval rejection during conversion/resume. The pending-path symlink guard is implemented, but its filesystem integration test could not run on this host.
- Fake two-job call-count evidence: model SHA once, workflow SHA twice, original input SHA twice. A separate new cache forces another model SHA. These counts demonstrate removed repeat model reads; no real-GPU speed improvement is claimed.
- Related Vitest:5 files /44 tests passed, `--maxWorkers=2` (story CG/video assets, gallery catalog, act1 and chapter validation).
- Python compile:19 files. Final `tsc --noEmit`, changed-file ESLint and diff check passed.
- npm ci completed. Existing Node22.14 is below package engine minimum22.16 and npm emitted that warning; no tool upgrades or lockfile changes were made.

## Root actions after integration

Actual D: ledgers, models, Comfy/GPU, outputs and game exports were not touched during this implementation. Only temporary fake/CPU fixtures were approved/exported. The earlier art worktree's root-owned manifest remains unchanged.

Use `scripts/art/library/README.md` pair commands with the actual approved video job IDs and immutable control target root. Scene stems are independent of the generation job name. Latest root steering designates **scene-act1-ch02-victory** and **scene-act3-ch09-river-walk**; rain-veranda remains CG-only after two rejected motion candidates. No VIDEO_AVAILABLE additions are made here.

Root reported final approved source jobs/hashes: `sakura-victory-video-v1` / `1de205f3aba53951a17037e7e71accada48b686a33dfa42a7a44052e42ca661e`, and `elena-river-walk-video-v1` / `ad0700ebc0372aa99dea51aea267cf7dc2dcdb14e5b40863a3793e07c0ea4bff`. These actual sources were reviewed by root; this implementation session used synthetic CPU fixtures only. After integrating this commit, root can run from the control worktree:

```powershell
$artPython = 'C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe'
$artRoot = 'D:/AI-Image-Video/output/poker-doku-library/a1c2-20260905'
$artTarget = 'C:/code/claude/poker-doku/.worktrees/story-expansion-control'
& $artPython -B scripts/art/library-worker.py --root $artRoot export-video-pair sakura-victory-video-v1 --target-root $artTarget --stem public/assets/story/video/scene-act1-ch02-victory
& $artPython -B scripts/art/library-worker.py --root $artRoot export-video-pair elena-river-walk-video-v1 --target-root $artTarget --stem public/assets/story/video/scene-act3-ch09-river-walk
```

After both actual pairs return complete, root verifies106frames24fps768x1152, both files<=2.5MB, motion/loop quality and receipts; adds only those two availability IDs in its final asset commit; then checks desktop/mobile playback time advance, reduced-motion behavior and video-failure static-CG fallback in a real browser. Existing49 video pairs remain intact. The model cache's actual speed can be measured on the next separately authorized queue run.
