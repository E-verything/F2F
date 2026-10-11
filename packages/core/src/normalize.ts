import { MIXED, type RawComponent, type RawComponentSet, type RawNode, type RawSnapshot, type RawStyle, type RawVariable, type RawVariableCollection } from './raw';
import {
  SCHEMA_VERSION,
  type Box, type CanonNode, type ComponentUse, type Edge, type Effect, type Geometry, type Inference, type Layout,
  type LetterSpacing, type LineHeight, type Mixed, type Paint, type Relations, type ResponsiveRule, type ScreenDependencies,
  type ScreenFile, type Style, type StyleRef, type Text, type TextRun, type Unsupported, type VarRef,
} from './model';

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  nodeId: string | null;
  message: string;
}

// Per-parent pairwise relation work is O(n^2); beyond this many children only the first ones are related and a warning is emitted.
const MAX_RELATED_CHILDREN = 300;
// Sibling edges closer than this (but not equal) are reported as likely unintended misalignment.
const NEAR_MISS_PX = 1;
const VIEWPORT_CLASSES: { max: number; name: string }[] = [
  { max: 480, name: 'mobile' },
  { max: 1024, name: 'tablet' },
  { max: Infinity, name: 'desktop' },
];
const FONT_WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi ?bold|demi ?bold/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/bold/i, 700], [/black|heavy/i, 900],
  [/regular|normal|book|roman/i, 400],
];

const GEOMETRY_PROPS = ['x', 'y', 'width', 'height', 'rotation', 'relativeTransform', 'absoluteBoundingBox', 'absoluteRenderBounds'];
const CONTAINER_LAYOUT_PROPS = [
  'layoutMode', 'layoutWrap', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'counterAxisAlignContent', 'paddingTop', 'paddingRight',
  'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'itemReverseZIndex',
  'strokesIncludedInLayout', 'gridRowCount', 'gridColumnCount', 'gridRowGap', 'gridColumnGap', 'gridRowSizes', 'gridColumnSizes',
];
const CHILD_LAYOUT_PROPS = [
  'layoutSizingHorizontal', 'layoutSizingVertical', 'layoutAlign', 'layoutGrow', 'layoutPositioning', 'minWidth', 'maxWidth', 'minHeight',
  'maxHeight', 'constraints', 'targetAspectRatio', 'clipsContent', 'gridRowAnchorIndex', 'gridColumnAnchorIndex', 'gridRowSpan', 'gridColumnSpan',
];
const STYLE_PROPS = [
  'fills', 'strokes', 'strokeWeight', 'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeAlign', 'strokeCap',
  'strokeJoin', 'dashPattern', 'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius', 'cornerSmoothing',
  'effects', 'opacity', 'blendMode', 'isMask', 'maskType', 'fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId', 'gridStyleId', 'boundVariables',
];
const TEXT_PROPS = [
  'characters', 'fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase', 'textAlignHorizontal',
  'textAlignVertical', 'textAutoResize', 'textTruncation', 'maxLines', 'paragraphSpacing', 'paragraphIndent', 'listSpacing', 'leadingTrim', 'hasMissingFont',
];
const OTHER_PROPS = ['devStatus', 'reactions', 'exportSettings', 'componentPropertyReferences'];
const HANDLED = new Set([...GEOMETRY_PROPS, ...CONTAINER_LAYOUT_PROPS, ...CHILD_LAYOUT_PROPS, ...STYLE_PROPS, ...TEXT_PROPS, ...OTHER_PROPS]);

export const r4 = (n: number) => {
  const v = Math.round(n * 1e4) / 1e4;
  return v === 0 ? 0 : v;
};
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numOr = (v: unknown, d: number) => (typeof v === 'number' ? r4(v) : d);
const numOrNull = (v: unknown) => (typeof v === 'number' ? r4(v) : null);
const has = (p: Record<string, unknown>, k: string) => p[k] !== undefined;
const toHex = (c: { r: number; g: number; b: number }) =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const matrix = (m: unknown) => (Array.isArray(m) ? m.map((row: number[]) => row.map(r4)) : null);
const box = (b: unknown): Box | null =>
  isObj(b) ? { x: r4(b.x), y: r4(b.y), width: r4(b.width), height: r4(b.height) } : null;

export function weightFromStyle(style: string): number | null {
  for (const [re, w] of FONT_WEIGHTS) if (re.test(style)) return w;
  return null;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unnamed';
}

class Deps {
  components = new Set<string>();
  assets = new Set<string>();
  variables = new Set<string>();
  styles = new Set<string>();
  toJSON(): ScreenDependencies {
    const s = (x: Set<string>) => [...x].sort();
    return { components: s(this.components), assets: s(this.assets), variables: s(this.variables), styles: s(this.styles) };
  }
}

interface Ctx {
  vars: Map<string, RawVariable>;
  styles: Map<string, RawStyle>;
  components: Map<string, RawComponent>;
  componentSets: Map<string, RawComponentSet>;
  collectionDefaults: Map<string, string>;
  imageAssets: Map<string, string>;
  issues: Issue[];
  deps: Deps;
  stats: { nodes: number; properties: number; unsupported: number };
  colorUsage: Map<string, number>;
  typeUsage: Map<string, number>;
}

function varRef(alias: unknown, ctx: Ctx): VarRef | undefined {
  if (!isObj(alias) || alias.type !== 'VARIABLE_ALIAS' || typeof alias.id !== 'string') return undefined;
  ctx.deps.variables.add(alias.id);
  const v = ctx.vars.get(alias.id);
  if (!v) ctx.issues.push({ severity: 'warning', code: 'variable-unresolved', nodeId: null, message: `Variable ${alias.id} is bound but its definition was not exported.` });
  return { id: alias.id, name: v?.name ?? null };
}

