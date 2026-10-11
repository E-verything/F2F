import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Measurements } from './compare';

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
  document.querySelector('flt-semantics-placeholder')?.click();
  const out = {};
  const els = document.querySelectorAll('[data-figma-id], [flt-semantics-identifier^="figma:"]');
  for (const el of els) {
    const id = el.getAttribute('data-figma-id') ?? el.getAttribute('flt-semantics-identifier').slice(6);
    const r = el.getBoundingClientRect();
    const m = { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    if (el.children.length === 0 && el.textContent && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) { m.overflow = true; m.text = el.textContent.trim().slice(0, 80); }
    out[id] = m;
  }
  return JSON.stringify({ count: els.length, nodes: out });
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

export interface WebMeasureOptions { url: string; viewport: { width: number; height: number }; rootId: string; waitMs?: number; screenshot?: boolean; chromePath?: string }

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
    // The page is given room around the design frame so a centred/padded root is not squeezed.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: o.viewport.width, height: o.viewport.height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    const loaded = cdp.once('Page.loadEventFired', READY_TIMEOUT_MS);
    await cdp.send('Page.navigate', { url: o.url }, sessionId);
    await loaded;
    let result: { count: number; nodes: Measurements['nodes'] } = { count: 0, nodes: {} };
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
    let screenshot: Buffer | null = null;
    if (o.screenshot) {
      const clip = root ? { x: root.x, y: root.y, width: root.width, height: root.height, scale: 1 } : { x: 0, y: 0, width: o.viewport.width, height: o.viewport.height, scale: 1 };
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }, sessionId);
      screenshot = Buffer.from(shot.data, 'base64');
    }
    await cdp.send('Browser.close').catch(() => undefined);
    ws.close();
    const viewport = root ? { width: Math.round(root.width), height: Math.round(root.height) } : o.viewport;
    return { measurements: { screenId: o.rootId, source: `chrome ${o.url}`, viewport, nodes: result.nodes }, screenshot };
  } finally {
    proc.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
