import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { sha256 } from '../../core/src/hash';
import { slugify } from '../../core/src/normalize';
import { screenOutline } from '../../core/src/outline';
import { validatePackage } from '../../core/src/validate';
import { compileFeature } from './repo/compile';
import { inspectRepo } from './repo/inspect';
import { writeReport } from './verify/html';
import { verify } from './verify/run';
import { bench } from './bench';

// Set by scripts/build.mjs from packages/cli/package.json; 'dev' when run from source.
declare const F2F_VERSION: string;
const VERSION = typeof F2F_VERSION === 'string' ? F2F_VERSION : 'dev';

const USAGE = `f2f <command>

Commands:
  --version, -v                        Print the installed f2f-cli version.
  validate <dir>                       Check a f2f package: schema, file hashes, and cross-references.
  inspect --repo <dir>                 Print what the tool detects in an app repository (read-only).
  build --feature <name> --repo <dir> [--package <dir>] [--name <brief name>]
                                       Write briefs/<feature>.md (+ .json) and implementation/project-map.json
                                       into the package. Package defaults to <repo>/f2f. <name> is a page or
                                       Figma section; several pages: "Page A, Page B" with --name for the brief.
  bench [--package <dir>] [--repo <dir> --feature <name>]
                                       Measure package size, estimated tokens, validate/inspect/brief time and memory.
  refresh [--package <dir>]            Regenerate screen outlines from the package JSON with this tool version.
  verify --screen <id|slug> [--package <dir>] (--url <url> | --android | --ios | --measurements <json>)
         [--device <serial|udid>] [--tolerance 1] [--window 590x1044] [--no-screenshot]
                                       Measure the running app's figma-tagged layers and compare with the design.
                                       Writes verification/<screen>.md/.json (+ app screenshot and visual diff for --url).
  verify --screens "<id>=<route>,…" --url <base url>
                                       Verify several web pages in one run, e.g. --screens "1:2=,1:567=services"
                                       (routes without the leading slash; empty = home).
  report [--package <dir>] [--open]    Write verification/index.html: every verified screen with Figma, your app and
                                       the heatmap side by side, wrong layers boxed, and what is wrong in words.`;