function aliases(value: unknown, path: string, ctx: Ctx, out: Record<string, VarRef>) {
  const ref = varRef(value, ctx);
  if (ref) out[path] = ref;
  else if (Array.isArray(value)) value.forEach((v, i) => aliases(v, `${path}[${i}]`, ctx, out));
  else if (isObj(value)) for (const k of Object.keys(value)) aliases(value[k], path ? `${path}.${k}` : k, ctx, out);
}

function styleRef(id: unknown, ctx: Ctx): StyleRef | Mixed | undefined {
  if (id === MIXED) return 'MIXED';
  if (typeof id !== 'string' || id === '') return undefined;
  ctx.deps.styles.add(id);
  return { id, name: ctx.styles.get(id)?.name ?? null };
}

// Only non-default values are emitted: opacity 1, visible true and blendMode NORMAL are implied when absent.
function paintDefaults(p: Record<string, any>): { opacity?: number; visible?: false; blendMode?: string } {
  const out: { opacity?: number; visible?: false; blendMode?: string } = {};
  if (typeof p.opacity === 'number' && p.opacity !== 1) out.opacity = r4(p.opacity);
  if (p.visible === false) out.visible = false;
  if (p.blendMode && p.blendMode !== 'NORMAL' && p.blendMode !== 'PASS_THROUGH') out.blendMode = p.blendMode;
  return out;
}

function paint(p: Record<string, any>, ctx: Ctx): Paint {
  const common = paintDefaults(p);
  if (p.type === 'SOLID') {
    const out: Paint = { type: 'solid', color: toHex(p.color), ...common };
    const v = varRef(p.boundVariables?.color, ctx);
    if (v) out.variable = v;
    if (p.visible !== false) ctx.colorUsage.set(out.color, (ctx.colorUsage.get(out.color) ?? 0) + 1);
    return out;
  }
  if (typeof p.type === 'string' && p.type.startsWith('GRADIENT_')) {
    return {
      type: 'gradient',
      kind: p.type.slice(9).toLowerCase() as 'linear' | 'radial' | 'angular' | 'diamond',
      stops: (p.gradientStops ?? []).map((s: any) => {
        const stop: { position: number; color: string; alpha: number; variable?: VarRef } = { position: r4(s.position), color: toHex(s.color), alpha: numOr(s.color?.a, 1) };
        const v = varRef(s.boundVariables?.color, ctx);
        if (v) stop.variable = v;
        return stop;
      }),
      transform: matrix(p.gradientTransform) ?? [],
      ...common,
    };
  }
  if (p.type === 'IMAGE') {
    const assetId = (p.imageHash && ctx.imageAssets.get(p.imageHash)) || null;
    if (assetId) ctx.deps.assets.add(assetId);
    else ctx.issues.push({ severity: 'warning', code: 'image-unavailable', nodeId: null, message: `Image fill ${p.imageHash ?? '(no hash)'} was not exported.` });
    const out: Paint = { type: 'image', assetId, imageHash: p.imageHash ?? null, scaleMode: p.scaleMode ?? 'FILL', ...common };
    if (p.imageTransform) out.transform = matrix(p.imageTransform)!;
    if (typeof p.rotation === 'number' && p.rotation !== 0) out.rotation = r4(p.rotation);
    if (isObj(p.filters)) out.filters = Object.fromEntries(Object.entries(p.filters).filter(([, v]) => v !== 0).map(([k, v]) => [k, r4(v as number)]));
    return out;
  }
  return { type: 'unsupported', sourceType: String(p.type), ...common, raw: p };
}

function paints(v: unknown, ctx: Ctx): Paint[] | Mixed | undefined {
  if (v === MIXED) return 'MIXED';
  return Array.isArray(v) ? v.map((p) => paint(p, ctx)) : undefined;
}

function effect(e: Record<string, any>, ctx: Ctx): Effect {
  const variables: Record<string, VarRef> = {};
  aliases(e.boundVariables, '', ctx, variables);
  const vars = Object.keys(variables).length ? { variables } : {};
  if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
    const out: Effect = {
      type: e.type === 'DROP_SHADOW' ? 'drop-shadow' : 'inner-shadow',
      color: toHex(e.color), alpha: numOr(e.color?.a, 1), offsetX: numOr(e.offset?.x, 0), offsetY: numOr(e.offset?.y, 0),
      radius: numOr(e.radius, 0), ...paintDefaults({ visible: e.visible, blendMode: e.blendMode }), ...vars,
    };
    if (e.spread) out.spread = r4(e.spread);
    if (typeof e.showShadowBehindNode === 'boolean') out.showShadowBehindNode = e.showShadowBehindNode;
    return out;
  }
  if ((e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') && (e.blurType ?? 'NORMAL') === 'NORMAL') {
    return { type: e.type === 'LAYER_BLUR' ? 'layer-blur' : 'background-blur', radius: numOr(e.radius, 0), ...paintDefaults({ visible: e.visible }), ...vars };
  }
  return { type: 'unsupported', sourceType: String(e.type), ...paintDefaults({ visible: e.visible }), raw: e };
}

function geometry(p: Record<string, any>): Geometry {
  return {
    x: numOr(p.x, 0), y: numOr(p.y, 0), width: numOr(p.width, 0), height: numOr(p.height, 0), rotation: numOr(p.rotation, 0),
    relativeTransform: matrix(p.relativeTransform), absoluteBox: box(p.absoluteBoundingBox), renderBox: box(p.absoluteRenderBounds),
  };
}

const LAYOUT_MODES: Record<string, Layout['mode']> = { NONE: 'none', HORIZONTAL: 'horizontal', VERTICAL: 'vertical', GRID: 'grid' };

