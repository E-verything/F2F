import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScreenFile } from '../../../core/src/model';
import { compare, reportMarkdown, type Measurements, type VerifyReport } from './compare';
import { measureAndroid, measureIos } from './mobile';
import { decodePng, diffImages, encodePng } from './png';
import { measureWeb } from './web';

export interface VerifyOptions {
  pkgDir: string;
  screen: string;
  url?: string;
  android?: boolean;
  ios?: boolean;
  device?: string;
  measurementsFile?: string;
  tolerancePx?: number;
  // Browser window; larger than the design so centred/padded app frames are not squeezed.
  window?: { width: number; height: number };
  screenshot?: boolean;
}

// Extra room around the design frame in the browser window by default.
const WINDOW_MARGIN = 200;

export async function findScreen(pkgDir: string, key: string): Promise<{ info: any; file: ScreenFile }> {
  const index = JSON.parse(await readFile(join(pkgDir, 'screens/index.json'), 'utf8'));
  const k = key.toLowerCase();
  const info = (index.screens as any[]).find((s) => s.id === key || s.slug === k || s.name.toLowerCase() === k) ?? (index.screens as any[]).find((s) => s.slug.startsWith(k));
  if (!info) throw new Error(`No screen "${key}". Screens: ${(index.screens as any[]).map((s) => `${s.slug} (${s.id})`).join(', ')}`);
  return { info, file: JSON.parse(await readFile(join(pkgDir, info.file), 'utf8')) };
}

export async function verify(o: VerifyOptions): Promise<{ report: VerifyReport; files: string[] }> {
  const { info, file } = await findScreen(o.pkgDir, o.screen);
  const vp = file.screen.viewport;
  let measurements: Measurements;
  let shot: Buffer | null = null;
  if (o.url) {
    const r = await measureWeb({ url: o.url, rootId: file.root.id, viewport: o.window ?? { width: vp.width + WINDOW_MARGIN, height: vp.height + WINDOW_MARGIN }, screenshot: o.screenshot !== false });
    measurements = r.measurements;
    shot = r.screenshot;
  } else if (o.android) measurements = measureAndroid(file.root.id, o.device);
  else if (o.ios) measurements = measureIos(file.root.id, o.device);
  else if (o.measurementsFile) measurements = JSON.parse(await readFile(o.measurementsFile, 'utf8'));
  else throw new Error('Give one of --url, --android, --ios or --measurements.');

  const report = compare(file, measurements, o.tolerancePx ?? 1);
  const outDir = join(o.pkgDir, 'verification');
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  if (shot) {
    const appPath = join(outDir, `${info.slug}.app.png`);
    await writeFile(appPath, shot);
    files.push(appPath);
    const assets = JSON.parse(await readFile(join(o.pkgDir, 'assets/manifest.json'), 'utf8')).assets as any[];
    const ref = assets.find((a) => a.role === 'screenshot' && a.sourceNodeIds.includes(file.root.id));
    if (ref) {
      try {
        const { ratio, diff } = diffImages(decodePng(await readFile(join(o.pkgDir, ref.file))), decodePng(shot));
        const diffPath = join(outDir, `${info.slug}.diff.png`);
        await writeFile(diffPath, encodePng(diff));
        files.push(diffPath);
        report.visual = { mismatchRatio: Math.round(ratio * 10000) / 10000, diffImage: `${info.slug}.diff.png`, note: 'Red = pixels differing from the Figma screenshot. Use for spotting, not as pass/fail.' };
      } catch (e) {
        report.visual = { mismatchRatio: NaN, diffImage: null, note: `Visual diff skipped: ${e instanceof Error ? e.message : String(e)}.` };
      }
    } else report.visual = { mismatchRatio: NaN, diffImage: null, note: 'No Figma reference screenshot in the package (export with "Reference screenshots").' };
  }
  const jsonPath = join(outDir, `${info.slug}.json`);
  const mdPath = join(outDir, `${info.slug}.md`);
  await writeFile(jsonPath, JSON.stringify({ report, measurements }, null, 2) + '\n');
  await writeFile(mdPath, reportMarkdown(report));
  files.unshift(mdPath, jsonPath);
  return { report, files };
}
