import { sha256, utf8 } from '../../core/src/hash';
import {
  MIXED, RAW_VERSION, type RawAsset, type RawComponent, type RawComponentSet, type RawIssue, type RawNode, type RawPage, type RawScreenRoot,
  type RawSnapshot, type RawStyle, type RawVariable, type RawVariableCollection, type ScopeMode,
} from '../../core/src/raw';

export interface ExtractOptions {
  scope: ScopeMode;
  screenshots: boolean;
  restJson: boolean;
}

export interface ExtractHooks {
  progress(message: string, done: number, total: number): void;
  cancelled(): boolean;
}

export const PLUGIN = { name: 'f2f', version: '0.1.0' };

// Explicit property whitelist; read only when present on the node. Anything here that normalize does not handle is reported as unsupported, never dropped.
const NODE_PROPS = [
  'x', 'y', 'width', 'height', 'rotation', 'relativeTransform', 'absoluteBoundingBox', 'absoluteRenderBounds',
  'layoutMode', 'layoutWrap', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'counterAxisAlignContent', 'paddingTop', 'paddingRight', 'paddingBottom',
  'paddingLeft', 'itemSpacing', 'counterAxisSpacing', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'itemReverseZIndex', 'strokesIncludedInLayout',
  'gridRowCount', 'gridColumnCount', 'gridRowGap', 'gridColumnGap', 'gridRowSizes', 'gridColumnSizes',
  'layoutSizingHorizontal', 'layoutSizingVertical', 'layoutAlign', 'layoutGrow', 'layoutPositioning', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'constraints', 'targetAspectRatio', 'clipsContent', 'gridRowAnchorIndex', 'gridColumnAnchorIndex', 'gridRowSpan', 'gridColumnSpan',
  'fills', 'strokes', 'strokeWeight', 'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeAlign', 'strokeCap',
  'strokeJoin', 'dashPattern', 'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius', 'cornerSmoothing', 'effects',
  'opacity', 'blendMode', 'isMask', 'maskType', 'fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId', 'gridStyleId', 'boundVariables',
  'characters', 'fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase', 'textAlignHorizontal', 'textAlignVertical',
  'textAutoResize', 'textTruncation', 'maxLines', 'paragraphSpacing', 'paragraphIndent', 'listSpacing', 'leadingTrim', 'hasMissingFont',
  'devStatus', 'reactions', 'exportSettings', 'componentPropertyReferences', 'layoutGrids', 'arcData', 'pointCount', 'innerRadius', 'booleanOperation',
];
const SEGMENT_FIELDS = ['fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase', 'fills', 'textStyleId', 'fillStyleId', 'hyperlink', 'boundVariables'] as const;
const SCREEN_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP']);
const SHAPE_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE', 'ELLIPSE', 'RECTANGLE']);
const PATH_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON']);
const CONTAINER_TYPES = new Set(['GROUP', 'FRAME', 'INSTANCE', 'COMPONENT']);
// Yield to the event loop so progress renders and Cancel messages are processed.
const YIELD_EVERY_NODES = 200;
const EXPORT_FORMATS: Record<string, RawAsset['format']> = { SVG: 'svg', PNG: 'png', JPG: 'jpg', PDF: 'pdf' };

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const assetId = (data: Uint8Array | string) => sha256(typeof data === 'string' ? utf8(data) : data).slice(0, 16);

