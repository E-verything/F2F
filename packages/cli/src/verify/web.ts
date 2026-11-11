import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Measurements } from './compare';
import { measureTexts } from './page-text';

// Drives the user's installed Chrome/Edge over the DevTools protocol (Node's built-in WebSocket), so verification needs no browser-automation library or browser download.

const CANDIDATES: Record<string, string[]> = {
  win32: [
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'],
};
const LAUNCH_TIMEOUT_MS = 15000;
const READY_TIMEOUT_MS = 30000;
const STABLE_POLL_MS = 1000;

export function findChrome(): string | null {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  return (CANDIDATES[process.platform] ?? []).find((p) => p && existsSync(p)) ?? null;
}

// Runs in the page: Figma ids come from data-figma-id (web) or Flutter's Semantics(identifier: 'figma:<id>').
const COLLECT = `(() => {
  // A web font family with no face for this style/weight is faked by the browser (slanted or thickened); system fonts are not checked.
  const fontFaceLoaded = (family, style, weight) => {
    const faces = document.fonts ? [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, '') === family) : [];
    if (!faces.length) return true;
    return faces.some((f) => {
      const [lo, hi = lo] = String(f.weight).split(' ').map(Number);
      return f.status === 'loaded' && (f.style === 'normal') === (style === 'normal') && weight >= lo && weight <= hi;
    });
  };
  document.querySelector('flt-semantics-placeholder')?.click();
  const out = {};
  const els = document.querySelectorAll('[data-figma-id], [flt-semantics-identifier^="figma:"]');
  for (const el of els) {
    const id = el.getAttribute('data-figma-id') ?? el.getAttribute('flt-semantics-identifier').slice(6);
    const r = el.getBoundingClientRect();
    const m = { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    if (el.children.length === 0 && el.textContent && (el.scrollWidth > el.clientWidth + 1 || (getComputedStyle(el).overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1))) { m.overflow = true; m.text = el.textContent.trim().slice(0, 80); }
    if (el.hasAttribute('data-figma-id')) {
      const s = getComputedStyle(el);
      const fam = s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      m.style = { fontFamily: s.fontFamily, fontWeight: Number(s.fontWeight), fontStyle: s.fontStyle, fontSize: parseFloat(s.fontSize), color: s.color, background: s.backgroundColor, radius: parseFloat(s.borderTopLeftRadius) || 0,
        fontLoaded: fontFaceLoaded(fam, s.fontStyle, Number(s.fontWeight)), hasText: !!el.textContent.trim() };
    }
    out[id] = m;
  }
  // Page height is where its content ends, not the window (which is taller than the design on purpose).
  // Faked fonts anywhere on the page, tagged or not: every element that draws its own text.
  const faked = new Map();
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el);
    const fam = s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    const key = s.fontStyle + ' ' + s.fontWeight + ' ' + fam;
    if (!faked.has(key) && !fontFaceLoaded(fam, s.fontStyle, Number(s.fontWeight))) faked.set(key, key + ': ' + el.textContent.trim().slice(0, 30));
  }
  return JSON.stringify({ count: els.length, nodes: out, fakedFonts: [...faked.values()].slice(0, 10), page: { width: document.documentElement.clientWidth, height: Math.round(Math.max(0, ...[...document.body.children].map((c) => c.getBoundingClientRect().bottom + scrollY))) } });
})()`;

class Cdp {
  private next = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners: ((m: any) => void)[] = [];
  constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      const p = msg.id ? this.pending.get(msg.id) : undefined;
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      } else this.listeners.forEach((l) => l(msg));
    });
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.listeners.push((m) => { if (m.method === method) { clearTimeout(t); resolve(); } });
    });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs in the page with the design's asset ids: every visible <img>, <image> or background whose URL carries the asset file name (bundlers keep it), with its box.
const ASSETS = (ids: string[]) => `(() => {
  const want = ${JSON.stringify(ids)};
  const res = {};
  for (const el of document.querySelectorAll('body *')) {
    const url = (el.currentSrc || el.getAttribute('src') || el.getAttribute('href') || '') + ' ' + getComputedStyle(el).backgroundImage;
    const id = want.find((i) => url.includes(i));
    if (!id) continue;
    // The visible part: an image sized past its box and clipped by a wrapper (a crop) shows only the wrapper's area.
    let { left, top, right, bottom } = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflow === 'visible') continue;
      const c = p.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    }
    if (right - left < 1 || bottom - top < 1) continue;
    (res[id] ??= []).push({ x: left + scrollX, y: top + scrollY, width: right - left, height: bottom - top });
  }
  return JSON.stringify(res);
})()`;

export interface WebMeasureOptions { url: string; viewport: { width: number; height: number }; rootId: string; waitMs?: number; screenshot?: boolean; chromePath?: string; narrowWidth?: number; texts?: [string, string, string?][]; assets?: string[] }

