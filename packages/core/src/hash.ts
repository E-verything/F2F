// Pure-JS SHA-256 and UTF-8 because the Figma plugin sandbox has neither crypto.subtle nor TextEncoder.

const primes: number[] = [];
for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
const frac32 = (x: number) => ((x - Math.floor(x)) * 0x100000000) >>> 0;
const K = primes.map((p) => frac32(Math.cbrt(p)));
const H0 = primes.slice(0, 8).map((p) => frac32(Math.sqrt(p)));

// Writes into a preallocated buffer: a number[] per byte was ~8x slower and stalled packaging of large files.
export function utf8(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 3);
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out[j++] = c;
      continue;
    }
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x800) {
      out[j++] = 0xc0 | (c >> 6);
      out[j++] = 0x80 | (c & 63);
    } else if (c < 0x10000) {
      out[j++] = 0xe0 | (c >> 12);
      out[j++] = 0x80 | ((c >> 6) & 63);
      out[j++] = 0x80 | (c & 63);
    } else {
      out[j++] = 0xf0 | (c >> 18);
      out[j++] = 0x80 | ((c >> 12) & 63);
      out[j++] = 0x80 | ((c >> 6) & 63);
      out[j++] = 0x80 | (c & 63);
    }
  }
  return out.slice(0, j);
}

export function sha256(input: Uint8Array | string): string {
  const data = typeof input === 'string' ? utf8(input) : input;
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = H0.slice();
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i]! + v) >>> 0));
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}
