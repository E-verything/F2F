// Contract between the Figma plugin sandbox (producer) and the core normalizer (consumer); all values are plain JSON copies of Plugin API reads.

export const RAW_VERSION = 1;
export const MIXED = '__MIXED__';

export type ScopeMode = 'selection' | 'page' | 'all-pages';

export interface RawIssue {
  nodeId: string | null;
  property: string | null;
  message: string;
  // Warning for opportunistic work the user did not request (e.g. auto icon export); defaults to error.
  severity?: 'error' | 'warning';
}

export interface RawTextSegment {
  start: number;
  end: number;
  characters: string;
  [field: string]: unknown;
}

export interface RawInstanceInfo {
  mainComponentId: string | null;
  componentProperties: Record<string, unknown> | null;
  overrides: { id: string; overriddenFields: string[] }[];
}

export interface RawNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  props: Record<string, unknown>;
  textSegments?: RawTextSegment[];
  instance?: RawInstanceInfo;
  assetIds?: string[];
  assetRole?: 'vector' | 'export-setting';
  issues?: RawIssue[];
  children?: RawNode[];
}

export interface RawScreenRoot {
  node: RawNode;
  feature: string | null;
  kind: 'frame' | 'fragment';
}

export interface RawPage {
  id: string;
  name: string;
  roots: RawScreenRoot[];
  skipped: { id: string; name: string; type: string; reason: string }[];
}

export interface RawComponent {
  id: string;
  key: string | null;
  name: string;
  description: string;
  remote: boolean;
  setId: string | null;
  variantProperties: Record<string, string> | null;
  definition: RawNode | null;
  // Only for standalone components; variant components take theirs from the component set.
  propertyDefinitions: Record<string, unknown> | null;
}

export interface RawComponentSet {
  id: string;
  key: string | null;
  name: string;
  description: string;
  propertyDefinitions: Record<string, unknown> | null;
  componentIds: string[];
}

export interface RawVariable {
  id: string;
  key: string | null;
  name: string;
  description: string;
  resolvedType: string;
  collectionId: string;
  valuesByMode: Record<string, unknown>;
  scopes: string[];
  codeSyntax: Record<string, string>;
  remote: boolean;
}

export interface RawVariableCollection {
  id: string;
  name: string;
  defaultModeId: string;
  modes: { modeId: string; name: string }[];
  remote: boolean;
}

export interface RawStyle {
  id: string;
  key: string | null;
  name: string;
  type: 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID';
  description: string;
  remote: boolean;
  props: Record<string, unknown>;
}

export interface RawAsset {
  id: string;
  format: 'svg' | 'png' | 'jpg' | 'gif' | 'pdf' | 'webp' | 'bin';
  role: 'vector' | 'image-fill' | 'export-setting' | 'screenshot';
  data: Uint8Array | string;
  sourceNodeIds: string[];
  imageHash?: string;
}

export interface RawSnapshot {
  rawVersion: typeof RAW_VERSION;
  plugin: { name: string; version: string };
  file: { name: string; key: string | null; editorType: string };
  scope: { mode: ScopeMode; selectedNodeIds: string[] };
  pages: RawPage[];
  components: RawComponent[];
  componentSets: RawComponentSet[];
  variables: RawVariable[];
  collections: RawVariableCollection[];
  styles: RawStyle[];
  assets: RawAsset[];
  issues: RawIssue[];
  status: 'complete' | 'partial' | 'cancelled';
  restJson?: Record<string, unknown>;
}
