#!/usr/bin/env node
/**
 * 캐릭터 키트 러너 — 턴어라운드(정면/3⁄4/측면/후면)를 레퍼런스로 붙여 같은 캐릭터의 새 의상·포즈를 만든다.
 *
 *   node scripts/art/character-kit/run.mjs <job.json> [--dry-run]
 *
 * 하는 일 (리포 밖 ART_ROOT, 기본 C:/code/claude/poker-doku-art):
 *   1. ART_ROOT/characters/<id>/jobs/<jobId>/ 에 스테이징(ref·out·logs·codex-home)을 만든다.
 *   2. characters.json의 디자인 스펙 + job의 샷 목록으로 프롬프트를 조립하고, 레퍼런스를 `-i`로 첨부한다.
 *   3. `codex exec -m <model> --sandbox workspace-write -` (프롬프트는 stdin) 를 격리 CODEX_HOME으로 실행한다.
 *      (전역 ~/.codex의 훅·스킬이 exec를 멈추게 하는 문제 회피 — reference_codex-image-gen 메모)
 *   4. 저장이 정책으로 막혀도 로그의 "exec-*.png → ./out/..." 매핑으로 generated_images에서 회수한다.
 *   5. 접촉 시트(contact.png)를 만든다. 게임 반영은 사람이 검수한 뒤 convert.mjs로 한다.
 *
 * 모델은 CHARACTER_KIT_MODEL(기본 gpt-5.6-sol). 그림 자체는 Codex 내장 image_gen이 그린다.
 */
import { spawn } from 'node:child_process';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART_ROOT = process.env.ART_ROOT ?? 'C:/code/claude/poker-doku-art';
const MODEL = process.env.CHARACTER_KIT_MODEL ?? 'gpt-5.6-sol';

const FRAMING = {
  bust: 'square 1024x1024 bust-up portrait framed like the bust reference (top of head near the top edge, cut around mid-chest), character centered',
  fullbody: 'portrait 1024x1536 FULL BODY head to toe including shoes, flat orthographic-like camera at chest height, same height and proportions as the turnaround references',
  cg: 'portrait 1024x1536 illustrated scene with a soft painted background (no chroma key for this shot)',
};

const HEADER = [
  'IMPORTANT: Non-interactive session. NEVER ask questions or offer options (no visual companion). Proceed text-only and generate immediately.',
  'You are producing game art for an anime visual-novel poker game. The attached images are the CHARACTER REFERENCES — study them first and replicate the EXACT same character design (face, hairstyle, hair color, eye color, accessories, body proportions).',
].join('\n');

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/art/character-kit/run.mjs <job.json> [--dry-run]');
  process.exit(1);
}

function buildPrompt(character, job) {
  const lines = [HEADER, ''];
  lines.push(`Character design (never change): ${character.design}.`);
  lines.push(`Art style (match exactly): ${character.style}.`);
  if (job.kind === 'outfit') {
    lines.push(`OUTFIT CHANGE: dress her in this new outfit "${job.outfitId}": ${job.outfit}. Change ONLY the clothing; hair, face, eyes, hair clip and proportions stay identical to the references.`);
  } else {
    lines.push(`Outfit (keep identical to the references): ${job.outfit ?? character.defaultOutfit}.`);
  }
  lines.push('');
  lines.push('For every shot that is not a CG: use the built-in chroma-key workflow with a perfectly flat #00ff00 background, do NOT switch to a CLI fallback, and do not use #00ff00 anywhere in the character. No text, labels, speech bubbles or effects unless the shot asks for them.');
  lines.push('');
  lines.push(`Generate these ${job.shots.length} images (one image each) and save them:`);
  job.shots.forEach((shot, index) => {
    const framing = FRAMING[shot.framing];
    if (!framing) throw new Error(`unknown framing "${shot.framing}" in shot ${shot.out}`);
    lines.push(`${index + 1}. ./out/${shot.out} — framing: ${framing}. ${shot.direction}`);
  });
  lines.push('');
  lines.push('After generating, verify the files exist and print their sizes. If saving is blocked, just print the mapping of generated image files to target paths (exact file names, one per line, "<generated file> → <target path>") and finish.');
  return lines.join('\n');
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function runCodex({ stage, codexHome, prompt, refs, logFile }) {
  return new Promise((resolve, reject) => {
    const args = ['exec', '-m', MODEL, '--skip-git-repo-check', '--sandbox', 'workspace-write'];
    for (const ref of refs) args.push('-i', ref);
    args.push('-');
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'codex.cmd' : 'codex', args, {
      cwd: stage,
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWin, // .cmd 실행에 필요 — 인자는 경로·플래그뿐이고 프롬프트는 stdin으로 보낸다
    });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', async code => {
      await fs.writeFile(logFile, Buffer.concat(chunks));
      resolve(code ?? 1);
    });
    child.stdin.end(prompt);
  });
}

