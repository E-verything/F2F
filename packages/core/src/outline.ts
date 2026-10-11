import type { CanonNode, Effect, Paint, ScreenFile, Style, TextRun, VarRef } from './model';

// One line per layer so an agent can read a whole screen cheaply; the JSON file stays the complete source of truth.

const MAX_TEXT = 80;
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const tok = (v?: VarRef) => (v?.name ? `{${v.name}}` : '');

function paintStr(p: Paint, assetPath: (id: string) => string): string {
  const op = p.opacity !== undefined && p.opacity !== 1 ? `@${fmt(p.opacity)}` : '';
  const hidden = p.visible === false ? '(hidden)' : '';
  if (p.type === 'solid') return `${p.color}${tok(p.variable)}${op}${hidden}`;
  if (p.type === 'gradient') return `${p.kind}-gradient(${p.stops.map((s) => `${s.color}${s.alpha !== 1 ? `@${fmt(s.alpha)}` : ''} ${fmt(s.position * 100)}%`).join(', ')})${op}${hidden}`;
  if (p.type === 'image') return `image(${p.assetId ? assetPath(p.assetId) : 'MISSING'} ${p.scaleMode.toLowerCase()})${op}${hidden}`;
  return `unsupported-${p.sourceType}`;
}

function effectStr(e: Effect): string {
  if (e.type === 'drop-shadow' || e.type === 'inner-shadow')
    return `${e.type === 'inner-shadow' ? 'inset ' : ''}shadow ${fmt(e.offsetX)} ${fmt(e.offsetY)} ${fmt(e.radius)}${e.spread ? ` ${fmt(e.spread)}` : ''} ${e.color}@${fmt(e.alpha)}`;
  if (e.type === 'layer-blur' || e.type === 'background-blur') return `${e.type} ${fmt(e.radius)}`;
  return `unsupported-${(e as { sourceType: string }).sourceType}`;
}

const CORNERS = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];

// Four corners bound to the same token read as one radius token.
function variablesStr(vars: Record<string, VarRef>): string {
  const v = { ...vars };
  const first = v[CORNERS[0]!];
  if (first && CORNERS.every((k) => v[k]?.id === first.id)) {
    CORNERS.forEach((k) => delete v[k]);
    v.radius = first;
  }
  return Object.entries(v).map(([k, r]) => `${k}=${tok(r)}`).join(' ');
}

function styleParts(s: Style | undefined, assetPath: (id: string) => string): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.fills === 'MIXED') out.push('fill MIXED');
  else if (s.fills?.length) out.push(`fill ${s.fills.map((p) => paintStr(p, assetPath)).join(' + ')}${s.styles?.fill && s.styles.fill !== 'MIXED' && s.styles.fill.name ? `[${s.styles.fill.name}]` : ''}`);
  if (s.strokes?.length) {
    const w = typeof s.strokeWeight === 'object' ? `${fmt(s.strokeWeight.top)}/${fmt(s.strokeWeight.right)}/${fmt(s.strokeWeight.bottom)}/${fmt(s.strokeWeight.left)}` : String(s.strokeWeight);
    out.push(`stroke ${w} ${(s.strokeAlign ?? '').toLowerCase()} ${s.strokes.map((p) => paintStr(p, assetPath)).join(' + ')}${s.dashPattern ? ` dash ${s.dashPattern.join(',')}` : ''}`);
  }
  if (typeof s.cornerRadius === 'number') out.push(`radius ${fmt(s.cornerRadius)}`);
  else if (s.cornerRadius) out.push(`radius ${fmt(s.cornerRadius.topLeft)}/${fmt(s.cornerRadius.topRight)}/${fmt(s.cornerRadius.bottomRight)}/${fmt(s.cornerRadius.bottomLeft)}`);
  if (s.effects?.length) out.push(s.effects.filter((e) => e.visible !== false).map(effectStr).join(', ') + (s.styles?.effect?.name ? `[${s.styles.effect.name}]` : ''));
  if (s.opacity !== undefined) out.push(`opacity ${fmt(s.opacity)}`);
  if (s.blendMode) out.push(`blend ${s.blendMode.toLowerCase()}`);
  if (s.isMask) out.push('MASK');
  if (s.variables) out.push(variablesStr(s.variables));
  return out;
}

function runStr(r: TextRun, autoPx: number | null): string {
  const lh = r.lineHeight.unit === 'auto' ? (autoPx ? `auto≈${fmt(autoPx)}px` : 'auto') : r.lineHeight.unit === 'px' ? fmt(r.lineHeight.value!) : `${fmt(r.lineHeight.value!)}%`;
  const ls = r.letterSpacing.value ? ` ls ${fmt(r.letterSpacing.value)}${r.letterSpacing.unit === 'px' ? 'px' : '%'}` : '';
  const color = r.fills.map((p) => paintStr(p, () => '')).join('+');
  const extra = [r.textDecoration?.toLowerCase(), r.textCase?.toLowerCase()].filter(Boolean).join(' ');
  return `${r.fontFamily} ${r.fontStyle}${r.fontWeight ? ` ${r.fontWeight}` : ''} ${fmt(r.fontSize)}/${lh}${ls} ${color}${extra ? ` ${extra}` : ''}${r.textStyle?.name ? `[${r.textStyle.name}]` : ''}`;
}

