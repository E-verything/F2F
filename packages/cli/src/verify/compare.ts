import type { Box, CanonNode, ScreenFile } from '../../../core/src/model';

// Framework-neutral comparison: any runtime (browser, Flutter test, native) that reports boxes per Figma node id can be verified here.

export interface MeasuredStyle { fontFamily: string; fontWeight: number; fontStyle: string; fontSize: number; color: string; background: string; radius: number; fontLoaded: boolean; hasText?: boolean }
export interface Measured { x: number; y: number; width: number; height: number; overflow?: boolean; text?: string; style?: MeasuredStyle }
export interface StyleMismatch { id: string; name: string; property: string; expected: string; actual: string }
export interface Measurements { screenId: string; source: string; viewport: { width: number; height: number }; nodes: Record<string, Measured>; narrow?: Narrow; fakedFonts?: string[] }
export interface Narrow { width: number; scrollWidth: number; cutOff: string[] }

export interface Mismatch { id: string; name: string; expected: Box; actual: Box; delta: { x: number; y: number; width: number; height: number } }
export interface VerifyReport {
  screen: { id: string; name: string };
  source: string;
  tolerancePx: number;
  viewport: { expected: { width: number; height: number }; actual: { width: number; height: number }; ok: boolean };
  summary: { designNodes: number; measured: number; passed: number; failed: number; textMetrics: number; coverage: number; missingKey: number; overflow: number; styleChecked: number; styleFailed: number; verdict: 'pass' | 'fail' | 'incomplete' };
  mismatches: Mismatch[];
  styles: StyleMismatch[];
  textMetrics: Mismatch[];
  missingKeyNodes: { id: string; name: string; depth: number }[];
  overflow: { id: string; name: string; text?: string }[];
  unknownIds: string[];
  narrow?: Narrow & { ok: boolean };
  code?: { rule: string; file: string; line: number; text: string }[];
  visual?: { mismatchRatio: number; diffImage: string | null; note: string };
}

// A text layer whose box hugs its content may differ by this share of its width from glyph-advance differences between font builds/engines.
export const TEXT_METRIC_SHARE = 0.05;
// Text that renders a little narrower/wider pushes its row neighbours sideways; drift this small, horizontal only, beside text is a font effect, not a layout bug.
export const TEXT_DRIFT_PX = 3;
// Layers deeper than this are optional to tag; only shallower ones count as missing coverage.
export const REQUIRED_DEPTH = 2;
const round = (n: number) => Math.round(n * 100) / 100;

interface Flat { node: CanonNode; depth: number; clip: Box; parent: CanonNode | null }

// Finite stand-in for 'unclipped' so box arithmetic never produces NaN.
const NO_CLIP: Box = { x: -1e9, y: -1e9, width: 2e9, height: 2e9 };

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

function flatten(root: CanonNode): Flat[] {
  const out: Flat[] = [];
  const walk = (n: CanonNode, depth: number, clip: Box, parent: CanonNode | null) => {
    if (n.visible === false) return;
    out.push({ node: n, depth, clip, parent });
    const own = depth === 0 ? { x: 0, y: 0, width: n.geometry.width, height: n.geometry.height } : n.calculated?.screenBox;
    const next = n.layout?.clipsContent && own ? intersect(clip, own) : clip;
    n.children?.forEach((c) => walk(c, depth + 1, next, n));
  };
  walk(root, 0, NO_CLIP, null);
  return out;
}

// Colour channels may differ by this much (rounding in Figma export vs CSS); font size by half a pixel.
const COLOR_SLACK = 2;
const SIZE_SLACK_PX = 0.5;

const hex = (css: string): { hex: string; alpha: number } | null => {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(css);
  if (!m) return null;
  return { hex: '#' + [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join(''), alpha: m[4] === undefined ? 1 : Number(m[4]) };
};
const sameColor = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= COLOR_SLACK);
const solid = (fills: unknown): string | null => {
  const visible = Array.isArray(fills) ? fills.filter((p: any) => p.visible !== false) : [];
  return visible.length === 1 && visible[0].type === 'solid' && (visible[0].opacity ?? 1) === 1 ? visible[0].color : null;
};
// A vector's fill is its shape colour (drawn by the SVG), not a CSS background.
const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'POLYGON']);
// Web font names carry build suffixes (next/font: "__Inter_d65c78"); compare letters only.
const familyKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

