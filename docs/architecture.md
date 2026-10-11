# Architecture

```
Figma (authorised session)
  └─ plugin sandbox: packages/plugin/src/extract.ts ── explicit property reads ──▶ RawSnapshot (packages/core/src/raw.ts)
       └─ packages/core/src/normalize.ts ── canonical model (packages/core/src/model.ts) + calculations + issues
            └─ packages/core/src/package.ts ── files map ──▶ plugin UI zips it (fflate) ──▶ <file>-f2f.zip on disk
CLI: packages/cli/src/index.ts ── validate <dir> (schema, hashes, cross-references; packages/core/src/validate.ts)
```

## Repo-aware brief and verification

```
f2f build:  packages/cli/src/repo/inspect.ts (read-only scan, never .env/keys) ─► packages/cli/src/repo/compile.ts ─► briefs/<feature>.md (+ packages/core/src/guide.ts rules)
f2f verify: runtime measurements ─► packages/cli/src/verify/compare.ts ─► verification/<screen>.md/.json
   web / Flutter web : packages/cli/src/verify/web.ts     Chrome DevTools protocol over Node's WebSocket; data-figma-id or flt-semantics-identifier
   Android           : packages/cli/src/verify/mobile.ts  adb uiautomator dump (px → dp via wm density)
   iOS               : packages/cli/src/verify/mobile.ts  idb ui describe-all (points)
   Flutter (host)    : packages/cli/templates/flutter/f2f_probe.dart → JSON → --measurements
   visual            : packages/cli/src/verify/png.ts     dependency-free PNG codec, alpha-composited diff vs the Figma screenshot
```

Comparison is relative to the measured screen root, so page padding, centring or a device status bar do not count as errors. Boxes clipped by a clipping ancestor are accepted (Flutter semantics and native accessibility report clipped rects). Hugging text that differs only in width is a font-metric warning, not a layout failure. Concrete mismatches decide FAIL before missing coverage decides INCOMPLETE.

## Boundaries

- **Plugin sandbox** (`extract.ts`, `code.ts`) is the only code that touches the Figma API. It reads an explicit whitelist of properties (`NODE_PROPS`), converts `figma.mixed` to `"__MIXED__"`, catches every failing read per property, and records it on the node.
- **RawSnapshot** is a plain-JSON contract. Tests build snapshots directly (`tests/fixtures/login.ts`), so normalization is tested without Figma.
- **Core** (`normalize`, `package`, `design-md`, `hash`) is pure, deterministic and free of Node APIs, so it runs both inside the plugin and in Node.
- **Validation** (`validate.ts`, uses ajv) is Node/CLI only and is never bundled into the plugin.

## Fact classification

Classification is by position in the node, not by per-value wrappers, which keeps the output compact.

| Location | Class | Example |
|---|---|---|
| `geometry`, `layout`, `style`, `text`, `component` | source | `layout.itemSpacing: 16` |
| `calculated` | calculated | `relations.gaps[].distance` (measured, never treated as configured spacing) |
| `inferred` | inferred, with `basis` | `viewportClass: mobile` from frame width only |
| `unsupported`, `reports/unresolved-items.json` | unknown | `layoutGrids` not normalised in schema 1; failed reads |
| `screen.responsive[]` | explicit `classification` per rule | FILL sizing = source; breakpoints = unknown |

## Deduplication

- **Components:** each main component's definition is normalised once into `components/components.json`. An instance omits its children (`childrenOmitted: identical-to-component-definition`) only if all of these hold: no overrides, every non-variant component property equals its definition default, and the size equals the definition. Otherwise it keeps its full effective subtree.
- **Assets:** the id is the first 16 hex characters of the SHA-256 of the content, so identical icons, images or exports are stored once and list every source node.
- **Vector icons:** the top-most vector-only subtree is exported once as SVG, and its paths are omitted (`childrenOmitted: exported-as-asset`).

## Determinism and stale detection

Arrays are sorted where source order carries no meaning (variables, styles, components, assets, dependency ids). Layer order is preserved. Only `manifest.volatile` (export time, timing) changes between exports of an unchanged design, and a test enforces this. `manifest.files` holds the SHA-256 of every file, so `f2f validate` can flag edited or stale files. Each screen in `screens/index.json` carries a `contentHash` for incremental comparison.

## Language decision

TypeScript was chosen for the CLI over Rust because the plugin must be TypeScript and the normalizer is shared. A Rust CLI would need a second schema implementation with no measured benefit yet. We will revisit this if Phase 6 benchmarks show CLI startup or memory is a bottleneck. Measured sizes: plugin bundle about 95 KB, UI about 14 KB (`npm run build`).

## Privacy

`manifest.json` declares `networkAccess.allowedDomains: ["none"]`, so the plugin cannot make network requests. Output is downloaded as a ZIP to wherever the browser or desktop app saves downloads. There is no telemetry. Repository contents are never read by the plugin.

## Known limitations (schema 1.0.0)

- Normalised as unsupported (raw value preserved): layout grids, arc data, star/polygon point counts, boolean operation type, effect types beyond shadow and normal blur (noise, texture, glass, progressive blur), and video/pattern paints.
- Line height `AUTO` is reported as `{unit: auto, value: null}`. The rendered line height depends on the font and is not computed.
- `variantProperties` is deprecated in the Plugin API typings. It is still used to read the variant values of a main component until a replacement for main components is confirmed.
- Breakpoints are never inferred. Linking mobile, tablet and desktop variants is Phase 3.
- Large files: pages are loaded one at a time, but the whole snapshot is held in memory before packaging. Streaming per page is Phase 3.
- Agent context size: on a real 640-layer, 2-screen export, each screen went from about 1.6 MB of pretty-printed JSON to about 230 KB of minified JSON, which is the full reference. Agents read the generated `screens/<screen>.md` outline instead, about 11k tokens per screen and one line per layer. These figures come from re-processing that export offline; a fresh plugin export is still needed to confirm them.
- Only non-default values are emitted (paint opacity/visibility/blend, layout sizing/align/constraints, text decoration/case, visible). Defaults are documented in the schema. Measured insets and gaps are only computed where Auto Layout does not define placement.
