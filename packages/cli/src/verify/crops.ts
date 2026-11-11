import type { Box } from '../../../core/src/model';
import type { Image } from './png';

// Small "Figma | your app" pictures per finding: an agent that can read images sees the problem instead of decoding numbers.

const PAD = 16;
const MAX_SIDE_W = 480;
const MAX_H = 360;
const GAP = 8;
const FIGMA_RGB = [0, 170, 60];
const APP_RGB = [230, 0, 0];

function cut(img: Image, b: Box): Image {
  const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(img.width, Math.ceil(b.x + b.width)), y1 = Math.min(img.height, Math.ceil(b.y + b.height));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const data = new Uint8Array(w * h * 4).fill(255);
  for (let y = 0; y < h && y0 + y < img.height; y++)
    for (let x = 0; x < w && x0 + x < img.width; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4, o = (y * w + x) * 4, a = img.data[i + 3]! / 255;
      // Over white, like the diff, so transparent Figma areas do not turn black.
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(img.data[i + c]! * a + 255 * (1 - a));
      data[o + 3] = 255;
    }
  return { width: w, height: h, data };
}

// Integer box downscale keeps text legible enough and needs no resampling library.
function shrink(img: Image, f: number): Image {
  if (f <= 1) return img;
  const w = Math.max(1, Math.floor(img.width / f)), h = Math.max(1, Math.floor(img.height / f));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = [0, 0, 0];
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const i = ((y * f + dy) * img.width + x * f + dx) * 4; for (let c = 0; c < 3; c++) s[c]! += img.data[i + c]!; }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = s[c]! / (f * f);
      data[o + 3] = 255;
    }
  return { width: w, height: h, data };
}

// Nearest-neighbour upscale: a 12px icon moved 2px must be visible, and blurring would hide it.
function grow(img: Image, f: number): Image {
  if (f <= 1) return img;
  const w = img.width * f, h = img.height * f, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(img.data.subarray(((Math.floor(y / f) * img.width) + Math.floor(x / f)) * 4, ((Math.floor(y / f) * img.width) + Math.floor(x / f)) * 4 + 4), (y * w + x) * 4);
  return { width: w, height: h, data };
}
const MIN_SIDE_W = 160;
const MAX_GROW = 4;

function outline(img: Image, b: Box, rgb: number[]) {
  const put = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < img.width && y < img.height) img.data.set([...rgb, 255], (y * img.width + x) * 4); };
  const x0 = Math.round(b.x), y0 = Math.round(b.y), x1 = Math.round(b.x + b.width), y1 = Math.round(b.y + b.height);
  for (let t = 0; t < 2; t++) {
    for (let x = x0 - t; x <= x1 + t; x++) { put(x, y0 - t); put(x, y1 + t); }
    for (let y = y0 - t; y <= y1 + t; y++) { put(x0 - t, y); put(x1 + t, y); }
  }
}

/** Figma (left, green outline) and app (right, red outline) around one layer, scaled to a small, readable size. */
export function cropPair(figma: Image, app: Image, expected: Box, actual: Box = expected): Image {
  const area = (b: Box) => ({ x: b.x - PAD, y: b.y - PAD, width: b.width + 2 * PAD, height: b.height + 2 * PAD });
  // One window covering both boxes, so a moved layer stays visible on both sides at the same place.
  const x = Math.min(expected.x, actual.x), y = Math.min(expected.y, actual.y);
  const win = area({ x, y, width: Math.max(expected.x + expected.width, actual.x + actual.width) - x, height: Math.max(expected.y + expected.height, actual.y + actual.height) - y });
  const f = Math.max(1, Math.ceil(Math.max(win.width / MAX_SIDE_W, win.height / MAX_H)));
  const up = f === 1 ? Math.min(MAX_GROW, Math.max(1, Math.floor(MIN_SIDE_W / win.width)), Math.max(1, Math.floor(MAX_H / win.height))) : 1;
  const sides = [[figma, expected, FIGMA_RGB], [app, actual, APP_RGB]].map(([img, box, rgb]) => {
    const c = cut(img as Image, win);
    const b = box as Box;
    outline(c, { x: b.x - Math.max(0, Math.floor(win.x)), y: b.y - Math.max(0, Math.floor(win.y)), width: b.width, height: b.height }, rgb as number[]);
    return grow(shrink(c, f), up);
  });
  const [l, r] = sides as [Image, Image];
  const w = l.width + GAP + r.width, h = Math.max(l.height, r.height);
  const data = new Uint8Array(w * h * 4).fill(255);
  for (const [img, ox] of [[l, 0], [r, l.width + GAP]] as [Image, number][])
    for (let yy = 0; yy < img.height; yy++) data.set(img.data.subarray(yy * img.width * 4, (yy + 1) * img.width * 4), (yy * w + ox) * 4);
  for (let yy = 0; yy < h; yy++) for (let g = 0; g < GAP; g++) data.set([200, 200, 200, 255], (yy * w + l.width + g) * 4);
  return { width: w, height: h, data };
}

