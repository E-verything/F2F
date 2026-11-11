// Framework-neutral Figma→code rules and per-framework tagging/verification, shared by DESIGN.md and feature briefs.
// Every rule here came from a measured mismatch, so it is phrased as a rule, not advice.

export const TRANSLATION_RULES = [
  '## Figma → code rules',
  '',
  '| Figma | Flutter | Web (CSS) |',
  '|---|---|---|',
  '| Auto Layout horizontal / vertical | `Row` / `Column` | `display:flex; flex-direction:row/column` |',
  '| `gap N` (itemSpacing) | `SizedBox` of N between children (or `spacing:` on Row/Column) | `gap: Npx` |',
  '| `gap auto` / SPACE_BETWEEN | `MainAxisAlignment.spaceBetween` | `justify-content: space-between` |',
  '| `pad t/r/b/l` | `Padding(EdgeInsets.fromLTRB(l, t, r, b))` | `padding: t r b l` |',
  '| `w fixed` / `h fixed` | exact `width` / `height` | exact `width` / `height` |',
  '| `w hug` (container) | `mainAxisSize: MainAxisSize.min`, no width | `width: fit-content` |',
  '| `w fill` | `Expanded` on the main axis, `CrossAxisAlignment.stretch` / `double.infinity` on the cross axis | `flex: 1 1 0` / `align-self: stretch` |',
  '| `ABSOLUTE` child or parent without Auto Layout | `Stack` + `Positioned` at the outline x,y minus the parent x,y | `position:absolute` at the same offsets |',
  '| `clip` | `ClipRRect` / `clipBehavior` | `overflow:hidden` |',
  '| stroke `inside` | `foregroundDecoration` border: it must not change the box size | `border` with `box-sizing:border-box` |',
  '| stroke `outside` / `center` | `foregroundDecoration` border, box size unchanged | `outline` / `box-shadow` (not `border`) |',
  '| `radius 9999` | `BorderRadius.circular(9999)` / `StadiumBorder` | `border-radius: 9999px` |',
  '| `shadow x y blur spread #c@a` | `BoxShadow(offset: Offset(x, y), blurRadius: blur, spreadRadius: spread)` | `box-shadow: x y blur spread rgba()` |',
  '| line height `N` / `N%` | `height: N / fontSize` / `height: N / 100` | `line-height: Npx` / `N%` |',
  '| line height `auto≈Npx` | pin `height: N / fontSize`; engines disagree on font metrics | `line-height: Npx` |',
  '| letter spacing `ls P%` | `letterSpacing: P / 100 * fontSize` | `letter-spacing: P/100 em` |',
  '| text `\\n` | keep the line break; do not let the box re-wrap | `white-space: pre-line` |',
  '| image `fill` / `fit` | `BoxFit.cover` / `BoxFit.contain` with `filterQuality: FilterQuality.high` | `object-fit: cover` / `contain` |',
  '| image `crop → object-fit: cover; object-position: X% Y%` | `BoxFit.cover` with `alignment: Alignment(X/50-1, Y/50-1)` | exactly that CSS (a centred cover shows a different part of the image) |',
  '| SVG asset `WxH` | wrap in `SizedBox(W, H)` so the layout box is the design size | `width/height` on the `<img>`/`<svg>` |',
  '| layer `HIDDEN` / paint `(hidden)` | do not render | do not render |',
  '| `(children = component definition)` | use the code component mapped in the brief, unchanged | same |',
  '',
  'Fonts: use the exact family and weight listed. Small text-width differences come from font builds; the verifier reports them separately as warnings. System UI (status bar, home indicator) is drawn by the OS: keep its space, do not draw it.',
  '',
].join('\n');

export interface Tagging { how: string; snippet: string; run: string; verify: string }