export function plain(v: unknown): unknown {
  if (v === figma.mixed) return MIXED;
  if (v === null || typeof v !== 'object') return typeof v === 'function' || typeof v === 'symbol' ? undefined : v;
  if (Array.isArray(v)) return v.map(plain);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    const x = plain((v as Record<string, unknown>)[k]);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

function imageFormat(b: Uint8Array): RawAsset['format'] {
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'gif';
  if (b[8] === 0x57 && b[9] === 0x45) return 'webp';
  return 'bin';
}

class Extractor {
  issues: RawIssue[] = [];
  assets = new Map<string, RawAsset>();
  components = new Map<string, RawComponent>();
  componentSets = new Map<string, RawComponentSet>();
  pendingComponents = new Map<string, ComponentNode>();
  styleIds = new Set<string>();
  variableIds = new Set<string>();
  imageHashes = new Map<string, string[]>();
  restJson: Record<string, unknown> = {};
  count = 0;
  rootId: string | null = null;
  vectorOnlyCache = new Map<string, boolean>();
  cancelled = false;

  constructor(private opts: ExtractOptions, private hooks: ExtractHooks) {}

  private async checkpoint() {
    if (++this.count % YIELD_EVERY_NODES === 0) {
      this.hooks.progress(`Read ${this.count} layers`, this.count, 0);
      await tick();
    }
    if (this.hooks.cancelled()) this.cancelled = true;
  }

  addAsset(data: Uint8Array | string, format: RawAsset['format'], role: RawAsset['role'], nodeId: string, imageHash?: string): string {
    const id = assetId(data);
    const existing = this.assets.get(id);
    if (existing) {
      if (!existing.sourceNodeIds.includes(nodeId)) existing.sourceNodeIds.push(nodeId);
      if (imageHash && !existing.imageHash) existing.imageHash = imageHash;
    } else this.assets.set(id, { id, format, role, data, sourceNodeIds: [nodeId], ...(imageHash ? { imageHash } : {}) });
    return id;
  }

  collectRefs(value: unknown, nodeId: string | null) {
    if (Array.isArray(value)) value.forEach((v) => this.collectRefs(v, nodeId));
    else if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (o.type === 'VARIABLE_ALIAS' && typeof o.id === 'string') this.variableIds.add(o.id);
      if (o.type === 'IMAGE' && typeof o.imageHash === 'string') {
        const ids = this.imageHashes.get(o.imageHash) ?? [];
        if (nodeId && !ids.includes(nodeId)) ids.push(nodeId);
        this.imageHashes.set(o.imageHash, ids);
      }
      Object.values(o).forEach((v) => this.collectRefs(v, nodeId));
    }
  }

  async readNode(node: SceneNode, isRoot: boolean): Promise<RawNode> {
    await this.checkpoint();
    const raw: RawNode = { id: node.id, name: node.name, type: node.type, visible: node.visible, locked: node.locked, props: {} };
    const n = node as unknown as Record<string, unknown>;
    for (const prop of NODE_PROPS) {
      if (!(prop in node)) continue;
      try {
        const v = plain(n[prop]);
        if (v !== undefined) raw.props[prop] = v;
      } catch (e) {
        (raw.issues ??= []).push({ nodeId: node.id, property: prop, message: String(e) });
      }
    }
    for (const k of ['fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId', 'gridStyleId'])
      if (typeof raw.props[k] === 'string' && raw.props[k]) this.styleIds.add(raw.props[k] as string);
    this.collectRefs(raw.props, node.id);

    if (node.type === 'TEXT') {
      try {
        raw.textSegments = node.getStyledTextSegments([...SEGMENT_FIELDS]).map((s) => plain(s) as RawNode['textSegments'] extends (infer T)[] | undefined ? T : never);
      } catch (e) {
        try {
          raw.textSegments = node.getStyledTextSegments(SEGMENT_FIELDS.filter((f) => f !== 'boundVariables' && f !== 'hyperlink')).map((s) => plain(s) as any);
        } catch (e2) {
          (raw.issues ??= []).push({ nodeId: node.id, property: 'textSegments', message: String(e2) });
        }
      }
      for (const s of raw.textSegments ?? []) {
        if (typeof s.textStyleId === 'string' && s.textStyleId) this.styleIds.add(s.textStyleId);
        if (typeof s.fillStyleId === 'string' && s.fillStyleId) this.styleIds.add(s.fillStyleId);
        this.collectRefs(s, node.id);
      }
    }

    if (node.type === 'INSTANCE') {
      let main: ComponentNode | null = null;
      try {
        main = await node.getMainComponentAsync();
      } catch (e) {
        (raw.issues ??= []).push({ nodeId: node.id, property: 'mainComponent', message: String(e) });
      }
      if (main && !this.components.has(main.id)) this.pendingComponents.set(main.id, main);
      raw.instance = {
        mainComponentId: main?.id ?? null,
        componentProperties: (plain(node.componentProperties) as Record<string, unknown>) ?? null,
        overrides: node.overrides.map((o) => ({ id: o.id, overriddenFields: [...o.overriddenFields] })),
      };
    }

    if ('exportSettings' in node && node.exportSettings.length && !isRoot) {
      raw.assetRole = 'export-setting';
      for (const setting of node.exportSettings) {
        try {
          const format = EXPORT_FORMATS[setting.format] ?? 'bin';
          const data = setting.format === 'SVG' ? await node.exportAsync({ ...setting, format: 'SVG_STRING' } as ExportSettingsSVGString) : await node.exportAsync(setting);
          (raw.assetIds ??= []).push(this.addAsset(data, format, 'export-setting', node.id));
        } catch (e) {
          (raw.issues ??= []).push({ nodeId: node.id, property: 'exportSettings', message: String(e) });
        }
      }
    }

    if ('children' in node && !this.cancelled) {
      raw.children = [];
      for (const child of node.children) {
        if (this.cancelled) break;
        raw.children.push(await this.readNode(child, false));
      }
    }

    if (!isRoot && !raw.assetRole && raw.visible && this.isVectorRoot(node)) {
      try {
        const svg = await node.exportAsync({ format: 'SVG_STRING' });
        raw.assetIds = [this.addAsset(svg, 'svg', 'vector', node.id)];
        raw.assetRole = 'vector';
      } catch (e) {
        (raw.issues ??= []).push({ nodeId: node.id, property: 'exportAsync(SVG)', message: String(e), severity: 'warning' });
      }
    }
    return raw;
  }

  async readComponent(main: ComponentNode): Promise<void> {
    const set = main.parent?.type === 'COMPONENT_SET' ? main.parent : null;
    let definition: RawNode | null = null;
    this.rootId = main.id;
    try {
      definition = await this.readNode(main, true);
    } catch (e) {
      this.issues.push({ nodeId: main.id, property: 'definition', message: String(e) });
    }
    this.components.set(main.id, {
      id: main.id, key: main.key ?? null, name: main.name, description: main.description ?? '', remote: main.remote,
      setId: set?.id ?? null, variantProperties: set ? (plain(main.variantProperties) as Record<string, string>) : null, definition,
      propertyDefinitions: set ? null : this.propertyDefinitions(main),
    });
    if (set && !this.componentSets.has(set.id)) {
      this.componentSets.set(set.id, {
        id: set.id, key: set.key ?? null, name: set.name, description: set.description ?? '', propertyDefinitions: this.propertyDefinitions(set),
        componentIds: set.children.map((c) => c.id),
      });
    }
  }

  private propertyDefinitions(n: ComponentNode | ComponentSetNode): Record<string, unknown> | null {
    try {
      return plain(n.componentPropertyDefinitions) as Record<string, unknown>;
    } catch (e) {
      this.issues.push({ nodeId: n.id, property: 'componentPropertyDefinitions', message: String(e) });
      return null;
    }
  }

  private vectorOnly(n: SceneNode): boolean {
    let v = this.vectorOnlyCache.get(n.id);
    if (v === undefined) {
      // An Auto Layout frame of icons is a layout container (e.g. a row of icons), not a single illustration.
      const autoLayout = 'layoutMode' in n && n.layoutMode !== 'NONE';
      v = SHAPE_TYPES.has(n.type) || (CONTAINER_TYPES.has(n.type) && !autoLayout && 'children' in n && n.children.length > 0 && n.children.every((c) => !c.visible || this.vectorOnly(c)));
      this.vectorOnlyCache.set(n.id, v);
    }
    return v;
  }

  // Export the top-most vector-only subtree once (an icon), never its individual paths; the screen/component root is a boundary, not a candidate.
  private isVectorRoot(node: SceneNode): boolean {
    const hasPath = (n: SceneNode): boolean => PATH_TYPES.has(n.type) || ('children' in n && n.children.some(hasPath));
    if (!this.vectorOnly(node) || !hasPath(node)) return false;
    const parent = node.parent;
    if (!parent || parent.id === this.rootId || parent.type === 'PAGE' || parent.type === 'SECTION' || parent.type === 'DOCUMENT') return true;
    return !this.vectorOnly(parent as SceneNode);
  }

  async root(node: SceneNode, feature: string | null, kind: RawScreenRoot['kind']): Promise<RawScreenRoot> {
    this.rootId = node.id;
    const raw = await this.readNode(node, true);
    if (this.opts.screenshots && !this.cancelled) {
      try {
        const png = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
        this.addAsset(png, 'png', 'screenshot', node.id);
      } catch (e) {
        this.issues.push({ nodeId: node.id, property: 'screenshot', message: String(e) });
      }
    }
    if (this.opts.restJson && !this.cancelled) {
      try {
        this.restJson[node.id] = await node.exportAsync({ format: 'JSON_REST_V1' });
      } catch (e) {
        this.issues.push({ nodeId: node.id, property: 'JSON_REST_V1', message: String(e) });
      }
    }
    return { node: raw, feature, kind };
  }
}

