import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

// Read-only, deterministic scan of an app repository: names, paths and token values only, never file contents, so secrets cannot leak into the package.

export interface CodeComponent { name: string; file: string; params: string[] }
export interface CodeToken { name: string; kind: 'color' | 'number' | 'text-style'; value: string; file: string }
export interface RepoMap {
  root: string;
  framework: 'flutter' | 'react' | 'next' | 'vue' | 'svelte' | 'unknown';
  styling: string[];
  entryPoints: string[];
  components: CodeComponent[];
  tokens: CodeToken[];
  fonts: string[];
  assetDirs: string[];
  assets: { file: string; sha256: string }[];
  routes: { path: string; file: string }[];
  commands: Record<string, string>;
  dependencies: string[];
  limits: string[];
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '.dart_tool', 'build', 'dist', '.next', 'ios', 'android', 'macos', 'windows', 'linux', 'web', 'coverage', 'f2f', '.idea', '.vscode']);
// Never read: credentials and env files may sit anywhere in a repo.
const SECRET_FILE = /(^\.env)|(\.(pem|key|p12|keystore|jks)$)|(secret|credential|service-account)/i;
// Test code defines main()/components that are not part of the app, so it is not scanned for app structure.
const TEST_FILE = /(^|\/)(test|tests|__tests__|integration_test|test_driver|e2e|cypress)\/|_test\.dart$|\.(test|spec|stories)\.[cm]?[jt]sx?$/;
const SOURCE_EXT = new Set(['.dart', '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.css', '.scss', '.mjs', '.cjs']);
const ASSET_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
// Keeps a scan of a very large repo bounded; hitting it is reported in limits.
const MAX_FILES = 5000;
const MAX_SOURCE_BYTES = 512 * 1024;

const posix = (p: string) => p.split(sep).join('/');

async function walk(root: string, limits: string[]): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) await visit(full);
      } else if (e.isFile() && !SECRET_FILE.test(e.name)) out.push(full);
    }
  };
  await visit(root);
  if (out.length >= MAX_FILES) limits.push(`stopped after ${MAX_FILES} files`);
  return out;
}

const hexFromArgb = (v: string) => '#' + v.slice(-6).toLowerCase();

