import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CanonNode, ScreenFile } from '../../../core/src/model';
import { codeChecks } from './code';
import { assetBoxes, compare, fixPrompt,hotspots, pairTexts, reportMarkdown, shiftGroups, textLineChecks, textNudges, textStyleChecks, type Finding, type Measurements, type StyleMismatch, type VerifyReport } from './compare';
import { bestScale, bestShift, colorShare, cropPair } from './crops';
import { describe } from './html';
import type { Image } from './png';
import { cropCss } from '../../../core/src/outline';
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
  // Browser window; defaults to the design width so fluid layouts render as designed.
  window?: { width: number; height: number };
  screenshot?: boolean;
}

// Fluid pages fill the window, so the width must equal the design width; only extra height is added.
const WINDOW_MARGIN = 200;
// Smallest common phone width; every web page must work there without sideways scrolling.
const NARROW_WIDTH = 375;

export async function findScreen(pkgDir: string, key: string): Promise<{ info: any; file: ScreenFile }> {
  const index = JSON.parse(await readFile(join(pkgDir, 'screens/index.json'), 'utf8'));
  const k = key.toLowerCase();
  const info = (index.screens as any[]).find((s) => s.id === key || s.slug === k || s.name.toLowerCase() === k) ?? (index.screens as any[]).find((s) => s.slug.startsWith(k));
  if (!info) throw new Error(`No screen "${key}". Screens: ${(index.screens as any[]).map((s) => `${s.slug} (${s.id})`).join(', ')}`);
  return { info, file: JSON.parse(await readFile(join(pkgDir, info.file), 'utf8')) };
}

