// 零依赖 PNG 生成器。生成 PWA 所需的两个尺寸的图标。
// 用法：npm run icons

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const BG = [10, 10, 10];
const FG = [255, 45, 45];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // 每行开头的 filter type
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y, size);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 图案全部落在中心 80% 的 maskable 安全区内，被裁成圆形也不会缺角
function isInk(x, y, size) {
  const cx = size / 2;
  const cy = size * 0.55;
  const radius = size * 0.28;
  const ring = size * 0.055;

  if (Math.abs(Math.hypot(x - cx, y - cy) - radius) < ring / 2) return true;

  const btnW = size * 0.13;
  const btnH = size * 0.075;
  const btnTop = cy - radius - ring / 2 - btnH;
  return Math.abs(x - cx) < btnW / 2 && y >= btnTop && y <= btnTop + btnH;
}

// 3x3 超采样做抗锯齿，否则圆环边缘锯齿很明显
function pixelAt(x, y, size) {
  const S = 3;
  let hits = 0;
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      if (isInk(x + (sx + 0.5) / S, y + (sy + 0.5) / S, size)) hits++;
    }
  }
  const t = hits / (S * S);
  return [
    Math.round(BG[0] + (FG[0] - BG[0]) * t),
    Math.round(BG[1] + (FG[1] - BG[1]) * t),
    Math.round(BG[2] + (FG[2] - BG[2]) * t),
  ];
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, pixelAt));
  console.log(`wrote ${file}`);
}
