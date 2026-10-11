import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { validatePackage } from '../../core/src/validate';
import { compileFeature } from './repo/compile';
import { inspectRepo } from './repo/inspect';

// Measured, not estimated, except tokens: those use a stated chars-per-token ratio because no tokenizer ships with the tool.
export const CHARS_PER_TOKEN = 3.5;

const tokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);
const ms = (t0: number) => Math.round((performance.now() - t0) * 10) / 10;

async function tree(root: string): Promise<{ path: string; bytes: number }[]> {
  const out: { path: string; bytes: number }[] = [];
  for (const e of await readdir(root, { recursive: true, withFileTypes: true }))
    if (e.isFile()) {
      const full = join(e.parentPath, e.name);
      out.push({ path: relative(root, full).split(sep).join('/'), bytes: (await stat(full)).size });
    }
  return out;
}

export async function bench(pkgDir: string, repoDir?: string, feature?: string) {
  const files = await tree(pkgDir);
  const sum = (re: RegExp) => files.filter((f) => re.test(f.path)).reduce((a, f) => a + f.bytes, 0);
  const report = JSON.parse(await readFile(join(pkgDir, 'reports/extraction-report.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(pkgDir, 'manifest.json'), 'utf8'));
  const index = JSON.parse(await readFile(join(pkgDir, 'screens/index.json'), 'utf8'));
  const screens = await Promise.all((index.screens as any[]).map(async (s) => {
    const json = (await stat(join(pkgDir, s.file))).size;
    const outlinePath = s.outline ?? s.file.replace(/\.json$/, '.md');
    const outline = await stat(join(pkgDir, outlinePath)).then((x) => x.size, () => 0);
    return { name: s.name, jsonBytes: json, outlineBytes: outline, outlineTokensEst: tokens(outline), jsonTokensEst: tokens(json) };
  }));

  let t0 = performance.now();
  const contents: Record<string, Uint8Array> = {};
  for (const f of files) contents[f.path] = await readFile(join(pkgDir, f.path));
  const findings = validatePackage(contents);
  const validateMs = ms(t0);

  let brief: Record<string, unknown> | null = null;
  if (repoDir && feature) {
    t0 = performance.now();
    const repo = await inspectRepo(repoDir);
    const inspectMs = ms(t0);
    t0 = performance.now();
    const b = await compileFeature(pkgDir, feature, repo);
    brief = { inspectMs, compileMs: ms(t0), repo: { components: repo.components.length, tokens: repo.tokens.length, assets: repo.assets.length }, briefChars: b.markdown.length, briefTokensEst: tokens(b.markdown.length) };
  }

  return {
    tokensEstimate: `chars / ${CHARS_PER_TOKEN}`,
    extraction: { status: report.status, ...report.counts, pluginTiming: manifest.volatile?.timing ?? null },
    package: {
      files: files.length,
      totalBytes: files.reduce((a, f) => a + f.bytes, 0),
      assetBytes: sum(/^assets\//),
      screenJsonBytes: sum(/^screens\/.*\.json$/) - (files.find((f) => f.path === 'screens/index.json')?.bytes ?? 0),
      componentsBytes: sum(/^components\//),
      tokensBytes: sum(/^tokens\//),
      designMdTokensEst: tokens(files.find((f) => f.path === 'DESIGN.md')?.bytes ?? 0),
    },
    screens,
    validate: { ms: validateMs, errors: findings.filter((f) => f.severity === 'error').length, warnings: findings.filter((f) => f.severity === 'warning').length },
    brief,
    process: { node: process.version, platform: `${process.platform}-${process.arch}`, peakRssMb: Math.round(process.memoryUsage().rss / 1048576) },
  };
}