function layout(p: Record<string, any>): Layout | undefined {
  const l: Layout = {};
  if (typeof p.layoutMode === 'string') {
    l.mode = LAYOUT_MODES[p.layoutMode] ?? 'none';
    if (l.mode !== 'none') {
      if (has(p, 'layoutWrap')) l.wrap = p.layoutWrap;
      if (has(p, 'primaryAxisAlignItems')) l.primaryAxisAlign = p.primaryAxisAlignItems;
      if (has(p, 'counterAxisAlignItems')) l.counterAxisAlign = p.counterAxisAlignItems;
      if (has(p, 'counterAxisAlignContent')) l.counterAxisAlignContent = p.counterAxisAlignContent;
      l.padding = { top: numOr(p.paddingTop, 0), right: numOr(p.paddingRight, 0), bottom: numOr(p.paddingBottom, 0), left: numOr(p.paddingLeft, 0) };
      if (has(p, 'itemSpacing')) l.itemSpacing = numOr(p.itemSpacing, 0);
      if (has(p, 'counterAxisSpacing')) l.counterAxisSpacing = numOrNull(p.counterAxisSpacing);
      if (has(p, 'primaryAxisSizingMode')) l.primaryAxisSizing = p.primaryAxisSizingMode;
      if (has(p, 'counterAxisSizingMode')) l.counterAxisSizing = p.counterAxisSizingMode;
      if (has(p, 'itemReverseZIndex')) l.itemReverseZIndex = p.itemReverseZIndex;
      if (has(p, 'strokesIncludedInLayout')) l.strokesIncludedInLayout = p.strokesIncludedInLayout;
    }
    if (l.mode === 'grid') l.grid = Object.fromEntries(CONTAINER_LAYOUT_PROPS.filter((k) => k.startsWith('grid') && has(p, k)).map((k) => [k, p[k]]));
    if (l.mode === 'none') delete l.mode;
  }
  // Figma reports these on every layer; only non-default values are emitted (defaults are documented in the schema).
  const sh = p.layoutSizingHorizontal ?? 'FIXED';
  const sv = p.layoutSizingVertical ?? 'FIXED';
  if (sh !== 'FIXED' || sv !== 'FIXED') l.sizing = { horizontal: sh, vertical: sv };
  if (has(p, 'layoutAlign') && p.layoutAlign !== 'INHERIT') l.align = p.layoutAlign;
  if (typeof p.layoutGrow === 'number' && p.layoutGrow !== 0) l.grow = r4(p.layoutGrow);
  if (p.layoutPositioning === 'ABSOLUTE') l.positioning = 'absolute';
  if (typeof p.minWidth === 'number' || typeof p.minHeight === 'number') l.min = { width: numOrNull(p.minWidth), height: numOrNull(p.minHeight) };
  if (typeof p.maxWidth === 'number' || typeof p.maxHeight === 'number') l.max = { width: numOrNull(p.maxWidth), height: numOrNull(p.maxHeight) };
  if (isObj(p.constraints) && (p.constraints.horizontal !== 'MIN' || p.constraints.vertical !== 'MIN'))
    l.constraints = { horizontal: p.constraints.horizontal, vertical: p.constraints.vertical };
  if (isObj(p.targetAspectRatio)) l.aspectRatio = r4(p.targetAspectRatio.x / p.targetAspectRatio.y);
  if (p.clipsContent === true) l.clipsContent = true;
  if (typeof p.gridRowAnchorIndex === 'number' && p.gridRowAnchorIndex >= 0) {
    const gridChild = CHILD_LAYOUT_PROPS.filter((k) => k.startsWith('grid') && has(p, k));
    l.grid = { ...l.grid, ...Object.fromEntries(gridChild.map((k) => [k, p[k]])) };
  }
  return Object.keys(l).length ? l : undefined;
}

function style(p: Record<string, any>, ctx: Ctx): Style | undefined {
  const s: Style = {};
  const fills = paints(p.fills, ctx);
  if (fills !== undefined) s.fills = fills;
  const strokes = paints(p.strokes, ctx);
  if (Array.isArray(strokes) && strokes.length) {
    s.strokes = strokes;
    s.strokeWeight = p.strokeWeight === MIXED
      ? { top: numOr(p.strokeTopWeight, 0), right: numOr(p.strokeRightWeight, 0), bottom: numOr(p.strokeBottomWeight, 0), left: numOr(p.strokeLeftWeight, 0) }
      : numOr(p.strokeWeight, 0);
    if (has(p, 'strokeAlign')) s.strokeAlign = p.strokeAlign;
    if (has(p, 'strokeCap')) s.strokeCap = p.strokeCap === MIXED ? 'MIXED' : p.strokeCap;
    if (has(p, 'strokeJoin')) s.strokeJoin = p.strokeJoin === MIXED ? 'MIXED' : p.strokeJoin;
    if (Array.isArray(p.dashPattern) && p.dashPattern.length) s.dashPattern = p.dashPattern.map(r4);
  }
  if (p.cornerRadius === MIXED)
    s.cornerRadius = { topLeft: numOr(p.topLeftRadius, 0), topRight: numOr(p.topRightRadius, 0), bottomRight: numOr(p.bottomRightRadius, 0), bottomLeft: numOr(p.bottomLeftRadius, 0) };
  else if (typeof p.cornerRadius === 'number' && p.cornerRadius !== 0) s.cornerRadius = r4(p.cornerRadius);
  if (typeof p.cornerSmoothing === 'number' && p.cornerSmoothing !== 0) s.cornerSmoothing = r4(p.cornerSmoothing);
  if (Array.isArray(p.effects) && p.effects.length) s.effects = p.effects.map((e: any) => effect(e, ctx));
  if (typeof p.opacity === 'number' && p.opacity !== 1) s.opacity = r4(p.opacity);
  if (has(p, 'blendMode') && p.blendMode !== 'PASS_THROUGH' && p.blendMode !== 'NORMAL') s.blendMode = p.blendMode;
  if (p.isMask === true) {
    s.isMask = true;
    if (has(p, 'maskType')) s.maskType = p.maskType;
  }
  const styles: NonNullable<Style['styles']> = {};
  const fill = styleRef(p.fillStyleId, ctx);
  if (fill) styles.fill = fill;
  const stroke = styleRef(p.strokeStyleId, ctx);
  if (stroke && stroke !== 'MIXED') styles.stroke = stroke;
  const eff = styleRef(p.effectStyleId, ctx);
  if (eff && eff !== 'MIXED') styles.effect = eff;
  const text = styleRef(p.textStyleId, ctx);
  if (text) styles.text = text;
  const grid = styleRef(p.gridStyleId, ctx);
  if (grid && grid !== 'MIXED') styles.grid = grid;
  if (Object.keys(styles).length) s.styles = styles;
  const variables: Record<string, VarRef> = {};
  aliases(p.boundVariables, '', ctx, variables);
  // Paint and effect bindings are already carried on each paint/effect; text range bindings on each run.
  for (const k of Object.keys(variables)) if (/^(fills|strokes|effects|textRangeFills)\b/.test(k)) delete variables[k];
  if (Object.keys(variables).length) s.variables = variables;
  return Object.keys(s).length ? s : undefined;
}