function scanDart(file: string, src: string, map: RepoMap) {
  for (const m of src.matchAll(/class\s+(\w+)\s+extends\s+(StatelessWidget|StatefulWidget|HookWidget|ConsumerWidget|HookConsumerWidget)\b[^{]*\{([\s\S]*?)\n\}/g)) {
    const params = [...m[3]!.matchAll(/^\s*final\s+[\w<>?,\s]+?\s+(\w+)\s*;/gm)].map((p) => p[1]!);
    map.components.push({ name: m[1]!, file, params });
  }
  // Any `name = Color(...)` or `name: Color(...)` (static consts, ColorScheme/ThemeData args, ThemeExtension fields).
  for (const m of src.matchAll(/(\w+)\s*[:=]\s*(?:const\s+)?Color\(\s*0x([0-9A-Fa-f]{8})\s*\)/g))
    map.tokens.push({ name: m[1]!, kind: 'color', value: hexFromArgb(m[2]!), file });
  for (const m of src.matchAll(/(\w+)\s*[:=]\s*(?:const\s+)?Color\.fromA?RGB[O]?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*)?[,)]/g)) {
    const isArgb = m[0]!.includes('fromARGB');
    const [r, g, b] = (isArgb ? [m[3], m[4], m[5]] : [m[2], m[3], m[4]]).map((v) => Number(v).toString(16).padStart(2, '0'));
    map.tokens.push({ name: m[1]!, kind: 'color', value: `#${r}${g}${b}`, file });
  }
  for (const m of src.matchAll(/static\s+(?:const|final)\s+(?:double\s+)?(\w+)\s*=\s*(\d+(?:\.\d+)?)\s*;/g))
    map.tokens.push({ name: m[1]!, kind: 'number', value: m[2]!, file });
  for (const m of src.matchAll(/static\s+(?:const\s+|final\s+)?(?:TextStyle\s+)?(\w+)\s*=\s*(?:const\s+)?(?:GoogleFonts\.(\w+)\()?\s*(?:TextStyle\()?([^;]*?fontSize:\s*[\d.]+[^;]*?)\)\s*;/g)) {
    const body = m[3]!;
    const size = /fontSize:\s*([\d.]+)/.exec(body)?.[1];
    const weight = /FontWeight\.w(\d00)/.exec(body)?.[1];
    const google = m[2] ? m[2][0]!.toUpperCase() + m[2].slice(1) : undefined;
    const family = /fontFamily:\s*['"]([^'"]+)['"]/.exec(body)?.[1] ?? google;
    map.tokens.push({ name: m[1]!, kind: 'text-style', value: [family, size && `${size}px`, weight].filter(Boolean).join(' '), file });
  }
  for (const m of src.matchAll(/GoRoute\(\s*(?:name:\s*[^,]+,\s*)?path:\s*['"]([^'"]+)['"]/g)) map.routes.push({ path: m[1]!, file });
  for (const m of src.matchAll(/['"](\/[\w\-/:]*)['"]\s*:\s*\(/g)) map.routes.push({ path: m[1]!, file });
  if (/void\s+main\s*\(/.test(src)) map.entryPoints.push(file);
}

function scanWeb(file: string, src: string, map: RepoMap) {
  if (/\.(tsx|jsx|vue|svelte)$/.test(file)) {
    for (const m of src.matchAll(/export\s+(?:default\s+)?(?:function|const)\s+([A-Z]\w*)/g)) {
      const props = /\(\s*\{([^}]*)\}/.exec(src.slice(m.index!, m.index! + 400))?.[1];
      map.components.push({ name: m[1]!, file, params: props ? props.split(',').map((p) => p.split(/[=:]/)[0]!.trim()).filter(Boolean) : [] });
    }
    for (const m of src.matchAll(/<Route[^>]*\spath=["']([^"']+)["']/g)) map.routes.push({ path: m[1]!, file });
  }
  for (const m of src.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) map.tokens.push({ name: `--${m[1]}`, kind: 'color', value: m[2]!.toLowerCase(), file });
  // Tailwind v3 config colours (`primary: '#700fce'`); v4 `@theme { --color-*: }` is covered by the CSS variable scan above.
  if (/tailwind\.config\.[cm]?[jt]s$/.test(file))
    for (const m of src.matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})['"]/g)) {
      const hex = m[2]!.length === 4 ? '#' + [...m[2]!.slice(1)].map((c) => c + c).join('') : m[2]!;
      map.tokens.push({ name: `tailwind:${m[1]}`, kind: 'color', value: hex.toLowerCase(), file });
    }
  if (/createRoot\(|ReactDOM\.render\(/.test(src)) map.entryPoints.push(file);
}

function yamlList(src: string, key: string): string[] {
  const block = new RegExp(`^\\s*${key}:\\s*\\n((?:\\s+-\\s*.+\\n?)+)`, 'm').exec(src)?.[1] ?? '';
  return [...block.matchAll(/-\s*(.+)/g)].map((m) => m[1]!.trim().replace(/^['"]|['"]$/g, ''));
}

export async function inspectRepo(root: string): Promise<RepoMap> {
  const map: RepoMap = { root: posix(root), framework: 'unknown', styling: [], entryPoints: [], components: [], tokens: [], fonts: [], assetDirs: [], assets: [], routes: [], commands: {}, dependencies: [], limits: [] };
  const files = await walk(root, map.limits);
  const rel = (f: string) => posix(relative(root, f));
  const read = async (f: string) => ((await stat(f)).size > MAX_SOURCE_BYTES ? null : readFile(f, 'utf8'));

  const pubspec = files.find((f) => rel(f) === 'pubspec.yaml');
  const pkg = files.find((f) => rel(f) === 'package.json');
  if (pubspec) {
    const src = (await read(pubspec)) ?? '';
    map.framework = 'flutter';
    map.dependencies = [...src.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!).filter((d) => !['sdk', 'flutter', 'uses-material-design', 'assets', 'fonts'].includes(d));
    map.assetDirs = yamlList(src, 'assets');
    map.fonts = [...src.matchAll(/-\s*family:\s*(.+)/g)].map((m) => m[1]!.trim());
    if (/google_fonts/.test(src)) map.styling.push('google_fonts');
    map.styling.push('flutter-theme');
    map.commands = { run: 'flutter run', test: 'flutter test', analyze: 'flutter analyze' };
  } else if (pkg) {
    const json = JSON.parse((await read(pkg)) ?? '{}');
    const deps = { ...json.dependencies, ...json.devDependencies } as Record<string, string>;
    map.dependencies = Object.keys(deps).sort();
    map.framework = deps.next ? 'next' : deps.vue ? 'vue' : deps.svelte ? 'svelte' : deps.react ? 'react' : 'unknown';
    if (deps.tailwindcss) map.styling.push('tailwind');
    if (deps['styled-components']) map.styling.push('styled-components');
    if (deps['@emotion/react']) map.styling.push('emotion');
    map.commands = Object.fromEntries(Object.keys(json.scripts ?? {}).sort().map((s) => [s, `npm run ${s}`]));
  } else map.limits.push('no pubspec.yaml or package.json at the repo root; framework unknown');

  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (SOURCE_EXT.has(ext) && !TEST_FILE.test(rel(f))) {
      const src = await read(f);
      if (src === null) continue;
      if (ext === '.dart') scanDart(rel(f), src, map);
      else scanWeb(rel(f), src, map);
    } else if (ASSET_EXT.has(ext)) {
      map.assets.push({ file: rel(f), sha256: createHash('sha256').update(await readFile(f)).digest('hex') });
    }
  }
  if (map.framework === 'next') for (const f of files) {
    const m = /^(?:src\/)?app\/(.*)page\.(tsx|jsx|ts|js)$/.exec(rel(f));
    if (m) map.routes.push({ path: '/' + m[1]!.replace(/\/$/, ''), file: rel(f) });
  }
  if (map.framework !== 'flutter' && map.assets.length) map.assetDirs = [...new Set(map.assets.map((a) => a.file.slice(0, a.file.lastIndexOf('/') + 1)))].sort();
  return map;
}
