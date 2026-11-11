import type { Box, CanonNode, ScreenFile } from '../../../core/src/model';

// Framework-neutral comparison: any runtime (browser, Flutter test, native) that reports boxes per Figma node id can be verified here.

export interface MeasuredStyle { fontFamily: string; fontWeight: number; fontStyle: string; fontSize: number; color: string; background: string; radius: number; fontLoaded: boolean; hasText?: boolean }
// loose: measured from rendered text (line boxes), not a tagged element, so it gets the font-metric tolerance.
export interface Measured { x: number; y: number; width: number; height: number; overflow?: boolean; text?: string; style?: MeasuredStyle; loose?: boolean }
export interface StyleMismatch { id: string; name: string; property: string; expected: string; actual: string }
export interface Measurements { screenId: string; source: string; viewport: { width: number; height: number }; nodes: Record<string, Measured>; narrow?: Narrow; fakedFonts?: string[]; lines?: Record<string, TextBlock[]>; assets?: Record<string, Box[]> }
// Every visible element showing a design text, keyed by the text without spaces, lowercased.
export interface TextBlock { x: number; y: number; lines: string[]; width?: number; left?: number; right?: number; top?: number; bottom?: number; style?: { fontFamily: string; fontSize: number; fontWeight: number; fontStyle: string; color: string; letterSpacing: number; textTransform?: string; textDecoration?: string } }
export interface Narrow { width: number; scrollWidth: number; cutOff: string[] }

export interface Finding { n: number; severity: 'fix' | 'check'; kind: string; id: string; name: string; what: string; fix: string; box: Box; actual?: Box; crop: string }
export interface Hotspot { id: string; name: string; kind: 'text' | 'image' | 'icon'; share: number; box: Box; text?: string }
export interface LineMismatch { id: string; name: string; kind?: 'lines' | 'align'; figma: string[]; app: string[]; hint?: string; box?: Box; dx?: number; text?: string }
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
  visual?: { mismatchRatio: number; noiseRatio?: number; diffImage: string | null; note: string; hotspots?: Hotspot[] };
  lines?: LineMismatch[];
  findings?: Finding[];
  // Measured differences no code or font change can remove (the two text engines), shown so nothing is hidden.
  engineNote?: string;
}

// A text layer whose box hugs its content may differ by this share of its width from glyph-advance differences between font builds/engines.
export const TEXT_METRIC_SHARE = 0.05;
// Text that renders a little narrower/wider pushes its row neighbours sideways; drift this small, horizontal only, beside text is a font effect, not a layout bug.
export const TEXT_DRIFT_PX = 3;
// Layers deeper than this are optional to tag; only shallower ones count as missing coverage.
export const REQUIRED_DEPTH = 2;
// Text measured from its line boxes: glyph metrics differ between Figma and browsers by up to a few px.
const TEXT_BOX_TOLERANCE_PX = 3;
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