// Runs in the page at the narrow width: text and images past the right edge are cut off or scroll sideways; empty decorations are ignored.
const NARROW = `(() => {
  const w = document.documentElement.clientWidth;
  const cut = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect();
    const content = el.tagName === 'IMG' || el.tagName === 'svg' || (el.children.length === 0 && el.textContent.trim());
    return content && r.width > 0 && r.right > w + 1;
  }).slice(0, 10).map((el) => (el.closest('[data-figma-id]')?.getAttribute('data-figma-id') ?? '') + ' ' + (el.textContent.trim().slice(0, 40) || el.tagName.toLowerCase()));
  return JSON.stringify({ width: w, scrollWidth: document.documentElement.scrollWidth, cutOff: cut });
})()`;

export async function measureWeb(o: WebMeasureOptions): Promise<{ measurements: Measurements; screenshot: Buffer | null }> {
  const chrome = o.chromePath ?? findChrome();
  if (!chrome) throw new Error('Chrome/Chromium/Edge not found. Install one or set CHROME_PATH.');
  const profile = mkdtempSync(join(tmpdir(), 'dc-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('Chrome did not start (no DevTools endpoint)')), LAUNCH_TIMEOUT_MS);
      proc.stderr!.on('data', (d) => {
        buf += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) { clearTimeout(t); resolve(m[1]!); }
      });
      proc.on('exit', (code) => reject(new Error(`Chrome exited (${code})`)));
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('cannot connect to Chrome DevTools')); });
    const cdp = new Cdp(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    // Integer metrics: Chrome rejects fractional sizes, and design heights are often fractional.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(o.viewport.width), height: Math.ceil(o.viewport.height), deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    const loaded = cdp.once('Page.loadEventFired', READY_TIMEOUT_MS);
    await cdp.send('Page.navigate', { url: o.url }, sessionId);
    await loaded;
    let result: { count: number; nodes: Measurements['nodes']; fakedFonts?: string[]; page?: { width: number; height: number } } = { count: 0, nodes: {} };
    let last = -1;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    // Flutter builds its semantics DOM asynchronously; wait until the tagged count stops changing.
    while (Date.now() < deadline) {
      const r = await cdp.send('Runtime.evaluate', { expression: COLLECT, returnByValue: true }, sessionId);
      result = JSON.parse(r.result.value);
      if (result.count > 0 && result.count === last) break;
      last = result.count;
      await sleep(STABLE_POLL_MS);
    }
    await sleep(o.waitMs ?? 1000);
    const r = await cdp.send('Runtime.evaluate', { expression: `(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => ${COLLECT})`, awaitPromise: true, returnByValue: true }, sessionId);
    result = JSON.parse(r.result.value);
    const root = result.nodes[o.rootId];
    const lines = o.texts?.length ? JSON.parse((await cdp.send('Runtime.evaluate', { expression: `(${measureTexts.toString()})(${JSON.stringify(o.texts)})`, returnByValue: true }, sessionId)).result.value) : undefined;
    const assets = o.assets?.length ? JSON.parse((await cdp.send('Runtime.evaluate', { expression: ASSETS(o.assets), returnByValue: true }, sessionId)).result.value) : undefined;
    let screenshot: Buffer | null = null;
    if (o.screenshot) {
      const clip = root ? { x: root.x, y: root.y, width: root.width, height: root.height, scale: 1 } : { x: 0, y: 0, width: o.viewport.width, height: o.viewport.height, scale: 1 };
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }, sessionId);
      screenshot = Buffer.from(shot.data, 'base64');
    }
    let narrow: Measurements['narrow'];
    if (o.narrowWidth) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: o.narrowWidth, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
      const reloaded = cdp.once('Page.loadEventFired', READY_TIMEOUT_MS);
      await cdp.send('Page.navigate', { url: o.url }, sessionId);
      await reloaded;
      await sleep(o.waitMs ?? 1000);
      narrow = JSON.parse((await cdp.send('Runtime.evaluate', { expression: NARROW, returnByValue: true }, sessionId)).result.value);
    }
    await cdp.send('Browser.close').catch(() => undefined);
    ws.close();
    // Without a tagged root the page itself is the screen; the window is larger than the design on purpose, so it is not the page size.
    const viewport = root ? { width: Math.round(root.width), height: Math.round(root.height) } : result.page ?? o.viewport;
    return { measurements: { screenId: o.rootId, source: `chrome ${o.url}`, viewport, nodes: result.nodes, fakedFonts: result.fakedFonts ?? [], ...(lines ? { lines } : {}), ...(assets ? { assets } : {}), ...(narrow ? { narrow } : {}) }, screenshot };
  } finally {
    proc.kill();
    await sleep(300);
    // Windows can keep a just-closed Chrome's profile locked; a leftover temp folder must not turn a finished verify into a crash.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in the OS temp folder */ }
  }
}