// Exact style facts per tagged layer: what geometry cannot see (colour, font, italic, background, corners).
function styleChecks(node: CanonNode, a: MeasuredStyle, box: Box): StyleMismatch[] {
  const out: StyleMismatch[] = [];
  const add = (property: string, expected: string, actual: string) => out.push({ id: node.id, name: node.name, property, expected, actual });
  if (node.type === 'TEXT' && node.text?.runs.length) {
    if (!a.hasText) return out;
    const run = [...node.text.runs].sort((x, y) => (y.end - y.start) - (x.end - x.start))[0]!;
    if (!familyKey(a.fontFamily.split(',')[0]!).includes(familyKey(run.fontFamily))) add('font-family', run.fontFamily, a.fontFamily.split(',')[0]!.trim());
    if (run.fontWeight && run.fontWeight !== a.fontWeight) add('font-weight', String(run.fontWeight), String(a.fontWeight));
    const italic = /italic|oblique/i.test(run.fontStyle);
    if (italic !== (a.fontStyle !== 'normal')) add('font-style', italic ? 'italic' : 'normal', a.fontStyle);
    if (Math.abs(run.fontSize - a.fontSize) > SIZE_SLACK_PX) add('font-size', `${run.fontSize}px`, `${a.fontSize}px`);
    if (!a.fontLoaded) add('font file', `${run.fontFamily} ${italic ? 'italic ' : ''}${run.fontWeight ?? run.fontStyle}`, 'not loaded: the browser fakes it (load this weight/style)');
    const want = solid(run.fills), got = hex(a.color);
    if (want && got && !sameColor(want, got.hex)) add('color', want, got.hex);
  } else if (!node.asset && !VECTOR_TYPES.has(node.type)) {
    const want = solid(node.style?.fills), got = hex(a.background);
    if (want && got) {
      if (got.alpha === 0) add('background', want, 'none');
      else if (!sameColor(want, got.hex)) add('background', want, got.hex);
    }
    const r = node.style?.cornerRadius;
    const radius = typeof r === 'number' ? r : r?.topLeft;
    // A radius of half the short side or more is a pill/circle in both tools, whatever the number.
    const pill = (v: number) => v >= Math.min(box.width, box.height) / 2 - 1;
    if (radius !== undefined && Math.abs(radius - a.radius) > 1 && !(pill(radius) && pill(a.radius))) add('border-radius', `${radius}px`, `${a.radius}px`);
  }
  return out;
}

const hasText =(n: CanonNode | null): boolean => !!n && (n.type === 'TEXT' || !!n.children?.some(hasText));

const within = (a: Box, e: Box, t: number) => Math.abs(a.x - e.x) <= t && Math.abs(a.y - e.y) <= t && Math.abs(a.width - e.width) <= t && Math.abs(a.height - e.height) <= t;

