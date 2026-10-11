import { deflateSync, inflateSync } from 'node:zlib';

// Minimal PNG codec (8-bit RGB/RGBA/grey, non-interlaced) so visual diffs need no image dependency.

export interface Image { width: number; height: number; data: Uint8Array }

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
// A pixel counts as different when any channel differs by more than this (absorbs anti-aliasing noise).
const CHANNEL_THRESHOLD = 32;

export function decodePng(buf: Uint8Array): Image {
  const b = Buffer.from(buf);
  if (!b.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const chunk = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); bitDepth = chunk[8]!; colorType = chunk[9]!; interlace = chunk[12]!;
    } else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = CHANNELS[colorType];
  if (bitDepth !== 8 || !ch || interlace) throw new Error(`unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch]! : 0, up = prev[i]!, c = i >= ch ? prev[i - ch]! : 0;
      let v = src[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      row[i] = v & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch;
    const [r, g, bl, al] = ch === 1 ? [px[s]!, px[s]!, px[s]!, 255] : ch === 2 ? [px[s]!, px[s]!, px[s]!, px[s + 1]!] : ch === 3 ? [px[s]!, px[s + 1]!, px[s + 2]!, 255] : [px[s]!, px[s + 1]!, px[s + 2]!, px[s + 3]!];
    data.set([r, g, bl, al], i * 4);
  }
  return { width, height, data };
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const x of buf) c = CRC[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(img: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) Buffer.from(img.data.buffer, img.data.byteOffset + y * img.width * 4, img.width * 4).copy(raw, y * (img.width * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Both images are composited over white first: Figma exports leave uncovered areas transparent, while a browser or device paints them.
const overWhite = (img: Image, i: number, c: number) => { const a = img.data[i + 3]! / 255; return img.data[i + c]! * a + 255 * (1 - a); };

// Compares the overlapping area; the diff image shows the app dimmed with differing pixels in red.
export function diffImages(design: Image, app: Image): { ratio: number; diff: Image } {
  const width = Math.min(design.width, app.width), height = Math.min(design.height, app.height);
  const diff = { width, height, data: new Uint8Array(width * height * 4) };
  let bad = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * design.width + x) * 4, j = (y * app.width + x) * 4, o = (y * width + x) * 4;
      const differs = [0, 1, 2].some((c) => Math.abs(overWhite(design, i, c) - overWhite(app, j, c)) > CHANNEL_THRESHOLD);
      if (differs) { bad++; diff.data.set([255, 0, 0, 255], o); }
      else { const g = (overWhite(app, j, 0) + overWhite(app, j, 1) + overWhite(app, j, 2)) / 3; diff.data.set([g, g, g, 70], o); }
    }
  return { ratio: bad / (width * height), diff };
}