type Shift = { x: number; y: number };
// Shifts of a measured box's start, centre and end edges: a child placed against any of them moves with it.
const edgeShifts = (a: Box, e: Box): Shift[] => [
  { x: a.x - e.x, y: a.y - e.y },
  { x: a.x + a.width / 2 - e.x - e.width / 2, y: a.y + a.height / 2 - e.y - e.height / 2 },
  { x: a.x + a.width - e.x - e.width, y: a.y + a.height - e.y - e.height },
];
// Per axis, the explained shift closest to the layer's own shift; what is left is the layer's own error.
const closest = (v: number, options: number[]) => options.reduce((best, o) => (Math.abs(v - o) < Math.abs(v - best) ? o : best), 0);

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
  const expectedOf = (f: Flat | undefined) => f?.node.calculated?.screenBox ?? (f && f.depth === 0 ? { x: 0, y: 0, width: f.node.geometry.width, height: f.node.geometry.height } : undefined);
  const actualOf = (id: string) => { const a = m.nodes[id]; return a && { x: round(a.x - origin.x), y: round(a.y - origin.y), width: round(a.width), height: round(a.height) }; };
  // A shift already explained by the nearest measured ancestor or the previous measured sibling (flow) is reported once, at its cause, not on every layer below it.
  const inherited = (f: Flat): Shift[] => {
    const out: Shift[] = [];
    let p = f.parent;
    while (p && !m.nodes[p.id]) p = byId.get(p.id)?.parent ?? null;
    const pe = p && expectedOf(byId.get(p.id)), pa = p && actualOf(p.id);
    if (pe && pa) out.push(...edgeShifts(pa, pe));
    // The layer before it in the flow: a measured sibling, or the last measured layer inside one (an icon wrapped in its own container),
    // climbing through untagged wrappers up to the measured ancestor.
    const lastMeasured = (n: CanonNode): CanonNode | null => {
      for (const c of [...(n.children ?? [])].reverse()) { const hit = lastMeasured(c); if (hit) return hit; }
      return m.nodes[n.id] ? n : null;
    };
    for (let cur: Flat | undefined = f; cur?.parent && cur.node.layout?.positioning !== 'absolute'; cur = byId.get(cur.parent.id)) {
      const sibs = cur.parent.children ?? [];
      let prev: CanonNode | null = null;
      for (let i = sibs.indexOf(cur.node) - 1; i >= 0 && !prev; i--) prev = lastMeasured(sibs[i]!);
      const se = prev && expectedOf(byId.get(prev.id)), sa = prev && actualOf(prev.id);
      if (se && sa) { out.push(...edgeShifts(sa, se)); break; }
      if (cur.parent === p) break;
    }
    return out;
  };
  for (const [id, a] of Object.entries(m.nodes)) {
    const f = byId.get(id);
    const e = expectedOf(f);
    if (!f || !e) continue;
    if (a.style) { styleChecked++; styles.push(...styleChecks(f.node, a.style, e)); }
    const actual = actualOf(id)!;
    const shifts = inherited(f);
    const sx = closest(actual.x - e.x, shifts.map((s) => s.x)), sy = closest(actual.y - e.y, shifts.map((s) => s.y));
    // Compare against the design box moved by the explained shift, so only this layer's own error counts.
    const moved = { ...e, x: e.x + sx, y: e.y + sy };
    // Some runtimes (Flutter semantics, native accessibility) report boxes clipped by ancestors; the clipped design box is equally correct.
    const visible = intersect(e, f.clip);
    const delta = { x: round(actual.x - moved.x), y: round(actual.y - moved.y), width: round(actual.width - e.width), height: round(actual.height - e.height) };
    const hugsText = f.node.type === 'TEXT' && /WIDTH/.test(f.node.text?.autoResize ?? '');
    const onlyGlyphWidth = hugsText && within({ ...actual, width: e.width }, moved, tolerancePx) && Math.abs(delta.width) <= Math.max(tolerancePx, e.width * TEXT_METRIC_SHARE);
    const textDrift = Math.abs(delta.y) <= tolerancePx && Math.abs(delta.height) <= tolerancePx && Math.abs(delta.x) <= TEXT_DRIFT_PX && Math.abs(delta.width) <= TEXT_DRIFT_PX && (hasText(f.parent ?? f.node) || hasText(f.parent ? byId.get(f.parent.id)?.parent ?? null : null));
    const tol = a.loose ? Math.max(tolerancePx, TEXT_BOX_TOLERANCE_PX) : tolerancePx;
    if (within(actual, moved, tol) || within(actual, visible, tol)) passed++;
    else if (onlyGlyphWidth || textDrift) textMetrics.push({ id, name: f.node.name, expected: e, actual, delta });
    else mismatches.push({ id, name: f.node.name, expected: e, actual, delta });
  }
  // Untagged text counts too: a faked italic or weight changes every line it is used on.
  for (const f of m.fakedFonts ?? []) {
    const [font, ...sample] = f.split(': ');
    styles.push({ id: '-', name: 'page text', property: 'font file', expected: font!, actual: `not loaded, the browser fakes it (${sample.join(': ')})` });
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

// Layers whose own area holds the most real pixel differences, tagged or not: the brief's outline gives every layer's box, so no tag is needed to point at it.
const HOTSPOT_MIN_AREA = 100;
const HOTSPOT_MIN_TEXT_AREA = 300;
const HOTSPOT_MIN_SHARE = 0.15;
const HOTSPOT_MAX = 15;
export function hotspots(screen: ScreenFile, mask: Uint8Array, width: number, height: number): Hotspot[] {
  const out: Hotspot[] = [];
  for (const f of flatten(screen.root)) {
    const n = f.node, b = n.calculated?.screenBox;
    const image = Array.isArray(n.style?.fills) && n.style!.fills.some((p: any) => p.type === 'image' && p.visible !== false);
    const kind = n.type === 'TEXT' ? 'text' : image ? 'image' : n.asset || VECTOR_TYPES.has(n.type) ? 'icon' : null;
    // Tiny text (a digit in a badge) differs mostly by glyph smoothing, so it needs a larger area to mean anything.
    if (!kind || !b || b.width * b.height < (kind === 'text' ? HOTSPOT_MIN_TEXT_AREA : HOTSPOT_MIN_AREA)) continue;
    const box = intersect(b, f.clip);
    const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y)), x1 = Math.min(width, Math.ceil(box.x + box.width)), y1 = Math.min(height, Math.ceil(box.y + box.height));
    let bad = 0, all = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { all++; bad += mask[y * width + x]!; }
    if (all && bad / all >= HOTSPOT_MIN_SHARE) out.push({ id: n.id, name: n.name, kind, share: round(bad / all), box: b, ...(n.type === 'TEXT' ? { text: n.text?.characters.replace(/\n/g, ' / ').slice(0, 80) } : {}) });
  }
  return out.sort((a, b) => b.share - a.share).slice(0, HOTSPOT_MAX);
}

