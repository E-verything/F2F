import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Measured, Measurements } from './compare';

// Reads the running app's accessibility tree from a device/emulator/simulator. Figma ids are tagged as identifiers: Flutter Semantics(identifier), React Native testID, Compose testTag (testTagsAsResourceId), SwiftUI/UIKit accessibilityIdentifier.

const TAG = /figma:([^\s"]+)/;
// Android reports px; design units are dp, where 160 dpi = 1x.
const ANDROID_BASELINE_DPI = 160;
const round = (n: number) => Math.round(n * 100) / 100;

const decodeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseUiautomator(xml: string, density: number): Record<string, Measured> {
  const scale = ANDROID_BASELINE_DPI / density;
  const out: Record<string, Measured> = {};
  for (const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, decodeXml(a[2]!)]));
    const id = TAG.exec(attrs['resource-id'] ?? '')?.[1] ?? TAG.exec(attrs['content-desc'] ?? '')?.[1];
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? '');
    if (!id || !b || out[id]) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number) as [number, number, number, number];
    out[id] = { x: round(x1 * scale), y: round(y1 * scale), width: round((x2 - x1) * scale), height: round((y2 - y1) * scale) };
  }
  return out;
}

export function parseDensity(wmOutput: string): number {
  const override = /Override density:\s*(\d+)/.exec(wmOutput)?.[1];
  const physical = /Physical density:\s*(\d+)/.exec(wmOutput)?.[1];
  const d = Number(override ?? physical);
  if (!d) throw new Error(`cannot read density from "${wmOutput.trim()}"`);
  return d;
}

// idb `ui describe-all --json` (points); older versions give AXFrame as "{{x, y}, {w, h}}".
export function parseIdb(json: string): Record<string, Measured> {
  const out: Record<string, Measured> = {};
  const items = JSON.parse(json) as Record<string, any>[];
  for (const it of items) {
    const id = TAG.exec(String(it.AXUniqueId ?? it.identifier ?? ''))?.[1];
    if (!id || out[id]) continue;
    let f = it.frame as { x: number; y: number; width: number; height: number } | undefined;
    if (!f && typeof it.AXFrame === 'string') {
      const n = it.AXFrame.match(/-?[\d.]+/g)?.map(Number);
      if (n?.length === 4) f = { x: n[0]!, y: n[1]!, width: n[2]!, height: n[3]! };
    }
    if (f) out[id] = { x: round(f.x), y: round(f.y), width: round(f.width), height: round(f.height) };
  }
  return out;
}

function tool(name: string, extra: string[]): string {
  for (const dir of extra) {
    const p = join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    if (dir && existsSync(p)) return p;
  }
  return name;
}

const run = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e: any) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${e.code === 'ENOENT' ? 'not installed or not on PATH' : String(e.stderr || e.message).trim()}`);
  }
};

function withViewport(nodes: Record<string, Measured>, rootId: string, source: string): Measurements {
  const root = nodes[rootId];
  const all = Object.values(nodes);
  const viewport = root ? { width: Math.round(root.width), height: Math.round(root.height) } : { width: Math.round(Math.max(0, ...all.map((n) => n.x + n.width))), height: Math.round(Math.max(0, ...all.map((n) => n.y + n.height))) };
  return { screenId: rootId, source: root ? source : `${source} (screen root not tagged: positions are relative to the device window, including the status bar)`, viewport, nodes };
}

export function measureAndroid(rootId: string, serial?: string): Measurements {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '';
  const adb = tool('adb', [sdk && join(sdk, 'platform-tools')]);
  const dev = serial ? ['-s', serial] : [];
  const density = parseDensity(run(adb, [...dev, 'shell', 'wm', 'density']));
  run(adb, [...dev, 'shell', 'uiautomator', 'dump', '/sdcard/dc-window.xml']);
  const xml = run(adb, [...dev, 'exec-out', 'cat', '/sdcard/dc-window.xml']);
  return withViewport(parseUiautomator(xml, density), rootId, `android uiautomator (density ${density})`);
}

export function measureIos(rootId: string, udid?: string): Measurements {
  const json = run('idb', ['ui', 'describe-all', '--json', ...(udid ? ['--udid', udid] : [])]);
  return withViewport(parseIdb(json), rootId, 'ios idb describe-all');
}