function screenCandidates(nodes: readonly SceneNode[], page: PageNode, selection: boolean): { roots: { node: SceneNode; feature: string | null; kind: RawScreenRoot['kind'] }[]; skipped: RawPage['skipped'] } {
  const roots: { node: SceneNode; feature: string | null; kind: RawScreenRoot['kind'] }[] = [];
  const skipped: RawPage['skipped'] = [];
  for (const node of nodes) {
    if (node.type === 'SECTION') {
      for (const child of node.children)
        if (SCREEN_TYPES.has(child.type)) roots.push({ node: child, feature: node.name, kind: 'frame' });
        else skipped.push({ id: child.id, name: child.name, type: child.type, reason: 'not a frame-like layer inside a section' });
    } else if (node.type === 'COMPONENT_SET') {
      skipped.push({ id: node.id, name: node.name, type: node.type, reason: 'component set; exported via components when used' });
    } else if (SCREEN_TYPES.has(node.type) && (node.parent === page || node.parent?.type === 'SECTION')) {
      const feature = node.parent?.type === 'SECTION' ? node.parent.name : null;
      roots.push({ node, feature, kind: 'frame' });
    } else if (selection) {
      roots.push({ node, feature: null, kind: 'fragment' });
    } else {
      skipped.push({ id: node.id, name: node.name, type: node.type, reason: 'loose top-level layer, not a screen' });
    }
  }
  return { roots, skipped };
}