// Each design text with the app element showing it: the nearest one to where Figma draws it, so repeated texts pair with the right copy.
const TEXT_PAIR_MAX_PX = 300;
export function pairTexts(screen: ScreenFile, blocks: Record<string, TextBlock[]>, origin: { x: number; y: number }): { n: CanonNode; b: Box; near: TextBlock }[] {
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const used = new Set<TextBlock>(), out: { n: CanonNode; b: Box; near: TextBlock }[] = [];
  for (const f of flatten(screen.root)) {
    const n = f.node, b = n.calculated?.screenBox;
    if (n.type !== 'TEXT' || !n.text?.characters || !b) continue;
    const dist = (c: TextBlock) => Math.hypot(c.x - origin.x - b.x, c.y - origin.y - b.y);
    // Too far away is another copy of the same words (a year in a form and in the footer), not this text.
    const near = (blocks[key(n.text.characters)] ?? []).filter((c) => !used.has(c) && dist(c) <= TEXT_PAIR_MAX_PX).sort((p, q) => dist(p) - dist(q))[0];
    if (!near) continue;
    used.add(near);
    out.push({ n, b, near });
  }
  return out;
}

// Font, size, weight, italic, colour and letter-spacing of every text found on the page, tagged or not (tagged ones are already checked).
const LETTER_SLACK_PX = 0.2;
export function textStyleChecks(screen: ScreenFile, blocks: Record<string, TextBlock[]>, origin: { x: number; y: number }, skip: Set<string>): StyleMismatch[] {
  const out: StyleMismatch[] = [];
  for (const { n, near } of pairTexts(screen, blocks, origin)) {
    const a = near.style;
    if (!a || skip.has(n.id) || !n.text?.runs.length) continue;
    const name = n.text.characters.replace(/\n/g, ' / ').slice(0, 40);
    const add = (property: string, expected: string, actual: string) => out.push({ id: n.id, name, property, expected, actual });
    const run = [...n.text.runs].sort((x, y) => (y.end - y.start) - (x.end - x.start))[0]!;
    if (!familyKey(a.fontFamily.split(',')[0]!).includes(familyKey(run.fontFamily))) add('font-family', run.fontFamily, a.fontFamily.split(',')[0]!.trim());
    if (run.fontWeight && run.fontWeight !== a.fontWeight) add('font-weight', String(run.fontWeight), String(a.fontWeight));
    if (Math.abs(run.fontSize - a.fontSize) > SIZE_SLACK_PX) add('font-size', `${run.fontSize}px`, `${a.fontSize}px`);
    const italic = /italic|oblique/i.test(run.fontStyle);
    if (italic !== (a.fontStyle !== 'normal')) add('font-style', italic ? 'italic' : 'normal', a.fontStyle);
    const want = solid(run.fills), got = hex(a.color);
    if (want && got && !sameColor(want, got.hex)) add('color', want, got.hex);
    const ls = run.letterSpacing?.unit === 'percent' ? (run.letterSpacing.value / 100) * run.fontSize : run.letterSpacing?.value ?? 0;
    if (Math.abs(ls - a.letterSpacing) > LETTER_SLACK_PX) add('letter-spacing', `${round(ls)}px`, `${round(a.letterSpacing)}px`);
    // Words are matched ignoring case, so the case shown is compared here: Figma's text case against the app text with its text-transform.
    if (a.textTransform !== undefined) {
      const cased = (s: string, c?: string) => (c === 'UPPER' || c === 'uppercase' ? s.toUpperCase() : c === 'LOWER' || c === 'lowercase' ? s.toLowerCase() : c === 'TITLE' || c === 'capitalize' ? s.replace(/(^|\s)(\S)/g, (_, w, ch) => w + ch.toUpperCase()) : s).replace(/\s+/g, '');
      const want = cased(n.text.characters, run.textCase), got = cased(near.lines.join(' '), a.textTransform);
      if (want !== got) add('text case', run.textCase ? `${run.textCase.toLowerCase()} ("${n.text.characters.slice(0, 20)}")` : `as written ("${n.text.characters.slice(0, 20)}")`, `"${near.lines.join(' ').slice(0, 20)}" with text-transform: ${a.textTransform}`);
      const deco = run.textDecoration === 'UNDERLINE' ? 'underline' : run.textDecoration === 'STRIKETHROUGH' ? 'line-through' : 'none';
      if (a.textDecoration !== undefined && !a.textDecoration.includes(deco === 'none' ? 'none' : deco)) add('text-decoration', deco, a.textDecoration);
    }
  }
  return out;
}

