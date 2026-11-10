import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { words } from '../repo/compile';

// Which route each screen lives at, so `f2f verify` alone checks every page: the profile, then routes remembered from earlier runs, then the app's own routes.

export interface ScreenInfo { id: string; name: string; slug: string }
export interface Route { route: string; source: 'saved' | 'profile' | 'app route' }

const SAVED = 'verification/routes.json';

// "Landing Page → /, Contact Us → /contact [user answer]; Services: ASK" → [["Landing Page", ""], ["Contact Us", "contact"]].
export function profileRoutes(profile: string): [string, string][] {
  const line = profile.split('\n').find((l) => /screen\s*(→|->)\s*route/i.test(l));
  if (!line) return [];
  const body = line.slice(line.indexOf(':') + 1).replace(/\[[^\]]*\]/g, '');
  return [...body.matchAll(/([^,;→]+?)\s*(?:→|->)\s*(\/[^\s,;]*)/g)].map((m) => [m[1]!.trim(), m[2]!.replace(/^\/+/, '')]);
}

// A profile name matches a screen when all its words are in the screen name ("Landing Page" → "AC Installation Service Landing Page").
const nameMatches = (short: string, screen: ScreenInfo) => { const w = words(short), s = new Set(words(screen.name)); return w.length > 0 && w.every((x) => s.has(x)); };

export async function resolveRoutes(pkgDir: string, repoDir: string, screens: ScreenInfo[], appRoutes: () => Promise<string[]>): Promise<{ routes: Map<string, Route>; missing: ScreenInfo[] }> {
  const routes = new Map<string, Route>();
  // The profile is the developer's decision, so it wins over a route remembered from an earlier run.
  const profile = await readFile(join(repoDir, 'f2f-project.md'), 'utf8').catch(() => '');
  for (const [name, route] of profileRoutes(profile)) {
    const hit = screens.filter((s) => !routes.has(s.id) && nameMatches(name, s));
    if (hit.length === 1) routes.set(hit[0]!.id, { route, source: 'profile' });
  }
  const saved = existsSync(join(pkgDir, SAVED)) ? JSON.parse(await readFile(join(pkgDir, SAVED), 'utf8')) as Record<string, string> : {};
  for (const s of screens) if (!routes.has(s.id) && saved[s.id] !== undefined) routes.set(s.id, { route: saved[s.id]!, source: 'saved' });
  // Last resort: an app route whose name is one of the screen's words ("/services" → "Services - …"); used only when exactly one screen fits.
  if (screens.some((s) => !routes.has(s.id))) {
    const taken = new Set([...routes.values()].map((r) => r.route));
    for (const path of await appRoutes()) {
      const route = path.replace(/^\/+/, '');
      if (!route || route.includes('[') || taken.has(route)) continue;
      const seg = words(route.split('/').pop()!);
      const hit = screens.filter((s) => !routes.has(s.id) && seg.length > 0 && seg.every((w) => words(s.name).includes(w)));
      if (hit.length === 1) { routes.set(hit[0]!.id, { route, source: 'app route' }); taken.add(route); }
    }
  }
  return { routes, missing: screens.filter((s) => !routes.has(s.id)) };
}

export async function saveRoutes(pkgDir: string, add: Record<string, string>) {
  const p = join(pkgDir, SAVED);
  const old = existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : {};
  await mkdir(join(pkgDir, 'verification'), { recursive: true });
  await writeFile(p, JSON.stringify({ ...old, ...add }, null, 2) + '\n');
}

// "3", "2,3", "1-3 5", "all" or "" (= all) → 0-based indexes; null when the answer is not valid.
export function parseChoice(answer: string, count: number): number[] | null {
  const a = answer.trim().toLowerCase();
  if (!a || a === 'all' || a === 'a' || a === String(count + 1)) return [...Array(count).keys()];
  const out = new Set<number>();
  for (const part of a.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]), to = Number(m[2] ?? m[1]);
    if (from < 1 || to > count || from > to) return null;
    for (let i = from; i <= to; i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

// The profile's "App URL" line, reduced to its origin, so `f2f verify` needs no --url.
export function profileUrl(profile: string): string | null {
  const m = /^.*app url.*?(https?:\/\/[^\s\]),]+)/im.exec(profile);
  return m ? new URL(m[1]!).origin : null;
}
