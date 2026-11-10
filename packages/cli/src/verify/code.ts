import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

// Production code rules an agent can read past; checked in the source so they cannot be skipped.

export interface CodeIssue { rule: string; file: string; line: number; text: string }

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'f2f', 'android', 'ios', '.dart_tool']);
const SOURCE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.css', '.scss', '.dart']);
// Ids built from strings/arithmetic only look right by accident: Figma ids are not sequential.
const COMPUTED_ID = /(data-figma-id|testID|identifier|testTag)\s*[=:]\s*\{?[^\n]*(split\(|\$\{[^}]*[+-]\s*\d|Number\()/;
// A two-decimal box size or spacing is a raw Figma measurement copied to chase pixels; typography (letter-spacing, line-height) keeps its exact design values.
const RAW_MEASUREMENT = /^\s*(padding|margin|width|height|min-width|min-height|max-width|max-height|top|right|bottom|left|inset|gap|row-gap|column-gap)(-[a-z]+)?\s*:[^;]*\b\d+\.\d{2,}px\b/;
const MAX_ISSUES = 30;

async function sources(dir: string, root: string, out: string[]) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await sources(join(dir, e.name), root, out);
    } else if (SOURCE_EXT.has(extname(e.name)) && !/\.(test|spec)\./.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

export async function codeChecks(repoDir: string): Promise<CodeIssue[]> {
  const issues: CodeIssue[] = [];
  for (const file of await sources(repoDir, repoDir, [])) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((text, i) => {
      if (COMPUTED_ID.test(text)) issues.push({ rule: 'computed Figma id (write the id as a literal)', file: relative(repoDir, file).split(sep).join('/'), line: i + 1, text: text.trim().slice(0, 100) });
      else if (RAW_MEASUREMENT.test(text)) issues.push({ rule: 'raw sub-pixel value (round to whole px or a token)', file: relative(repoDir, file).split(sep).join('/'), line: i + 1, text: text.trim().slice(0, 100) });
    });
  }
  return issues.slice(0, MAX_ISSUES);
}