// Untagged images and icons found by their asset file: each design layer takes the nearest unused app box, so compare() measures it like a tagged layer.
const ASSET_PAIR_MAX_PX = 300;
export function assetBoxes(screen: ScreenFile, found: Record<string, Box[]>, origin: { x: number; y: number }, tagged: Set<string>): Record<string, Box> {
  const out: Record<string, Box> = {};
  const used = new Set<Box>();
  for (const f of flatten(screen.root)) {
    const n = f.node, b = n.calculated?.screenBox;
    if (!b || tagged.has(n.id) || f.depth === 0) continue;
    const fills = Array.isArray(n.style?.fills) ? n.style!.fills : [];
    const ids = [...(n.asset?.assetIds ?? []), ...fills.map((p) => (p.type === 'image' ? p.assetId : null)).filter((x): x is string => !!x)];
    const dist = (c: Box) => Math.hypot(c.x - origin.x - b.x, c.y - origin.y - b.y);
    for (const id of ids) {
      const near = (found[id] ?? []).filter((c) => !used.has(c) && dist(c) <= ASSET_PAIR_MAX_PX).sort((p, q) => dist(p) - dist(q))[0];
      if (near) { used.add(near); out[n.id] = near; break; }
    }
  }
  return out;
}

// Rendered line breaks vs Figma's: a text whose words wrap elsewhere looks different even when its box size matches.
// Sideways drift beyond font-width noise (TEXT_DRIFT_PX) means the text is placed or aligned differently.
const TEXT_SHIFT_PX = 4;
export function textLineChecks(screen: ScreenFile, blocks: Record<string, TextBlock[]>, origin: { x: number; y: number }): LineMismatch[] {
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const out: LineMismatch[] = [];
  for (const { n, b, near } of pairTexts(screen, blocks, origin)) {
    if (!n.text) continue;
    const app = near.lines;
    const run = n.text.runs[0];
    const size = run?.fontSize ?? 16, l = run?.lineHeight;
    const lh = l?.unit === 'px' && l.value ? l.value : l?.unit === 'percent' && l.value ? (size * l.value) / 100 : size * 1.2;
    const count = Math.max(1, Math.round(n.geometry.height / lh));
    const figma = n.text.characters.split('\n');
    // Explicit breaks that account for every line give the exact lines; otherwise only the line count is known.
    const exact = figma.length === count && figma.every((l) => l.trim());
    if (exact ? figma.map(key).join('|') !== app.map(key).join('|') : app.length !== count) {
      // Narrower than Figma's box is the usual cause; otherwise the Figma breaks are explicit and must be kept.
      const w = near.width, fw = round(n.geometry.width);
      const hint = w !== undefined && w < fw - 1 ? `your text box is ${round(fw - w)}px narrower than Figma's (${w}px vs ${fw}px): give it Figma's width, or keep Figma's line breaks with <br> from the design width up`
        : w !== undefined && w > fw + 1 && exact ? `your text box is ${round(w - fw)}px wider than Figma's (${w}px vs ${fw}px): keep Figma's line breaks with <br> from the design width up, or give it Figma's width`
        : `keep Figma's line breaks with <br> from the design width up; if they still differ, check font size, weight and letter-spacing`;
      out.push({ id: n.id, name: n.name, text: n.text.characters.replace(/\n/g, ' / ').slice(0, 60), kind: 'lines', figma: exact ? figma : [`${count} line(s)`], app, hint, box: b });
    }
    // Where the text sits sideways, measured on the edge its alignment pins (glyph widths may move the other edge): catches wrong text-align or justify on untagged text too.
    const align = ({ CENTER: 'center', RIGHT: 'right' } as Record<string, string>)[n.text.alignHorizontal ?? ''] ?? 'left';
    if (near.left !== undefined && near.right !== undefined) {
      const l = near.left - origin.x, r = near.right - origin.x;
      const off = align === 'right' ? r - (b.x + b.width) : align === 'center' ? (l + r) / 2 - (b.x + b.width / 2) : l - b.x;
      if (Math.abs(off) > TEXT_SHIFT_PX)
        out.push({ id: n.id, name: n.name, text: n.text.characters.replace(/\n/g, ' / ').slice(0, 60), kind: 'align', dx: round(off), figma: [`${align} edge at x ${round(align === 'right' ? b.x + b.width : align === 'center' ? b.x + b.width / 2 : b.x)}`], app: [`at x ${round(align === 'right' ? r : align === 'center' ? (l + r) / 2 : l)}`], box: b,
          // Moved further than its own width: it is on another line of the sentence, so the wrap differs, not the alignment.
          hint: Math.abs(off) > b.width
            ? `it is on a different line than in Figma (the sentence wraps at another word): give the text box Figma's width or keep Figma's line break before it`
            : `text sits ${round(Math.abs(off))}px too far ${off > 0 ? 'right' : 'left'}; Figma pins its ${align} edge there, so check text-align: ${align} and the container's alignment/padding` });
    }
  }
  return out;
}

