# Local art queue

This is an independent SQLite ledger for explicitly approved, fully clothed adult character scenes. It does not change the game database, invent scenes, approve outputs automatically, or call an LLM. Pillow handles images; ffmpeg/ffprobe handle videos. SQLite, HTTP and OS locking use Python's standard library. The portable Comfy Python includes Pillow.

## Commands

Run from the art worktree in PowerShell:

```powershell
$artPython = 'C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe'
$artRoot = 'D:/AI-Image-Video/output/poker-doku-library/a1c2-20260905'
& $artPython -B scripts/art/library-worker.py --root $artRoot init --target-root 'C:/code/claude/poker-doku/.worktrees/story-expansion-control'
& $artPython -B scripts/art/library-worker.py --root $artRoot import scripts/art/library/recipes/a1c2-20260905.manifest.json
& $artPython -B scripts/art/library-worker.py --root $artRoot status
# Only after the root operator hands over the GPU:
& $artPython -B scripts/art/library-worker.py --root $artRoot run --limit 4
# Normal process exit, inspect status, then start a fresh process:
& $artPython -B scripts/art/library-worker.py --root $artRoot run --limit 8
& $artPython -B scripts/art/library-worker.py --root $artRoot sheet
```

`run --watch` waits for pending work; `--limit N` caps new submissions in that process. Without either option, run submits at most one job. Existing attempts are reconciled before a new submission, including when the limit is reached. `--max-wait` defaults to 900 seconds per continuously active interval; expiration exits with the attempt still submitted, without an interrupt or retry. A lost network connection also exits conservatively. Rerun/reconcile to inspect durable evidence.

`pause` commits immediately while a worker is waiting. The worker finishes its current attempt and stops submitting. A non-watch run then exits; a watch run waits. `resume` permits subsequent work. Neither command calls Comfy interrupt or modifies its queue.

```powershell
& $artPython -B scripts/art/library-worker.py --root $artRoot pause
& $artPython -B scripts/art/library-worker.py --root $artRoot resume
& $artPython -B scripts/art/library-worker.py --root $artRoot reconcile
# Only after investigating the exact unknown attempt:
& $artPython -B scripts/art/library-worker.py --root $artRoot reconcile --mark-failed '<intent>' --reason 'Evidence that this attempt is no longer executing'
& $artPython -B scripts/art/library-worker.py --root $artRoot reconcile --retry '<job-id>' --reason 'Explicit bounded retry'
```

No automatic retry exists. Unknown blocks its own job. With an empty Comfy queue, other pending jobs may continue. Every job has an absolute ceiling of three submitted attempts; additional art generation still needs scene/batch authorization. Failed preflight has no submitted attempt. Rejected visual quality is separate from generation failure and does not enable retry.

## Review and export

`sheet` writes JPEG contact pages and HTML links to full results, displaying scene axes and failures. Review originals, full images, identity/style, composition/gaze/expression, hand/object contact, and duplicate scenes. Contact sheets alone are not approval. `status` exposes the SHA256 needed for the explicit review command:

```powershell
& $artPython -B scripts/art/library-worker.py --root $artRoot review '<job-id>' approved --sha256 '<reviewed-output-sha256>' --reason 'Full-resolution identity, intent and anatomy review'
& $artPython -B scripts/art/library-worker.py --root $artRoot review '<job-id>' rejected --sha256 '<reviewed-output-sha256>' --reason 'Specific failure'
# Separate operator action after review and export authorization:
& $artPython -B scripts/art/library-worker.py --root $artRoot export '<job-id>' --target-root 'C:/code/claude/poker-doku/.worktrees/story-expansion-control' --path 'public/assets/story/cg/<new-name>.webp'
```

