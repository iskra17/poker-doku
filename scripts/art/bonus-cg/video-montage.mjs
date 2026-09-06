// 캐릭터별 영상 검수 몽타주 — sheets/video/bonus-<id>-<scene>-video.jpg 5장을 세로로 쌓아 sheets/video-montage/<id>.jpg로 만든다.
// 사용: node scripts/art/bonus-cg/video-montage.mjs <staging-dir> [characterId ...]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ORDER = ['beach', 'gym', 'yoga', 'sing', 'casual'];
const ROW_W = 1200; // 6프레임 시트를 이 폭으로 축소
const [staging, ...only] = process.argv.slice(2);
if (!staging) { console.error('usage: video-montage.mjs <staging-dir> [characterId ...]'); process.exit(1); }
const sheetDir = path.join(staging, 'sheets', 'video');
const outDir = path.join(staging, 'sheets', 'video-montage');
await fs.mkdir(outDir, { recursive: true });
const files = await fs.readdir(sheetDir);
const ids = only.length > 0 ? only : [...new Set(files.map(f => f.match(/^bonus-([a-z]+)-/)?.[1]).filter(Boolean))];

for (const id of ids) {
  const rows = [];
  for (const scene of ORDER) {
    const file = path.join(sheetDir, `bonus-${id}-${scene}-video.jpg`);
    try { await fs.access(file); } catch { continue; }
    const buf = await sharp(file).resize({ width: ROW_W }).toBuffer();
    const meta = await sharp(buf).metadata();
    rows.push({ buf, h: meta.height });
  }
  if (rows.length === 0) { console.log(`${id}: no sheets`); continue; }
  const GAP = 6;
  const height = rows.reduce((s, r) => s + r.h, 0) + GAP * (rows.length - 1);
  let top = 0;
  const composite = rows.map(r => { const c = { input: r.buf, left: 0, top }; top += r.h + GAP; return c; });
  const dest = path.join(outDir, `${id}.jpg`);
  await sharp({ create: { width: ROW_W, height, channels: 3, background: '#141414' } }).composite(composite).jpeg({ quality: 84 }).toFile(dest);
  console.log(`${id}: ${rows.length} rows -> ${dest}`);
}