const flutter: Tagging = {
  how: 'Wrap each layer you build in `figma(\'<id>\', widget)` (ids are the `#…` values in the outline). Add the helper once:',
  snippet: "```dart\n// lib/f2f_tag.dart\nimport 'package:flutter/widgets.dart';\n\nWidget figma(String? id, Widget child) => id == null ? child : Semantics(identifier: 'figma:$id', container: true, child: child);\n```\nIn `main()`, before `runApp`: `if (const bool.fromEnvironment('FIGMA_VERIFY')) SemanticsBinding.instance.ensureSemantics();` (import `package:flutter/semantics.dart`).",
  run: '`flutter run -d chrome --web-port 8080 --dart-define=FIGMA_VERIFY=true` (web), or run on an Android emulator / iOS simulator with the same `--dart-define`.',
  verify: '`f2f verify --screen <id> --url "http://localhost:8080/#/<route>"`, `--android`, or `--ios`',
};
const web: Tagging = {
  how: 'Add `data-figma-id="<id>"` to the element that renders each layer (ids are the `#…` values in the outline).',
  snippet: '```html\n<div data-figma-id="869:16072" class="post">…</div>\n```',
  run: 'Start the dev server (see Commands).',
  verify: '`f2f verify --screen <id> --url http://localhost:<port>/<route>`',
};
const reactNative: Tagging = {
  how: 'Set `testID="figma:<id>"` on the view that renders each layer.',
  snippet: '```tsx\n<View testID="figma:869:16072">…</View>\n```',
  run: 'Run the app on an Android emulator or iOS simulator.',
  verify: '`f2f verify --screen <id> --android` (adb) or `--ios` (idb)',
};
const native: Tagging = {
  how: 'Android Compose: `Modifier.testTag("figma:<id>")` with `semantics { testTagsAsResourceId = true }` on the root. SwiftUI/UIKit: `.accessibilityIdentifier("figma:<id>")`.',
  snippet: '```kotlin\nBox(Modifier.testTag("figma:869:16072"))\n```',
  run: 'Run the app on an emulator/simulator or device.',
  verify: '`f2f verify --screen <id> --android` (adb) or `--ios` (idb)',
};

export function tagging(framework: string, dependencies: string[] = []): Tagging {
  if (framework === 'flutter') return flutter;
  if (dependencies.includes('react-native')) return reactNative;
  if (['react', 'next', 'vue', 'svelte'].includes(framework)) return web;
  return { ...web, how: `${web.how} Mobile: ${reactNative.how} ${native.how}` };
}

// Measuring at one viewport must not turn the design into a fixed canvas; these rules keep the built code production-grade.
export const PRODUCTION_RULES = [
  '## Production code rules',
  '',
  '- **Fluid, not a fixed canvas.** Never give the page or a section the design viewport width. Sections are full width; content sits in a centred container with `max-width` set to the design container width. Rows of cards use wrapping flex or a grid (`repeat(auto-fit, minmax(<card min width>, 1fr))`) so they stack on narrow screens. Use absolute positions only for decorations.',
  '- **Responsive.** `f2f verify` checks the design viewport. Below it, the layout must still work with no horizontal scroll at 375px wide: stack columns, let text wrap (drop design `\\n` line breaks under the design width), scale big headings with `clamp()`. Header navigation collapses into a menu button (`<button aria-expanded>` that opens the same links) once the links no longer fit on one line; never let nav links wrap. Follow breakpoints in the project profile if it lists any.',
  '- **Clean values.** Round sub-pixel measurements to whole px or the nearest token within 1px (23.08 → 24 if a 24 token exists). Do not add padding or offsets to chase fractions; the verifier tolerance and its font-metric warnings cover them.',
  '- **Semantic order.** HTML order follows reading order (header, main, footer) whatever the Figma layer order. Positions are measured, not order.',
  '- **Real interactions.** Links are `<a href>`, actions are `<button>`, each with hover, focus-visible and active styles (from the design, or a darker/lighter step of the same token). Accordions use `<details>/<summary>` or a button with `aria-expanded`. Forms use `<form>`, `<label>` and real inputs. Text stays text; images get alt text.',
  '- **Tags as literals.** Write every Figma id exactly as the outline shows it. Never compute ids. A shared component takes its root id as a prop (e.g. `figmaId="1:467"`) and tags only its root; inner layers of shared components may stay untagged.',
  '',
].join('\n');

export const VERIFY_LOOP = [
  '## Verify loop',
  '',
  '1. Tag the layers you build with their Figma ids (at least every layer down to depth 2; more is better).',
  '2. Run the app at the design viewport and run `f2f verify` for the screen.',
  '3. Fix every row of `verification/<screen>.md` "Fix these" (largest first), then re-run. Look at `<screen>.diff.png`: red areas the measurements did not explain are usually missing assets, wrong images or colours.',
  '4. Follow f2f/verification/<screen>.prompt.md when verify writes one: it lists every measured difference with its picture. Stop when the verdict is PASS with no small differences, or explain each remaining item (e.g. a "text width" row whose font file you cannot change) to the user.',
  '',
].join('\n');