Approval records bind exact output bytes. Export rechecks the latest approval, source hash and decode, then calls that target repository's existing `convert.mjs cg` (768x1152, attention crop, WebP quality82). Video uses H264 CRF26 and faststart. New exports are staged and verified before atomic no-overwrite publication. A durable receipt makes a repeated identical export a no-op and recovers a crash between publication and receipt completion. Existing assets, changed exports, different worktrees, traversal and collisions are rejected. An unrecorded conversion leftover is deliberately not adopted; inspect it before manually removing that specific staging file. No command connects exported files to a game gallery or chapter.

## Recipe and recovery contracts

Recipes contain a version, explicit general-art queue approval, SHA256 workflow/models, reviewed node classes, bindings for prompt/seed/input/output, output node/collection, and exact media dimensions. IDs are in the recipe binding map, never the worker. The approved Qwen graph is copied byte-for-byte from the successful A1c graph. Model revisions, canonical references and fixed seeds are in the manifest/recipe. Import checks all file hashes. Each worker fully hashes a model on first use and caches only its resolved path, expected SHA and stat dev/ino/size/mtime_ns/ctime_ns signature; a changed signature forces another full hash. This cache is never persisted. Workflows, canonical sources and image inputs are still hashed for every job. Inputs are copied under content-addressed names without changing their originals.

The SQLite transaction commits `submitting` and a unique intent before any POST. Requests carry matching `extra_data.poker_doku_art`, `extra_data.extra_pnginfo.poker_doku_art`, and intent/attempt/full-recipe-hash filename prefixes. Queue/history tuple index3 is extra_data in the installed Comfy source. SaveImage serializes extra_pnginfo into PNG text. Output path, full decode, dimensions, metadata and SHA256 are checked before `generated`. If history disappears, the same checks recover one unambiguous prefixed file. Missing evidence and duplicate intent outputs remain unknown.

`run`/`reconcile` hold the fixed `D:/AI-Image-Video/.poker-doku-gpu.lock` OS lock across all databases and endpoint aliases. Comfy must expose input/output CLI paths matching the initialized ledger and must not disable metadata. An external queue prevents a new submission; this lock cannot prevent unrelated programs from submitting directly. No Comfy node, model, service or configuration is installed or altered by this worker. CPU exports use a separate fixed OS lock. SQLite write transactions never span model hashing, HTTP waits or media conversion.

Video jobs use the same queue and declare `kind: video`, approved image `parent_job`, the parent's exact output hash as an input, dimensions/frame/duration constraints, and a metadata-preserving saver. ffprobe validates stream/frame data and embedded intent tags (or a JSON comment), followed by full ffmpeg decoding. Existing H3 can be bound as a separately reviewed video recipe; no H3 generation or video quality claim is included in this image batch.

## H3 video pair export

The separate pair command preserves the existing single-file export command. Only an exact-byte approved, fully decoded 107-frame / 24fps / 768x1152 video is accepted. It trims the final frame and makes 106 frames (4.4167 seconds), MP4 H264 CRF26 medium / faststart and WebM VP9 CRF32 cpu-used4, both yuv420p. Each file must decode fully, match codec/fps/dimensions/frame count and remain <=2,500,000 bytes. Oversized outputs fail; there is no silent quality reduction or automatic regeneration.

```powershell
# Only root performs actual exports after integration and full-motion approval.
& $artPython -B scripts/art/library-worker.py --root '<approved-video-ledger-root>' export-video-pair '<approved-video-job-id>' --target-root 'C:/code/claude/poker-doku/.worktrees/story-expansion-control' --stem 'public/assets/story/video/scene-act1-ch02-victory'
& $artPython -B scripts/art/library-worker.py --root '<approved-video-ledger-root>' export-video-pair '<approved-elena-video-job-id>' --target-root 'C:/code/claude/poker-doku/.worktrees/story-expansion-control' --stem 'public/assets/story/video/scene-act3-ch09-river-walk'
```

