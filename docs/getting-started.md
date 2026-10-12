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

## Prepare the Figma file (for designers)

F2F reads structure and names straight from Figma. A well-organised file gives the AI agent exact context; a messy one makes it guess.

1. **One feature = one Section.** F2F uses the section name as the feature name, so every screen of a feature belongs inside its section.
2. **Give every section a clear, unique name.** For example, "Network" and "Network Error State" are better than names where one contains the other.
3. **Name screens after what they show,** like "Network - Connections" or "Network - Sync Contacts", instead of "iPhone 13 & 14 - 386". Both the AI and the developer will understand the brief much faster.
4. **Mark finished sections "Ready for dev",** so developers know which sections are final.

## Find a feature's screens (for developers)

- `f2f/screens/index.json` lists every screen with its `feature` (the section name). Search for `"feature": "Network"` with the quotes; a plain search for `Network` also matches other sections such as "Network error".
- `f2f build --feature "Network"` matches the section name exactly, so the brief contains only that section's screens.
- Give the agent the brief, not the whole `f2f/` folder. The brief already points to the right outlines, components, tokens and assets.

## Copy-paste prompts for your AI agent

Build the design system once, before any screen. If every feature builds its own buttons and colours, the codebase fills with duplicates.

| When | Who | Prompt |
|---|---|---|
| Once per project | Lead developer | 1. Design system setup |
| Per section | Any developer, after `f2f build` | 2. Build one feature |
| `f2f verify` fails | Same developer | 3. Fix after verify |
| Designer changed Figma | Lead developer | 4. Design update |

### 1. Design system setup

```
You are setting up the design system for this app from the F2F export in ./f2f.
Source of truth: f2f/DESIGN.md, f2f/tokens/tokens.json, f2f/components/components.json.

Rules:
- Use ONLY values from these files. Never invent a colour, size, font or spacing. If something is missing or unclear, list it under "Open questions" and stop on that item.
- Check f2f/reports/unresolved-items.json first and list anything that affects the design system.

Tasks:
1. Read DESIGN.md sections "Implementation rules", "Figma → code rules" and "Tokens".
2. Create one theme/token layer: every colour token, every text style, and the recurring spacing/radius values from "Observed values". Use the exact token names from DESIGN.md.
3. From components.json, group the components by component set. For each set used by 2+ screens, create ONE reusable widget whose variants map to the Figma variant properties (e.g. Button: variant=primary/secondary, state=default/pressed/disabled). Skip one-off components; list them instead.
4. Reuse anything that already exists in this repo before creating something new.
5. Output: the files you created, a table "Figma component set → widget → file", and the open questions.
Do not build any screens yet.
```

### 2. Build one feature

Run `f2f build --feature "<section name>" --repo .` first, then:

```
Read f2f/briefs/<feature>.md and follow it exactly.

Rules:
- Use the existing theme tokens and shared widgets. Never hard-code a colour, font size or spacing that exists as a token. Never create a widget that already exists.
- Every size, text and colour must come from the screen outlines in the brief. If a value is missing, add it to "Open questions" instead of guessing.
- If a pattern repeats across these screens (list row, tab bar, header), build it once as a shared widget and reuse it.
- Tag every element with its Figma id as the brief shows.
- Run the verify command from the brief and fix until it passes.

Output: files changed, widgets reused vs. newly created, verify result, open questions.
```

### 3. Fix after verify

```
Read f2f/verification/<screen>.md.
Fix the listed differences, largest first. Fix the cause in the shared widget or the token when the same difference appears on several elements; do not patch each screen separately.
Do not change any value that is not listed. Re-run verify until it passes, then summarise what you changed and why.
```

### 4. Design update

```
A new F2F export is in ./f2f. Compare it with the current theme and shared widgets.
1. List changed tokens (old → new) and changed component variants.
2. Update tokens and shared widgets first, so every screen picks up the change.
3. Then rebuild only the affected features with `f2f build --feature <name>` and verify them.
Do not touch features whose screens did not change.
```

Check the "Figma component set → widget" table from prompt 1 before the team starts on features: every later prompt reuses what it creates.

## The workflow per feature (about 7 minutes plus agent time)

### Step 1: Export from Figma (1 min)

1. Select the screens (or one Section) you want to build.
2. Run **Plugins → Development → F2F** → **Export**. Keep **Reference screenshots** ticked. Leave **Include raw JSON_REST_V1** off: it is a large debug dump that slows the export and adds nothing the agent needs.
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

Paste prompt 2 from [Copy-paste prompts for your AI agent](#copy-paste-prompts-for-your-ai-agent) into your agent. Set up the design system with prompt 1 first if this is the project's first feature.

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
