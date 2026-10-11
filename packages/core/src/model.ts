// Canonical design representation. Classification is positional: node.geometry/layout/style/text/component hold source facts, node.calculated holds derived values, node.inferred holds guesses, node.unsupported holds what was not normalized.

export const SCHEMA_VERSION = '1.0.0';

export interface Box { x: number; y: number; width: number; height: number }
export interface VarRef { id: string; name: string | null }
export interface StyleRef { id: string; name: string | null }
export type Mixed = 'MIXED';

export type Paint =
  | { type: 'solid'; color: string; opacity?: number; visible?: false; blendMode?: string; variable?: VarRef }
  | {
      type: 'gradient';
      kind: 'linear' | 'radial' | 'angular' | 'diamond';
      stops: { position: number; color: string; alpha: number; variable?: VarRef }[];
      transform: number[][];
      opacity?: number;
      visible?: false;
      blendMode?: string;
    }
  | { type: 'image'; assetId: string | null; imageHash: string | null; scaleMode: string; opacity?: number; visible?: false; blendMode?: string; transform?: number[][]; rotation?: number; filters?: Record<string, number> }
  | { type: 'unsupported'; sourceType: string; opacity?: number; visible?: false; blendMode?: string; raw: unknown };

export type Effect =
  | { type: 'drop-shadow' | 'inner-shadow'; color: string; alpha: number; offsetX: number; offsetY: number; radius: number; spread?: number; visible?: false; blendMode?: string; showShadowBehindNode?: boolean; variables?: Record<string, VarRef> }
  | { type: 'layer-blur' | 'background-blur'; radius: number; visible?: false; variables?: Record<string, VarRef> }
  | { type: 'unsupported'; sourceType: string; visible?: false; raw: unknown };

// Omitted fields mean: rotation 0, relativeTransform = pure translation by x/y, absoluteBox = screen root absoluteBox + calculated.screenBox, renderBox = absoluteBox.
export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  relativeTransform?: number[][] | null;
  absoluteBox?: Box | null;
  renderBox?: Box | null;
}

export interface Layout {
  mode?: 'none' | 'horizontal' | 'vertical' | 'grid';
  wrap?: string;
  primaryAxisAlign?: string;
  counterAxisAlign?: string;
  counterAxisAlignContent?: string;
  padding?: { top: number; right: number; bottom: number; left: number };
  itemSpacing?: number;
  counterAxisSpacing?: number | null;
  primaryAxisSizing?: string;
  counterAxisSizing?: string;
  itemReverseZIndex?: boolean;
  strokesIncludedInLayout?: boolean;
  grid?: Record<string, unknown>;
  sizing?: { horizontal: string | null; vertical: string | null };
  align?: string;
  grow?: number;
  positioning?: 'auto' | 'absolute';
  min?: { width: number | null; height: number | null };
  max?: { width: number | null; height: number | null };
  constraints?: { horizontal: string; vertical: string };
  aspectRatio?: number | null;
  clipsContent?: boolean;
}

export interface Style {
  fills?: Paint[] | Mixed;
  strokes?: Paint[];
  strokeWeight?: number | Mixed | { top: number; right: number; bottom: number; left: number };
  strokeAlign?: string;
  strokeCap?: string | Mixed;
  strokeJoin?: string | Mixed;
  dashPattern?: number[];
  cornerRadius?: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  cornerSmoothing?: number;
  effects?: Effect[];
  opacity?: number;
  blendMode?: string;
  isMask?: boolean;
  maskType?: string;
  styles?: { fill?: StyleRef | Mixed; stroke?: StyleRef; effect?: StyleRef; text?: StyleRef | Mixed; grid?: StyleRef };
  variables?: Record<string, VarRef>;
}

export interface LineHeight { unit: 'px' | 'percent' | 'auto'; value: number | null }
export interface LetterSpacing { unit: 'px' | 'percent'; value: number }

export interface TextRun {
  start: number;
  end: number;
  characters: string;
  fontFamily: string;
  fontStyle: string;
  fontWeight: number | null;
  fontSize: number;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  // Omitted when NONE / ORIGINAL / unstyled.
  textDecoration?: string;
  textCase?: string;
  fills: Paint[];
  textStyle?: StyleRef;
  fillStyle?: StyleRef;
  variables?: Record<string, VarRef>;
  hyperlink?: unknown;
}

export interface Text {
  characters: string;
  runs: TextRun[];
  alignHorizontal?: string;
  alignVertical?: string;
  autoResize?: string;
  truncation?: string;
  maxLines?: number | null;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  listSpacing?: number;
  leadingTrim?: string;
  hasMissingFont: boolean;
}

export interface ComponentUse {
  componentId: string | null;
  componentName: string | null;
  setId: string | null;
  setName?: string;
  variant: Record<string, string> | null;
  properties: Record<string, { type: string; value: unknown }> | null;
  overrides: { nodeId: string; fields: string[] }[];
}

export interface Relations {
  gaps: { from: string; to: string; axis: 'x' | 'y'; distance: number }[];
  alignments: { edge: Edge; value: number; nodeIds: string[] }[];
  overlaps: [string, string][];
  nearMisses: { edge: Edge; nodeIds: string[]; values: number[] }[];
}
export type Edge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

export interface Calculated {
  screenBox?: Box;
  insets?: { left: number; top: number; right: number; bottom: number };
  relations?: Relations;
}

export interface Inference { property: string; value: unknown; basis: string }
export interface Unsupported { property: string; reason: string; raw?: unknown }

export interface CanonNode {
  id: string;
  name: string;
  type: string;
  // Omitted when true.
  visible?: boolean;
  locked?: boolean;
  geometry: Geometry;
  layout?: Layout;
  style?: Style;
  text?: Text;
  component?: ComponentUse;
  componentPropertyReferences?: Record<string, string>;
  asset?: { assetIds: string[]; role: string };
  exportSettings?: unknown[];
  calculated?: Calculated;
  inferred?: Inference[];
  unsupported?: Unsupported[];
  childrenOmitted?: 'identical-to-component-definition' | 'exported-as-asset';
  children?: CanonNode[];
}

export type Classification = 'source' | 'calculated' | 'inferred' | 'unknown';

export interface ResponsiveRule {
  nodeId: string;
  rule: string;
  classification: Classification;
  // Omitted for 'source' rules, which always come from a Figma layout property.
  basis?: string;
}

export interface ScreenDependencies {
  components: string[];
  assets: string[];
  variables: string[];
  styles: string[];
}

export interface ScreenInfo {
  id: string;
  name: string;
  slug: string;
  file: string;
  pageId: string;
  pageName: string;
  feature: string | null;
  kind: 'frame' | 'fragment';
  status: { value: string; source: 'figma-dev-status' | 'none' };
  viewport: { width: number; height: number };
  contentHash: string;
}

export interface ScreenFile {
  schemaVersion: string;
  screen: Omit<ScreenInfo, 'file' | 'contentHash'>;
  responsive: ResponsiveRule[];
  dependencies: ScreenDependencies;
  root: CanonNode;
}