function lineHeight(v: any): LineHeight {
  if (!isObj(v) || v.unit === 'AUTO') return { unit: 'auto', value: null };
  return { unit: v.unit === 'PERCENT' ? 'percent' : 'px', value: r4(v.value) };
}
const letterSpacing = (v: any): LetterSpacing =>
  ({ unit: isObj(v) && v.unit === 'PERCENT' ? 'percent' : 'px', value: isObj(v) ? r4(v.value) : 0 });

function text(raw: RawNode, ctx: Ctx): Text {
  const p = raw.props as Record<string, any>;
  const segments = raw.textSegments?.length
    ? raw.textSegments
    : [{ start: 0, end: String(p.characters ?? '').length, characters: String(p.characters ?? ''), ...p }];
  const runs: TextRun[] = segments.map((s: Record<string, any>) => {
    const font = isObj(s.fontName) ? s.fontName : { family: 'UNKNOWN', style: 'UNKNOWN' };
    if (!isObj(s.fontName)) ctx.issues.push({ severity: 'warning', code: 'font-unknown', nodeId: raw.id, message: 'Text run has no readable fontName.' });
    const run: TextRun = {
      start: s.start, end: s.end, characters: s.characters, fontFamily: font.family, fontStyle: font.style,
      fontWeight: typeof s.fontWeight === 'number' ? s.fontWeight : null, fontSize: numOr(s.fontSize, 0),
      lineHeight: lineHeight(s.lineHeight), letterSpacing: letterSpacing(s.letterSpacing),
      fills: Array.isArray(s.fills) ? s.fills.map((f: any) => paint(f, ctx)) : [],
    };
    if (s.textDecoration && s.textDecoration !== 'NONE') run.textDecoration = s.textDecoration;
    if (s.textCase && s.textCase !== 'ORIGINAL') run.textCase = s.textCase;
    const textStyle = styleRef(s.textStyleId, ctx);
    if (textStyle && textStyle !== 'MIXED') run.textStyle = textStyle;
    const fillStyle = styleRef(s.fillStyleId, ctx);
    if (fillStyle && fillStyle !== 'MIXED') run.fillStyle = fillStyle;
    const variables: Record<string, VarRef> = {};
    aliases(s.boundVariables, '', ctx, variables);
    if (Object.keys(variables).length) run.variables = variables;
    if (s.hyperlink) run.hyperlink = s.hyperlink;
    const key = `${run.fontFamily}|${run.fontStyle}|${run.fontSize}|${run.lineHeight.unit}:${run.lineHeight.value}|${run.letterSpacing.value}${run.letterSpacing.unit}`;
    ctx.typeUsage.set(key, (ctx.typeUsage.get(key) ?? 0) + 1);
    return run;
  });
  const t: Text = { characters: String(p.characters ?? ''), runs, hasMissingFont: p.hasMissingFont === true };
  if (has(p, 'textAlignHorizontal')) t.alignHorizontal = p.textAlignHorizontal;
  if (has(p, 'textAlignVertical')) t.alignVertical = p.textAlignVertical;
  if (has(p, 'textAutoResize')) t.autoResize = p.textAutoResize;
  if (has(p, 'textTruncation')) t.truncation = p.textTruncation;
  if (has(p, 'maxLines')) t.maxLines = numOrNull(p.maxLines);
  if (typeof p.paragraphSpacing === 'number') t.paragraphSpacing = r4(p.paragraphSpacing);
  if (typeof p.paragraphIndent === 'number') t.paragraphIndent = r4(p.paragraphIndent);
  if (typeof p.listSpacing === 'number') t.listSpacing = r4(p.listSpacing);
  if (has(p, 'leadingTrim')) t.leadingTrim = p.leadingTrim;
  if (t.hasMissingFont) {
    const families = [...new Set(runs.map((r) => `${r.fontFamily} ${r.fontStyle}`))].join(', ');
    ctx.issues.push({ severity: 'warning', code: 'font-missing', nodeId: raw.id, message: `Font not available in the exporting Figma session: ${families}. Metrics may reflect a substitute.` });
  }
  return t;
}

