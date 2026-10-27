#!/usr/bin/env node
/**
 * The web app's icons, rendered from the Mac app's icon algorithm
 * (../Support/make-icon.swift, ported line for line): a planet almost
 * wholly in night, a thin cold crescent of day on its rim, in ordered-dither
 * pixels on a starfield. No dependencies: the PNGs are encoded here.
 *
 *     node scripts/make-icons.mjs        # writes public/icon-*.png, apple-touch-icon.png
 *
 * - icon-192.png, icon-512.png: the Mac's squircle with its margin and
 *   shadow (manifest "any": installed app windows, the macOS Dock).
 * - icon-maskable-512.png: the squircle's contents, full bleed; the planet
 *   sits well inside the maskable safe zone (a circle of 40% radius).
 * - apple-touch-icon.png (180): full bleed; iOS rounds the corners itself
 *   (any transparency would turn black on the Home Screen).
 * - icon-64.png: the favicon, the squircle.
 *
 * Everything is drawn in the Swift script's 1024-point space (CoreGraphics:
 * y up) and box-filtered down, so each size is the same picture.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const SIZE = 1024;
const INSET = 100;
const SIDE = 824;
const CORNER = 185;

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
/** Night to ice: the tones the dither mixes between. */
const PALETTE = [0x01070d, 0x0a2438, 0x23628a, 0x8fcbee, 0xf4fbff].map(hex);
const clamp = (v) => Math.min(Math.max(v, 0), 1);

/** 8 × 8 Bayer thresholds in 0…1. */
const BAYER = (() => {
  let m = [[0]];
  while (m.length < 8) {
    const n = m.length;
    const next = Array.from({ length: n * 2 }, () => new Array(n * 2).fill(0));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + n] = v + 2;
        next[y + n][x] = v + 3;
        next[y + n][x + n] = v + 1;
      }
    m = next;
  }
  return m.map((row) => row.map((v) => (v + 0.5) / 64));
})();

const U64 = (v) => BigInt.asUintN(64, v);
/** Deterministic hash noise in 0..<1 (the Swift's, in 64-bit wrapping arithmetic), so every build draws the same stars. */
function noise(x, y) {
  let h = U64(BigInt.asIntN(64, BigInt(Math.trunc(x * 73856093))) ^ BigInt.asIntN(64, BigInt(Math.trunc(y * 19349663))));
  h = U64(h * 0x9e3779b97f4a7c15n);
  h ^= h >> 29n;
  h = U64(h * 0xbf58476d1ce4e5b9n);
  h ^= h >> 32n;
  return Number(h % 10000n) / 10000;
}
function star(x, y) {
  const cx = Math.floor(x / 7);
  const cy = Math.floor(y / 7);
  return noise(cx, cy) < 0.006 ? 0.6 + 0.4 * noise(cy, cx) : 0;
}