// How much bigger or smaller the content is drawn (zoom/crop of an image), plus the offset of its anchor.
// Compared on blurred 4px cells: fine texture (leaves, grilles) makes pixel-exact matching noisy, while big shapes still line up.
const CELL = 4;
function cells(img: Image, x0: number, y0: number, w: number, h: number) {
  const gw = Math.max(1, Math.floor(w / CELL)), gh = Math.max(1, Math.floor(h / CELL));
  const g = new Float32Array(gw * gh).fill(-1);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      let s = 0, n = 0;
      for (let y = y0 + j * CELL; y < y0 + (j + 1) * CELL; y++)
        for (let x = x0 + i * CELL; x < x0 + (i + 1) * CELL; x++) {
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          const k = (y * img.width + x) * 4;
          s += 0.299 * img.data[k]! + 0.587 * img.data[k + 1]! + 0.114 * img.data[k + 2]!; n++;
        }
      if (n) g[j * gw + i] = s / n;
    }
  return { x0, y0, gw, gh, g };
}
export function bestScale(figma: Image, app: Image, b: Box): { scale: number; dx: number; dy: number; gain: number } {
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const fg = cells(figma, Math.round(b.x), Math.round(b.y), b.width, b.height);
  const mx = Math.round(b.width * 0.3), my = Math.round(b.height * 0.3);
  const ag = cells(app, Math.round(b.x) - mx, Math.round(b.y) - my, b.width + 2 * mx, b.height + 2 * my);
  // App content at scale s and offset (dx, dy): the Figma point p shows up at centre + (p - centre) * s + offset.
  const err = (s: number, dx: number, dy: number, step = 1) => {
    let sum = 0, n = 0;
    for (let j = 0; j < fg.gh; j += step)
      for (let i = 0; i < fg.gw; i += step) {
        const a = fg.g[j * fg.gw + i]!;
        const px = fg.x0 + (i + 0.5) * CELL, py = fg.y0 + (j + 0.5) * CELL;
        const ai = Math.floor((cx + (px - cx) * s + dx - ag.x0) / CELL), aj = Math.floor((cy + (py - cy) * s + dy - ag.y0) / CELL);
        if (a < 0 || ai < 0 || aj < 0 || ai >= ag.gw || aj >= ag.gh) continue;
        const c = ag.g[aj * ag.gw + ai]!;
        if (c < 0) continue;
        sum += Math.abs(a - c); n++;
      }
    // Too little overlap is not a match.
    return n >= (fg.gw * fg.gh) / (step * step) / 2 ? sum / n : Infinity;
  };
  const base = err(1, 0, 0);
  let best = { scale: 1, dx: 0, dy: 0, e: base };
  const lx = Math.round(b.width * 0.25), ly = Math.round(b.height * 0.25);
  for (let s = 0.6; s <= 1.4001; s += 0.02)
    for (let dy = -ly; dy <= ly; dy += CELL) for (let dx = -lx; dx <= lx; dx += CELL) { const e = err(s, dx, dy, 2); if (e < best.e) best = { scale: Math.round(s * 100) / 100, dx, dy, e }; }
  // Refine around the coarse best at full cell density.
  const c0 = best;
  best = { ...c0, e: err(c0.scale, c0.dx, c0.dy) };
  for (let s = c0.scale - 0.02; s <= c0.scale + 0.0201; s += 0.01)
    for (let dy = c0.dy - CELL; dy <= c0.dy + CELL; dy += 2) for (let dx = c0.dx - CELL; dx <= c0.dx + CELL; dx += 2) { const e = err(s, dx, dy); if (e < best.e) best = { scale: Math.round(s * 100) / 100, dx, dy, e }; }
  return { scale: best.scale, dx: best.dx, dy: best.dy, gain: base > 0 && Number.isFinite(base) ? 1 - best.e / base : 0 };
}

// How far an image layer's content moved: the shift with the smallest difference, on half-size luminance.
const MAX_SHIFT = 16;
export function bestShift(figma: Image, app: Image, b: Box): { dx: number; dy: number; gain: number } {
  const lumAt = (img: Image, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return -1;
    const i = (y * img.width + x) * 4;
    return 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
  };
  const err = (dx: number, dy: number) => {
    let s = 0, n = 0;
    for (let y = Math.ceil(b.y); y < b.y + b.height; y += 2)
      for (let x = Math.ceil(b.x); x < b.x + b.width; x += 2) {
        const a = lumAt(figma, x, y), c = lumAt(app, x + dx, y + dy);
        if (a < 0 || c < 0) continue;
        s += Math.abs(a - c); n++;
      }
    return n ? s / n : Infinity;
  };
  const base = err(0, 0);
  let best = { dx: 0, dy: 0, e: base };
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy += 2) for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx += 2) { const e = err(dx, dy); if (e < best.e) best = { dx, dy, e }; }
  // Refine to the pixel around the coarse best.
  for (let dy = best.dy - 1; dy <= best.dy + 1; dy++) for (let dx = best.dx - 1; dx <= best.dx + 1; dx++) { const e = err(dx, dy); if (e < best.e) best = { dx, dy, e }; }
  return { dx: best.dx, dy: best.dy, gain: base > 0 ? 1 - best.e / base : 0 };
}

// Share of a box's pixels that show a colour (over white, within a small distance): enough to tell whether a shape or text of that colour is there at all.
const COLOR_NEAR = 48;
export function colorShare(img: Image, b: Box, hex: string): number {
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y)), x1 = Math.min(img.width, Math.ceil(b.x + b.width)), y1 = Math.min(img.height, Math.ceil(b.y + b.height));
  let hit = 0, all = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4, a = img.data[i + 3]! / 255;
      const d = Math.hypot(...[0, 1, 2].map((c) => img.data[i + c]! * a + 255 * (1 - a) - want[c]!));
      all++; if (d <= COLOR_NEAR) hit++;
    }
  return all ? hit / all : 0;
}