function componentUse(raw: RawNode, ctx: Ctx): ComponentUse {
  const info = raw.instance!;
  const comp = info.mainComponentId ? ctx.components.get(info.mainComponentId) : undefined;
  if (info.mainComponentId) ctx.deps.components.add(info.mainComponentId);
  if (!comp?.definition)
    ctx.issues.push({ severity: 'warning', code: 'component-definition-unavailable', nodeId: raw.id, message: `Main component ${info.mainComponentId ?? '(none)'} of instance "${raw.name}" was not exported; instance children are kept in full.` });
  const properties = info.componentProperties
    ? Object.fromEntries(Object.entries(info.componentProperties).map(([k, v]: [string, any]) => [k, { type: v?.type ?? 'UNKNOWN', value: v?.value ?? null }]))
    : null;
  const use: ComponentUse = {
    componentId: info.mainComponentId, componentName: comp?.name ?? null, setId: comp?.setId ?? null, variant: comp?.variantProperties ?? null,
    properties, overrides: info.overrides.map((o) => ({ nodeId: o.id, fields: [...o.overriddenFields].sort() })),
  };
  const setName = comp?.setId ? ctx.componentSets.get(comp.setId)?.name : undefined;
  if (setName) use.setName = setName;
  return use;
}

function edges(b: Box): Record<Edge, number> {
  return { left: b.x, centerX: b.x + b.width / 2, right: b.x + b.width, top: b.y, centerY: b.y + b.height / 2, bottom: b.y + b.height };
}

