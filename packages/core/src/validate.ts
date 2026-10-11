import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../schema/f2f.schema.json';
import { sha256 } from './hash';

export interface Finding { severity: 'error' | 'warning'; file: string; message: string }

const FILE_DEFS: [RegExp, string][] = [
  [/^manifest\.json$/, 'manifest'],
  [/^screens\/index\.json$/, 'screenIndex'],
  [/^screens\/.+\.json$/, 'screenFile'],
  [/^components\/components\.json$/, 'componentsFile'],
  [/^tokens\/tokens\.json$/, 'tokensFile'],
  [/^assets\/manifest\.json$/, 'assetsManifest'],
  [/^flows\/navigation\.json$/, 'navigation'],
  [/^reports\/extraction-report\.json$/, 'report'],
  [/^reports\/unresolved-items\.json$/, 'unresolved'],
];

// Validates a package held in memory (path -> content) so the same check runs in tests, the CLI and later in CI.
export function validatePackage(files: Record<string, string | Uint8Array>): Finding[] {
  // ajv is CommonJS; under Node ESM the class sits on .default, under bundlers it is the default export itself.
  const Ajv = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(schema, 'dc');
  const findings: Finding[] = [];
  const parsed: Record<string, any> = {};
  const text = (d: string | Uint8Array) => (typeof d === 'string' ? d : new TextDecoder().decode(d));

  for (const [path, data] of Object.entries(files)) {
    const def = FILE_DEFS.find(([re]) => re.test(path))?.[1];
    if (!def) continue;
    try {
      parsed[path] = JSON.parse(text(data));
    } catch (e) {
      findings.push({ severity: 'error', file: path, message: `invalid JSON: ${String(e)}` });
      continue;
    }
    const validate = ajv.getSchema(`dc#/$defs/${def}`)!;
    if (!validate(parsed[path]))
      for (const err of validate.errors!.slice(0, 20)) findings.push({ severity: 'error', file: path, message: `${err.instancePath || '/'} ${err.message}` });
  }

  const manifest = parsed['manifest.json'];
  if (!manifest) return [...findings, { severity: 'error', file: 'manifest.json', message: 'missing' }];
  for (const [path, hash] of Object.entries(manifest.files as Record<string, string>)) {
    if (!(path in files)) findings.push({ severity: 'error', file: path, message: 'listed in manifest but missing' });
    else if (sha256(files[path]!) !== hash) findings.push({ severity: 'warning', file: path, message: 'content differs from manifest hash (edited or stale)' });
  }

  const componentIds = new Set((parsed['components/components.json']?.components ?? []).map((c: any) => c.id));
  const assets = parsed['assets/manifest.json']?.assets ?? [];
  const assetIds = new Set(assets.map((a: any) => a.id));
  for (const a of assets) if (!(a.file in files)) findings.push({ severity: 'error', file: 'assets/manifest.json', message: `asset file ${a.file} missing` });
  const variableIds = new Set((parsed['tokens/tokens.json']?.variables ?? []).map((v: any) => v.id));
  for (const s of parsed['screens/index.json']?.screens ?? []) {
    if (!(s.file in files)) {
      findings.push({ severity: 'error', file: 'screens/index.json', message: `screen file ${s.file} missing` });
      continue;
    }
    const deps = parsed[s.file]?.dependencies;
    if (!deps) continue;
    for (const id of deps.components) if (!componentIds.has(id)) findings.push({ severity: 'warning', file: s.file, message: `component ${id} not in components.json` });
    for (const id of deps.assets) if (!assetIds.has(id)) findings.push({ severity: 'error', file: s.file, message: `asset ${id} not in assets/manifest.json` });
    for (const id of deps.variables) if (!variableIds.has(id)) findings.push({ severity: 'warning', file: s.file, message: `variable ${id} not in tokens.json` });
  }
  return findings;
}
