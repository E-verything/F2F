import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CanonNode, Paint, ScreenFile } from '../../../core/src/model';
import { TRANSLATION_RULES, tagging, VERIFY_LOOP } from '../../../core/src/guide';
import type { CodeComponent, CodeToken, RepoMap } from './inspect';

// Deterministic feature brief: matches Figma facts to repo code by name/value evidence only, and says "no match" rather than guessing.

export type Confidence = 'exact' | 'likely' | 'none';
export interface Match<T> { target: T | null; confidence: Confidence; evidence: string }

// Words that carry no identity when comparing a Figma name with a code name.
const STOP_WORDS = new Set(['property', 'widget', 'component', 'view', 'app', 'default', 'true', 'false', 'variant', 'type', 'state', 'frame', 'group', 'the']);
// Minimum word overlap (Jaccard) to propose a code component as a likely match.
const LIKELY_OVERLAP = 0.5;
const VERIFY_DEPTH = 2;
const VERIFY_TOLERANCE_PX = 1;

export function words(name: string): string[] {
  return [...new Set(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP_WORDS.has(w) && !/^\d+$/.test(w)))].sort();
}

export function matchComponent(figmaName: string, code: CodeComponent[]): Match<CodeComponent> {
  const a = words(figmaName);
  let best: { c: CodeComponent; score: number } | null = null;
  for (const c of code) {
    const b = words(c.name);
    const inter = a.filter((w) => b.includes(w)).length;
    const score = inter / new Set([...a, ...b]).size;
    if (score > 0 && (!best || score > best.score || (score === best.score && c.name < best.c.name))) best = { c, score };
  }
  if (best && best.score === 1) return { target: best.c, confidence: 'exact', evidence: `same name words [${a.join(', ')}]` };
  if (best && best.score >= LIKELY_OVERLAP) return { target: best.c, confidence: 'likely', evidence: `shared words [${a.filter((w) => words(best!.c.name).includes(w)).join(', ')}]; confirm before reuse` };
  return { target: null, confidence: 'none', evidence: a.length ? `no code component shares the words [${a.join(', ')}]` : 'Figma name has no identifying words' };
}

interface ColorUse { hex: string; token: string | null; count: number }
interface TypeUse { family: string; style: string; weight: number | null; size: number; textStyle: string | null; count: number }

function collect(root: CanonNode, colors: Map<string, ColorUse>, types: Map<string, TypeUse>, boxes: { id: string; name: string; box: { x: number; y: number; width: number; height: number } }[], depth = 0) {
  const addPaint = (p: Paint, styleName: string | null) => {
    if (p.type !== 'solid' || p.visible === false) return;
    const token = p.variable?.name ?? styleName;
    const key = `${p.color}|${token ?? ''}`;
    const u = colors.get(key) ?? { hex: p.color, token, count: 0 };
    u.count++;
    colors.set(key, u);
  };
  const fillStyle = root.style?.styles?.fill;
  if (Array.isArray(root.style?.fills)) root.style!.fills.forEach((p) => addPaint(p, fillStyle && fillStyle !== 'MIXED' ? fillStyle.name : null));
  root.style?.strokes?.forEach((p) => addPaint(p, root.style?.styles?.stroke?.name ?? null));
  for (const r of root.text?.runs ?? []) {
    r.fills.forEach((p) => addPaint(p, r.fillStyle?.name ?? null));
    const key = `${r.fontFamily}|${r.fontStyle}|${r.fontSize}|${r.textStyle?.name ?? ''}`;
    const u = types.get(key) ?? { family: r.fontFamily, style: r.fontStyle, weight: r.fontWeight, size: r.fontSize, textStyle: r.textStyle?.name ?? null, count: 0 };
    u.count++;
    types.set(key, u);
  }
  if (depth > 0 && depth <= VERIFY_DEPTH && root.calculated?.screenBox && root.visible !== false) boxes.push({ id: root.id, name: root.name, box: root.calculated.screenBox });
  root.children?.forEach((c) => collect(c, colors, types, boxes, depth + 1));
}