export function relations(children: CanonNode[], autoLayout: boolean): Relations | undefined {
  const items = children.filter((c) => c.visible !== false && c.geometry.absoluteBox).slice(0, MAX_RELATED_CHILDREN);
  if (items.length < 2) return undefined;
  const rel: Relations = { gaps: [], alignments: [], overlaps: [], nearMisses: [] };
  items.forEach((a, ai) => {
    const A = a.geometry.absoluteBox!;
    let right: { d: number; id: string } | null = null;
    let below: { d: number; id: string } | null = null;
    items.forEach((b, bi) => {
      if (a === b) return;
      const B = b.geometry.absoluteBox!;
      const vOverlap = Math.min(A.y + A.height, B.y + B.height) - Math.max(A.y, B.y) > 0;
      const hOverlap = Math.min(A.x + A.width, B.x + B.width) - Math.max(A.x, B.x) > 0;
      if (vOverlap && hOverlap) {
        if (ai < bi) rel.overlaps.push([a.id, b.id]);
      } else if (vOverlap && B.x >= A.x + A.width) {
        const d = B.x - (A.x + A.width);
        if (!right || d < right.d) right = { d, id: b.id };
      } else if (hOverlap && B.y >= A.y + A.height) {
        const d = B.y - (A.y + A.height);
        if (!below || d < below.d) below = { d, id: b.id };
      }
    });
    const r = right as { d: number; id: string } | null;
    const bl = below as { d: number; id: string } | null;
    if (r) rel.gaps.push({ from: a.id, to: r.id, axis: 'x', distance: r4(r.d) });
    if (bl) rel.gaps.push({ from: a.id, to: bl.id, axis: 'y', distance: r4(bl.d) });
  });
  const all = items.map((c) => ({ id: c.id, e: edges(c.geometry.absoluteBox!) }));
  for (const edge of ['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] as Edge[]) {
    const groups = new Map<number, string[]>();
    for (const { id, e } of all) {
      const v = r4(Math.round(e[edge] * 100) / 100);
      groups.set(v, [...(groups.get(v) ?? []), id]);
    }
    for (const [value, ids] of groups) if (ids.length > 1) rel.alignments.push({ edge, value, nodeIds: ids });
    if (autoLayout) continue;
    const sorted = [...groups.keys()].sort((x, y) => x - y);
    let cluster: number[] = [];
    const flush = () => {
      if (cluster.length > 1) rel.nearMisses.push({ edge, values: cluster, nodeIds: cluster.flatMap((v) => groups.get(v)!) });
      cluster = [];
    };
    for (const v of sorted) {
      if (cluster.length && v - cluster[cluster.length - 1]! > NEAR_MISS_PX) flush();
      cluster.push(v);
    }
    flush();
  }
  return rel;
}

// Boolean/text/instance-swap property values change the rendered result without always appearing in overrides; omit children only when they all equal the definition defaults.
function propsAtDefaults(raw: RawNode, comp: RawComponent, ctx: Ctx): boolean {
  const defs = (comp.setId ? ctx.componentSets.get(comp.setId)?.propertyDefinitions : comp.propertyDefinitions) as Record<string, any> | null | undefined;
  const values = raw.instance!.componentProperties ?? {};
  for (const [name, v] of Object.entries(values) as [string, any][]) {
    if (v?.type === 'VARIANT') continue;
    if (!defs?.[name] || JSON.stringify(defs[name].defaultValue) !== JSON.stringify(v?.value)) return false;
  }
  return true;
}

function normNode(raw: RawNode, ctx: Ctx, screenAbs: Box | null): CanonNode {
  ctx.stats.nodes++;
  const p = raw.props as Record<string, any>;
  ctx.stats.properties += Object.keys(p).length;
  const node: CanonNode = { id: raw.id, name: raw.name, type: raw.type, visible: raw.visible, geometry: geometry(p) };
  if (raw.locked) node.locked = true;
  const l = layout(p);
  if (l) node.layout = l;
  const s = style(p, ctx);
  if (s) node.style = s;
  if (raw.type === 'TEXT') {
    node.text = text(raw, ctx);
    // Text colour lives on each run; the node-level copy is either identical or MIXED.
    if (node.style) delete node.style.fills;
    if (node.style && !Object.keys(node.style).length) delete node.style;
  }
  if (raw.instance) node.component = componentUse(raw, ctx);
  if (isObj(p.componentPropertyReferences)) node.componentPropertyReferences = p.componentPropertyReferences;
  if (Array.isArray(p.exportSettings) && p.exportSettings.length) node.exportSettings = p.exportSettings;
  if (raw.assetIds?.length) {
    node.asset = { assetIds: [...raw.assetIds].sort(), role: raw.assetRole ?? 'vector' };
    raw.assetIds.forEach((id) => ctx.deps.assets.add(id));
  }
  const unsupported: Unsupported[] = Object.keys(p)
    .filter((k) => !HANDLED.has(k) && !isDefaultValue(k, p[k]))
    .sort()
    .map((k) => ({ property: k, reason: 'not-normalized-by-schema-1', raw: p[k] }));
  for (const issue of raw.issues ?? []) {
    unsupported.push({ property: issue.property ?? '(node)', reason: `read-failed: ${issue.message}` });
    const severity = issue.severity ?? 'error';
    ctx.issues.push({ severity, code: severity === 'error' ? 'property-read-failed' : 'optional-export-failed', nodeId: raw.id, message: `${issue.property ?? '(node)'}: ${issue.message}` });
  }
  if (unsupported.length) {
    node.unsupported = unsupported;
    ctx.stats.unsupported += unsupported.length;
  }
  if (node.geometry.absoluteBox && screenAbs) {
    const b = node.geometry.absoluteBox;
    node.calculated = { screenBox: { x: r4(b.x - screenAbs.x), y: r4(b.y - screenAbs.y), width: b.width, height: b.height } };
  }

  const comp = raw.instance?.mainComponentId ? ctx.components.get(raw.instance.mainComponentId) : undefined;
  const defGeom = comp?.definition ? geometry(comp.definition.props) : null;
  const identical = !!defGeom && raw.instance!.overrides.length === 0 && propsAtDefaults(raw, comp!, ctx) &&
    Math.abs(defGeom.width - node.geometry.width) < 0.01 && Math.abs(defGeom.height - node.geometry.height) < 0.01;
  if (raw.assetRole === 'vector' && raw.children?.length) node.childrenOmitted = 'exported-as-asset';
  else if (identical && raw.children?.length) node.childrenOmitted = 'identical-to-component-definition';
  else if (raw.children?.length) {
    node.children = raw.children.map((c) => normNode(c, ctx, screenAbs));
    // Auto Layout fully determines in-flow child placement via padding/itemSpacing, so measured insets and gaps there would only duplicate (or contradict) the configured values.
    const autoLayout = !!l?.mode && l.mode !== 'none';
    const parentBox = node.geometry.absoluteBox;
    if (parentBox) for (const c of node.children) {
      const cb = c.geometry.absoluteBox;
      if (!cb || (autoLayout && c.layout?.positioning !== 'absolute')) continue;
      c.calculated = {
        ...c.calculated,
        insets: { left: r4(cb.x - parentBox.x), top: r4(cb.y - parentBox.y), right: r4(parentBox.x + parentBox.width - cb.x - cb.width), bottom: r4(parentBox.y + parentBox.height - cb.y - cb.height) },
      };
    }
    if (!autoLayout && node.children.length > MAX_RELATED_CHILDREN)
      ctx.issues.push({ severity: 'info', code: 'relations-truncated', nodeId: raw.id, message: `Only the first ${MAX_RELATED_CHILDREN} children were related geometrically.` });
    const rel = autoLayout ? undefined : relations(node.children, false);
    if (rel) node.calculated = { ...node.calculated, relations: rel };
  }
  return node;
}

const FULL_CIRCLE = 2 * Math.PI;

// Figma returns these on every eligible node even when unused; reporting them as unsupported would bury real gaps.
function isDefaultValue(prop: string, v: unknown): boolean {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return true;
  if (prop === 'arcData' && isObj(v)) return v.startingAngle === 0 && Math.abs(v.endingAngle - FULL_CIRCLE) < 1e-4 && v.innerRadius === 0;
  return false;
}

// Drops values that are implied or derivable so agents read fewer tokens; documented as defaults in the schema.
function compact(n: CanonNode, isRoot: boolean, parentAutoLayout = false) {
  const g = n.geometry;
  const sameBox = (a?: Box | null, b?: Box | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  if (sameBox(g.renderBox, g.absoluteBox)) delete g.renderBox;
  if (!isRoot && n.calculated?.screenBox) delete g.absoluteBox;
  const m = g.relativeTransform;
  if (m && m[0]![0] === 1 && m[0]![1] === 0 && m[1]![0] === 0 && m[1]![1] === 1) delete g.relativeTransform;
  if (g.rotation === 0) delete g.rotation;
  if (n.visible) delete (n as Partial<CanonNode>).visible;
  // Figma ignores constraints on in-flow Auto Layout children.
  if (parentAutoLayout && n.layout?.positioning !== 'absolute' && n.layout?.constraints) delete n.layout.constraints;
  if (n.layout && !Object.keys(n.layout).length) delete n.layout;
  const auto = !!n.layout?.mode && n.layout.mode !== 'none';
  n.children?.forEach((c) => compact(c, false, auto));
}

function walk(n: CanonNode, fn: (n: CanonNode, parent: CanonNode | null) => void, parent: CanonNode | null = null) {
  fn(n, parent);
  n.children?.forEach((c) => walk(c, fn, n));
}

function responsiveRules(root: CanonNode): ResponsiveRule[] {
  const rules: ResponsiveRule[] = [];
  const add = (nodeId: string, rule: string) => rules.push({ nodeId, rule, classification: 'source' });
  walk(root, (n, parent) => {
    const l = n.layout;
    if (!l) return;
    const parentAuto = !!parent?.layout?.mode && parent.layout.mode !== 'none' && l.positioning !== 'absolute';
    for (const axis of ['horizontal', 'vertical'] as const) {
      const sz = l.sizing?.[axis];
      const dim = axis === 'horizontal' ? 'width' : 'height';
      if (sz === 'FILL') add(n.id, `${dim} fills the available space of its parent`);
      else if (sz === 'HUG') add(n.id, `${dim} hugs its content`);
      const c = l.constraints?.[axis];
      if (!parentAuto && parent && c && c !== 'MIN') add(n.id, `${axis} constraint ${c} relative to parent ${parent.id}`);
    }
    if (l.min?.width != null) add(n.id, `min-width ${l.min.width}px`);
    if (l.max?.width != null) add(n.id, `max-width ${l.max.width}px`);
    if (l.min?.height != null) add(n.id, `min-height ${l.min.height}px`);
    if (l.max?.height != null) add(n.id, `max-height ${l.max.height}px`);
    if (l.wrap === 'WRAP') add(n.id, 'children wrap onto new lines when space runs out');
  });
  return rules;
}

export interface NormalizedScreen {
  info: { id: string; name: string; slug: string; pageId: string; pageName: string; feature: string | null; kind: 'frame' | 'fragment'; status: { value: string; source: 'figma-dev-status' | 'none' }; viewport: { width: number; height: number } };
  file: ScreenFile;
}

export interface Normalized {
  screens: NormalizedScreen[];
  components: Record<string, unknown>[];
  componentSets: Record<string, unknown>[];
  variables: Record<string, unknown>[];
  collections: RawVariableCollection[];
  styles: Record<string, unknown>[];
  navigation: Record<string, unknown>[];
  issues: Issue[];
  skipped: { pageId: string; id: string; name: string; type: string; reason: string }[];
  stats: { pages: number; nodes: number; properties: number; unsupported: number };
  usage: { colors: { color: string; count: number }[]; typography: { key: string; count: number }[] };
}

function variableValue(v: unknown, ctx: Ctx): unknown {
  const ref = isObj(v) && v.type === 'VARIABLE_ALIAS' ? { alias: { id: v.id, name: ctx.vars.get(v.id)?.name ?? null } } : null;
  if (ref) return ref;
  if (isObj(v) && typeof v.r === 'number') return { color: toHex(v as any), alpha: numOr(v.a, 1) };
  return typeof v === 'number' ? r4(v) : v;
}

function resolveDefault(v: RawVariable, ctx: Ctx, seen = new Set<string>()): unknown {
  const col = ctx.collectionDefaults.get(v.collectionId);
  const val = col ? v.valuesByMode[col] : Object.values(v.valuesByMode)[0];
  if (isObj(val) && val.type === 'VARIABLE_ALIAS') {
    const target = ctx.vars.get(val.id);
    if (!target || seen.has(val.id)) return null;
    seen.add(val.id);
    return resolveDefault(target, ctx, seen);
  }
  return variableValue(val, ctx);
}

function textStyleProps(p: Record<string, any>) {
  const font = isObj(p.fontName) ? p.fontName : { family: 'UNKNOWN', style: 'UNKNOWN' };
  return {
    fontFamily: font.family, fontStyle: font.style, fontSize: numOr(p.fontSize, 0), lineHeight: lineHeight(p.lineHeight),
    letterSpacing: letterSpacing(p.letterSpacing), paragraphSpacing: numOr(p.paragraphSpacing, 0), paragraphIndent: numOr(p.paragraphIndent, 0),
    textCase: p.textCase ?? 'ORIGINAL', textDecoration: p.textDecoration ?? 'NONE',
  };
}

function flowsFrom(raw: RawNode, screenId: string, out: Record<string, unknown>[]) {
  const reactions = (raw.props as Record<string, any>).reactions;
  if (Array.isArray(reactions))
    for (const r of reactions) {
      const actions = (Array.isArray(r.actions) ? r.actions : r.action ? [r.action] : []).map((a: any) => {
        const out: Record<string, unknown> = { type: a.type };
        for (const k of ['destinationId', 'navigation', 'transition', 'url', 'overlayRelativePosition', 'preserveScrollPosition', 'resetScrollPosition'])
          if (a[k] !== undefined) out[k] = a[k];
        const known = new Set(['type', 'destinationId', 'navigation', 'transition', 'url', 'overlayRelativePosition', 'preserveScrollPosition', 'resetScrollPosition']);
        const extra = Object.keys(a).filter((k) => !known.has(k));
        if (extra.length) out.unnormalized = Object.fromEntries(extra.map((k) => [k, a[k]]));
        return out;
      });
      out.push({ sourceNodeId: raw.id, sourceScreenId: screenId, trigger: r.trigger ?? null, actions });
    }
  raw.children?.forEach((c) => flowsFrom(c, screenId, out));
}

export function normalize(snap: RawSnapshot): Normalized {
  const imageAssets = new Map<string, string>();
  for (const a of snap.assets) if (a.imageHash) imageAssets.set(a.imageHash, a.id);
  const ctx: Ctx = {
    vars: new Map(snap.variables.map((v) => [v.id, v])),
    styles: new Map(snap.styles.map((s) => [s.id, s])),
    components: new Map(snap.components.map((c) => [c.id, c])),
    componentSets: new Map(snap.componentSets.map((s) => [s.id, s])),
    collectionDefaults: new Map(snap.collections.map((c) => [c.id, c.defaultModeId])),
    imageAssets,
    issues: snap.issues.map((i) => ({ severity: 'error' as const, code: 'extraction-error', nodeId: i.nodeId, message: i.property ? `${i.property}: ${i.message}` : i.message })),
    deps: new Deps(),
    stats: { nodes: 0, properties: 0, unsupported: 0 },
    colorUsage: new Map(),
    typeUsage: new Map(),
  };

  const compDeps = new Map<string, ScreenDependencies>();
  const components = [...snap.components].sort((a, b) => a.id.localeCompare(b.id)).map((c) => {
    ctx.deps = new Deps();
    const definition = c.definition ? normNode(c.definition, ctx, box(c.definition.props.absoluteBoundingBox)) : null;
    if (definition) compact(definition, true);
    compDeps.set(c.id, ctx.deps.toJSON());
    return {
      id: c.id, key: c.key, name: c.name, description: c.description, remote: c.remote, setId: c.setId, variant: c.variantProperties,
      dependencies: ctx.deps.toJSON(), definition,
    };
  });

  const screens: NormalizedScreen[] = [];
  const navigation: Record<string, unknown>[] = [];
  const skipped: Normalized['skipped'] = [];
  for (const page of snap.pages) {
    skipped.push(...page.skipped.map((s) => ({ pageId: page.id, ...s })));
    for (const root of page.roots) {
      ctx.deps = new Deps();
      const abs = box(root.node.props.absoluteBoundingBox);
      const canon = normNode(root.node, ctx, abs);
      const dev = (root.node.props as Record<string, any>).devStatus;
      const status = isObj(dev) && typeof dev.type === 'string'
        ? { value: dev.type.toLowerCase().replace(/_/g, '-'), source: 'figma-dev-status' as const }
        : { value: 'unknown', source: 'none' as const };
      const viewport = { width: canon.geometry.width, height: canon.geometry.height };
      const viewportClass = VIEWPORT_CLASSES.find((v) => viewport.width <= v.max)!.name;
      const inference: Inference = { property: 'viewportClass', value: viewportClass, basis: `frame width ${viewport.width}px only; not a source breakpoint` };
      canon.inferred = [...(canon.inferred ?? []), inference];
      const queue = [...ctx.deps.components];
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const d = compDeps.get(id);
        if (!d) continue;
        d.assets.forEach((x) => ctx.deps.assets.add(x));
        d.variables.forEach((x) => ctx.deps.variables.add(x));
        d.styles.forEach((x) => ctx.deps.styles.add(x));
        for (const c of d.components) if (!ctx.deps.components.has(c)) { ctx.deps.components.add(c); queue.push(c); }
      }
      const responsive = responsiveRules(canon);
      compact(canon, true);
      responsive.push({ nodeId: canon.id, rule: `breakpoint behaviour beyond the ${viewport.width}x${viewport.height} frame is not defined by the source`, classification: 'unknown', basis: 'single exported viewport; confirm with the designer' });
      if (status.source === 'none')
        ctx.issues.push({ severity: 'info', code: 'approval-unknown', nodeId: canon.id, message: `Screen "${canon.name}" has no Dev Mode status; approval is unknown.` });
      const info = {
        id: canon.id, name: canon.name, slug: `${slugify(canon.name)}--${canon.id.replace(/[^A-Za-z0-9]+/g, '-')}`, pageId: page.id, pageName: page.name,
        feature: root.feature, kind: root.kind, status, viewport,
      };
      screens.push({ info, file: { schemaVersion: SCHEMA_VERSION, screen: info, responsive, dependencies: ctx.deps.toJSON(), root: canon } });
      flowsFrom(root.node, canon.id, navigation);
    }
  }
  const screenIds = new Set(screens.map((s) => s.info.id));
  for (const f of navigation)
    for (const a of f.actions as Record<string, unknown>[])
      if (typeof a.destinationId === 'string') a.destinationInExport = screenIds.has(a.destinationId);

  const variables = [...snap.variables].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((v) => ({
    id: v.id, key: v.key, name: v.name, description: v.description, type: v.resolvedType, collectionId: v.collectionId, scopes: v.scopes,
    codeSyntax: v.codeSyntax, remote: v.remote,
    valuesByMode: Object.fromEntries(Object.entries(v.valuesByMode).sort(([a], [b]) => a.localeCompare(b)).map(([m, val]) => [m, variableValue(val, ctx)])),
    resolvedDefault: resolveDefault(v, ctx),
  }));
  const styles = [...snap.styles].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((s) => {
    const p = s.props as Record<string, any>;
    const base = { id: s.id, key: s.key, name: s.name, type: s.type, description: s.description, remote: s.remote };
    const variables: Record<string, VarRef> = {};
    aliases(p.boundVariables, '', ctx, variables);
    const vars = Object.keys(variables).length ? { variables } : {};
    if (s.type === 'PAINT') return { ...base, paints: (Array.isArray(p.paints) ? p.paints : []).map((x: any) => paint(x, ctx)), ...vars };
    if (s.type === 'EFFECT') return { ...base, effects: (Array.isArray(p.effects) ? p.effects : []).map((x: any) => effect(x, ctx)), ...vars };
    if (s.type === 'TEXT') {
      const t = textStyleProps(p);
      return { ...base, ...t, inferred: [{ property: 'fontWeight', value: weightFromStyle(t.fontStyle), basis: `font style name "${t.fontStyle}"` }], ...vars };
    }
    return { ...base, layoutGrids: p.layoutGrids ?? [], ...vars };
  });

  return {
    screens,
    components,
    componentSets: [...snap.componentSets].sort((a, b) => a.id.localeCompare(b.id)).map((s) => ({ ...s, componentIds: [...s.componentIds].sort() })),
    variables,
    collections: [...snap.collections].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    styles,
    navigation,
    issues: ctx.issues,
    skipped,
    stats: { pages: snap.pages.length, ...ctx.stats },
    usage: {
      colors: [...ctx.colorUsage].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count || a.color.localeCompare(b.color)),
      typography: [...ctx.typeUsage].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    },
  };
}
