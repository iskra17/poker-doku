#!/usr/bin/env node
/**
 * 아트 후처리 — gpt-image-2 원본 PNG → 서빙 규격 webp (2막 이후 재사용).
 *
 *   node scripts/art/convert.mjs bg   <in.png> <out.webp>      # 1280 폭 q80 (배경)
 *   node scripts/art/convert.mjs cg   <in.png> <out.webp>      # 768×1152 cover q82 (이벤트 CG)
 *   node scripts/art/convert.mjs bust <in.png> <out.webp>      # #00ff00 크로마키 → 알파, 정사각 512 q82 (버스트업)
 *   node scripts/art/convert.mjs check <file.webp|png>         # 코너 알파·그린 프린지 검사
 *
 * 크로마키는 "밝은 초록(G 우세)" 픽셀을 투명 처리하고 경계는 부분 알파로 부드럽게 한다.
 * 컨벤션: 카드/칩/버튼은 SVG — 이 스크립트는 캐릭터·배경·CG 전용.
 */
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

const [mode, input, output] = process.argv.slice(2);

async function toBg(src, dst) {
  await sharp(src).resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 80 }).toFile(dst);
}

async function toCg(src, dst) {
  await sharp(src).resize(768, 1152, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toFile(dst);
}

/** #00ff00 크로마키 제거 — G가 R·B보다 충분히 크면 투명, 경계는 거리 비례 알파 */
async function chromaKey(src) {
  const image = sharp(src).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i], g = out[i + 1], b = out[i + 2];
    const dominance = g - Math.max(r, b); // 순수 #00ff00 = 255
    if (dominance > 140) {
      out[i + 3] = 0;
    } else if (dominance > 60) {
      // 경계: 초록 우세도에 비례해 반투명 + 초록 스필 제거
      const keep = 1 - (dominance - 60) / 80;
      out[i + 3] = Math.round(out[i + 3] * keep);
      out[i + 1] = Math.round(Math.max(r, b));
    }
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } });
}

async function toBust(src, dst) {
  const keyed = await chromaKey(src);
  const { width = 0, height = 0 } = await sharp(src).metadata();
  const side = Math.min(width, height);
  await keyed
    .extract({ left: Math.floor((width - side) / 2), top: 0, width: side, height: side })
    .resize(512, 512)
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(dst);
}

async function check(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  const corners = [px(0, 0), px(info.width - 1, 0), px(0, info.height - 1), px(info.width - 1, info.height - 1)];
  let greenFringe = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i + 1] - Math.max(data[i], data[i + 2]) > 110) greenFringe++;
  }
  console.log(JSON.stringify({ file: path.basename(file), size: `${info.width}x${info.height}`, cornerAlpha: corners.map(c => c[3]), greenFringePixels: greenFringe }));
}

async function main() {
  if (!mode || !input) {
    console.error('usage: convert.mjs <bg|cg|bust|check> <in> [out]');
    process.exit(2);
  }
  if (mode === 'check') return check(input);
  if (!output) throw new Error('output path required');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (mode === 'bg') await toBg(input, output);
  else if (mode === 'cg') await toCg(input, output);
  else if (mode === 'bust') await toBust(input, output);
  else throw new Error(`unknown mode ${mode}`);
  const meta = await sharp(output).metadata();
  console.log(`${output} ${meta.width}x${meta.height} ${fs.statSync(output).size}B`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