// Small differences under the failing tolerances, measured exactly so they are told apart from rendering noise:
// a hugging text drawn wider or narrower than Figma with the same style, and a text a little off its place.
// Chrome rounds each line box to whole pixels, so up to TEXT_NUDGE_PX is rendering, not code.
const TEXT_NUDGE_PX = 1.5;
const GLYPH_WIDTH_PX = 1;
// Figma lays some texts out 1-3px wider or narrower than the browser with the same font (measured 2026-11-11: a retyped Figma text keeps its width;
// Inter 3.19/4.0/4.1, CSS font features, opsz 14-32, kerning and glyph rounding all fail to reproduce it). The cause is not confirmed, so it is a note, not a finding.
const ENGINE_PX = 2.5; const ENGINE_SHARE = 0.0125;
// dw: the text is wider (+) or narrower (-) than its Figma box. engine: within what the two text engines differ by.
export interface TextNudge { id: string; text: string; box: Box; dx: number; dy: number; dw: number; engine?: boolean; cause?: { id: string; text: string; dw: number; engine?: boolean } }
export function textNudges(screen: ScreenFile, blocks: Record<string, TextBlock[]>, origin: { x: number; y: number }): TextNudge[] {
  const parentOf = new Map(flatten(screen.root).map((f) => [f.node.id, f.parent?.id]));
  const all = pairTexts(screen, blocks, origin).filter(({ near }) => near.left !== undefined && near.right !== undefined && near.top !== undefined).map(({ n, b, near }) => {
    const align = n.text?.alignHorizontal ?? 'LEFT', l = near.left! - origin.x, r = near.right! - origin.x;
    const dx = align === 'RIGHT' ? r - (b.x + b.width) : align === 'CENTER' ? (l + r) / 2 - (b.x + b.width / 2) : l - b.x;
    // Spaces at the ends count in Figma's width but carry no ink in the app, so such texts are not compared.
    const c = n.text!.characters, hugs = /WIDTH/.test(n.text?.autoResize ?? '') && !c.includes('\n') && c === c.trim();
    const dw = hugs ? round(r - l - b.width) : 0;
    return { id: n.id, text: c.replace(/\n/g, ' / ').slice(0, 60), box: b, dx: round(dx), dy: round(near.top! - origin.y - b.y), dw: Math.abs(dw) > GLYPH_WIDTH_PX ? dw : 0,
      ...(Math.abs(dw) > GLYPH_WIDTH_PX && Math.abs(dw) <= Math.max(ENGINE_PX, b.width * ENGINE_SHARE) ? { engine: true } : {}) };
  });
  const wide = all.filter((t) => t.dw);
  // Moved by as much as a sibling (or a sibling of its parent) is wider or narrower: that text is the cause.
  const near = (a: string, b: string) => parentOf.get(a) === parentOf.get(b) || parentOf.get(parentOf.get(a)!) === parentOf.get(parentOf.get(b)!);
  // Larger moves fail through the layout and text-position checks; here only what stays under them.
  return all.filter((t) => Math.max(Math.abs(t.dx), Math.abs(t.dy)) <= TEXT_SHIFT_PX && (t.dw || Math.max(Math.abs(t.dx), Math.abs(t.dy)) > TEXT_NUDGE_PX)).map((t) => {
    const c = Math.abs(t.dx) > TEXT_NUDGE_PX ? wide.find((w) => w.id !== t.id && near(w.id, t.id) && Math.abs(Math.abs(w.dw) - Math.abs(t.dx)) <= 0.5) : undefined;
    return c ? { ...t, cause: { id: c.id, text: c.text, dw: c.dw, ...(c.engine ? { engine: true } : {}) } } : t;
  });
}

