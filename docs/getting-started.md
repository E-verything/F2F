# Getting started: Figma to working frontend in about 10 minutes

This guide is for a developer who has never used this tool. It works with any frontend stack (React, Next, Vue, Svelte, HTML, Flutter, React Native, Compose, SwiftUI) and any AI coding agent.

## What you get

One repository contains three parts. You use all three, in this order:

| Part | What it is | Where it lives | Who runs it | When |
|---|---|---|---|---|
| **Figma plugin** | Exports the exact design values (layout, colours, text, icons, screenshots) as a ZIP | `packages/plugin/` | Designer or developer, inside Figma desktop | Once per design change |
| **CLI** (`f2f`) | Reads your app repo, writes a brief for the AI agent, then measures the built screen against Figma | `packages/cli/` (after `npm link`, available everywhere) | Developer, in a terminal in **your app** repo | Before and after the agent codes |
| **AI agent** | Writes the actual UI code | Your editor | Developer | Between `build` and `verify` |

The tool does not generate code itself. It gives the agent exact facts so the code is right, then **proves** whether it is right.

## One-time setup (about 3 minutes)

Requirements: Node 22+, Figma **desktop** app, and Chrome or Edge for web checks.

```bash
git clone <this repo> f2f
cd f2f
npm install
npm run check      # must end with "built packages/..." and all tests passed
npm link           # the `f2f` command now works in any folder
f2f --help
```

In Figma desktop: **Plugins → Development → Import plugin from manifest…** → choose `packages/plugin/manifest.json` from this repo. The plugin then appears as **F2F**.

## The workflow per feature (about 7 minutes plus agent time)

### Step 1: Export from Figma (1 min)

1. Select the screens (or one Section) you want to build.
2. Run **Plugins → Development → F2F** → **Export**. Keep **Reference screenshots** ticked.
3. Unzip the ZIP into the root of **your app** repo, so `your-app/f2f/` exists.
4. Run `f2f validate f2f`. It should report no errors.

### Step 2: Build the brief (30 s)

```bash
cd your-app
f2f inspect --repo .                       # optional: shows what it found in your code
f2f build --feature "<section or screen name>" --repo .
```

This writes `f2f/briefs/<feature>.md`. It lists the components and tokens you already have and should reuse, what to create, which assets to copy, the tagging snippet for your framework, and the verify command. The tool only reads your repo, and it never reads `.env` or key files.

### Step 3: Let the AI agent implement (agent time)

Paste this into your agent:

> Read `f2f/briefs/<feature>.md` and follow it: implement the screens, tag the layers, run `f2f verify` and fix until it passes.

### Step 4: Verify the build against Figma (1 to 2 min)

Start your app, then run the command for your platform:

| Your app | Tag each element with | Run |
|---|---|---|
| Web (React, Next, Vue, Svelte, HTML) | `data-figma-id="<id>"` | `f2f verify --screen <id> --url http://localhost:3000/route` |
| Flutter web | `Semantics(identifier: 'figma:<id>')` (helper in `packages/cli/templates/flutter/`) | `flutter run -d chrome --dart-define=FIGMA_VERIFY=true`, then `--url …` |
| Android (Flutter, RN, Compose) | identifier / `testID` / `testTag` | app on an emulator or device, then `--android` (needs `adb`) |
| iOS (Flutter, RN, SwiftUI) | identifier / `testID` / `accessibilityIdentifier` | simulator, then `--ios` (needs `idb`) |
| Flutter, no device | same `Semantics` tags | copy `packages/cli/templates/flutter/f2f_probe.dart` to `test/`, run `flutter test`, then `--measurements build/f2f/<id>.json` |

The `<id>` values are the `#…` ids in `f2f/screens/<screen>.md`. The brief already contains the exact snippet.

## How the difference between Figma and your build is shown

`verify` writes `f2f/verification/<screen>.md` (and `.json`):

- **PASS or FAIL** at the top.
- **Geometry:** every layer that is off by more than ±1 px, with Δx Δy Δw Δh, largest first. Example: `#12:40 Title  Δy +8  Δh -2` means the title sits 8 px too low and is 2 px too short.
- **Overflow:** text that is clipped or wraps when it should not.
- **Coverage:** Figma layers that have no tag in your code, so they cannot be measured.
- **Font-metric warnings:** text boxes that differ because of font rendering and not layout.
- **Web only:** an app screenshot and a **diff image**. Red pixels are where your build differs from the Figma screenshot.

You fix it, or give the report to the agent ("fix the FAIL items in `f2f/verification/<screen>.md`"), and run `verify` again until it shows PASS.

Not measured as numbers yet: colours, font family and weight, and radius. On web you check these in the diff image. On mobile you check them by eye (see roadmap item 4).

## Quick reference

| I want to… | Command |
|---|---|
| Check an exported package | `f2f validate f2f` |
| See what the tool detects in my repo | `f2f inspect --repo .` |
| Write the brief for the agent | `f2f build --feature <name> --repo .` |
| Compare the build with Figma | `f2f verify --screen <id> …` |
| Re-generate outlines after updating the tool | `f2f refresh --package f2f` |
| Measure size and tokens | `f2f bench --package f2f` |

## Common problems

| Symptom | Fix |
|---|---|
| `f2f: command not found` | Run `npm link` again in the tool repo |
| Plugin not in Figma | You need the **desktop** app, and you must import `packages/plugin/manifest.json` |
| `No feature or screen "x"` | Use a name from the error message's `Features:` list |
| Many "untagged" layers | Add the tag from the brief to each element; untagged elements cannot be measured |
| Text boxes off by 1 to 3 px only | Font-metric warning. Bundle the same font the design uses |

## Developing the tool itself

`npm run check` runs type-check, tests and build. Tests use small fixtures in `tests/fixtures/`. To try a real change, run it against your own app repo; there is no demo app inside this repo.