// Inferred from the name only: OS-drawn chrome that apps normally do not implement.
const SYSTEM_UI = /\b(status ?bar|home ?indicator|keyboard|notch|dynamic island)\b/i;

// Asset ids if every visible leaf of a component definition is an exported vector/asset, i.e. the component is an icon.
function iconAssets(def: CanonNode): string[] | null {
  if (def.asset) return def.asset.assetIds;
  const kids = (def.children ?? []).filter((c) => c.visible !== false);
  if (!kids.length) return null;
  const parts = kids.map(iconAssets);
  return parts.every(Boolean) ? (parts.flat() as string[]) : null;
}

function screenAssets(n: CanonNode, out: Set<string>) {
  n.asset?.assetIds.forEach((id) => out.add(id));
  const fills = Array.isArray(n.style?.fills) ? n.style!.fills : [];
  for (const p of fills) if (p.type === 'image' && p.assetId) out.add(p.assetId);
  if (n.childrenOmitted !== 'identical-to-component-definition') n.children?.forEach((c) => screenAssets(c, out));
}

function instanceIcons(n: CanonNode, out: Map<string, Set<string>>) {
  if (n.component?.componentId && n.asset) {
    const s = out.get(n.component.componentId) ?? new Set<string>();
    n.asset.assetIds.forEach((id) => s.add(id));
    out.set(n.component.componentId, s);
  }
  n.children?.forEach((c) => instanceIcons(c, out));
}

function nodeIds(n: CanonNode, out: Set<string>) {
  out.add(n.id);
  n.children?.forEach((c) => nodeIds(c, out));
}

export interface Brief { markdown: string; data: Record<string, unknown> }

