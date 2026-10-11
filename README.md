<p align="center"><img src="brand/logo.png" width="120" alt="F2F logo" /></p>

# F2F

A free, open-source (MIT), local-first tool that turns a Figma design into a portable `f2f/` package for any AI coding agent. It maps the design to your existing codebase and then **measures** the built screen against the design.

```
Figma plugin ──► f2f/ ─────────────► f2f build ─────────► agent implements ──► f2f verify ─────────────────────► fix ──► PASS
(exact values)   (JSON + outlines)    (repo-aware brief)    (any agent)          (web / Android / iOS / Flutter)
```

There is no server, paid API, MCP or telemetry. Your design data stays on your machine. The tool does not claim pixel-perfect output; it measures. Measured results are in [docs/benchmark.md](docs/benchmark.md).

**New here?** Start with [docs/getting-started.md](docs/getting-started.md). It covers setup, the full Figma → agent → verify loop and how to read the differences, in about 10 minutes.

## Install

You need Node 22 or newer, plus Chrome or Edge for web verification.

```bash
git clone <this repo> && cd f2f
npm install
npm run check          # type-check, tests, build
npm link               # makes `f2f` available in every project
```

## 1. Export from Figma

1. In the Figma desktop app, go to **Plugins → Development → Import plugin from manifest…** and pick `packages/plugin/manifest.json` from this repo.
2. Select screens or a section, then run **F2F** → **Export**. Keep "Reference screenshots" ticked; they are used for the visual diff.
3. Unzip the downloaded `<file>-f2f.zip` into your app repository, so that `<your-app>/f2f/` exists.
4. Check it: `f2f validate f2f`.

## 2. Prepare the brief for your agent

```bash
cd <your-app>
f2f build --feature <section-or-screen-name> --repo .
```

This reads your repository read-only: framework, components or widgets, theme colours and text styles, fonts, routes and assets. Env and key files are never read. It writes `f2f/briefs/<feature>.md`, which contains:
- which existing components and tokens to reuse, with evidence;
- what to create;
- which assets to copy;
- open questions;
- Figma→code rules for your framework;
- the exact tagging snippet and verify commands.

Then tell your AI coding agent:

> Read `f2f/briefs/<feature>.md` and follow it: implement the screens, tag the layers, run `f2f verify` and fix until it passes.

## 3. Verify

Tag each built element with its Figma id (the `#…` in the outline). The brief shows the exact snippet for your framework.

| Platform | Tag | Run |
|---|---|---|
| Web (React, Next, Vue, Svelte, HTML) | `data-figma-id="<id>"` | `f2f verify --screen <id> --url http://localhost:3000/route` |
| Flutter web | `Semantics(identifier: 'figma:<id>')` (helper in `packages/cli/templates/flutter/`) | `flutter run -d chrome --dart-define=FIGMA_VERIFY=true`, then `--url …` |
| Android (Flutter, React Native, Compose) | Flutter identifier / `testID` / `testTag` | app running on an emulator or device, then `--android` (uses `adb`) |
| iOS (Flutter, React Native, SwiftUI) | identifier / `testID` / `accessibilityIdentifier` | simulator, then `--ios` (needs [idb](https://fbidb.io)) |
| Flutter without a device | same `Semantics` tags | copy `packages/cli/templates/flutter/f2f_probe.dart` to `test/`, run `flutter test`, then `--measurements build/f2f/<id>.json` (bundle your fonts as assets) |

Output goes to `f2f/verification/<screen>.md`: PASS/FAIL, every layer that is off with its Δx Δy Δw Δh (largest first), text overflow, untagged layers and font-metric warnings. For web runs it also writes an app screenshot and a red-pixel **diff image** against the Figma screenshot.

## Other commands

| Command | What it does |
|---|---|
| `f2f inspect --repo .` | Show what the tool detects in a repo |
| `f2f refresh --package f2f` | Regenerate the outlines with a newer tool version (no re-export) |
| `f2f bench --package f2f [--repo . --feature x]` | Measure size, tokens, time and memory |

## Repository layout

| Folder | What it is | Released as |
|---|---|---|
| `packages/core/` | Shared engine: design model, normaliser, outline, package writer, validator, JSON Schema | Bundled into plugin and CLI |
| `packages/plugin/` | Figma plugin (`manifest.json`, extractor, UI) | Figma Community plugin |
| `packages/cli/` | `f2f` command: inspect, build, verify, bench, Flutter templates | npm package |
| `website/` | Product site and docs (Astro); `/docs` renders `docs/getting-started.md` | Static site |
| `tests/` | Tests for all packages; `npm run check` builds and tests everything | — |

## Package layout

```
f2f/
  DESIGN.md                    tokens (design.md front matter), Figma→code rules, verify loop
  manifest.json                source, scope, status, features, SHA-256 of every file
  screens/<screen>.md          compact outline, one line per layer (agents read this)
  screens/<screen>.json        full node tree: source / calculated / inferred / unsupported
  components/components.json   shared definitions once; instances reference them
  tokens/tokens.json           variables (modes, aliases), styles
  assets/                      content-hashed SVG/PNG/JPG + manifest; screenshots/ for the visual diff
  flows/navigation.json        prototype interactions (intent only)
  reports/                     extraction report, unresolved items, benchmark
  briefs/<feature>.md          written by `build`
  verification/<screen>.*      written by `verify`
```

## Supported today and known limits

- **Design input:** any Figma file you can open in the desktop app, free plan included. Only one viewport per screen is linked; breakpoints are reported as unknown and never invented.
- **Repo inspection:** Flutter (widgets, `Color(...)` anywhere including `ColorScheme`/`ThemeExtension`, `TextStyle`/`GoogleFonts` styles, pubspec fonts and assets, GoRouter), React/Next/Vue/Svelte (components, CSS variables, Tailwind config colours, routes). Matching is by name words and values. Uncertain matches are marked "confirm", never assumed.
- **Verification:** geometry (±1 px), overflow, coverage, plus a visual diff on web. Colours and fonts are checked visually, not numerically. Android and iOS are measured from accessibility trees, so you need `adb` or `idb` installed.
- See [docs/architecture.md](docs/architecture.md), [docs/benchmark.md](docs/benchmark.md), and [docs/roadmap.md](docs/roadmap.md).

## Dependencies

| Package | Use | License |
|---|---|---|
| ajv | Schema validation (CLI) | MIT |
| fflate | ZIP in the plugin UI (bundled) | MIT |
| typescript, esbuild, vitest, @figma/plugin-typings, @types/node | Build and test only | Apache-2.0 / MIT |

Chrome/Edge (web verification), `adb` (Android) and `idb` (iOS) are optional tools you install yourself; nothing is downloaded automatically.