// Opens the report in the default browser; detached so the CLI exits at once.
function openFile(path: string) {
  const [bin, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', path]] : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]];
  spawn(bin, args, { detached: true, stdio: 'ignore', shell: false }).unref();
}

async function refreshOutlines(pkgDir: string, reuse?: Map<string, string>): Promise<number> {
  const index = JSON.parse(await readFile(join(pkgDir, 'screens/index.json'), 'utf8'));
  const assets = new Map((JSON.parse(await readFile(join(pkgDir, 'assets/manifest.json'), 'utf8')).assets as any[]).map((a) => [a.id, a.file]));
  const manifestPath = join(pkgDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const s of index.screens) {
    const outline = s.outline ?? s.file.replace(/\.json$/, '.md');
    const md = screenOutline(JSON.parse(await readFile(join(pkgDir, s.file), 'utf8')), s.file, (id) => `../${assets.get(id) ?? `assets/${id}`}`, reuse);
    await writeFile(join(pkgDir, outline), md);
    manifest.files[outline] = sha256(md);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return index.screens.length;
}

async function readTree(root: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    out[relative(root, full).split(sep).join('/')] = await readFile(full);
  }
  return out;
}

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith('--') && argv[i + 1] && !argv[i + 1]!.startsWith('--')) out[argv[i]!.slice(2)] = argv[++i]!;
  return out;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, dir] = argv;
  const f = flags(argv.slice(1));
  if (cmd && ['--version', '-v', '--v', '-V', 'version'].includes(cmd)) {
    console.log(`f2f-cli ${VERSION}`);
    return 0;
  }
  if (cmd === 'validate' && dir) {
    const findings = validatePackage(await readTree(dir));
    for (const x of findings) console.log(`${x.severity.toUpperCase()} ${x.file}: ${x.message}`);
    const errors = findings.filter((x) => x.severity === 'error').length;
    console.log(errors ? `${errors} error(s)` : `valid (${findings.length} warning(s))`);
    return errors ? 1 : 0;
  }
  if (cmd === 'inspect' && f.repo) {
    const map = await inspectRepo(resolve(f.repo));
    console.log(JSON.stringify({ ...map, assets: `${map.assets.length} files` }, null, 2));
    return 0;
  }
  if (cmd === 'build' && f.feature && f.repo) {
    const repoDir = resolve(f.repo);
    const pkgDir = resolve(f.package ?? join(repoDir, 'f2f'));
    const t0 = Date.now();
    // Exports from older plugin versions carry outlines this CLI can improve; the brief must point at current ones.
    await refreshOutlines(pkgDir);
    const repo = await inspectRepo(repoDir);
    const brief = await compileFeature(pkgDir, f.feature, repo, f.name);
    // Layers the repo already renders (header, footer…) shrink to one line, so the agent does not re-read them on every page.
    const reuse = new Map<string, string>();
    for (const r of (brief.data as any).layerReuse ?? []) for (const id of r.nodeIds) reuse.set(id, `\`${r.code.name}\` (${r.code.file})`);
    if (reuse.size) await refreshOutlines(pkgDir, reuse);
    const slug = slugify(f.name ?? f.feature);
    await mkdir(join(pkgDir, 'briefs'), { recursive: true });
    await mkdir(join(pkgDir, 'implementation'), { recursive: true });
    await writeFile(join(pkgDir, 'briefs', `${slug}.md`), brief.markdown);
    await writeFile(join(pkgDir, 'briefs', `${slug}.json`), JSON.stringify(brief.data, null, 2) + '\n');
    await writeFile(join(pkgDir, 'implementation', 'project-map.json'), JSON.stringify({ ...repo, root: '.' }, null, 2) + '\n');
    console.log(`wrote briefs/${slug}.md (${brief.markdown.length} chars, ~${Math.round(brief.markdown.length / 3.5 / 1000)}k tokens) in ${Date.now() - t0} ms`);
    return 0;
  }
  if (cmd === 'bench') {
    const pkgDir = resolve(f.package ?? 'f2f');
    const result = await bench(pkgDir, f.repo && resolve(f.repo), f.feature);
    await mkdir(join(pkgDir, 'reports'), { recursive: true });
    await writeFile(join(pkgDir, 'reports', 'benchmark.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (cmd === 'refresh') {
    const n = await refreshOutlines(resolve(f.package ?? dir ?? 'f2f'));
    console.log(`regenerated ${n} screen outline(s) with this version of the tool`);
    return 0;
  }
  if (cmd === 'verify' && (f.screen || (f.screens && f.url))) {
    const win = f.window?.split('x').map(Number);
    // --screens "1:2=/,1:567=/services" verifies several pages against one base --url in a single run.
    const jobs = f.screens
      ? f.screens.split(',').map((p) => p.trim().split('=')).map(([id, route = '']) => {
          // Git Bash rewrites "/route" into a Windows path, so routes are written without the leading slash.
          if (/^[a-z]:[\\/]/i.test(route.trim())) throw new Error(`Route "${route}" became a file path (Git Bash does this to "/…"). Write routes without the leading slash: --screens "${id}=${route.replace(/^.*[\\/]/, '')}"`);
          return { screen: id!.trim(), url: new URL(route.trim().replace(/^\/+/, ''), f.url!.replace(/\/*$/, '/')).href };
        })
      : [{ screen: f.screen!, url: f.url }];
    let failed = 0;
    for (const job of jobs) {
      const { report, files } = await verify({
        pkgDir: resolve(f.package ?? 'f2f'), screen: job.screen, url: job.url, measurementsFile: f.measurements,
        android: argv.includes('--android'), ios: argv.includes('--ios'), device: f.device,
        tolerancePx: f.tolerance ? Number(f.tolerance) : undefined, screenshot: !argv.includes('--no-screenshot'),
        window: win?.length === 2 ? { width: win[0]!, height: win[1]! } : undefined,
      });
      const s = report.summary;
      if (s.verdict !== 'pass') failed++;
      console.log(`${jobs.length > 1 ? `[${job.screen} ${job.url}] ` : ''}${s.verdict.toUpperCase()}: ${s.passed}/${s.measured} layers within ±${report.tolerancePx}px, ${s.failed} off, ${s.styleFailed} style diffs, ${report.code?.length ?? 0} code-rule issues, ${s.textMetrics} font-metric warnings, ${s.overflow} overflow, ${s.missingKey} required layers untagged${report.narrow ? `, small screen ${report.narrow.width}px ${report.narrow.ok ? 'OK' : 'FAIL'}` : ''}${report.visual && !Number.isNaN(report.visual.mismatchRatio) ? `, visual diff ${(report.visual.mismatchRatio * 100).toFixed(1)}%` : ''}`);
      files.forEach((p) => console.log(`  ${p}`));
    }
    if (jobs.length > 1) console.log(`${jobs.length - failed}/${jobs.length} screens PASS`);
    const { path } = await writeReport(resolve(f.package ?? 'f2f'));
    console.log(`Report with images: ${path} (open it, or run f2f report --open)`);
    return failed ? 1 : 0;
  }
  if (cmd === 'report') {
    const { path, screens } = await writeReport(resolve(f.package ?? 'f2f'));
    if (!screens) { console.log('No verify results yet. Run f2f verify --screen <id> --url <url> first.'); return 1; }
    console.log(`wrote ${path} (${screens} screen(s))`);
    if (argv.includes('--open')) openFile(path);
    return 0;
  }
  console.log(USAGE);
  return cmd ? 2 : 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