// The few things to fix first, each with what is wrong, how to fix it and a "Figma | app" picture; one shared cause is one finding.
const MAX_FINDINGS = 14;
// Below this a layer is a few pixels; colour sampling there is noise.
const PRESENCE_MIN_AREA = 16;
// Shapes up to this size (dots, bullets, short lines) are searched for nearby when their colour is not in place.
const SHAPE_SEARCH_MAX_AREA = 2500;
const SHAPE_SEARCH_PX = 24;
async function findings(r: VerifyReport, figma: Image, app: Image, dir: string, screen: ScreenFile, measured: Set<string>, m: Measurements): Promise<Finding[]> {
  // Where each design text is in the app (found by its words), so a moved text is told apart from an absent one.
  const origin = m.nodes[screen.root.id] ?? { x: 0, y: 0 };
  const where = new Map(m.lines ? pairTexts(screen, m.lines, origin).map((x) => [x.n.id, { dx: Math.round(x.near.x - origin.x - x.b.x), dy: Math.round(x.near.y - origin.y - x.b.y) }]) : []);
  const words = (dx: number, dy: number, flip = false) => [dy ? `${Math.abs(dy)}px ${(dy > 0) !== flip ? 'lower' : 'higher'}` : '', dx ? `${Math.abs(dx)}px ${(dx > 0) !== flip ? 'further right' : 'further left'}` : ''].filter(Boolean).join(' and ');
  // Measured and in place once the shift of its neighbours is explained (e.g. text drawn a little narrower before it): a pixel move there is not its own error.
  const placed = new Set([...measured].filter((id) => !r.mismatches.some((m) => m.id === id)));
  const boxOf = (id: string) => nodeOf(id)?.calculated?.screenBox;
  const nodeOf = (id: string, n: CanonNode = screen.root): CanonNode | undefined => (n.id === id ? n : n.children?.reduce<CanonNode | undefined>((f, c) => f ?? nodeOf(id, c), undefined));
  const out: Omit<Finding, 'n' | 'crop'>[] = [];
  for (const l of (r.lines ?? []).filter((x) => x.kind === 'lines').slice(0, 6))
    out.push({ severity: 'fix', kind: 'text lines', id: l.id, name: l.text ?? l.name, what: `wraps differently: Figma "${l.figma.join(' / ')}", app "${l.app.join(' / ')}"`, fix: l.hint ?? '', box: l.box! });
  for (const g of shiftGroups(r.lines ?? []).slice(0, 4)) {
    const l = g.items[0]!;
    out.push({ severity: 'fix', kind: 'text position', id: l.id, name: l.text ?? l.name, what: `${g.items.length > 1 ? `${g.items.length} texts sit` : 'sits'} ${Math.abs(g.dx)}px too far ${g.dx > 0 ? 'right' : 'left'}${g.items.length > 1 ? ` (${g.items.slice(0, 5).map((x) => x.id).join(', ')}${g.items.length > 5 ? ', …' : ''})` : ''}`,
      fix: g.items.length > 1 ? `they share one cause: fix the padding, gap or alignment of their common container by ${Math.abs(g.dx)}px` : l.hint ?? '', box: l.box!, actual: { ...l.box!, x: l.box!.x + g.dx } });
  }
  // The same wrong value on several texts is one wrong class or token.
  const byStyle = new Map<string, StyleMismatch[]>();
  for (const s of r.styles.filter((x) => x.id !== '—')) { const k = `${s.property}|${s.expected}|${s.actual}`; byStyle.set(k, [...(byStyle.get(k) ?? []), s]); }
  for (const [, list] of [...byStyle].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
    const s = list[0]!, box = boxOf(s.id);
    if (box) out.push({ severity: 'fix', kind: 'style', id: s.id, name: s.name, what: `${list.length > 1 ? `${list.length} texts have` : 'has'} ${s.property} ${s.actual} instead of ${s.expected}${list.length > 1 ? ` (${list.slice(0, 5).map((x) => x.id).join(', ')}${list.length > 5 ? ', …' : ''})` : ''}`, fix: `set ${s.property}: ${s.expected}${list.length > 1 ? ' in the class or token these texts share' : ''}`, box });
  }
  // Same layer name moved the same way (one icon in every card) is one cause.
  const byMove = new Map<string, typeof r.mismatches>();
  // A text already reported for its line breaks or sideways position has that as its cause.
  const lineIds = new Set((r.lines ?? []).map((l) => l.id));
  for (const mm of r.mismatches) {
    if (lineIds.has(mm.id)) continue; const k = `${m.nodes[mm.id]?.loose ? 'text' : mm.name}|${Object.values(mm.delta).map((v) => Math.round(v)).join(',')}`; const mis = mm; byMove.set(k, [...(byMove.get(k) ?? []), mis]); }
  for (const list of [...byMove.values()].slice(0, 4)) {
    const m = list[0]!;
    out.push({ severity: 'fix', kind: 'layout', id: m.id, name: nodeOf(m.id)?.text?.characters.split('\n').join(' / ').slice(0, 60) ?? m.name, what: `${list.length > 1 ? `${list.length} layers: ` : ''}${describe(m)}${list.length > 1 ? ` (${list.slice(0, 5).map((x) => x.id).join(', ')}${list.length > 5 ? ', …' : ''})` : ''}`, fix: list.length > 1 ? 'they share one cause: fix the size/position in the component or class they share (see the outline line of each id)' : 'match the Figma size and position of this layer (see the outline line for its padding, gap and size)', box: m.expected, actual: m.actual });
  }
  // Colour presence: where Figma draws a text, bullet, line or icon in a colour, that colour must be there in the app. Missing means removed, moved away or replaced (a dash for a square bullet).
  const solidOf = (fills: unknown): string | null => {
    const v = Array.isArray(fills) ? fills.filter((f: any) => f.visible !== false) : [];
    return v.length === 1 && v[0].type === 'solid' && (v[0].opacity ?? 1) >= 0.9 ? v[0].color : null;
  };
  const absent = new Map<string, Omit<Finding, 'n' | 'crop'>[]>();
  const visit = (n: CanonNode, depth: number) => {
    if (n.visible === false) return;
    const kids = (n.children ?? []).filter((c) => c.visible !== false);
    kids.forEach((c) => visit(c, depth + 1));
    const b = n.calculated?.screenBox;
    if (!depth || kids.length || !b || b.width * b.height < PRESENCE_MIN_AREA || covered.has(n.id)) return;
    const text = n.type === 'TEXT';
    const color = text ? solidOf([...(n.text?.runs ?? [])].sort((x, y) => (y.end - y.start) - (x.end - x.start))[0]?.fills) : solidOf(n.style?.fills);
    if (!color) return;
    const fig = colorShare(figma, b, color), got = colorShare(app, b, color);
    if (fig < (text ? 0.08 : 0.4) || got >= fig * 0.35) return;
    const what = text ? `the text "${n.text!.characters.replace(/\n/g, ' / ').slice(0, 40)}"` : `a ${Math.round(b.width)}×${Math.round(b.height)} ${n.type === 'ELLIPSE' ? 'circle' : n.type === 'LINE' ? 'line' : n.asset ? 'icon' : 'shape'}`;
    const moved = text ? where.get(n.id) : undefined;
    if (moved && (Math.abs(moved.dx) > 3 || Math.abs(moved.dy) > 3)) {
      const key = `moved|${moved.dx}|${moved.dy}`;
      absent.set(key, [...(absent.get(key) ?? []), { severity: 'fix', kind: 'text position', id: n.id, name: n.text!.characters.split('\n').join(' / ').slice(0, 60), what: `sits ${words(moved.dx, moved.dy)} than in Figma`,
        fix: `it must be ${words(moved.dx, moved.dy, true).replace('lower', 'lower down').replace('higher', 'higher up')}: check the margin, padding or gap above or before it against its outline line`, box: b, actual: { ...b, x: b.x + moved.dx, y: b.y + moved.dy } }]);
      return;
    }
    // A small shape whose colour shows up close by has moved, not vanished: report how far.
    if (!text && b.width * b.height <= SHAPE_SEARCH_MAX_AREA) {
      let best = { dx: 0, dy: 0, s: got };
      for (let dy = -SHAPE_SEARCH_PX; dy <= SHAPE_SEARCH_PX; dy++)
        for (let dx = -SHAPE_SEARCH_PX; dx <= SHAPE_SEARCH_PX; dx++) { const s = colorShare(app, { ...b, x: b.x + dx, y: b.y + dy }, color); if (s > best.s) best = { dx, dy, s }; }
      if (best.s >= fig * 0.7 && (best.dx || best.dy)) {
        const key = `shape|${color}|${best.dx}|${best.dy}`;
        absent.set(key, [...(absent.get(key) ?? []), { severity: 'fix', kind: 'shape position', id: n.id, name: n.name, what: `sits ${words(best.dx, best.dy)} than in Figma`, fix: `it must be ${words(best.dx, best.dy, true)}: check the gap, margin or position before it against its outline line`, box: b, actual: { ...b, x: b.x + best.dx, y: b.y + best.dy } }]);
        return;
      }
    }
    const k = `${text ? 'text' : n.name}|${color}|${Math.round(b.width)}x${Math.round(b.height)}`;
    absent.set(k, [...(absent.get(k) ?? []), { severity: 'fix', kind: text ? 'text missing here' : 'shape missing here', id: n.id, name: text ? n.text!.characters.replace(/\n/g, ' / ').slice(0, 60) : n.name, what: `Figma draws ${what} in ${color} here; your app shows ${Math.round(got / fig * 100)}% of it`, fix: text ? 'put this text where Figma has it (see its outline line: position, parent and order)' : `draw this exact shape (${n.type.toLowerCase()}, ${Math.round(b.width)}×${Math.round(b.height)}px, ${color}${typeof n.style?.cornerRadius === 'number' && n.style.cornerRadius ? `, radius ${n.style.cornerRadius}` : ''}) as in its outline line`, box: b }]);
  };
  // Measured layers are judged by the layout check (which knows what moved them); colour presence covers the rest.
  const covered = new Set([...out.map((x) => x.id), ...r.mismatches.map((x) => x.id), ...placed]);
  visit(screen.root, 0);
  for (const list of [...absent.values()].sort((a, b) => b.length - a.length)) {
    const f = list[0]!;
    out.push(list.length > 1 ? { ...f, what: `${list.length} ${f.kind === 'text position' ? `texts ${f.what.replace(/^sits/, 'sit')}` : f.kind === 'shape position' ? `shapes ${f.what.replace(/^sits/, 'sit')}` : `layers: ${f.what}`} (${list.slice(0, 5).map((x) => x.id).join(', ')}${list.length > 5 ? ', …' : ''})` } : f);
  }
  // Small exact differences (not failing): the measured px and its cause instead of a vague pixel card.
  const taken = new Set([...out.map((x) => x.id), ...r.mismatches.map((x) => x.id), ...(r.lines ?? []).map((l) => l.id)]);
  const nudges = m.lines ? textNudges(screen, m.lines, origin).filter((t) => !taken.has(t.id)) : [];
  const px = (v: number) => `${Math.abs(v)}px`, round1 = (v: number) => Math.round(v * 10) / 10;
  // One font file is one cause: all texts drawn at another width are one finding.
  const w = (x: (typeof nudges)[number]) => `"${x.text.slice(0, 30)}" ${px(x.dw)} ${x.dw < 0 ? 'narrower' : 'wider'} (${round1(x.box.width + x.dw)}px vs ${round1(x.box.width)}px)`;
  // Within the text-engine difference: nothing in code or font removes it, so it is a note, not a finding (a neighbour it pushed is too).
  const engine = nudges.filter((x) => x.engine || x.cause?.engine);
  if (engine.length) r.engineNote = `These texts are 1-3px (about 1% of their width) wider or narrower in the browser than Figma lays them out, with the same font family, size, weight and spacing (or moved by such a neighbour). Cause not confirmed: Figma lays them out this way even when retyped, and Inter 3.19/4.0/4.1, CSS font features, optical sizes and kerning all give the same browser width. Not counted as a failure. To place the layers next to such a text exactly, give it the Figma width (the box in its outline line): ${engine.slice(0, 6).map((x) => (x.dw ? w(x) : `"${x.text.slice(0, 30)}" moved ${px(round1(x.dx))} by "${x.cause!.text.slice(0, 20)}"`)).join('; ')}${engine.length > 6 ? '; …' : ''}.`;
  // One font file is one cause: all texts drawn at a clearly other width are one finding.
  const widths = nudges.filter((x) => x.dw && !x.engine).sort((a, b) => Math.abs(b.dw) - Math.abs(a.dw));
  if (widths.length) {
    const t = widths[0]!;
    out.push({ severity: 'check', kind: 'text width', id: t.id, name: t.text, what: `${widths.length > 1 ? `${widths.length} texts are` : 'is'} drawn wider or narrower than in Figma with the same font family, size, weight and spacing, more than the two text engines differ: ${widths.slice(0, 4).map(w).join('; ')}${widths.length > 4 ? '; …' : ''}`,
      fix: 'compare the text and the font file the app loads with the outline line (other characters, another font family file or a missing weight); do not add padding or change spacing for it', box: t.box, actual: { ...t.box, width: t.box.width + t.dw } });
  }
  const moves = new Map<string, typeof nudges>();
  for (const t of nudges.filter((x) => !x.cause?.engine && Math.max(Math.abs(x.dx), Math.abs(x.dy)) > 1.5 && !(x.dw && !x.cause))) {
    const k = `${Math.round(t.dx * 2)}|${Math.round(t.dy * 2)}|${t.cause?.id ?? ''}`;
    moves.set(k, [...(moves.get(k) ?? []), t]);
  }
  for (const list of moves.values()) {
    const t = list[0]!, many = list.length > 1;
    const where = [Math.abs(t.dy) > 1.5 ? `${px(round1(t.dy))} too ${t.dy > 0 ? 'low' : 'high'}` : '', Math.abs(t.dx) > 1.5 ? `${px(round1(t.dx))} too far ${t.dx > 0 ? 'right' : 'left'}` : ''].filter(Boolean).join(' and ');
    out.push({ severity: 'check', kind: 'small shift', id: t.id, name: t.text, what: `${many ? `${list.length} texts sit` : 'sits'} ${where}${many ? ` (${list.slice(0, 5).map((x) => x.id).join(', ')}${list.length > 5 ? ', …' : ''})` : ''}`,
      fix: t.cause ? `it moves because "${t.cause.text}" (${t.cause.id}) is drawn ${px(round1(t.cause.dw))} ${t.cause.dw < 0 ? 'narrower' : 'wider'} than in Figma (see the "text width" row); fix that, not this position` : `move it ${[Math.abs(t.dy) > 1.5 ? `${px(round1(t.dy))} ${t.dy > 0 ? 'up' : 'down'}` : '', Math.abs(t.dx) > 1.5 ? `${px(round1(t.dx))} to the ${t.dx > 0 ? 'left' : 'right'}` : ''].filter(Boolean).join(' and ')}: check the margin, padding, gap or line-height before it against its outline line`,
      box: t.box, actual: { ...t.box, x: t.box.x + t.dx, y: t.box.y + t.dy } });
  }
  // A layer already covered by a finding or a group is not shown again as a pixel difference.
  const seen = new Set([...out.map((x) => x.id), ...r.mismatches.map((m) => m.id), ...r.styles.map((x) => x.id), ...(r.lines ?? []).map((l) => l.id)]);
  const groups = shiftGroups(r.lines ?? []);
  // A text found by its words with Figma's position, width and style (all measured above) differs only in how glyph edges are smoothed.
  // Any other measured difference of a found text (moved, wrapped, wider) already has its own card with the cause.
  const exactText = (id: string) => where.has(id) && !r.styles.some((s) => s.id === id);
  for (const h of (r.visual?.hotspots ?? []).filter((x) => !seen.has(x.id) && !(x.kind === 'text' && exactText(x.id))).slice(0, 8)) {
    let fix = h.kind === 'image' ? "the image looks different: use the asset from the outline, Figma's fill mode (cover/contain) and crop" : h.kind === 'icon' ? 'the icon differs: use the SVG asset from the outline at its design size and colour' : where.has(h.id) ? 'the text looks different: compare font family, weight, size, letter-spacing and colour with the outline line'
      : 'these words were not found as text on the page (an input placeholder or value, a picture of text, or other words), so only its pixels are compared: check its words, font, size and colour against the outline line';
    let actual: Finding['actual'];
    // Only a measured cause (moved, zoomed, wrong crop) makes a pixel difference a failure; without one it is worth a look.
    let sure = false;
    if (h.kind !== 'text') {
      const s = bestShift(figma, app, h.box);
      // A clear gain from moving the picture means only its position or crop is off.
      // Moved sideways by the same amount as a group of texts: same cause, already one finding.
      if (s.gain > 0.4 && !s.dy && s.dx && groups.some((g) => g.items.length > 1 && Math.abs(g.dx - s.dx) <= 1)) continue;
      const z = h.kind === 'image' && !(s.gain > 0.4 && (s.dx || s.dy)) ? bestScale(figma, app, h.box) : null;
      const fills = nodeOf(h.id)?.style?.fills;
      const crop = Array.isArray(fills) ? fills.map(cropCss).find(Boolean) : null;
      // The export knows exactly which part of the image Figma shows; that beats any measurement.
      sure = !!crop || (!placed.has(h.id) && ( (!!z && z.scale !== 1 && z.gain > 0.3) || ((Math.abs(s.dx) >= 2 || Math.abs(s.dy) >= 2) && s.gain > 0.4)));
      if (crop) fix = `show the same part of the image as Figma: ${crop}${z && z.gain > 0.15 && (z.dx || z.dy) ? ` (your app shows it ${z.dy ? `${Math.abs(z.dy)}px ${z.dy < 0 ? 'higher' : 'lower'}` : ''}${z.dx && z.dy ? ', ' : ''}${z.dx ? `${Math.abs(z.dx)}px ${z.dx < 0 ? 'left' : 'right'}` : ''}${Math.abs(1 - z.scale) >= 0.04 ? ` at ${Math.round(z.scale * 100)}% size` : ''})` : ''}`;
      else if (z && z.scale !== 1 && z.gain > 0.3) fix = `the picture is drawn ${Math.round(Math.abs(1 - z.scale) * 100)}% ${z.scale < 1 ? 'larger (zoomed in)' : 'smaller (zoomed out)'} in Figma than in your app: match Figma's crop/zoom (object-fit: cover on a box of the Figma size, or the same crop)`;
      else if ((s.dx || s.dy) && s.gain > 0.4) { fix = `the content is moved ${s.dx ? `${Math.abs(s.dx)}px ${s.dx > 0 ? 'right' : 'left'}` : ''}${s.dx && s.dy ? ' and ' : ''}${s.dy ? `${Math.abs(s.dy)}px ${s.dy > 0 ? 'down' : 'up'}` : ''}: fix its position${h.kind === 'image' ? ' or crop (object-position / object-fit)' : ''}`; actual = { ...h.box, x: h.box.x + s.dx, y: h.box.y + s.dy }; }
      // Moved with its neighbours and its own size and spacing match: the neighbour's card (small shift, text width) is the cause, so no card here.
      if (!sure && placed.has(h.id) && (s.dx || s.dy) && s.gain > 0.4) continue;
    }
    out.push({ severity: sure ? 'fix' : 'check', kind: `${h.kind} pixels`, id: h.id, name: (h.text ?? h.name).slice(0, 60), what: `${Math.round(h.share * 100)}% of its area differs from Figma`, fix, box: h.box, ...(actual ? { actual } : {}) });
  }
  out.sort((a, b) => (a.severity === 'check' ? 1 : 0) - (b.severity === 'check' ? 1 : 0));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const base = dir.split(/[\\/]/).pop()!;
  return Promise.all(out.slice(0, MAX_FINDINGS).map(async (f, i) => {
    const file = `${String(i + 1).padStart(2, '0')}-${f.id.replace(/[^\w-]/g, '_')}.png`;
    await writeFile(join(dir, file), encodePng(cropPair(figma, app, f.box, f.actual ?? f.box)));
    return { ...f, n: i + 1, crop: `${base}/${file}` };
  }));
}

