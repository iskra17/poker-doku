// 보너스 CG 프롬프트 생성기 — 계획 JSON → 캐릭터별 codex exec 프롬프트(txt) + 참조 PNG 준비.
// 사용: node scripts/art/bonus-cg/build-prompts.mjs <staging-dir> [characterId | characterId:scene ...]
//   `id:scene`(예: sakura:beach)이면 그 장면 1장만 담은 재생성 프롬프트 prompts/<id>-<scene>.txt를 만든다.
//   staging-dir: 리포 밖 작업 폴더(예: C:/code/claude/poker-doku-art/bonus-cg). ref/·prompts/·out/·logs/를 만든다.
//   참조: 캐릭터 showcase.webp → ref/<id>-showcase.png, 스타일 벤치마크 v2 CG 2장 → ref/style-a.png, ref/style-b.png.
// 생성된 프롬프트는 run-wave.sh가 codex exec(gpt-image-2)에 넘긴다. 이 스크립트는 이미지를 만들지 않는다.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../..');
const PLAN = path.join(REPO, 'scripts/art/bonus-cg/bonus-cg-plan-2026-09-06.json');
const [staging, ...only] = process.argv.slice(2);
if (!staging) { console.error('usage: build-prompts.mjs <staging-dir> [characterId ...]'); process.exit(1); }

const plan = JSON.parse(await fs.readFile(PLAN, 'utf8'));
for (const dir of ['ref', 'prompts', 'out', 'logs']) await fs.mkdir(path.join(staging, dir), { recursive: true });

// 스타일 벤치마크 참조
for (const ref of plan.style_refs) {
  const dest = path.join(staging, ref.path);
  await sharp(path.join(REPO, ref.from)).png().toFile(dest);
}

const COMMON = [
  'IMPORTANT: Non-interactive session. NEVER ask questions or offer options (no visual companion, no clarification). Proceed text-only and generate immediately with the built-in image generation tool. Do not stop until every requested file exists on disk. If saving a file is blocked, print the mapping "call_x.png -> <target path>" for each image and finish.',
  '',
  'TASK: Create premium finished Japanese galge visual-novel EVENT CG illustrations (one character plus a fully painted environment in one image), portrait 1024x1536, opaque, no text/letters/logo/watermark/collage/split panels.',
  `CONTENT RULES: ${plan.content_rules}`,
  'QUALITY BENCHMARK: ./ref/style-a.png and ./ref/style-b.png are the required finish benchmark — delicate fine linework, translucent layered hair highlights, luminous nuanced skin, richly painted environment with foreground/midground/background depth, dimensional cinematic lighting connected to the figure, soft detailed fabric. Match this polished painted EVENT-CG finish, not a thick-outlined flat cartoon and not a chibi.',
  'CHARACTER CONSISTENCY: The character reference PNG is identity/wardrobe-base ONLY. FIRST open and study it and replicate the EXACT same face shape, eyes, hair color and hairstyle, skin tone, signature accessories and adult proportions. Only outfit, pose, expression and scene change as instructed. Do not copy the reference pose or its frontal composition.',
  'After generating, verify each output file exists at the exact path and print its size in bytes. Overwrite if it exists.',
  '',
].join('\n');

// 인자: `id`(캐릭터 전체 5장) 또는 `id:scene`(그 장면 1장만 — 재생성용 prompts/<id>-<scene>.txt)
const wanted = new Map(); // id -> Set(scene) | null(전체)
for (const arg of only) {
  const [id, scene] = arg.split(':');
  if (!wanted.has(id)) wanted.set(id, scene ? new Set([scene]) : null);
  else if (scene && wanted.get(id)) wanted.get(id).add(scene);
  else if (!scene) wanted.set(id, null);
}
const chosen = plan.characters.filter(c => only.length === 0 || wanted.has(c.id));
for (const c of chosen) {
  const sceneFilter = wanted.get(c.id) ?? null;
  const entries = Object.entries(c.scenes).filter(([sceneId]) => !sceneFilter || sceneFilter.has(sceneId));
  if (entries.length === 0) { console.log(`prompt: ${c.id} — no matching scene`); continue; }
  const src = path.join(REPO, 'public/assets/characters', c.id, 'showcase.webp');
  await sharp(src).png().toFile(path.join(staging, c.ref));
  await fs.mkdir(path.join(staging, 'out', c.id), { recursive: true });
  const lines = [COMMON];
  lines.push(`Reference: ./${c.ref} (${c.name_ko} — ${c.identity}, adult woman age ${c.age}). Study it first; keep her unmistakable face and hair in every image.`);
  lines.push('');
  lines.push(sceneFilter
    ? `Generate ${entries.length} EVENT CG illustration(s) of this SAME woman — a regeneration of a specific scene. Keep her identity exactly and use the described composition.`
    : `Generate 5 EVENT CG illustrations of this SAME woman. Each image is a different scene with a different outfit, camera angle and framing — vary the composition strongly between images (at most one image may look at the camera directly).`);
  lines.push('');
  let n = 1;
  for (const [sceneId, text] of entries) {
    const meta = plan.scenes[sceneId];
    lines.push(`IMAGE ${n} → save ./out/${c.id}/${sceneId}.png — [${meta.title_ko}] ${text} Camera: ${meta.camera}.`);
    n += 1;
  }
  const name = sceneFilter ? `${c.id}-${[...sceneFilter].join('-')}` : c.id;
  await fs.writeFile(path.join(staging, 'prompts', `${name}.txt`), lines.join('\n') + '\n', 'utf8');
  console.log(`prompt: ${name} (${entries.length} images)`);
}
