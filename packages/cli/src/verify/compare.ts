import type { Box, CanonNode, ScreenFile } from '../../../core/src/model';

// Framework-neutral comparison: any runtime (browser, Flutter test, native) that reports boxes per Figma node id can be verified here.

export interface Measured { x: number; y: number; width: number; height: number; overflow?: boolean; text?: string }
export interface Measurements { screenId: string; source: string; viewport: { width: number; height: number }; nodes: Record<string, Measured> }

export interface Mismatch { id: string; name: string; expected: Box; actual: Box; delta: { x: number; y: number; width: number; height: number } }
export interface VerifyReport {
  screen: { id: string; name: string };
  source: string;
  tolerancePx: number;
  viewport: { expected: { width: number; height: number }; actual: { width: number; height: number }; ok: boolean };
  summary: { designNodes: number; measured: number; passed: number; failed: number; textMetrics: number; coverage: number; missingKey: number; overflow: number; verdict: 'pass' | 'fail' | 'incomplete' };
  mismatches: Mismatch[];
  textMetrics: Mismatch[];
  missingKeyNodes: { id: string; name: string; depth: number }[];
  overflow: { id: string; name: string; text?: string }[];
  unknownIds: string[];
  visual?: { mismatchRatio: number; diffImage: string | null; note: string };
}

// A text layer whose box hugs its content may differ by this share of its width from glyph-advance differences between font builds/engines.
export const TEXT_METRIC_SHARE = 0.05;
// Layers deeper than this are optional to tag; only shallower ones count as missing coverage.
export const REQUIRED_DEPTH = 2;
const round = (n: number) => Math.round(n * 100) / 100;

interface Flat { node: CanonNode; depth: number; clip: Box }

// Finite stand-in for 'unclipped' so box arithmetic never produces NaN.
const NO_CLIP: Box = { x: -1e9, y: -1e9, width: 2e9, height: 2e9 };

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

function flatten(root: CanonNode): Flat[] {
  const out: Flat[] = [];
  const walk = (n: CanonNode, depth: number, clip: Box) => {
    if (n.visible === false) return;
    out.push({ node: n, depth, clip });
    const own = depth === 0 ? { x: 0, y: 0, width: n.geometry.width, height: n.geometry.height } : n.calculated?.screenBox;
    const next = n.layout?.clipsContent && own ? intersect(clip, own) : clip;
    n.children?.forEach((c) => walk(c, depth + 1, next));
  };
  walk(root, 0, NO_CLIP);
  return out;
}

const within = (a: Box, e: Box, t: number) => Math.abs(a.x - e.x) <= t && Math.abs(a.y - e.y) <= t && Math.abs(a.width - e.width) <= t && Math.abs(a.height - e.height) <= t;

export function compare(screen: ScreenFile, m: Measurements, tolerancePx = 1): VerifyReport {
  const flat = flatten(screen.root);
  const byId = new Map(flat.map((f) => [f.node.id, f]));
  // A runtime root may sit anywhere on the page; everything is compared relative to the measured screen root.
  const origin = m.nodes[screen.root.id] ?? { x: 0, y: 0, width: m.viewport.width, height: m.viewport.height };
  const mismatches: Mismatch[] = [];
  const textMetrics: Mismatch[] = [];
  let passed = 0;
  for (const [id, a] of Object.entries(m.nodes)) {
    const f = byId.get(id);
    const e = f?.node.calculated?.screenBox ?? (f && f.depth === 0 ? { x: 0, y: 0, width: f.node.geometry.width, height: f.node.geometry.height } : undefined);
    if (!f || !e) continue;
    const actual = { x: round(a.x - origin.x), y: round(a.y - origin.y), width: round(a.width), height: round(a.height) };
    // Some runtimes (Flutter semantics, native accessibility) report boxes clipped by ancestors; the clipped design box is equally correct.
    const visible = intersect(e, f.clip);
    const delta = { x: round(actual.x - e.x), y: round(actual.y - e.y), width: round(actual.width - e.width), height: round(actual.height - e.height) };
    const hugsText = f.node.type === 'TEXT' && /WIDTH/.test(f.node.text?.autoResize ?? '');
    const onlyGlyphWidth = hugsText && within({ ...actual, width: e.width }, e, tolerancePx) && Math.abs(delta.width) <= Math.max(tolerancePx, e.width * TEXT_METRIC_SHARE);
    if (within(actual, e, tolerancePx) || within(actual, visible, tolerancePx)) passed++;
    else if (onlyGlyphWidth) textMetrics.push({ id, name: f.node.name, expected: e, actual, delta });
    else mismatches.push({ id, name: f.node.name, expected: e, actual, delta });
  }
  mismatches.sort((a, b) => Math.max(...Object.values(b.delta).map(Math.abs)) - Math.max(...Object.values(a.delta).map(Math.abs)) || a.id.localeCompare(b.id));
  const measuredIds = new Set(Object.keys(m.nodes).filter((id) => byId.has(id)));
  const missingKeyNodes = flat.filter((f) => f.depth > 0 && f.depth <= REQUIRED_DEPTH && !measuredIds.has(f.node.id)).map((f) => ({ id: f.node.id, name: f.node.name, depth: f.depth }));
  const overflow = Object.entries(m.nodes).filter(([, a]) => a.overflow).map(([id, a]) => ({ id, name: byId.get(id)?.node.name ?? '?', ...(a.text ? { text: a.text } : {}) }));
  const unknownIds = Object.keys(m.nodes).filter((id) => !byId.has(id)).sort();
  const expectedViewport = screen.screen.viewport;
  const viewportOk = Math.abs(m.viewport.width - expectedViewport.width) <= tolerancePx && Math.abs(m.viewport.height - expectedViewport.height) <= tolerancePx;
  const failed = mismatches.length;
  // Concrete failures win over missing coverage because they are what the implementer must fix first.
  const verdict = failed || overflow.length || !viewportOk ? 'fail' : !measuredIds.size || missingKeyNodes.length ? 'incomplete' : 'pass';
  return {
    screen: { id: screen.screen.id, name: screen.screen.name },
    source: m.source,
    tolerancePx,
    viewport: { expected: expectedViewport, actual: m.viewport, ok: viewportOk },
    summary: { designNodes: flat.length, measured: measuredIds.size, passed, failed, textMetrics: textMetrics.length, coverage: round(measuredIds.size / flat.length), missingKey: missingKeyNodes.length, overflow: overflow.length, verdict },
    mismatches, textMetrics, missingKeyNodes, overflow, unknownIds,
  };
}