/** 저장이 막혔을 때: 로그의 "<generated>.png → ./out/<path>" 매핑으로 generated_images에서 복사 */
async function recover(stage, codexHome, job, logText) {
  const genRoot = path.join(codexHome, 'generated_images');
  const sessions = await fs.readdir(genRoot).catch(() => []);
  const findGenerated = async name => {
    for (const session of sessions) {
      const candidate = path.join(genRoot, session, name);
      if (await exists(candidate)) return candidate;
    }
    return null;
  };
  const report = [];
  for (const shot of job.shots) {
    const dest = path.join(stage, 'out', shot.out);
    if (await exists(dest)) { report.push(`saved     ${shot.out}`); continue; }
    const escaped = shot.out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = logText.match(new RegExp(`([\\w-]+\\.png)\\W*(?:→|->)\\W*\\.?/?out/${escaped}`));
    const source = match ? await findGenerated(match[1]) : null;
    if (!source) { report.push(`MISSING   ${shot.out}`); continue; }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(source, dest);
    report.push(`recovered ${shot.out} <- ${match[1]}`);
  }
  return report;
}

async function contactSheet(stage, job) {
  const tile = 256;
  const files = [];
  for (const shot of job.shots) {
    const file = path.join(stage, 'out', shot.out);
    if (await exists(file)) files.push(file);
  }
  if (files.length === 0) return null;
  const tiles = await Promise.all(files.map(file => sharp(file)
    .resize(tile, Math.round(tile * 1.5), { fit: 'contain', background: '#808080' }).png().toBuffer()));
  const out = path.join(stage, 'contact.png');
  await sharp({ create: { width: tile * files.length, height: Math.round(tile * 1.5), channels: 4, background: '#808080' } })
    .composite(tiles.map((input, i) => ({ input, left: i * tile, top: 0 })))
    .png()
    .toFile(out);
  return out;
}

async function main() {
  const [jobPath, flag] = process.argv.slice(2);
  if (!jobPath) usage();
  const job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
  const characters = JSON.parse(readFileSync(path.join(HERE, 'characters.json'), 'utf8'));
  const character = characters[job.character];
  if (!character) usage(`unknown character "${job.character}" — add it to characters.json`);
  if (!Array.isArray(job.shots) || job.shots.length === 0) usage('job.shots is empty');

  const charRoot = path.join(ART_ROOT, 'characters', job.character);
  const stage = path.join(charRoot, 'jobs', job.id);
  const codexHome = path.join(stage, 'codex-home');
  await fs.mkdir(path.join(stage, 'out'), { recursive: true });
  await fs.mkdir(path.join(stage, 'logs'), { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });

  const refKeys = job.references ?? ['bust', 'front', 'threeQuarter', 'back'];
  const refs = [];
  for (const key of refKeys) {
    const rel = character.references[key];
    const file = rel && path.join(charRoot, rel);
    if (!file || !(await exists(file))) usage(`missing reference "${key}" (${file}) — generate the turnaround first`);
    refs.push(file);
  }

  const prompt = buildPrompt(character, job);
  await fs.writeFile(path.join(stage, 'prompt.txt'), prompt);
  if (flag === '--dry-run') {
    console.log(prompt);
    console.log(`\nrefs:\n${refs.join('\n')}\nstage: ${stage}`);
    return;
  }

  const auth = path.join(os.homedir(), '.codex', 'auth.json');
  if (!(await exists(auth))) usage(`codex auth not found: ${auth} — run "codex login" first`);
  await fs.copyFile(auth, path.join(codexHome, 'auth.json'));

  const logFile = path.join(stage, 'logs', `run-${Date.now()}.log`);
  console.log(`running codex (${MODEL}) for ${job.shots.length} shot(s)… stage: ${stage}`);
  const code = await runCodex({ stage, codexHome, prompt, refs, logFile });
  const logText = await fs.readFile(logFile, 'utf8');
  const report = await recover(stage, codexHome, job, logText);
  console.log(report.join('\n'));
  const sheet = await contactSheet(stage, job);
  if (sheet) console.log(`contact sheet: ${sheet}`);
  console.log(`codex exit ${code}, log: ${logFile}`);
  if (report.some(line => line.startsWith('MISSING'))) process.exitCode = 2;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