export function compare(screen: ScreenFile, m: Measurements, tolerancePx = 1): VerifyReport {
  const flat = flatten(screen.root);
  const byId = new Map(flat.map((f) => [f.node.id, f]));
  // A runtime root may sit anywhere on the page; everything is compared relative to the measured screen root.
  const origin = m.nodes[screen.root.id] ?? { x: 0, y: 0, width: m.viewport.width, height: m.viewport.height };
  const mismatches: Mismatch[] = [];
  const textMetrics: Mismatch[] = [];
  const styles: StyleMismatch[] = [];
  let styleChecked = 0;
  let passed = 0;
  for (const [id, a] of Object.entries(m.nodes)) {
    const f = byId.get(id);
    const e = f?.node.calculated?.screenBox ?? (f && f.depth === 0 ? { x: 0, y: 0, width: f.node.geometry.width, height: f.node.geometry.height } : undefined);
    if (!f || !e) continue;
    if (a.style) { styleChecked++; styles.push(...styleChecks(f.node, a.style, e)); }
    const actual = { x: round(a.x - origin.x), y: round(a.y - origin.y), width: round(a.width), height: round(a.height) };
    // Some runtimes (Flutter semantics, native accessibility) report boxes clipped by ancestors; the clipped design box is equally correct.
    const visible = intersect(e, f.clip);
    const delta = { x: round(actual.x - e.x), y: round(actual.y - e.y), width: round(actual.width - e.width), height: round(actual.height - e.height) };
    const hugsText = f.node.type === 'TEXT' && /WIDTH/.test(f.node.text?.autoResize ?? '');
    const onlyGlyphWidth = hugsText && within({ ...actual, width: e.width }, e, tolerancePx) && Math.abs(delta.width) <= Math.max(tolerancePx, e.width * TEXT_METRIC_SHARE);
    const textDrift = Math.abs(delta.y) <= tolerancePx && Math.abs(delta.height) <= tolerancePx && Math.abs(delta.x) <= TEXT_DRIFT_PX && Math.abs(delta.width) <= TEXT_DRIFT_PX && (hasText(f.parent ?? f.node) || hasText(f.parent ? byId.get(f.parent.id)?.parent ?? null : null));
    if (within(actual, e, tolerancePx) || within(actual, visible, tolerancePx)) passed++;
    else if (onlyGlyphWidth || textDrift) textMetrics.push({ id, name: f.node.name, expected: e, actual, delta });
    else mismatches.push({ id, name: f.node.name, expected: e, actual, delta });
  }
  // Untagged text counts too: a faked italic or weight changes every line it is used on.
  for (const f of m.fakedFonts ?? []) {
    const [font, ...sample] = f.split(': ');
    styles.push({ id: '—', name: 'page text', property: 'font file', expected: font!, actual: `not loaded, the browser fakes it (${sample.join(': ')})` });
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
  const narrow = m.narrow && { ...m.narrow, ok: m.narrow.scrollWidth <= m.narrow.width + 1 && !m.narrow.cutOff.length };
  const verdict = failed || styles.length || overflow.length || !viewportOk || narrow?.ok === false ? 'fail' : !measuredIds.size || missingKeyNodes.length ? 'incomplete' : 'pass';
  return {
    screen: { id: screen.screen.id, name: screen.screen.name },
    source: m.source,
    tolerancePx,
    viewport: { expected: expectedViewport, actual: m.viewport, ok: viewportOk },
    summary: { designNodes: flat.length, measured: measuredIds.size, passed, failed, textMetrics: textMetrics.length, coverage: round(measuredIds.size / flat.length), missingKey: missingKeyNodes.length, overflow: overflow.length, styleChecked, styleFailed: styles.length, verdict },
    mismatches, styles, textMetrics, missingKeyNodes, overflow, unknownIds,
    ...(narrow ? { narrow } : {}),
  };
}

export function reportMarkdown(r: VerifyReport): string {
  const s = r.summary;
  const md = [
    `# Verification: ${r.screen.name}`,
    '',
    `**${s.verdict.toUpperCase()}**: ${s.passed}/${s.measured} measured layers within ±${r.tolerancePx}px, ${s.failed} off, ${s.styleFailed} style differences (of ${s.styleChecked} checked), ${s.textMetrics} font-metric warnings, ${s.overflow} text overflow, ${s.missingKey} required layers not tagged (coverage ${Math.round(s.coverage * 100)}% of ${s.designNodes} design layers). Source: ${r.source}. Viewport ${r.viewport.actual.width}x${r.viewport.actual.height} (design ${r.viewport.expected.width}x${r.viewport.expected.height})${r.viewport.ok ? '' : ' **MISMATCH**'}.`,
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
  if (r.styles.length) md.push('## Style differences (fix these)', '', 'Exact computed CSS vs the Figma values, so font rendering does not matter here.', '', '| Layer | id | Property | Figma | App |', '|---|---|---|---|---|', ...r.styles.slice(0, 50).map((x) => `| ${x.name} | ${x.id} | ${x.property} | ${x.expected} | ${x.actual} |`), r.styles.length > 50 ? `| … ${r.styles.length - 50} more in the JSON report | | | | |` : '', '');
  if (r.textMetrics.length) md.push('## Font-metric differences (warning, do not fix in layout)', '', `Text renders slightly narrower or wider than in Figma (font build/engine), which also shifts its row neighbours sideways by up to ${TEXT_DRIFT_PX}px. Vertical position and height match. Check the font version; do not add padding or offsets for these.`, '', ...r.textMetrics.map((x) => `- ${x.name} (${x.id}): Δx ${x.delta.x} Δw ${x.delta.width}`), '');
  if (r.narrow) md.push(`## Small screen (${r.narrow.width}px wide)`, '', r.narrow.ok ? 'OK: no horizontal scroll, no content cut off.' : `**FAIL**: page is ${r.narrow.scrollWidth}px wide (scrolls sideways) or content is cut off. Make the layout fluid (see "Production code rules" in the brief). Cut off (figma id, text):`, ...r.narrow.cutOff.map((c) => `- ${c}`), '');
  if (r.code?.length) md.push('## Code rules (fix these)', '', 'Production code rules checked in the source.', '', ...r.code.map((c) => `- ${c.file}:${c.line} — ${c.rule}: ${c.text}`), '');
  if (r.overflow.length) md.push('## Text overflow', '', ...r.overflow.map((o) => `- ${o.name} (${o.id})${o.text ? `: "${o.text}"` : ''}`), '');
  if (r.missingKeyNodes.length) md.push(`## Not tagged (tag these to verify them)`, '', ...r.missingKeyNodes.slice(0, 40).map((n) => `- ${n.name} (${n.id})`), r.missingKeyNodes.length > 40 ? `- … ${r.missingKeyNodes.length - 40} more` : '', '');
  if (r.unknownIds.length) md.push(`Tagged ids not in this screen (typo or other screen): ${r.unknownIds.slice(0, 20).join(', ')}`, '');
  return md.join('\n') + '\n';
}