export async function verify(o: VerifyOptions): Promise<{ report: VerifyReport; files: string[] }> {
  const { info, file } = await findScreen(o.pkgDir, o.screen);
  const vp = file.screen.viewport;
  let measurements: Measurements;
  let shot: Buffer | null = null;
  if (o.url) {
    // Each text with its sibling texts joined: Figma may split one sentence into several layers that the app draws as one element.
    const texts: [string, string, string?][] = [];
    const walk = (n: CanonNode) => {
      if (n.visible === false) return;
      const kids = (n.children ?? []).filter((c) => c.visible !== false && c.type === 'TEXT' && c.text?.characters.trim());
      const ctx = kids.length > 1 ? kids.map((c) => c.text!.characters).join(' ') : undefined;
      for (const c of n.children ?? []) if (kids.includes(c)) texts.push([c.id, c.text!.characters, ctx]); else walk(c);
    };
    if (file.root.type === 'TEXT' && file.root.text?.characters.trim()) texts.push([file.root.id, file.root.text.characters]);
    walk(file.root);
    const assetIds = new Set<string>();
    const collect = (n: CanonNode) => { n.asset?.assetIds.forEach((a) => assetIds.add(a)); if (Array.isArray(n.style?.fills)) n.style!.fills.forEach((p) => p.type === 'image' && p.assetId && assetIds.add(p.assetId)); n.children?.forEach(collect); };
    collect(file.root);
    const r = await measureWeb({ texts, assets: [...assetIds], url: o.url, rootId: file.root.id, viewport: o.window ?? { width: vp.width, height: vp.height + WINDOW_MARGIN }, screenshot: o.screenshot !== false, narrowWidth: NARROW_WIDTH });
    measurements = r.measurements;
    shot = r.screenshot;
    if (!Object.keys(measurements.nodes).length) throw new Error(`No data-figma-id elements found at ${o.url}. Is the app running (start it with your dev command) and is this the right route?`);
  } else if (o.android) measurements = measureAndroid(file.root.id, o.device);
  else if (o.ios) measurements = measureIos(file.root.id, o.device);
  else if (o.measurementsFile) measurements = JSON.parse(await readFile(o.measurementsFile, 'utf8'));
  else throw new Error('Give one of --url, --android, --ios or --measurements.');

  const origin = measurements.nodes[file.root.id] ?? { x: 0, y: 0 };
  // Untagged images and icons found by their asset file are measured like tagged layers.
  if (measurements.assets) Object.assign(measurements.nodes, assetBoxes(file, measurements.assets, origin, new Set(Object.keys(measurements.nodes))));
  const tagged = new Set(Object.entries(measurements.nodes).filter(([, n]) => n.style).map(([id]) => id));
  // Untagged texts are measured by their line boxes; horizontal placement is checked on the aligned edge separately, so x and width follow the design.
  if (measurements.lines)
    for (const { n, b, near } of pairTexts(file, measurements.lines, origin))
      if (!measurements.nodes[n.id] && near.top !== undefined && near.bottom !== undefined)
        measurements.nodes[n.id] = { x: origin.x + b.x, width: b.width, y: near.top, height: near.bottom - near.top, loose: true };
  const report = compare(file, measurements, o.tolerancePx ?? 1);
  if (measurements.lines) {
    const more = textStyleChecks(file, measurements.lines, origin, tagged);
    report.styles.push(...more);
    report.summary.styleFailed = report.styles.length;
    if (more.length) report.summary.verdict = 'fail';
  }
  if (measurements.lines) {
    report.lines = textLineChecks(file, measurements.lines, origin);
    if (report.lines.length) report.summary.verdict = 'fail';
  }
  // The package lives in the app root, so its parent is the code to check.
  report.code = await codeChecks(dirname(o.pkgDir));
  if (report.code.length) report.summary.verdict = 'fail';
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
        const figmaImg = decodePng(await readFile(join(o.pkgDir, ref.file))), appImg = decodePng(shot);
        const { ratio, noise, diff, mask } = diffImages(figmaImg, appImg);
        const diffPath = join(outDir, `${info.slug}.diff.png`);
        await writeFile(diffPath, encodePng(diff));
        files.push(diffPath);
        report.visual = { mismatchRatio: Math.round(ratio * 10000) / 10000, noiseRatio: Math.round(noise * 10000) / 10000, diffImage: `${info.slug}.diff.png`, note: 'Green = shape as in Figma, red = shape as in your app (moved, missing or different), grey = same or rendering-only (photo compression, font smoothing).', hotspots: hotspots(file, mask, diff.width, diff.height) };
        report.findings = await findings(report, figmaImg, appImg, join(outDir, info.slug), file, new Set(Object.keys(measurements.nodes)), measurements);
        if (report.findings.some((f) => f.severity === 'fix')) report.summary.verdict = 'fail';
      } catch (e) {
        report.visual = { mismatchRatio: NaN, diffImage: null, note: `Visual diff skipped: ${e instanceof Error ? e.message : String(e)}.` };
      }
    } else report.visual = { mismatchRatio: NaN, diffImage: null, note: 'No Figma reference screenshot in the package (export with "Reference screenshots").' };
  }
  const jsonPath = join(outDir, `${info.slug}.json`);
  const mdPath = join(outDir, `${info.slug}.md`);
  await writeFile(jsonPath, JSON.stringify({ report, measurements }, null, 2) + '\n');
  await writeFile(mdPath, reportMarkdown(report));
  // A ready prompt to paste into any coding agent; a clean screen has none, so an old one is removed.
  const promptPath = join(outDir, `${info.slug}.prompt.md`), prompt = fixPrompt(report, info.slug);
  if (prompt) { await writeFile(promptPath, prompt); files.unshift(promptPath); } else await rm(promptPath, { force: true });
  files.unshift(mdPath, jsonPath);
  return { report, files };
}
