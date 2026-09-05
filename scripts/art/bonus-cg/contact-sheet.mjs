// 보너스 CG 검수용 컨택트 시트 — 캐릭터별 out/<id>/*.png 5장을 가로로 이어 붙인 JPG를 만든다.
// 사용: node scripts/art/bonus-cg/contact-sheet.mjs <staging-dir> [characterId ...]
//   출력: <staging>/sheets/<id>-<n>.jpg (각 셀 384×576, 라벨 없음 — 파일명 순서 = beach, gym, yoga, sing, casual)
//   승인 판정은 원본 PNG를 열어 보고 한다. 시트는 후보 비교용이다.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ORDER = ['beach', 'gym', 'yoga', 'sing', 'casual'];
const CELL_W = 384, CELL_H = 576, GAP = 8;
const [staging, ...only] = process.argv.slice(2);
if (!staging) { console.error('usage: contact-sheet.mjs <staging-dir> [characterId ...]'); process.exit(1); }
const outRoot = path.join(staging, 'out');
const sheetDir = path.join(staging, 'sheets');
await fs.mkdir(sheetDir, { recursive: true });
const ids = only.length > 0 ? only : (await fs.readdir(outRoot, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);

for (const id of ids) {
  const cells = [];
  const present = [];
  for (const scene of ORDER) {
    const file = path.join(outRoot, id, `${scene}.png`);
    try { await fs.access(file); } catch { continue; }
    const buf = await sharp(file).resize(CELL_W, CELL_H, { fit: 'cover', position: 'attention' }).toBuffer();
    cells.push({ input: buf, left: present.length * (CELL_W + GAP), top: 0 });
    present.push(scene);
  }
  if (cells.length === 0) { console.log(`${id}: no images`); continue; }
  const width = present.length * CELL_W + (present.length - 1) * GAP;
  const dest = path.join(sheetDir, `${id}.jpg`);
  await sharp({ create: { width, height: CELL_H, channels: 3, background: '#141414' } })
    .composite(cells).jpeg({ quality: 86 }).toFile(dest);
  console.log(`${id}: ${present.join(', ')} -> ${dest}`);
}