export function reportMarkdown(r: VerifyReport): string {
  const s = r.summary;
  const md = [
    `# Verification: ${r.screen.name}`,
    '',
    `**${s.verdict.toUpperCase()}**: ${s.passed}/${s.measured} measured layers within ±${r.tolerancePx}px, ${s.failed} off, ${s.textMetrics} text width only (font metrics), ${s.overflow} text overflow, ${s.missingKey} required layers not tagged (coverage ${Math.round(s.coverage * 100)}% of ${s.designNodes} design layers). Source: ${r.source}. Viewport ${r.viewport.actual.width}x${r.viewport.actual.height} (design ${r.viewport.expected.width}x${r.viewport.expected.height})${r.viewport.ok ? '' : ' **MISMATCH**'}.`,
    '',
  ];
  if (r.visual) md.push(`Visual (supplementary, font rendering differs across engines): ${Math.round(r.visual.mismatchRatio * 1000) / 10}% of pixels differ${r.visual.diffImage ? `, diff image: ${r.visual.diffImage}` : ''}. ${r.visual.note}`, '');
  if (r.mismatches.length) {
    md.push('## Fix these (largest first)', '', '| Layer | id | Expected x,y wxh | Actual x,y wxh | Δx Δy Δw Δh |', '|---|---|---|---|---|');
    for (const x of r.mismatches.slice(0, 50))
      md.push(`| ${x.name} | ${x.id} | ${x.expected.x},${x.expected.y} ${x.expected.width}x${x.expected.height} | ${x.actual.x},${x.actual.y} ${x.actual.width}x${x.actual.height} | ${x.delta.x} ${x.delta.y} ${x.delta.width} ${x.delta.height} |`);
    if (r.mismatches.length > 50) md.push(`| … ${r.mismatches.length - 50} more in the JSON report | | | | |`);
    md.push('');
  }
  if (r.textMetrics.length) md.push('## Text width differs only (warning)', '', 'Position and height match; the hugging width differs by glyph advances (font build/engine). Check the font version before changing layout.', '', ...r.textMetrics.map((x) => `- ${x.name} (${x.id}): ${x.expected.width} → ${x.actual.width}px`), '');
  if (r.overflow.length) md.push('## Text overflow', '', ...r.overflow.map((o) => `- ${o.name} (${o.id})${o.text ? `: "${o.text}"` : ''}`), '');
  if (r.missingKeyNodes.length) md.push(`## Not tagged (tag these to verify them)`, '', ...r.missingKeyNodes.slice(0, 40).map((n) => `- ${n.name} (${n.id})`), r.missingKeyNodes.length > 40 ? `- … ${r.missingKeyNodes.length - 40} more` : '', '');
  if (r.unknownIds.length) md.push(`Tagged ids not in this screen (typo or other screen): ${r.unknownIds.slice(0, 20).join(', ')}`, '');
  return md.join('\n') + '\n';
}