The first explicit pair export adds two tables to the art ledger: `video_pairs` and `video_pair_targets`. A pair receipt binds job/source hash, settings hash and both target paths before conversion. Both conversions are validated and recorded before either is published. Each publication uses a no-overwrite hard link on the target volume. After a crash, rerun the same command: an already published matching part is preserved, a missing part is published from verified staging, and only that receipt's pending names are cleaned. Changed source, approval/rejection, staging, published bytes or target collisions stop recovery. A preparing receipt owns its exact conversion staging names and may rebuild them if conversion was interrupted. Single-file exports cannot claim paths reserved by a pair.

The command never edits `VIDEO_AVAILABLE`. Root must wait for the returned `state: complete`, inspect both real clips and their full loop, then register those two scene IDs in a separate asset commit. Until then the new CGs remain static. Existing 49 videos are untouched.

## Tests

```powershell
& $artPython -B -m unittest discover -s scripts/art/library/tests -v
```

Tests launch only a local CPU fake Comfy HTTP process on a random port. They use temporary databases, references, locks and game-export roots, including fixture approvals. Process death is injected only by a test child script. Production CLI has no lock override or crash injection. The fake queue/history layout and PNG metadata mirror installed Comfy source. Real GPU completion and eight accepted distinct scenes are separate handoff gates.


## External GPT Image 2 source receipts

Use `import-external-image` for an already produced, fully clothed adult general-art PNG. This command does not generate images, contact Comfy, create a generation attempt, or approve the result. It records an explicit `external-image` recipe/spec with provider `gpt-image-2`, preserves the PNG bytes and provenance document in immutable copies under the job root, and starts at `generated` with no reviews. The legacy job seed column contains zero only because it is NOT NULL; the receipt records `seed: null` and `seed_status: not-applicable`.

Create one JSON document per approved scene intent (paths resolve relative to this document):

```json
{
  "version": 1,
  "scope": "general",
  "source_type": "external-image",
  "provider": "gpt-image-2",
  "id": "sakura-library-v2",
  "character": "sakura",
  "scene": "library",
  "target_root": "C:/code/claude/poker-doku/.worktrees/story-expansion-control",
  "source": {"path": "source.png", "sha256": "<exact lowercase SHA256>"},
  "provenance": {"path": "provenance.md", "sha256": "<exact lowercase SHA256>"},
  "prompt": "The actual approved general scene generation prompt",
  "angle": "profile",
  "gaze": "book",
  "expression": "happy",
  "outfit": "cream cardigan"
}
```

The provenance document should contain the generation tool/provider, actual prompt, reference paths/hashes and tool/output identifiers available to the operator. Import validates the supplied provider declaration and exact document bytes; it does not independently attest the provider. Keep that document and the source PNG unchanged and available: review, repeated import and video-parent checks verify both originals and their copies. No PNG metadata is added or rewritten. The immutable spec and `external-images/<id>--<spec_hash>/receipt.json` are the source receipt, distinct from Comfy intent metadata.

```powershell
& $artPython -B scripts/art/library-worker.py --root $artRoot import-external-image '<external-source.json>'
# Existing exact-byte review is still mandatory after inspecting the complete PNG:
& $artPython -B scripts/art/library-worker.py --root $artRoot review 'sakura-library-v2' approved --sha256 '<source SHA256>' --reason 'Full-resolution scene, identity and anatomy review'
```

Use that job ID as `parent_job` in the existing approved H3 video manifest. Its parent input must use the returned `output` path and `output_hash`. Video import/preflight still requires the latest approved review and unchanged parent/provenance bytes. Video recipe, model verification, metadata and export rules are unchanged. An external source cannot execute as a Comfy recipe, including if mistakenly put in pending state. Reimport of the identical receipt is idempotent and preserves any review; a changed ID specification, source, provenance, target root or copied artifact is rejected. Imported files are never game exports.

Registration holds a separate per-ledger CPU lock and uses a short SQLite transaction after copy/decode verification. Existing staging is never overwritten. If a process stops after copying but before committing its job, the next registration reports an unrecorded staging collision; investigate that exact folder before any cleanup. Registration does not adopt or remove unrecorded files automatically.