export async function extract(opts: ExtractOptions, hooks: ExtractHooks): Promise<RawSnapshot> {
  const ex = new Extractor(opts, hooks);
  const pages: RawPage[] = [];
  const pageList = opts.scope === 'all-pages' ? [...figma.root.children] : [figma.currentPage];
  const selectedIds = figma.currentPage.selection.map((n) => n.id);
  if (opts.scope === 'selection' && !selectedIds.length) throw new Error('Nothing is selected. Select frames, sections or layers, or choose another scope.');

  for (const [i, page] of pageList.entries()) {
    if (ex.cancelled) break;
    hooks.progress(`Loading page "${page.name}" (${i + 1}/${pageList.length})`, i, pageList.length);
    await page.loadAsync();
    const sources = opts.scope === 'selection' ? figma.currentPage.selection : page.children;
    const { roots, skipped } = screenCandidates(sources, page, opts.scope === 'selection');
    const rawPage: RawPage = { id: page.id, name: page.name, roots: [], skipped };
    for (const r of roots) {
      if (ex.cancelled) break;
      hooks.progress(`Reading "${r.node.name}"`, i, pageList.length);
      rawPage.roots.push(await ex.root(r.node, r.feature, r.kind));
    }
    pages.push(rawPage);
  }

  while (ex.pendingComponents.size && !ex.cancelled) {
    const [id, main] = ex.pendingComponents.entries().next().value as [string, ComponentNode];
    ex.pendingComponents.delete(id);
    if (ex.components.has(id)) continue;
    hooks.progress(`Reading component "${main.name}"`, 0, 0);
    await ex.readComponent(main);
  }

  hooks.progress('Reading variables and styles', 0, 0);
  const styles = await readStyles(ex);
  const { variables, collections } = await readVariables(ex);

  hooks.progress('Reading images', 0, 0);
  for (const [hash, nodeIds] of ex.imageHashes) {
    if (ex.cancelled) break;
    try {
      const bytes = await figma.getImageByHash(hash)?.getBytesAsync();
      if (!bytes) throw new Error('image not found');
      const asset = ex.assets.get(ex.addAsset(bytes, imageFormat(bytes), 'image-fill', nodeIds[0] ?? '', hash))!;
      asset.sourceNodeIds = [...new Set([...asset.sourceNodeIds, ...nodeIds])].filter(Boolean);
    } catch (e) {
      ex.issues.push({ nodeId: nodeIds[0] ?? null, property: 'imageHash', message: `${hash}: ${String(e)}` });
    }
  }

  return {
    rawVersion: RAW_VERSION,
    plugin: PLUGIN,
    file: { name: figma.root.name, key: figma.fileKey ?? null, editorType: figma.editorType },
    scope: { mode: opts.scope, selectedNodeIds: opts.scope === 'selection' ? selectedIds : [] },
    pages,
    components: [...ex.components.values()],
    componentSets: [...ex.componentSets.values()],
    variables,
    collections,
    styles,
    assets: [...ex.assets.values()],
    issues: ex.issues,
    status: ex.cancelled ? 'cancelled' : 'complete',
    ...(opts.restJson ? { restJson: ex.restJson } : {}),
  };
}