export async function compileFeature(pkgDir: string, feature: string, repo: RepoMap): Promise<Brief> {
  const load = async (p: string) => JSON.parse(await readFile(join(pkgDir, p), 'utf8'));
  const manifest = await load('manifest.json');
  const index = await load('screens/index.json');
  const want = feature.toLowerCase();
  const feat = (manifest.features as { name: string; slug: string; screenIds: string[] }[]).find((f) => f.slug === want || f.name.toLowerCase() === want);
  const screens = (index.screens as any[]).filter((s) => (feat ? feat.screenIds.includes(s.id) : s.slug.startsWith(want) || s.id === feature || s.name.toLowerCase() === want));
  if (!screens.length) {
    const names = (manifest.features as { slug: string }[]).map((f) => f.slug).join(', ');
    throw new Error(`No feature or screen "${feature}". Features: ${names}`);
  }

  const files: ScreenFile[] = await Promise.all(screens.map((s) => load(s.file)));
  const comps = await load('components/components.json');
  const assetsManifest = await load('assets/manifest.json');
  const navigation = await load('flows/navigation.json');
  const unresolved = await load('reports/unresolved-items.json');

  const colors = new Map<string, ColorUse>();
  const types = new Map<string, TypeUse>();
  const ids = new Set<string>();
  const verify = files.map((f) => {
    const boxes: { id: string; name: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    collect(f.root, colors, types, boxes);
    nodeIds(f.root, ids);
    return { screen: f.screen.name, viewport: f.screen.viewport, tolerancePx: VERIFY_TOLERANCE_PX, boxes };
  });
  const compIds = new Set(files.flatMap((f) => f.dependencies.components));
  for (const c of comps.components) if (compIds.has(c.id) && c.definition) collect(c.definition, colors, types, []);

  const setNames = new Map<string, string>((comps.componentSets as any[]).map((s) => [s.id, s.name]));
  const byFamily = new Map<string, { name: string; variants: string[]; ids: string[] }>();
  for (const c of comps.components as any[]) {
    if (!compIds.has(c.id)) continue;
    const name = (c.setId && setNames.get(c.setId)) || c.name;
    const e = byFamily.get(name) ?? { name, variants: [] as string[], ids: [] as string[] };
    if (c.variant) e.variants.push(Object.entries(c.variant).map(([k, v]) => `${k}=${v}`).join(', '));
    e.ids.push(c.id);
    byFamily.set(name, e);
  }
  const compById = new Map<string, any>((comps.components as any[]).map((c) => [c.id, c]));
  const componentMap = [...byFamily.values()].sort((a, b) => a.name.localeCompare(b.name)).map((f) => {
    const match = matchComponent(f.name, repo.components);
    const icons = f.ids.map((id) => compById.get(id)?.definition).map((d) => (d ? iconAssets(d) : null));
    const kind: 'widget' | 'icon' | 'system-ui' = match.confidence === 'none' && SYSTEM_UI.test(f.name) ? 'system-ui' : match.confidence === 'none' && icons.every((i) => i?.length) ? 'icon' : 'widget';
    return { figma: f.name, variants: f.variants.sort(), componentIds: f.ids.sort(), kind, iconAssetIds: kind === 'icon' ? [...new Set(icons.flat() as string[])].sort() : [], ...match };
  });

  const colorTokens = repo.tokens.filter((t) => t.kind === 'color');
  const colorMap = [...colors.values()].sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)).map((c) => {
    const same = colorTokens.filter((t) => t.value === c.hex);
    const named = c.token ? same.find((t) => matchComponent(c.token!, [{ name: t.name, file: t.file, params: [] }]).confidence !== 'none') : undefined;
    const target: CodeToken | undefined = named ?? same[0];
    return { ...c, code: target ? `${target.name} (${target.file})` : null, evidence: target ? (same.length > 1 ? `same value; ${same.length} code tokens share it` : 'same value') : 'no code colour with this value' };
  });

  const textTokens = repo.tokens.filter((t) => t.kind === 'text-style');
  const typeMap = [...types.values()].sort((a, b) => b.count - a.count || a.size - b.size).map((t) => {
    const hit = textTokens.find((x) => x.value.includes(`${t.size}px`) && (!t.weight || x.value.includes(String(t.weight))) && (!/\w+ /.test(x.value) || x.value.toLowerCase().includes(t.family.toLowerCase())));
    return { ...t, code: hit ? `${hit.name} (${hit.file})` : null };
  });
  const families = [...new Set([...types.values()].map((t) => t.family))].sort().map((family) => ({
    family,
    status: repo.fonts.some((f) => f.toLowerCase() === family.toLowerCase()) ? 'declared in project' : repo.styling.includes('google_fonts') ? 'not declared; available via google_fonts if it is a Google Font (verify)' : 'MISSING from project',
  }));

  // Assets inside a component the repo already implements are that widget's concern, so only screen-level assets and those of components still to build are listed.
  const assetIds = new Set<string>();
  files.forEach((f) => screenAssets(f.root, assetIds));
  for (const c of componentMap)
    if (c.confidence !== 'exact' && c.kind !== 'system-ui') for (const id of c.componentIds) (compById.get(id)?.dependencies.assets ?? []).forEach((a: string) => assetIds.add(a));
  const repoAssets = new Map(repo.assets.map((a) => [a.sha256, a.file]));
  const assetDir = repo.assetDirs[0] ?? 'assets/';
  const assetMap = await Promise.all((assetsManifest.assets as any[]).filter((a) => assetIds.has(a.id) && a.role !== 'screenshot').map(async (a) => {
    const sha = createHash('sha256').update(await readFile(join(pkgDir, a.file))).digest('hex');
    const existing = repoAssets.get(sha);
    const action = existing ? `reuse ${existing}`
      : a.role === 'image-fill' ? `sample image in the design (avatar/photo content is usually dynamic); bundle f2f/${a.file} only if it is static`
      : `copy f2f/${a.file} to ${assetDir}`;
    return { id: a.id, role: a.role, file: a.file, sourceNodeIds: a.sourceNodeIds, repo: existing ?? null, action };
  }));
  const assetById = new Map(assetMap.map((a) => [a.id, a]));
  // An instance export (with its colour overrides) already in the repo beats the bare definition export.
  const instanceAssets = new Map<string, Set<string>>();
  files.forEach((f) => instanceIcons(f.root, instanceAssets));
  const iconPaths = (c: (typeof componentMap)[number]) => {
    const inRepo = c.componentIds.flatMap((id) => [...(instanceAssets.get(id) ?? [])]).map((id) => assetById.get(id)?.repo).filter(Boolean) as string[];
    if (inRepo.length) return [...new Set(inRepo)].sort();
    return c.iconAssetIds.map((id) => assetById.get(id)?.repo ?? `f2f/${assetById.get(id)?.file ?? id}`);
  };

  const screenIdSet = new Set(screens.map((s) => s.id));
  const flows = (navigation.flows as any[]).filter((f) => screenIdSet.has(f.sourceScreenId));
  const seen = new Set<string>();
  const open = (unresolved.items as any[]).filter((i) => i.nodeId && ids.has(i.nodeId) && !seen.has(i.message) && seen.add(i.message));

  const data = {
    feature: feat?.name ?? feature,
    screens: screens.map((s) => ({ id: s.id, name: s.name, outline: s.outline, file: s.file, viewport: s.viewport, status: s.status })),
    tagging: tagging(repo.framework, repo.dependencies),
    repo: { framework: repo.framework, styling: repo.styling, entryPoints: repo.entryPoints, routes: repo.routes, assetDirs: repo.assetDirs, commands: repo.commands, limits: repo.limits },
    components: componentMap.map((c) => ({
      figma: c.figma, variants: c.variants, componentIds: c.componentIds, kind: c.kind,
      code: c.target ? { name: c.target.name, file: c.target.file, params: c.target.params } : null, confidence: c.confidence, evidence: c.evidence,
      ...(c.kind === 'icon' ? { icon: iconPaths(c) } : {}),
    })),
    colors: colorMap,
    typography: typeMap,
    fonts: families,
    assets: assetMap,
    navigation: flows,
    unresolved: open,
    verification: verify,
  };
  return { markdown: render(data), data };
}

