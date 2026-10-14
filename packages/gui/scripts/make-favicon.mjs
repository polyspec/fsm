#!/usr/bin/env node
// Writes public/favicon.ico (docs/plans/fsm-v1.md, C-7; docs/plans/execution-checklist.md, S-22-2): the icon that browsers request
// at /favicon.ico. It is one 16x16 image of 32 bits per pixel in the ICO format, a filled circle of the accent color on a transparent
// background. The file is committed; run this script again only to change the icon:
//   node scripts/make-favicon.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 16;
const ACCENT = [0x25, 0x63, 0xeb];
const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The pixels of the XOR mask, bottom row first (BMP order), in blue, green, red, alpha.
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const dx = x + 0.5 - SIZE / 2;
    const dy = y + 0.5 - SIZE / 2;
    if (dx * dx + dy * dy > (SIZE / 2 - 1) ** 2) continue;
    const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
    pixels[offset] = ACCENT[2];
    pixels[offset + 1] = ACCENT[1];
    pixels[offset + 2] = ACCENT[0];
    pixels[offset + 3] = 0xff;
  }
}
// The AND mask holds one bit per pixel, each row padded to 32 bits; the alpha channel decides the visible pixels, so it is clear.
const mask = Buffer.alloc(SIZE * 4);

// The BITMAPINFOHEADER of the image: its height is the XOR and the AND mask together.
const info = Buffer.alloc(40);
info.writeUInt32LE(40, 0);
info.writeInt32LE(SIZE, 4);
info.writeInt32LE(SIZE * 2, 8);
info.writeUInt16LE(1, 12);
info.writeUInt16LE(32, 14);
info.writeUInt32LE(pixels.length + mask.length, 20);
const image = Buffer.concat([info, pixels, mask]);

// The ICONDIR (type 1, one image) and its ICONDIRENTRY, whose image starts after the 22 bytes of both.
const header = Buffer.from([0, 0, 1, 0, 1, 0]);
const entry = Buffer.alloc(16);
entry[0] = SIZE;
entry[1] = SIZE;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(image.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);

writeFileSync(path.join(GUI, 'public', 'favicon.ico'), Buffer.concat([header, entry, image]));
console.log(`public/favicon.ico: ${header.length + entry.length + image.length} bytes`);