function line(n: CanonNode, assetPath: (id: string) => string): string {
  const g = n.geometry;
  const sb = n.calculated?.screenBox;
  const parts = [`${n.type.toLowerCase()} "${n.name}" #${n.id}`, `${fmt(g.width)}x${fmt(g.height)}${sb ? ` @${fmt(sb.x)},${fmt(sb.y)}` : ''}${g.rotation ? ` rot ${fmt(g.rotation)}` : ''}`];
  if (n.visible === false) parts.push('HIDDEN');
  const l = n.layout;
  if (l) {
    const lp: string[] = [];
    if (l.mode) {
      lp.push(l.mode === 'horizontal' ? 'row' : l.mode === 'vertical' ? 'column' : l.mode);
      if (l.itemSpacing !== undefined) lp.push(`gap ${l.primaryAxisAlign === 'SPACE_BETWEEN' ? 'auto' : fmt(l.itemSpacing)}`);
      if (l.padding && (l.padding.top || l.padding.right || l.padding.bottom || l.padding.left)) lp.push(`pad ${fmt(l.padding.top)}/${fmt(l.padding.right)}/${fmt(l.padding.bottom)}/${fmt(l.padding.left)}`);
      if (l.primaryAxisAlign || l.counterAxisAlign) lp.push(`align ${l.primaryAxisAlign ?? 'MIN'}/${l.counterAxisAlign ?? 'MIN'}`);
      if (l.wrap === 'WRAP') lp.push(`wrap${l.counterAxisSpacing != null ? ` ${fmt(l.counterAxisSpacing)}` : ''}`);
    }
    if (l.sizing) lp.push(`w ${l.sizing.horizontal?.toLowerCase()} h ${l.sizing.vertical?.toLowerCase()}`);
    if (l.grow) lp.push(`grow ${l.grow}`);
    if (l.align === 'STRETCH') lp.push('stretch');
    if (l.positioning === 'absolute') lp.push('ABSOLUTE');
    if (l.constraints) lp.push(`constraints ${l.constraints.horizontal}/${l.constraints.vertical}`);
    if (l.min) lp.push(`min ${l.min.width ?? '-'}x${l.min.height ?? '-'}`);
    if (l.max) lp.push(`max ${l.max.width ?? '-'}x${l.max.height ?? '-'}`);
    if (l.clipsContent) lp.push('clip');
    if (lp.length) parts.push(lp.join(' '));
  }
  parts.push(...styleParts(n.style, assetPath));
  if (n.text) {
    // Figma's 'auto' line height is font-metric based and differs between engines; a box that hugs its text reveals the rendered px.
    const lines = n.text.characters.split('\n').length;
    const autoPx = n.text.autoResize === 'WIDTH_AND_HEIGHT' && new Set(n.text.runs.map((r) => r.fontSize)).size === 1 ? g.height / lines : null;
    const t = n.text.characters.replace(/\n/g, '\\n').replace(/\s+/g, ' ');
    parts.push(`text "${t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t}" ${n.text.runs.map((r) => runStr(r, autoPx)).join(' | ')}${n.text.alignHorizontal && n.text.alignHorizontal !== 'LEFT' ? ` align ${n.text.alignHorizontal.toLowerCase()}` : ''}${n.text.autoResize ? ` resize ${n.text.autoResize.toLowerCase()}` : ''}${n.text.truncation === 'ENDING' ? ` truncate${n.text.maxLines ? ` ${n.text.maxLines} lines` : ''}` : ''}${n.text.hasMissingFont ? ' FONT-MISSING' : ''}`);
  }
  if (n.component) {
    const v = n.component.variant ? ` (${Object.entries(n.component.variant).map(([k, x]) => `${k}=${x}`).join(', ')})` : '';
    const props = Object.entries(n.component.properties ?? {}).filter(([, p]) => p.type !== 'VARIANT').map(([k, p]) => `${k.split('#')[0]}=${JSON.stringify(p.value)}`).join(', ');
    parts.push(`=> component ${n.component.setName ?? n.component.componentName ?? n.component.componentId}${v}${props ? ` props ${props}` : ''}${n.component.overrides.length ? ` overrides ${n.component.overrides.length}` : ''}`);
  }
  if (n.asset) parts.push(`asset ${n.asset.assetIds.map(assetPath).join(', ')}`);
  if (n.childrenOmitted === 'identical-to-component-definition') parts.push('(children = component definition)');
  if (n.unsupported?.length) parts.push(`unsupported: ${n.unsupported.map((u) => u.property).join(', ')}`);
  return parts.join(' | ');
}

export function screenOutline(file: ScreenFile, jsonPath: string, assetPath: (id: string) => string): string {
  const s = file.screen;
  const out = [
    `# ${s.name}`,
    '',
    `Screen ${s.id} on page "${s.pageName}"${s.feature ? `, feature "${s.feature}"` : ''}. Viewport ${s.viewport.width}x${s.viewport.height}. Approval: ${s.status.value}.`,
    `Full detail: [${jsonPath}](${jsonPath.split('/').pop()}). Lines are \`type "name" #id | WxH @x,y (screen-relative px) | layout | style | text | component | asset\`. Colours in {braces} are bound tokens; [brackets] are shared styles.`,
    '',
  ];
  const walk = (n: CanonNode, depth: number) => {
    out.push(`${'  '.repeat(depth)}- ${line(n, assetPath)}`);
    n.children?.forEach((c) => walk(c, depth + 1));
  };
  walk(file.root, 0);
  const unknown = file.responsive.filter((r) => r.classification !== 'source');
  if (unknown.length) out.push('', '## Not defined by the design', '', ...unknown.map((r) => `- ${r.rule} (${r.basis ?? r.classification})`));
  return out.join('\n') + '\n';
}