async function readVariables(ex: Extractor): Promise<{ variables: RawVariable[]; collections: RawVariableCollection[] }> {
  const vars = new Map<string, Variable>();
  try {
    for (const v of await figma.variables.getLocalVariablesAsync()) vars.set(v.id, v);
  } catch (e) {
    ex.issues.push({ nodeId: null, property: 'variables', message: String(e) });
  }
  const queue = [...ex.variableIds].filter((id) => !vars.has(id));
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    try {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (v) vars.set(id, v);
    } catch (e) {
      ex.issues.push({ nodeId: null, property: 'variable', message: `${id}: ${String(e)}` });
    }
  }
  for (const v of [...vars.values()])
    for (const val of Object.values(v.valuesByMode))
      if (typeof val === 'object' && val && 'type' in val && val.type === 'VARIABLE_ALIAS' && !vars.has(val.id)) {
        const target = await figma.variables.getVariableByIdAsync(val.id).catch(() => null);
        if (target) vars.set(target.id, target);
      }
  const collections = new Map<string, RawVariableCollection>();
  for (const v of vars.values()) {
    if (collections.has(v.variableCollectionId)) continue;
    try {
      const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      if (c) collections.set(c.id, { id: c.id, name: c.name, defaultModeId: c.defaultModeId, modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })), remote: c.remote });
    } catch (e) {
      ex.issues.push({ nodeId: null, property: 'variableCollection', message: `${v.variableCollectionId}: ${String(e)}` });
    }
  }
  return {
    variables: [...vars.values()].map((v) => ({
      id: v.id, key: v.key ?? null, name: v.name, description: v.description ?? '', resolvedType: v.resolvedType, collectionId: v.variableCollectionId,
      valuesByMode: plain(v.valuesByMode) as Record<string, unknown>, scopes: [...v.scopes], codeSyntax: { ...v.codeSyntax }, remote: v.remote,
    })),
    collections: [...collections.values()],
  };
}

async function readStyles(ex: Extractor): Promise<RawStyle[]> {
  const styles = new Map<string, BaseStyle>();
  const locals: (() => Promise<BaseStyle[]>)[] = [
    () => figma.getLocalPaintStylesAsync(), () => figma.getLocalTextStylesAsync(), () => figma.getLocalEffectStylesAsync(), () => figma.getLocalGridStylesAsync(),
  ];
  for (const get of locals) {
    try {
      for (const s of await get()) styles.set(s.id, s);
    } catch (e) {
      ex.issues.push({ nodeId: null, property: 'localStyles', message: String(e) });
    }
  }
  for (const id of ex.styleIds) {
    if (styles.has(id)) continue;
    try {
      const s = await figma.getStyleByIdAsync(id);
      if (s) styles.set(id, s);
      else ex.issues.push({ nodeId: null, property: 'style', message: `${id}: style not found` });
    } catch (e) {
      ex.issues.push({ nodeId: null, property: 'style', message: `${id}: ${String(e)}` });
    }
  }
  const STYLE_FIELDS: Record<string, string[]> = {
    PAINT: ['paints'],
    TEXT: ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent', 'textCase', 'textDecoration', 'leadingTrim'],
    EFFECT: ['effects'],
    GRID: ['layoutGrids'],
  };
  return [...styles.values()].map((s) => {
    const props: Record<string, unknown> = {};
    for (const k of [...(STYLE_FIELDS[s.type] ?? []), 'boundVariables']) if (k in s) props[k] = plain((s as unknown as Record<string, unknown>)[k]);
    ex.collectRefs(props, null);
    return { id: s.id, key: s.key ?? null, name: s.name, type: s.type as RawStyle['type'], description: s.description ?? '', remote: s.remote, props };
  });
}