function render(d: any): string {
  const md: string[] = [];
  const count = (fn: (c: any) => boolean) => d.components.filter(fn).length;
  const reuse = count((c) => c.confidence === 'exact');
  const likely = count((c) => c.confidence === 'likely');
  const icons = count((c) => c.kind === 'icon');
  const system = count((c) => c.kind === 'system-ui');
  const missing = d.components.length - reuse - likely - icons - system;
  md.push(`# Implementation brief: ${d.feature}`, '');
  md.push(`Target repo: ${d.repo.framework}${d.repo.styling.length ? ` (${d.repo.styling.join(', ')})` : ''}. Screens: ${d.screens.length}. Components: ${reuse} reuse, ${likely} to confirm, ${icons} icons (SVG assets), ${missing} widgets to create, ${system} system UI. Assets: ${d.assets.filter((a: any) => a.repo).length} already in repo, ${d.assets.filter((a: any) => !a.repo).length} to add.`, '');
  md.push('## Task', '', `Implement the screens below in this ${d.repo.framework} project. Read each screen outline first (one line per layer), and open its JSON only for details. Reuse the mapped components and tokens. Follow the "Figma → code rules" below. Do not invent values. Ask about anything under "Open questions". Then tag, run and verify as below until the verdict is PASS.`, '');
  md.push('## Tag, run, verify', '', d.tagging.how, '', d.tagging.snippet, '', `Run: ${d.tagging.run}`, '', `Verify each screen: ${d.tagging.verify} (screen ids below). Fix the largest mismatches first and re-run.`, '');
  md.push('## Screens', '', ...d.screens.map((s: any) => `- ${s.name} — ${s.viewport.width}x${s.viewport.height}, approval ${s.status.value}: [outline](../${s.outline}), [full JSON](../${s.file})`), '');
  md.push('## Components', '', '| Figma | Variants used | Code | Confidence | Evidence |', '|---|---|---|---|---|');
  const codeCell = (c: any) =>
    c.code ? `\`${c.code.name}\` (${c.code.file})${c.code.params.length ? ` params: ${c.code.params.join(', ')}` : ''}`
      : c.kind === 'icon' ? `icon — render ${c.icon.join(', ')} (e.g. an SVG widget)`
      : c.kind === 'system-ui' ? 'system UI (inferred from name) — normally drawn by the OS, do not build'
      : '**create new widget**';
  for (const c of d.components) md.push(`| ${c.figma} | ${c.variants.join('; ') || '—'} | ${codeCell(c)} | ${c.confidence} | ${c.evidence} |`);
  md.push('', '## Colours', '', '| Value | Figma token/style | Uses | Code |', '|---|---|---|---|');
  for (const c of d.colors) md.push(`| ${c.hex} | ${c.token ?? '—'} | ${c.count} | ${c.code ?? `**none** — ${c.token ? 'add a token' : 'hard-coded in design'}`} |`);
  md.push('', '## Typography', '', '| Family | Style | Size | Figma style | Uses | Code |', '|---|---|---|---|---|---|');
  for (const t of d.typography) md.push(`| ${t.family} | ${t.style}${t.weight ? ` (${t.weight})` : ''} | ${t.size} | ${t.textStyle ?? '—'} | ${t.count} | ${t.code ?? '**none**'} |`);
  md.push('', 'Fonts: ' + d.fonts.map((f: any) => `${f.family} — ${f.status}`).join('; '), '');
  md.push('## Assets', '', ...d.assets.map((a: any) => `- \`${a.id}\` (${a.role}, layers ${a.sourceNodeIds.slice(0, 3).join(', ')}${a.sourceNodeIds.length > 3 ? '…' : ''}): ${a.action}`), '');
  if (d.navigation.length) md.push('## Prototype navigation (intent only)', '', ...d.navigation.map((f: any) => `- ${f.sourceNodeId} on ${f.trigger?.type ?? '?'}: ${f.actions.map((a: any) => `${a.type}${a.destinationId ? ` → ${a.destinationId}${a.destinationInExport ? '' : ' (not exported)'}` : ''}`).join(', ')}`), '');
  md.push('## Project', '', `Entry points: ${d.repo.entryPoints.join(', ') || 'unknown'}. Routes: ${d.repo.routes.map((r: any) => r.path).join(', ') || 'none found'}. Asset dirs: ${d.repo.assetDirs.join(', ') || 'none'}. Commands: ${Object.entries(d.repo.commands).map(([k, v]) => `${k}=\`${v}\``).join(', ') || 'none'}.`, '');
  if (d.repo.limits.length) md.push(`Inspection limits: ${d.repo.limits.join('; ')}.`, '');
  md.push('## Open questions', '', ...(d.unresolved.length ? d.unresolved.map((u: any) => `- ${u.message} → ${u.action}`) : ['- none']), '');
  md.push(TRANSLATION_RULES, VERIFY_LOOP);
  md.push('## Verification', '', `Render each screen at its viewport and compare these screen-relative boxes (±${VERIFY_TOLERANCE_PX}px). Full list: \`verification\` in the brief JSON.`, '');
  for (const v of d.verification) {
    md.push(`- ${v.screen} @ ${v.viewport.width}x${v.viewport.height}: ` + v.boxes.slice(0, 8).map((b: any) => `"${b.name}" ${b.box.x},${b.box.y} ${b.box.width}x${b.box.height}`).join('; ') + (v.boxes.length > 8 ? `; +${v.boxes.length - 8} more` : ''));
  }
  return md.join('\n') + '\n';
}