// The planet, and the light from behind and to the upper right of it.
const CENTER = { x: 512, y: 512 };
const RADIUS = 270;
const LIGHT = (() => {
  const l = [0.82, 0.45, -0.22];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

function tone(x, y) {
  const dx = (x - CENTER.x) / RADIUS;
  const dy = (y - CENTER.y) / RADIUS;
  const d2 = dx * dx + dy * dy;
  if (d2 <= 1) {
    const lit = clamp(dx * LIGHT[0] + dy * LIGHT[1] + Math.sqrt(1 - d2) * LIGHT[2]);
    return 0.05 + 0.95 * Math.pow(lit, 1.25);
  }
  // Atmosphere: a glow off the rim, brightest on the lit side.
  const distance = Math.sqrt(d2) * RADIUS;
  const glow = Math.exp(-(distance - RADIUS) / (RADIUS * 0.22)) * (0.5 + (0.5 * (dx * LIGHT[0] + dy * LIGHT[1])) / Math.sqrt(d2));
  return clamp(0.06 + 0.5 * glow + star(x, y));
}

/** The dithered field over the squircle's square, in 6-point cells (CoreGraphics coordinates, y up). */
function field() {
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  const cell = 6;
  let row = 0;
  for (let y = INSET; y < INSET + SIDE; y += cell, row++) {
    let column = 0;
    for (let x = INSET; x < INSET + SIDE; x += cell, column++) {
      const p = tone(x + cell / 2, y + cell / 2) * (PALETTE.length - 1);
      const low = Math.min(Math.floor(p), PALETTE.length - 1);
      const up = p - low > BAYER[row % 8][column % 8] && low + 1 < PALETTE.length;
      const color = PALETTE[up ? low + 1 : low];
      for (let yy = y; yy < Math.min(y + cell, INSET + SIDE); yy++) {
        // Image rows run down; CoreGraphics' run up.
        const iy = SIZE - 1 - yy;
        for (let xx = x; xx < Math.min(x + cell, INSET + SIDE); xx++) rgb.set(color, (iy * SIZE + xx) * 3);
      }
    }
  }
  return rgb;
}

/** Coverage of the rounded rect (CGPath roundedRect) at a pixel, 4×4 supersampled. */
function coverage(px, py) {
  let inside = 0;
  for (let sy = 0; sy < 4; sy++)
    for (let sx = 0; sx < 4; sx++) {
      const x = px + (sx + 0.5) / 4;
      const y = py + (sy + 0.5) / 4;
      const cx = Math.min(Math.max(x, INSET + CORNER), INSET + SIDE - CORNER);
      const cy = Math.min(Math.max(y, INSET + CORNER), INSET + SIDE - CORNER);
      if ((x - cx) ** 2 + (y - cy) ** 2 <= CORNER ** 2 && x >= INSET && x <= INSET + SIDE && y >= INSET && y <= INSET + SIDE) inside++;
    }
  return inside / 16;
}

/** Three box blurs ≈ a Gaussian (the shadow's 24-point blur). */
function blur(alpha, radius) {
  let a = alpha;
  for (let pass = 0; pass < 3; pass++) {
    const h = new Float32Array(a.length);
    for (let y = 0; y < SIZE; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += a[y * SIZE + Math.min(Math.max(x, 0), SIZE - 1)];
      for (let x = 0; x < SIZE; x++) {
        h[y * SIZE + x] = sum / (2 * radius + 1);
        sum += a[y * SIZE + Math.min(x + radius + 1, SIZE - 1)] - a[y * SIZE + Math.max(x - radius, 0)];
      }
    }
    const v = new Float32Array(a.length);
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += h[Math.min(Math.max(y, 0), SIZE - 1) * SIZE + x];
      for (let y = 0; y < SIZE; y++) {
        v[y * SIZE + x] = sum / (2 * radius + 1);
        sum += h[Math.min(y + radius + 1, SIZE - 1) * SIZE + x] - h[Math.max(y - radius, 0) * SIZE + x];
      }
    }
    a = v;
  }
  return a;
}

/** The Mac icon: shadowed squircle on transparency, premultiplied RGBA floats (0…1). */
function squircle(rgb) {
  const out = new Float32Array(SIZE * SIZE * 4);
  const mask = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) mask[y * SIZE + x] = coverage(x, SIZE - 1 - y);
  // The shadow: 10 points down, blurred, black at 30%.
  const shifted = new Float32Array(SIZE * SIZE);
  for (let y = 10; y < SIZE; y++) for (let x = 0; x < SIZE; x++) shifted[y * SIZE + x] = mask[(y - 10) * SIZE + x];
  const shadow = blur(shifted, 11);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const m = mask[i];
    const s = shadow[i] * 0.3 * (1 - m);
    out[i * 4] = (rgb[i * 3] / 255) * m;
    out[i * 4 + 1] = (rgb[i * 3 + 1] / 255) * m;
    out[i * 4 + 2] = (rgb[i * 3 + 2] / 255) * m;
    out[i * 4 + 3] = m + s;
  }
  return { data: out, x: 0, y: 0, side: SIZE };
}

/** The squircle's contents, full bleed (no margin, corners or shadow). */
function fullBleed(rgb) {
  const out = new Float32Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    out[i * 4] = rgb[i * 3] / 255;
    out[i * 4 + 1] = rgb[i * 3 + 1] / 255;
    out[i * 4 + 2] = rgb[i * 3 + 2] / 255;
    out[i * 4 + 3] = 1;
  }
  return { data: out, x: INSET, y: INSET, side: SIDE };
}

/** Area-averaged resample of a square region to `size` × `size`, unpremultiplied to 8-bit RGBA. */
function resample({ data, x: ox, y: oy, side }, size) {
  const out = new Uint8Array(size * size * 4);
  const scale = side / size;
  for (let ty = 0; ty < size; ty++)
    for (let tx = 0; tx < size; tx++) {
      const x0 = ox + tx * scale;
      const y0 = oy + ty * scale;
      const acc = [0, 0, 0, 0];
      let total = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y0 + scale); sy++) {
        const wy = Math.min(sy + 1, y0 + scale) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x0 + scale); sx++) {
          const wx = Math.min(sx + 1, x0 + scale) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * SIZE + sx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += data[i + c] * w;
          total += w;
        }
      }
      const a = acc[3] / total;
      const o = (ty * size + tx) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = a > 0 ? Math.round(Math.min(acc[c] / total / a, 1) * 255) : 0;
      out[o + 3] = Math.round(a * 255);
    }
  return out;
}

// MARK: - PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(rgba, size, opaque) {
  const channels = opaque ? 3 : 4;
  const raw = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * channels + 1)] = 0;
    for (let x = 0; x < size; x++)
      for (let c = 0; c < channels; c++) raw[y * (size * channels + 1) + 1 + x * channels + c] = rgba[(y * size + x) * 4 + c];
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const rgb = field();
const mac = squircle(rgb);
const bleed = fullBleed(rgb);
const outputs = [
  ["icon-64.png", mac, 64, false],
  ["icon-192.png", mac, 192, false],
  ["icon-512.png", mac, 512, false],
  ["icon-maskable-512.png", bleed, 512, true],
  ["apple-touch-icon.png", bleed, 180, true],
];
for (const [name, source, size, opaque] of outputs) {
  writeFileSync(join(OUT, name), png(resample(source, size), size, opaque));
  console.log(`wrote public/${name} (${size}×${size})`);
}