// Texts shifted sideways by the same amount share one cause (a padding or gap), so they are reported as one group.
export function shiftGroups(lines: LineMismatch[]): { dx: number; items: LineMismatch[] }[] {
  const groups: { dx: number; items: LineMismatch[] }[] = [];
  for (const l of lines.filter((x) => x.kind === 'align')) {
    const g = groups.find((x) => Math.abs(x.dx - l.dx!) <= 1);
    if (g) g.items.push(l); else groups.push({ dx: l.dx!, items: [l] });
  }
  return groups.sort((a, b) => b.items.length - a.items.length || Math.abs(b.dx) - Math.abs(a.dx));
}

export function reportMarkdown(r: VerifyReport): string {
  const s = r.summary;
  const md = [
    `# Verification: ${r.screen.name}`,
    '',
    `**${s.verdict.toUpperCase()}**: ${s.passed}/${s.measured} measured layers within ±${r.tolerancePx}px, ${s.failed} off, ${s.styleFailed} style differences (of ${s.styleChecked} checked), ${s.textMetrics} font-metric warnings, ${s.overflow} text overflow, ${s.missingKey} required layers not tagged (coverage ${Math.round(s.coverage * 100)}% of ${s.designNodes} design layers). Source: ${r.source}. Viewport ${r.viewport.actual.width}x${r.viewport.actual.height} (design ${r.viewport.expected.width}x${r.viewport.expected.height})${r.viewport.ok ? '' : ' **MISMATCH**'}.`,
    '',
  ];
  if (r.visual) md.push(`Visual: ${Math.round(r.visual.mismatchRatio * 1000) / 10}% of pixels really differ${r.visual.noiseRatio ? ` (+${Math.round(r.visual.noiseRatio * 1000) / 10}% rendering only)` : ''}${r.visual.diffImage ? `, heatmap: ${r.visual.diffImage}` : ''}. ${r.visual.note}`, '');
  const row = (f: Finding) => `${f.n}. **${f.kind}** ${f.id} "${f.name}": ${f.what}. Fix: ${f.fix}. Picture: verification/${f.crop}`;
  const toFix = r.findings?.filter((f) => f.severity === 'fix') ?? [], toCheck = r.findings?.filter((f) => f.severity === 'check') ?? [];
  if (toFix.length) md.push('## Fix these first (look at each picture)', '', 'Each picture: left = Figma (green outline), right = your app (red outline). One row can stand for several layers with one shared cause.', '', ...toFix.map(row), '');
  if (toCheck.length) md.push('## Small differences (page passes; fix these for pixel-perfect)', '', 'Measured differences under the failing tolerance, each with its exact px and cause. Glyph-edge smoothing of a text that is in place is not listed.', '', ...toCheck.map(row), '');
  if (r.engineNote) md.push('## Text width vs Figma (not counted)', '', r.engineNote, '');
  const wraps = r.lines?.filter((l) => l.kind !== 'align') ?? [];
  if (wraps.length) md.push('## Text lines differ (fix these)', '', 'The words wrap at other places than in Figma.', '', ...wraps.map((l) => `- ${l.id}: Figma "${l.figma.join(' / ')}" → app "${l.app.join(' / ')}". Fix: ${l.hint ?? 'keep the Figma line breaks'}`), '');
  const shifts = shiftGroups(r.lines ?? []);
  if (shifts.length) md.push('## Text placed sideways (fix these)', '', 'Measured on the edge each text is aligned to, tagged or not. Texts moved by the same amount share one cause: fix the padding, gap or alignment of their common container once.', '', ...shifts.map((g) => `- ${g.items.length} text(s) ${Math.abs(g.dx)}px too far ${g.dx > 0 ? 'right' : 'left'}: ${g.items.slice(0, 8).map((x) => `${x.id} "${x.text ?? x.name}"`).join(', ')}${g.items.length > 8 ? ` and ${g.items.length - 8} more` : ''}.${g.items.length === 1 ? ` Fix: ${g.items[0]!.hint}` : ''}`), '');
  if (r.mismatches.length) {
    md.push('## Fix these (largest first)', '', 'Δ is this layer\'s own error: a shift its parent or the layer before it already explains is not counted again, so fix the listed layer itself.', '', '| Layer | id | Expected x,y wxh | Actual x,y wxh | Δx Δy Δw Δh |', '|---|---|---|---|---|');
    for (const x of r.mismatches.slice(0, 50))
      md.push(`| ${x.name} | ${x.id} | ${x.expected.x},${x.expected.y} ${x.expected.width}x${x.expected.height} | ${x.actual.x},${x.actual.y} ${x.actual.width}x${x.actual.height} | ${x.delta.x} ${x.delta.y} ${x.delta.width} ${x.delta.height} |`);
    if (r.mismatches.length > 50) md.push(`| … ${r.mismatches.length - 50} more in the JSON report | | | | |`);
    md.push('');
  }
  if (r.styles.length) md.push('## Style differences (fix these)', '', 'Exact computed CSS vs the Figma values, so font rendering does not matter here.', '', '| Layer | id | Property | Figma | App |', '|---|---|---|---|---|', ...r.styles.slice(0, 50).map((x) => `| ${x.name} | ${x.id} | ${x.property} | ${x.expected} | ${x.actual} |`), r.styles.length > 50 ? `| … ${r.styles.length - 50} more in the JSON report | | | | |` : '', '');
  if (r.narrow) md.push(`## Small screen (${r.narrow.width}px wide)`, '', r.narrow.ok ? 'OK: no horizontal scroll, no content cut off.' : `**FAIL**: page is ${r.narrow.scrollWidth}px wide (scrolls sideways) or content is cut off. Make the layout fluid (see "Production code rules" in the brief). Cut off (figma id, text):`, ...r.narrow.cutOff.map((c) => `- ${c}`), '');
  if (r.code?.length) md.push('## Code rules (fix these)', '', 'Production code rules checked in the source.', '', ...r.code.map((c) => `- ${c.file}:${c.line} - ${c.rule}: ${c.text}`), '');
  if (r.overflow.length) md.push('## Text overflow', '', ...r.overflow.map((o) => `- ${o.name} (${o.id})${o.text ? `: "${o.text}"` : ''}`), '');
  if (r.missingKeyNodes.length) md.push(`## Not tagged (tag these to verify them)`, '', ...r.missingKeyNodes.slice(0, 40).map((n) => `- ${n.name} (${n.id})`), r.missingKeyNodes.length > 40 ? `- … ${r.missingKeyNodes.length - 40} more` : '', '');
  if (r.unknownIds.length) md.push(`Tagged ids not in this screen (typo or other screen): ${r.unknownIds.slice(0, 20).join(', ')}`, '');
  return md.join('\n') + '\n';
}

