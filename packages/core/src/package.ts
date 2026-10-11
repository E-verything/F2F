import { sha256 } from './hash';
import { SCHEMA_VERSION } from './model';
import { normalize, slugify, type Normalized } from './normalize';
import type { RawSnapshot } from './raw';
import { designMd } from './design-md';
import { screenOutline } from './outline';
import schema from '../schema/f2f.schema.json';

export type PackageFiles = Record<string, string | Uint8Array>;

export interface BuildOptions {
  exportedAt: string;
  timing?: Record<string, number>;
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
// Large agent-facing data files are minified; whitespace was ~70% of their size on a real file.
const jsonMin = (v: unknown) => JSON.stringify(v) + '\n';

export function buildPackage(snap: RawSnapshot, opts: BuildOptions): PackageFiles {
  const n = normalize(snap);
  const files: PackageFiles = {};

  const assetFile = (a: RawSnapshot['assets'][number]) => `assets/${a.role === 'screenshot' ? 'screenshots/' : ''}${a.id}.${a.format}`;
  const assetPaths = new Map(snap.assets.map((a) => [a.id, assetFile(a)]));
  const screenIndex = n.screens.map((s) => {
    const path = `screens/${s.info.slug}.json`;
    const outline = `screens/${s.info.slug}.md`;
    const body = jsonMin(s.file);
    files[path] = body;
    files[outline] = screenOutline(s.file, path, (id) => `../${assetPaths.get(id) ?? `assets/${id}`}`);
    return { ...s.info, file: path, outline, contentHash: sha256(body) };
  });
  files['screens/index.json'] = json({ schemaVersion: SCHEMA_VERSION, screens: screenIndex });
  files['components/components.json'] = jsonMin({ schemaVersion: SCHEMA_VERSION, components: n.components, componentSets: n.componentSets });
  files['tokens/tokens.json'] = jsonMin({ schemaVersion: SCHEMA_VERSION, collections: n.collections, variables: n.variables, styles: n.styles });
  files['flows/navigation.json'] = json({
    schemaVersion: SCHEMA_VERSION,
    note: 'Figma prototype interactions only. They do not describe backend, validation, auth or application-state requirements.',
    flows: n.navigation,
  });

  const assets = [...snap.assets].sort((a, b) => a.id.localeCompare(b.id)).map((a) => {
    const path = assetFile(a);
    files[path] = a.data;
    const entry: Record<string, unknown> = { id: a.id, role: a.role, format: a.format, file: path, sourceNodeIds: [...a.sourceNodeIds].sort() };
    if (a.imageHash) entry.imageHash = a.imageHash;
    return entry;
  });
  files['assets/manifest.json'] = json({
    schemaVersion: SCHEMA_VERSION,
    note: 'Screenshots are supplementary verification references, never the source of truth for geometry.',
    assets,
  });

  const errors = n.issues.filter((i) => i.severity === 'error');
  const status = snap.status !== 'complete' ? snap.status : errors.length ? 'partial' : 'complete';
  files['reports/extraction-report.json'] = json({
    schemaVersion: SCHEMA_VERSION,
    status,
    counts: {
      pages: n.stats.pages, screens: n.screens.length, nodes: n.stats.nodes, propertiesRead: n.stats.properties,
      unsupportedProperties: n.stats.unsupported, components: n.components.length, variables: n.variables.length, styles: n.styles.length,
      assets: assets.length, errors: errors.length, warnings: n.issues.filter((i) => i.severity === 'warning').length,
    },
    unsupportedSummary: unsupportedSummary(n),
    skipped: n.skipped,
    issues: n.issues,
  });
  files['reports/unresolved-items.json'] = json({ schemaVersion: SCHEMA_VERSION, items: unresolved(n) });
  files['design-schema.json'] = json(schema);
  if (snap.restJson) for (const [id, rest] of Object.entries(snap.restJson)) files[`raw/rest/${id.replace(/[^A-Za-z0-9]+/g, '-')}.json`] = json(rest);
  files['DESIGN.md'] = designMd(n, snap, screenIndex);

  const hashes = Object.fromEntries(Object.keys(files).sort().map((p) => [p, sha256(files[p]!)]));
  files['manifest.json'] = json({
    schemaVersion: SCHEMA_VERSION,
    generator: { name: snap.plugin.name, version: snap.plugin.version, rawVersion: snap.rawVersion },
    source: { fileName: snap.file.name, fileKey: snap.file.key, editorType: snap.file.editorType, pages: [...new Map(n.screens.map((s) => [s.info.pageId, s.info.pageName]))].map(([id, name]) => ({ id, name })) },
    scope: snap.scope,
    status,
    features: features(n),
    indexes: { screens: 'screens/index.json', components: 'components/components.json', tokens: 'tokens/tokens.json', assets: 'assets/manifest.json', navigation: 'flows/navigation.json', report: 'reports/extraction-report.json', unresolved: 'reports/unresolved-items.json' },
    files: hashes,
    volatile: { note: 'Only this object changes between exports of an unchanged design.', exportedAt: opts.exportedAt, timing: opts.timing ?? {} },
  });
  return files;
}

function features(n: Normalized) {
  const map = new Map<string, string[]>();
  for (const s of n.screens) {
    const name = s.info.feature ?? s.info.pageName;
    map.set(name, [...(map.get(name) ?? []), s.info.id]);
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([name, screenIds]) => ({ name, slug: slugify(name), screenIds, source: 'figma-section-or-page' }));
}

function unsupportedSummary(n: Normalized) {
  const counts = new Map<string, number>();
  const visit = (node: any) => {
    for (const u of node.unsupported ?? []) counts.set(u.property, (counts.get(u.property) ?? 0) + 1);
    node.children?.forEach(visit);
  };
  n.screens.forEach((s) => visit(s.file.root));
  n.components.forEach((c) => c.definition && visit(c.definition));
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([property, count]) => ({ property, count }));
}

const UNRESOLVED_CODES: Record<string, string> = {
  'font-missing': 'Install the font or confirm the substitute before implementing.',
  'font-unknown': 'Confirm the intended font for this text.',
  'component-definition-unavailable': 'Export the library/page containing this component or confirm its implementation.',
  'variable-unresolved': 'Export the variable collection or confirm the token value.',
  'image-unavailable': 'Provide the image asset.',
  'approval-unknown': 'Confirm whether this screen is approved for implementation.',
  'extraction-error': 'Re-run the export or inspect the node manually.',
  'property-read-failed': 'Inspect this property in Figma manually; it could not be read.',
};

function unresolved(n: Normalized) {
  const items = n.issues
    .filter((i) => UNRESOLVED_CODES[i.code])
    .map((i) => ({ code: i.code, nodeId: i.nodeId, message: i.message, action: UNRESOLVED_CODES[i.code] }));
  for (const s of n.screens)
    items.push({ code: 'responsive-undefined', nodeId: s.info.id, message: `Only one viewport (${s.info.viewport.width}x${s.info.viewport.height}) exists for "${s.info.name}".`, action: 'Confirm breakpoint behaviour or export the other viewport designs.' });
  return items;
}
