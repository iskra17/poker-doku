// codex 로그에서 "call_xxx.png -> ./out/<id>/<scene>.png" 매핑을 읽어, 워크스페이스 저장이 막혔던 이미지를
// codex-home/generated_images/<session>/call_xxx.png에서 out/ 경로로 회수한다(이미 있으면 건너뜀).
// 사용: node scripts/art/bonus-cg/collect-outputs.mjs <staging-dir> <codex-home-dir> [wave-tag]
import { promises as fs } from 'node:fs';
import path from 'node:path';

const [staging, codexHome, wave] = process.argv.slice(2);
if (!staging || !codexHome) { console.error('usage: collect-outputs.mjs <staging-dir> <codex-home-dir> [wave-tag]'); process.exit(1); }
const logDir = path.join(staging, 'logs');
const genRoot = path.join(codexHome, 'generated_images');

async function findCall(name) {
  const sessions = await fs.readdir(genRoot, { withFileTypes: true }).catch(() => []);
  for (const s of sessions) {
    if (!s.isDirectory()) continue;
    const candidate = path.join(genRoot, s.name, name);
    try { await fs.access(candidate); return candidate; } catch { /* next */ }
  }
  return null;
}

const logs = (await fs.readdir(logDir)).filter(f => f.endsWith('.log') && (!wave || f.endsWith(`-${wave}.log`)));
const pattern = /(call_[A-Za-z0-9_-]+\.png)[^\n]*?(?:->|→|:)\s*[^\n]*?out[\\/]([a-z]+)[\\/]([a-z]+)\.png/g;
let copied = 0, present = 0, missing = 0;
for (const log of logs) {
  const text = await fs.readFile(path.join(logDir, log), 'utf8');
  const seen = new Set();
  for (const m of text.matchAll(pattern)) {
    const [, call, id, scene] = m;
    const key = `${id}/${scene}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dest = path.join(staging, 'out', id, `${scene}.png`);
    try { await fs.access(dest); present++; continue; } catch { /* copy */ }
    const src = await findCall(call);
    if (!src) { console.log(`missing source for ${key}: ${call}`); missing++; continue; }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    copied++;
    console.log(`recovered ${key} <- ${path.basename(path.dirname(src))}/${call}`);
  }
}
console.log(`done: copied=${copied} already=${present} missing=${missing}`);
