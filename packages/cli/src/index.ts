import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { sha256 } from '../../core/src/hash';
import { slugify } from '../../core/src/normalize';
import { screenOutline } from '../../core/src/outline';
import { validatePackage } from '../../core/src/validate';
import { compileFeature } from './repo/compile';
import { inspectRepo } from './repo/inspect';
import { verify } from './verify/run';
import { bench } from './bench';

const USAGE = `f2f <command>

Commands:
  validate <dir>                       Check a f2f package: schema, file hashes, and cross-references.
  inspect --repo <dir>                 Print what the tool detects in an app repository (read-only).
  build --feature <name> --repo <dir> [--package <dir>]
                                       Write briefs/<feature>.md (+ .json) and implementation/project-map.json
                                       into the package. Package defaults to <repo>/f2f.
  bench [--package <dir>] [--repo <dir> --feature <name>]
                                       Measure package size, estimated tokens, validate/inspect/brief time and memory.
  refresh [--package <dir>]            Regenerate screen outlines from the package JSON with this tool version.
  verify --screen <id|slug> [--package <dir>] (--url <url> | --android | --ios | --measurements <json>)
         [--device <serial|udid>] [--tolerance 1] [--window 590x1044] [--no-screenshot]
                                       Measure the running app's figma-tagged layers and compare with the design.
                                       Writes verification/<screen>.md/.json (+ app screenshot and visual diff for --url).`;

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
    const repo = await inspectRepo(repoDir);
    const brief = await compileFeature(pkgDir, f.feature, repo);
    const slug = slugify(f.feature);
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
    const pkgDir = resolve(f.package ?? dir ?? 'f2f');
    const index = JSON.parse(await readFile(join(pkgDir, 'screens/index.json'), 'utf8'));
    const assets = new Map((JSON.parse(await readFile(join(pkgDir, 'assets/manifest.json'), 'utf8')).assets as any[]).map((a) => [a.id, a.file]));
    const manifestPath = join(pkgDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const s of index.screens) {
      const outline = s.outline ?? s.file.replace(/\.json$/, '.md');
      const md = screenOutline(JSON.parse(await readFile(join(pkgDir, s.file), 'utf8')), s.file, (id) => `../${assets.get(id) ?? `assets/${id}`}`);
      await writeFile(join(pkgDir, outline), md);
      manifest.files[outline] = sha256(md);
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`regenerated ${index.screens.length} screen outline(s) with this version of the tool`);
    return 0;
  }
  if (cmd === 'verify' && f.screen) {
    const win = f.window?.split('x').map(Number);
    const { report, files } = await verify({
      pkgDir: resolve(f.package ?? 'f2f'), screen: f.screen, url: f.url, measurementsFile: f.measurements,
      android: argv.includes('--android'), ios: argv.includes('--ios'), device: f.device,
      tolerancePx: f.tolerance ? Number(f.tolerance) : undefined, screenshot: !argv.includes('--no-screenshot'),
      window: win?.length === 2 ? { width: win[0]!, height: win[1]! } : undefined,
    });
    const s = report.summary;
    console.log(`${s.verdict.toUpperCase()}: ${s.passed}/${s.measured} layers within ±${report.tolerancePx}px, ${s.failed} off, ${s.textMetrics} text-width warnings, ${s.overflow} overflow, ${s.missingKey} required layers untagged${report.visual && !Number.isNaN(report.visual.mismatchRatio) ? `, visual diff ${(report.visual.mismatchRatio * 100).toFixed(1)}%` : ''}`);
    files.forEach((p) => console.log(`  ${p}`));
    return s.verdict === 'pass' ? 0 : 1;
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