declare const F2F_VERSION: string;
// A ready prompt for any coding agent with every measured difference of this screen, so the developer copies it as is.
export function fixPrompt(r: VerifyReport, slug: string): string | null {
  const url = r.source.replace(/^chrome /, '');
  const items: string[] = [];
  for (const f of r.findings ?? []) items.push(`${f.kind}, ${f.id} "${f.name}": ${f.what}. Fix: ${f.fix}. Picture: f2f/verification/${f.crop}`);
  const listed = new Set((r.findings ?? []).flatMap((f) => [f.id, ...(f.what.match(/\d+:\d+/g) ?? [])]));
  for (const x of r.mismatches.filter((x) => !listed.has(x.id)).slice(0, 30)) items.push(`layout, ${x.id} "${x.name}": Figma ${x.expected.x},${x.expected.y} ${x.expected.width}x${x.expected.height}, app ${x.actual.x},${x.actual.y} ${x.actual.width}x${x.actual.height}. Fix: give it the Figma size and position from its outline line`);
  for (const x of r.styles.filter((x) => !listed.has(x.id)).slice(0, 30)) items.push(`style, ${x.id} "${x.name}": ${x.property} is ${x.actual}, Figma ${x.expected}. Fix: set ${x.property} to the Figma value`);
  for (const l of (r.lines ?? []).filter((l) => l.kind !== 'align' && !listed.has(l.id))) items.push(`text lines, ${l.id}: Figma "${l.figma.join(' / ')}", app "${l.app.join(' / ')}". Fix: ${l.hint ?? "keep Figma's line breaks"}`);
  if (!r.viewport.ok) items.push(`page size: app ${r.viewport.actual.width}x${r.viewport.actual.height}, Figma ${r.viewport.expected.width}x${r.viewport.expected.height}. Fix: the section heights above add up wrong; fix the layout findings first`);
  if (r.narrow && !r.narrow.ok) items.push(`small screen ${r.narrow.width}px: page is ${r.narrow.scrollWidth}px wide or cuts off ${r.narrow.cutOff.join('; ')}. Fix: make the layout fluid`);
  for (const c of r.code ?? []) items.push(`code rule, ${c.file}:${c.line}: ${c.rule}`);
  for (const o of r.overflow) items.push(`text overflow, ${o.id} "${o.name}". Fix: the text must fit its box as in Figma`);
  for (const n of r.missingKeyNodes.slice(0, 20)) items.push(`not tagged, ${n.id} "${n.name}". Fix: add data-figma-id="${n.id}" to the element that draws it`);
  if (!items.length) return null;
  return [
    `Make the screen "${r.screen.name}" (Figma ${r.screen.id}, ${url}) match Figma pixel for pixel. Follow f2f-project.md and the F2F files; never invent a value.`,
    `The F2F verify tool measured the ${items.length} differences below in the running app. For each one, open its picture first (left = Figma with a green outline, right = your app with a red outline), then read the outline line of every id named in f2f/screens/${slug}.md for the exact values (size, padding, gap, font, colour) and fix the code.`,
    '',
    ...items.map((x, i) => `${i + 1}. ${x}`),
    '',
    'Rules:',
    // An older f2f-cli does not measure these checks, so its run would report none of them and the agent would stop.
    ...(typeof F2F_VERSION === 'string' ? [`- First run \`npx f2f --version\`: it must be ${F2F_VERSION} or newer, the version that measured this list. If it is older, update f2f-cli to the latest version first (with the project's package manager), because older versions do not measure these items.`] : []),
    '- When one row names several ids, they share one cause: fix it once in the shared component, class or token.',
    '- When a row says another text is the cause, fix only that cause, not the position of this one.',
    '- "text width" means the app draws the text wider or narrower than Figma with the same style, more than the two text engines differ: check the characters and the font file the app loads; never add padding or letter-spacing for it.',
    '- Do not change anything that is not listed. Never use --window or --tolerance.',
    `- Run \`${/^https?:/.test(url) ? `f2f verify --screen ${r.screen.id} --url ${url}` : 'f2f verify'}\` after your changes and repeat until it shows PASS and no "Small differences"; start the app first if it is not running, and stop any dev server you started.`,
    `- Report what you changed for each number above, and anything you could not fix with the reason.`,
  ].join('\n') + '\n';
}
