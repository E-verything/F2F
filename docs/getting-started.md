# Getting started: Figma to a verified frontend

This guide is for a developer who has never used this tool. It works with any frontend stack (React, Next, Vue, Svelte, HTML, Flutter, React Native, Compose, SwiftUI) and any AI coding agent.

## What you get

F2F has two parts. The third part is your own AI coding agent. You use all three, in this order:

| Part | What it is | Where you get it | Who runs it | When |
|---|---|---|---|---|
| **Figma plugin** | Exports the exact design values (layout, colours, text, icons, screenshots) as a ZIP | [F2F on Figma Community](https://www.figma.com/community/plugin/1691251414681348956) | Designer or developer, inside Figma | Once per design change |
| **CLI** (`f2f`) | Reads your app repo, writes a brief for the AI agent, then measures the built screen against Figma | [`f2f-cli` on npm](https://www.npmjs.com/package/f2f-cli) | Developer, in a terminal in **your app** repo | Before and after the agent codes |
| **Your AI agent** (not included: Claude Code, Cursor, Copilot, Codex…) | Writes the actual UI code | Your editor | Developer | Between `build` and `verify` |

The tool does not generate code itself. It gives the agent exact facts so the code is right, then **proves** whether it is right.

## One-time setup (about 2 minutes)

Requirements: Node 22+, Figma, and Chrome or Edge for web checks. You do not need to clone this repository.

1. Install the CLI:

   ```bash
   npm install -g f2f-cli   # the package is f2f-cli; the command is f2f
   f2f --version            # prints the installed version, e.g. f2f-cli 0.1.2
   ```

   Do not run `npm install -g f2f`: that name belongs to an unrelated package. To update later, run `npm install -g f2f-cli@latest`.

2. In Figma, open [F2F on Figma Community](https://www.figma.com/community/plugin/1691251414681348956) and click **Open in…** or **Try it out**. The plugin then appears under **Plugins** as **F2F**.

## Prepare the Figma file (for designers)

F2F reads structure and names straight from Figma. A well-organised file gives the AI agent exact context; a messy one makes it guess.

1. **One feature = one Section.** F2F uses the section name as the feature name, so every screen of a feature belongs inside its section.
2. **Give every section a clear, unique name.** For example, "Network" and "Network Error State" are better than names where one contains the other.
3. **Name screens after what they show,** like "Network - Connections" or "Network - Sync Contacts", instead of "iPhone 13 & 14 - 386". Both the AI and the developer will understand the brief much faster.
4. **Mark finished sections "Ready for dev",** so developers know which sections are final.
5. **Use Figma variables or styles for colours and text, and components for repeated elements.** F2F then exports their names, and the agent reuses them exactly. Without them the export still works: DESIGN.md lists every colour and text style it measured under "Observed values". But the agent has to name tokens and find repeated parts itself, which takes more tokens and more checking.
6. **Keep style guides, notes and loose parts out of the export,** or put them on their own page. Every exported frame is treated as a screen to build.
7. **Add prototype links between screens** if you want the agent to wire up navigation. Without them `flows/navigation.json` is empty, and the links have to be described in `f2f-project.md`.

## Find a feature's screens (for developers)

- `f2f/screens/index.json` lists every screen with its `feature` (the section name). Search for `"feature": "Network"` with the quotes; a plain search for `Network` also matches other sections such as "Network error".
- `f2f build --feature "Network"` matches the section name exactly, so the brief contains only that section's screens.
- A frame that is not inside a Figma Section has `"feature": null`. That is normal: build it by its screen name, or several at once with `f2f build --feature "Services, Contact Us, About Us" --name "Site Pages" --repo .`.
- Give the agent the brief, not the whole `f2f/` folder. The brief already points to the right outlines, components, tokens and assets.

## What is inside `f2f/`

You and your agent only open a few of these files. The rest are there for the tool and for reference.

| Path | What it holds | Who reads it |
|---|---|---|
| `DESIGN.md` | Start here: all tokens, Figma → code rules and the verify loop on one page | Agent (prompt 1), you |
| `screens/index.json` | List of every exported screen: name, `id`, `feature` (section name), file paths | You, to find a screen's id or feature |
| `screens/<screen>.md` | Compact outline of one screen, one line per layer with its `#id`, size, position, colours, text and asset | Agent (the brief links the right ones) |
| `screens/<screen>.json` | The full node tree of the same screen | Tool, agent only for detail |
| `components/components.json` | Shared Figma components and their variants, stored once | Agent (prompt 1) |
| `tokens/tokens.json` | Figma variables (with modes and aliases) and styles | Agent (prompt 1) |
| `assets/` | Icons and images (SVG/PNG/JPG) the screens use, plus `manifest.json` | Agent copies them into your app |
| `assets/screenshots/` | One reference PNG per screen | `f2f verify` (visual diff) |
| `flows/navigation.json` | Prototype links between screens (which tap goes where) | Agent, for routing |
| `reports/extraction-report.json` | Counts, skipped layers, errors and unsupported properties from the export | You, when something is missing |
| `reports/unresolved-items.json` | Decisions a human must make | Agent lists them as open questions |
| `manifest.json`, `design-schema.json` | File hashes and the package format, used by `f2f validate` | Tool only |
| `briefs/<feature>.md` | Written by `f2f build`: the instructions for one feature in your repo | Agent (prompt 2) |
| `verification/<screen>.md` | Written by `f2f verify`: PASS/FAIL and every difference | Agent (prompt 3), you |

File names are made from your Figma names, for example the screen "AC Installation Service Landing Page" becomes `screens/ac-installation-service-landing-page--1-2.md`. The number at the end is the Figma node id.

## Copy-paste prompts for your AI agent

The prompts work in any project: they point to folders and to one project profile, not to file names. The only thing you ever type is the name of the page or section to build: once in `f2f build --feature "<name>"` and once in the `Build:` line of prompt 2. Use the Figma frame name for one page, or the section name for a group of pages, exactly as Figma's layer panel shows it (also listed in `f2f/screens/index.json`).

F2F gives the agent the design. It does not know your stack, so you write that down once in the project profile. Every prompt tells the agent to follow it and to ask instead of guessing.

### 0. Project profile (once per project, about 5 minutes)

`f2f-project.md` lives in your app's root folder, next to `f2f/`, not inside it, so a new export never overwrites it.

**Open your terminal and your AI agent in the app's root folder** (the folder that has, or will have, `package.json` / `pubspec.yaml`). If your editor opened a parent folder, the agent works one level too high and writes files in the wrong place.

Pick the path that fits you:

| Your situation | What to do |
|---|---|
| You already have an app | Prompt **0a** drafts the profile from your code. You answer only what it cannot find. |
| New app, you know your stack | Write the profile by hand from the template below, then run prompt **0b** to create the app. |
| New app, not sure what to write | Run prompt **0a** in an empty app folder. It asks you every question, one list. Then run prompt **0b**. |

#### 0a. Draft the profile

Run `f2f inspect --repo .` first, then paste:

```
Create or update f2f-project.md in this folder (the app root) using the template at the end of this prompt. If f2f-project.md already exists here, fill only its missing or empty lines and keep my values. Never create a second copy in another folder.
Fill each line ONLY from evidence: package.json / pubspec.yaml / build files, existing folders and config, the output of `f2f inspect --repo .`, f2f/screens/index.json for the screen names and f2f/DESIGN.md for the fonts. If there is no f2f/ folder here: when `f2f inspect` names a folder with the F2F export, use that folder and tell me to rename it to f2f/; otherwise ask me where I unzipped the export.
- After every value you filled, add the evidence in brackets, e.g. "Next.js 15 App Router [package.json next@15.1, app/ folder]".
- Where there is no evidence (a new project, or a choice such as UI library, data or scope), write "ASK" and do not guess.
- For "Screens NOT to be built", list screens whose names look like style guides, notes or components, marked "ASK: confirm".
Then show me only the ASK lines as numbered questions, each with your recommended answer, and wait for my answers before you finish the file. Recommend: the latest stable version for a new app; loading the font families DESIGN.md lists (say that system fonts make `f2f verify` fail, because every text box measures differently); one route for every screen to be built (first screen "/", the others a short kebab-case name); the framework's default dev URL. If I answer only some questions, ask again only the ones still open.
At the end, report only what you actually did, then end with: "Next step: no app yet → paste prompt 0b from the F2F guide; app exists → paste prompt 1 (Design system setup)."

Template:
# F2F project profile
## Stack
- Platform: <web | mobile | desktop>
- Framework and version: <e.g. Next.js 15 App Router | Flutter 3.24 | React Native 0.76 + Expo | Electron 33 + React | SwiftUI iOS 17 | Jetpack Compose>
- Language: <TypeScript | Dart | Kotlin | Swift | …>
- Styling: <CSS Modules | Tailwind 4 | styled-components | Flutter ThemeData | …>
- UI component library: <none | shadcn/ui | MUI 6 | Chakra | Material 3 | …> (when a design component matches a library component, use the library one, styled with the design tokens)
- Icons: <use the SVGs from f2f/assets | lucide-react | …>
- Fonts: <the families in f2f/DESIGN.md and how they load, e.g. Inter + Manrope via next/font/google | bundled in assets/fonts | pubspec fonts>
- New dependencies: <not allowed | allowed after asking>
## Where code goes
- Design tokens / theme: <e.g. app/globals.css :root variables | lib/theme/app_theme.dart>
- Shared components: <e.g. components/ui/>
- Screens / pages: <e.g. app/<route>/page.tsx | lib/screens/>
- Assets: <e.g. public/f2f/ | assets/images/>
- Screen → route/name: <one entry per screen to be built, e.g. Landing Page → /, Contact Us → /contact>
## Scope
- Screens in the export that are NOT to be built: <e.g. style-guide frames, notes, components>
- Data: <static content from the design | real API: describe it>
- Interactivity: <static layout only | forms validate on the client | describe>
- Viewports: <only the Figma width | the Figma width plus breakpoints you define here>
- Accessibility: <e.g. semantic HTML, alt text from layer names, focus states from the design>
## Commands
- Run the app: <e.g. npm run dev>
- App URL or device for verify: <e.g. http://localhost:3000 | --android | --ios>
- Lint / type-check: <e.g. npm run lint && npx tsc --noEmit>
```

Check the file once. Every later prompt depends on it.

#### 0b. Create a new app from the profile

Skip this if your app already exists.

```
Create the app described in f2f-project.md in this folder. This folder is the app root.
- The values in f2f-project.md are my decisions; they need no evidence in the repo. Stop only if a line needed here is empty or says ASK.
- Use the official project generator for the framework and version it names, with every choice passed as a flag (no interactive questions). If the generator refuses a non-empty folder, move f2f-project.md and f2f/ out first and back afterwards.
- If there is no f2f/ folder (with f2f/manifest.json) here: when `f2f inspect --repo .` names a folder with the F2F export, rename or move that folder to f2f/; otherwise ask me where I unzipped the export, and move it here as f2f/.
- If a line asks for a version and says ASK, use the latest stable version and say so in the report instead of stopping.
- Do not initialise git or commit anything; pass the generator's flag that skips git (for create-next-app: --disable-git). I set up version control myself.
- Make the folders the profile names under "Where code goes". Add f2f/ to .gitignore unless the profile says to commit it.
- Install the generator's own dependencies (e.g. npm install), and nothing else. Remove any folder you emptied.
- Run `f2f validate f2f` and `f2f inspect --repo .`. If validate reports errors, stop and show them.
At the end, report only what you actually did and checked, with both outputs summarised, list what I must do myself and why (only things you cannot do), and end with: "Next step: paste prompt 1 (Design system setup) from the F2F guide."
```

#### The template

Fill every line. Write `none` where something does not apply. **Leave nothing blank:** a blank line makes the agent stop and ask you.

```markdown
# F2F project profile

## Stack
- Platform: <web | mobile | desktop>
- Framework and version: <e.g. Next.js 15 App Router | Flutter 3.24 | React Native 0.76 + Expo | Electron 33 + React | SwiftUI iOS 17 | Jetpack Compose>
- Language: <TypeScript | Dart | Kotlin | Swift | …>
- Styling: <CSS Modules | Tailwind 4 | styled-components | Flutter ThemeData | …>
- UI component library: <none | shadcn/ui | MUI 6 | Chakra | Material 3 | …> (when a design component matches a library component, use the library one, styled with the design tokens)
- Icons: <use the SVGs from f2f/assets | lucide-react | …>
- Fonts: <the families in f2f/DESIGN.md and how they load, e.g. Inter + Manrope via next/font/google | bundled in assets/fonts | pubspec fonts>
- New dependencies: <not allowed | allowed after asking>

## Where code goes
- Design tokens / theme: <e.g. app/globals.css :root variables | lib/theme/app_theme.dart>
- Shared components: <e.g. components/ui/>
- Screens / pages: <e.g. app/<route>/page.tsx | lib/screens/>
- Assets: <e.g. public/f2f/ | assets/images/>
- Screen → route/name: <one entry per screen to be built, e.g. Landing Page → /, Contact Us → /contact>

## Scope
- Screens in the export that are NOT to be built: <e.g. style-guide frames, notes, components>
- Data: <static content from the design | real API: describe it>
- Interactivity: <static layout only | forms validate on the client | describe>
- Viewports: <only the Figma width | the Figma width plus breakpoints you define here>
- Accessibility: <e.g. semantic HTML, alt text from layer names, focus states from the design>

## Commands
- Run the app: <e.g. npm run dev>
- App URL or device for verify: <e.g. http://localhost:3000 | --android | --ios>
- Lint / type-check: <e.g. npm run lint && npx tsc --noEmit>
```

The same template covers websites, mobile apps and desktop apps. Only the values change. Example for a desktop app: `Platform: desktop`, `Framework: Electron 33 + React 19`, verify against the renderer's dev server URL.

### Rules every prompt includes

Each prompt below starts with the same short block. It is what keeps the agent from guessing:

```
Follow f2f-project.md (stack, folders, scope) and the F2F files exactly.
- Every colour, size, spacing, radius, font and text comes from f2f/. Never invent a value, a screen, a section, copy text or an image.
- Use only the stack and libraries in f2f-project.md. Add no dependency it does not allow.
- If f2f-project.md or f2f/ does not answer something, or has an empty line, stop and ask me. Do not assume.
- Do not touch files outside the folders f2f-project.md names, except the ones the task needs.
- Finish the job yourself: run every command the task needs (install, lint, type-check, verify) and remove temporary or empty folders you created or emptied. Before starting a dev server, check whether one is already running for this app and reuse it; never start a second one on another port. Before you report, stop every dev server you started (including background ones) and delete log files you created.
- At the end, first stop every dev server or watcher you started and confirm it in the report ("Dev servers: none running"). Then report only what you actually did and checked, list what I must do myself and why (only things you cannot do), and end with the "Next step" line of this prompt.
```

**Agent sessions:** use one agent session per feature: prompt 2 and prompt 3 for the same screens belong together. Start a fresh session for the next feature or after a long setup chat. Old history is re-sent with every message and costs tokens without helping.

Build the design system once, before any screen. If every feature builds its own buttons and colours, the codebase fills with duplicates.

| When | Who | Prompt |
|---|---|---|
| Once per project | Lead developer | 0. Project profile (a file, not a prompt) |
| Once per project | Lead developer | 1. Design system setup |
| Per page or section | Any developer, after `f2f build` | 2. Build pages |
| `f2f verify` fails | Same developer | 3. Fix after verify |
| Designer changed Figma | Lead developer | 4. Design update |

### 1. Design system setup

```
Follow f2f-project.md (stack, folders, scope) and the F2F files exactly.
- Every colour, size, spacing, radius, font and text comes from f2f/. Never invent a value, a screen, a section, copy text or an image.
- Use only the stack and libraries in f2f-project.md. Add no dependency it does not allow.
- If f2f-project.md or f2f/ does not answer something, or has an empty line, stop and ask me. Do not assume.
- Do not touch files outside the folders f2f-project.md names, except the ones the task needs.
- Finish the job yourself: run every command the task needs (install, lint, type-check, verify) and remove temporary or empty folders you created or emptied. Before starting a dev server, check whether one is already running for this app and reuse it; never start a second one on another port. Before you report, stop every dev server you started (including background ones) and delete log files you created.
- At the end, first stop every dev server or watcher you started and confirm it in the report ("Dev servers: none running"). Then report only what you actually did and checked, list what I must do myself and why (only things you cannot do), and end with the "Next step" line of this prompt.

Task: set up the design system. Do not build any screens yet.
Sources: f2f/DESIGN.md, f2f/tokens/tokens.json, f2f/components/components.json, f2f/reports/unresolved-items.json.
1. List anything in unresolved-items.json that affects the design system.
2. Read DESIGN.md sections "Implementation rules", "Figma → code rules" and "Tokens".
3. In the token/theme location from f2f-project.md, create one token layer: every colour token, every text style, and the recurring spacing/radius values from "Observed values". Use the exact token names from DESIGN.md. If DESIGN.md says no variables or styles were found, build the tokens from "Observed values" instead: take the names from a style-guide screen in the export if there is one (match by hex value), otherwise name them by role (e.g. text-primary, brand). Show the table "token → value → where the name came from". Set up the fonts the way f2f-project.md says.
4. If components.json has no components, find the elements that repeat with identical structure across the screens (header, footer, button, card) in the screen outlines, and make those the shared components; list each with the screens and #ids it appears in. Otherwise, from components.json, group the components by component set. For each set used by 2+ screens (ignore the screens f2f-project.md excludes), create ONE reusable component in the shared-components folder, with variants that map to the Figma variant properties (e.g. Button: variant=primary/secondary, state=default/pressed/disabled). Use the UI library from f2f-project.md where it has a matching component. List one-off components instead of building them.
5. Reuse anything that already exists in this repo before creating something new.
6. Build production code, not a fixed canvas: components are fluid (max-width containers, wrapping rows), responsive down to 375px wide, with real links/buttons and hover, focus-visible and active states. Round sub-pixel values to whole px or a token. A shared component takes its Figma root id as a prop and tags only its root.
7. Questions: a value you can read in the screen outlines is a fact, so use it and do not ask. If the same element differs between screens or instances (sizes, shadows, nav labels, widths), build it as variants or props so each instance gets exactly its own measured values. Never ask which one is "right"; list the differences as a note. Odd values (13.5, 7.99) are measured facts too: use them as written; make tokens only for values that repeat on 2+ screens. Skip measured elements no screen to be built uses. Skip things that appear only on screens f2f-project.md excludes (e.g. fonts or colours used only in a style guide). Ask only about decisions the files cannot answer.
Output: the files you created, a table "Figma component set → component → file", and the open questions.
Do not build screens in this session, even after I answer questions: screens are built from the brief that `f2f build` writes.
Next step: list the screens from f2f/screens/index.json that are to be built, then give me the exact command to copy: when they share one Figma Section (their "feature"), `f2f build --feature "<section name>" --repo .`; otherwise (feature is null) one command for all of them, `f2f build --feature "<screen 1>, <screen 2>, …" --name "<short name>" --repo .`. Then say: "then paste prompt 2 (Build pages) from the F2F guide with Build: <that section name, or the --name value>."
```

### 2. Build pages (one page or one section)

Run `f2f build --feature "<page or section name>" --repo .` first. "Feature" means what you pass here: one page (a Figma frame name, e.g. "AC Installation Service Landing Page") or a Figma Section, which builds all its pages at once. To build several pages that are not in one Section, list them with commas and give the brief a name: `f2f build --feature "Services, Contact Us, About Us" --name "Site Pages" --repo .` (the start of each page name is enough). The brief contains only those pages. Then paste the prompt and fill in its first line with **the same name** you gave `f2f build` (the `--name` value, if you used one) (the Figma frame or section name, as it appears in Figma's layer panel):

```
Build: <Figma page or section name, e.g. AC Installation Service Landing Page>

Follow f2f-project.md (stack, folders, scope) and the F2F files exactly.
- Every colour, size, spacing, radius, font and text comes from f2f/. Never invent a value, a screen, a section, copy text or an image.
- Use only the stack and libraries in f2f-project.md. Add no dependency it does not allow.
- If f2f-project.md or f2f/ does not answer something, or has an empty line, stop and ask me. Do not assume.
- Do not touch files outside the folders f2f-project.md names, except the ones the task needs.
- Finish the job yourself: run every command the task needs (install, lint, type-check, verify) and remove temporary or empty folders you created or emptied. Before starting a dev server, check whether one is already running for this app and reuse it; never start a second one on another port. Before you report, stop every dev server you started (including background ones) and delete log files you created.
- At the end, first stop every dev server or watcher you started and confirm it in the report ("Dev servers: none running"). Then report only what you actually did and checked, list what I must do myself and why (only things you cannot do), and end with the "Next step" line of this prompt.

Task: build the page(s) named in "Build:" from their brief in f2f/briefs/ (the brief whose title is "Implementation brief: <that name>"). If that brief does not exist, stop and tell me to run `f2f build --feature "<that name>" --repo .` first. Build only the screens listed in that brief, and follow it exactly.
- Follow the brief's "Production code rules": fluid and responsive (no fixed page width, no horizontal scroll at 375px, header nav collapses into a menu button on small screens), whole-px values, HTML in reading order, real links/buttons/accordions with hover and focus states, Figma ids written as literals (never computed).
- If a screen or shared component already exists, do not skip it: review its code against every Production code rule and fix what breaks one, then verify.
- Put each screen where f2f-project.md says, with the route/name rule it gives.
- Use the existing tokens and shared components. Never hard-code a value that exists as a token. Never create a component that already exists.
- Build a pattern that repeats across these screens (header, footer, card, list row) once as a shared component.
- A value read from the screen outline is a design fact. If instances of the same element differ in the design (sizes, offsets, gaps), give each instance its own measured values through a prop or a per-instance class; do not ask me which one is right. List those differences as a note for the designer.
- Copy the assets the brief lists into the assets folder from f2f-project.md.
- Tag every element with its Figma id as the brief shows.
- Start the app with the command from f2f-project.md, run the verify command from the brief, and fix until it passes.
Output: files changed, components reused vs. newly created, verify result per screen, open questions, and the line "See every difference with images: run `f2f report --open`".
Next step: every screen PASS → "Build the next page: `f2f build --feature "<next name>" --repo .`, then prompt 2 with Build: <next name>", naming the screens not built yet; any FAIL left after your fixes → "Paste prompt 3 (Fix after verify) from the F2F guide."
```

### 3. Fix after verify

```
Follow f2f-project.md and the F2F files exactly. Never invent a value; if something is unclear, stop and ask me.

Find every report in f2f/verification/*.md whose verdict is **FAIL** or that has a "Small differences" section, and fix those screens one by one; each such screen has f2f/verification/<screen>.prompt.md listing every difference with its picture, so follow it. If none, say so and stop.
In each report, work through "Fix these first" in order: open the picture each row names (left = Figma, right = your app) and compare it with the row's text before changing code; then fix the other listed sections. Read the screen outline line of each id for the exact values.
Then, for pixel-perfect, fix the "Small differences" rows that carry a measured cause: "small shift" → move the text by the px the row gives, by fixing the margin, padding, gap or line-height before it (or, when the row names another text as the cause, fix only that cause); "text width" → the text is clearly wider or narrower than in Figma with the same style: check its characters and the font file the app loads, and change nothing else for it (no padding, no letter-spacing). The "Text width vs Figma" note is not counted; give such a text its Figma width only if a neighbour must sit exactly. Leave a "pixels" row alone unless its picture shows a real difference.
Fix the cause in the shared widget or the token when the same difference appears on several elements; do not patch each screen separately.
Verify with `f2f verify --all` (or `f2f verify --screens …`), never with --window, --tolerance or other flags that hide a difference; a check that fails must be fixed in the code, not in the command.
A value read from the screen outline is a design fact, not a value you chose. If instances of the same element differ in the design (sizes, offsets, gaps), give each instance its own measured values through a prop or a per-instance class; do not ask me which one is right. List those differences as a note for the designer.
Do not change any value that is not listed. Re-run verify for each fixed screen until it passes, then stop every dev server you started and summarise what you actually changed and why, with the line "Dev servers: none running" and the line "See every difference with images: run `f2f report --open`".
Before starting a dev server, check whether one is already running for this app and reuse it. Before you report, stop every dev server you started (including background ones) and delete log files you created.
Next step: PASS → name the screens not built yet and say "Run `f2f build --feature "<next name>" --repo .`, then prompt 2"; still FAIL → explain each remaining item and what I must decide.
```

### 4. Design update

```
Follow f2f-project.md and the F2F files exactly. Never invent a value; if something is unclear, stop and ask me.

A new F2F export is in ./f2f. Compare it with the current theme and shared components.
1. List changed tokens (old → new) and changed component variants.
2. Update tokens and shared widgets first, so every screen picks up the change.
3. Then rebuild only the affected features with `f2f build --feature <name>` and verify them.
Do not touch features whose screens did not change.
At the end, report only what you actually changed and verified, per feature.
```

Check the "Figma component set → widget" table from prompt 1 before the team starts on features: every later prompt reuses what it creates.

## The workflow per feature (about 7 minutes plus agent time)

### Step 1: Export from Figma (1 min)

1. Select the screens (or one Section) you want to build.
2. Run **Plugins → F2F**, choose the options below, then click **Export**.
3. Unzip the ZIP into the root of **your app** repo, so `your-app/f2f/` exists. Windows "Extract All" and macOS add an extra folder named after the ZIP (`your-app/<file>-f2f/f2f/`). If that happens, move the inner `f2f/` folder up to the app root. No app yet? Create one first (for example `npm create vite@latest`) and unzip into it.
   The `f2f/` folder holds your design data. It must sit inside the app, because `f2f build`, `f2f verify` and the prompts look for `<app>/f2f`. Being inside the app does not make it public: add `f2f/` to `.gitignore` and Git never sees it, so it never reaches GitHub. To share the same export with your team, commit it instead.
4. Run `f2f validate f2f`. It should report no errors.

#### Plugin options

**Scope**: which screens go into the ZIP.

| Option | Exports | Choose it when |
|---|---|---|
| **Selection** (default) | Only the frames or sections you selected | You build one feature or a few screens. This is the usual choice: a smaller export is faster, and the agent reads less. |
| **Current page** | Every top-level frame and every frame inside a section on the open page | The whole page is one app and every frame on it is a real screen |
| **All pages** | The same, for every page in the file | First export of a finished file, to set up the design system with prompt 1 |

Each frame becomes one screen. A frame inside a Section gets the section's name as its feature. A loose frame has no feature, so you pass its screen name to `f2f build --feature`. Loose layers that are not frames are skipped and listed in `f2f/reports/extraction-report.json`. Leave style-guide or notes frames out of the selection, because each frame you export is treated as a screen to build.

**Options**

| Option | Default | What it does | Recommendation |
|---|---|---|---|
| **Reference screenshots** | On | Saves one PNG of each screen | Keep it on. `f2f verify` compares your build with these PNGs to make the red-pixel diff image. Without them you get no visual diff. |
| **Include raw JSON_REST_V1** | Off | Adds Figma's own full JSON dump of each screen | Keep it off. It is a large debug file that slows the export and adds nothing the agent needs. It exists for one case: when F2F exports a value wrongly, turn it on and attach the ZIP to your bug report, so the maintainers can compare F2F's output with Figma's own data. |

### Step 2: Build the brief (30 s)

```bash
cd your-app
f2f inspect --repo .                       # optional: shows what it found in your code
f2f build --feature "<section or screen name>" --repo .
```

This writes `f2f/briefs/<feature>.md`. It lists the components and tokens you already have and should reuse, what to create, which assets to copy, the tagging snippet for your framework, and the verify command. The tool only reads your repo, and it never reads `.env` or key files.

### Step 3: Let the AI agent implement (agent time)

Paste prompt 2 from [Copy-paste prompts for your AI agent](#copy-paste-prompts-for-your-ai-agent) into your agent. If this is the project's first feature, first write `f2f-project.md` (step 0), then set up the design system with prompt 1.

### Step 4: Verify the build against Figma (1 to 2 min)

**Web apps: one command.** Start your app, then run:

```bash
f2f verify --open
```

It lists your pages with a number each, plus "All pages". Type `3` for one page, `2,3` for two, or press Enter for all. It checks the chosen pages against your running app (your latest code), then opens the report for exactly those pages. Routes come from the "Screen → route" line of `f2f-project.md` (and from earlier runs or your app's routes when a page is missing there); the URL comes from its "App URL" line. An agent or CI has no keyboard, so there `f2f verify` checks every page; `f2f verify --all` does the same in your terminal.

Per screen, or for mobile, run the command for your platform:

| Your app | Tag each element with | Run |
|---|---|---|
| Web (React, Next, Vue, Svelte, HTML) | `data-figma-id="<id>"` | `f2f verify --screen <id> --url http://localhost:3000/route` |
| Flutter web | `Semantics(identifier: 'figma:<id>')` (helper in `templates/flutter/` of the installed `f2f-cli`; find it under `npm root -g`) | `flutter run -d chrome --dart-define=FIGMA_VERIFY=true`, then `--url …` |
| Android (Flutter, RN, Compose) | identifier / `testID` / `testTag` | app on an emulator or device, then `--android` (needs `adb`) |
| iOS (Flutter, RN, SwiftUI) | identifier / `testID` / `accessibilityIdentifier` | simulator, then `--ios` (needs `idb`) |
| Flutter, no device | same `Semantics` tags | copy `templates/flutter/f2f_probe.dart` from the installed `f2f-cli` to `test/`, run `flutter test`, then `--measurements build/f2f/<id>.json` |

The `<id>` values are the `#…` ids in `f2f/screens/<screen>.md`. The brief already contains the exact snippet.

## How the difference between Figma and your build is shown

**See it in one page:** `f2f verify --open` opens the report for the pages you just checked; `f2f report --open` shows every page checked so far. It opens `f2f/verification/index.html` in your browser: a table of every verified screen (PASS/FAIL), then one section per screen with **Figma, your app and the heatmap side by side**. Each wrong layer has a red box on Figma (where it should be) and on your app (where it is now), and a row in plain words such as "12px too short, 20px too low". Hover a row to find it on the images. "Overlay your app on Figma" has a slider to fade between the two. Each section shows when that page was verified.

`verify` also writes `f2f/verification/<screen>.md` (and `.json`) for the agent:

- **PASS or FAIL** at the top.
- **Geometry:** every layer that is off by more than ±1 px, with Δx Δy Δw Δh, largest first. Example: `#12:40 Title  Δy +8  Δh -2` means the title sits 8 px too low and is 2 px too short. Each layer is measured against its parent and the layer before it, so a section that is 20 px too tall is reported once, on that section, not on every layer below it.
- **Style (web):** the exact computed font family, weight, italic, size and text colour of each tagged text, and the background colour and corner radius of each tagged box, against the Figma values. It also lists fonts anywhere on the page whose file is not loaded, so the browser fakes them (for example a slanted "italic"). These are numbers, so font rendering does not affect them.
- **Untagged texts, images and icons (web):** every text in the design is found on the page by its words, and its font, size, weight, italic, colour and letter-spacing are checked too. Images and icons are found by their asset file name (bundlers keep it in the URL) and measured like tagged layers. Tags are still needed for containers and sections. The same wrong value on many texts (for example letter-spacing 0 instead of 0.24 px on 21 labels) is reported once, as one class or token to fix.
- **Untagged layout of texts (web):** every text is also measured from its rendered line boxes, so a label 19 px lower than in Figma fails even without a tag; a text that Figma splits into two layers but the app draws as one sentence is found inside that sentence.
- **Colour presence (web):** where Figma draws a text, bullet, dot, line or icon in a colour, that colour must be at that place in the app. A square bullet replaced by a dash, a missing name or a dot that moved 16 px is reported with what Figma draws there (shape, size, colour, radius) and, when it is found close by, how far it moved.
- **Code rules:** your source is scanned for Figma ids built with string maths (write them as literals) and for raw two-decimal box sizes or spacing copied from Figma (round them). Typography values such as letter-spacing keep their exact design values.
- **Small screen (web):** the page is loaded again at 375 px wide; it fails if it scrolls sideways or cuts off text or images.
- **Overflow:** text that is clipped.
- **Coverage:** Figma layers that have no tag in your code, so they cannot be measured.
- **Text lines (web, fails):** every text in the design is found on the page by its words, tagged or not, and its rendered lines are compared with Figma's. "Complete Residential AC / Installation" in Figma but "Complete Residential / AC Installation" in the app is a failure, because it looks different even when the box size matches.
- **Text position (web, fails):** every text, tagged or not, is measured on the edge it is aligned to in Figma (left, centre or right). A right-aligned label drawn on the left, or a list that sits 6 px too far left, fails. Texts moved by the same amount are reported once, as one shared cause.
- **Web only, heatmap:** an app screenshot and a **diff image** (the heatmap in the report page). **Green** = a shape as Figma draws it, **red** = the same spot in your app (moved, missing or different), **grey** = same, or different only in rendering (photo re-compression, font smoothing; not counted). A green word next to a red one means it moved; green with no red means it is missing in the app. Numbered purple boxes match the "Fix these first" list.
- **Fix these first:** up to 14 findings per screen, each with what is wrong, how to fix it, and a small picture: Figma on the left (green outline), your app on the right (red outline). For images and icons the tool also measures whether the content is moved or zoomed; untagged texts, images and icons whose pixels really differ are found here too. Agents that read images use these pictures; the report page shows them as cards. Only numbered findings are marked on the heatmap; a difference without a finding is rendering only.
- **Small differences (page passes):** what stays under the failing tolerance, measured exactly. **Small shift**: a text 1.5–4 px off its place, with its cause when another text pushed it. **Text width**: a text drawn clearly wider or narrower than in Figma with the same font, size, weight and spacing (other characters or another font file). **Text width vs Figma** (a note, not counted): some texts are 1–3 px (about 1%) wider or narrower in the browser than Figma lays them out with the same font, size, weight and spacing. Figma keeps that width when the text is retyped, and Inter 3.19/4.0/4.1, CSS font features, optical sizes and kerning all give the same browser width, so the cause is not confirmed. To place the layers next to such a text exactly, give it the Figma width from its outline line. A text whose position, width and style all match is not listed even if its pixels differ, because Figma and the browser smooth glyph edges differently. For pixel-perfect, fix these too; then the section is empty.
- **Text case and underline (web, fails):** the case the text is shown in (Figma's text case against the app text with its text-transform) and underline or strike-through are compared on every text.
- **Fix prompt per screen:** every screen with anything to fix gets `f2f/verification/<screen>.prompt.md`, also shown in the report page with a "Copy prompt" button. It lists every measured difference with its px, fix and picture, the rules, and the command that re-verifies only that screen. Paste it as is into Claude, Codex or any coding agent. A clean screen has no prompt.

You fix it, paste the screen's fix prompt into your agent, or use prompt 3 for all screens at once, and run `verify` again until it shows PASS and no small differences.

On mobile (Android, iOS), styles are not measured as numbers yet: check colours and fonts by eye (see roadmap item 4).

## Quick reference

| I want to… | Command |
|---|---|
| See which version is installed | `f2f --version` (or `f2f -v`) |
| Check an exported package | `f2f validate f2f` |
| See what the tool detects in my repo | `f2f inspect --repo .` |
| Write the brief for the agent | `f2f build --feature <name> --repo .` |
| Compare the build with Figma (web, pick pages, open report) | `f2f verify --open` |
| Compare one screen, or on mobile | `f2f verify --screen <id> …` |
| See every difference with images and heatmap | `f2f report --open` |
| Re-generate outlines after updating the tool | `f2f refresh --package f2f` |
| Measure size and tokens | `f2f bench --package f2f` |

## Common problems

| Symptom | Fix |
|---|---|
| `f2f: command not found` | Run `npm install -g f2f-cli` again, then open a new terminal |
| Plugin not in Figma | Open [F2F on Figma Community](https://www.figma.com/community/plugin/1691251414681348956) and run it once from there |
| `No feature or screen "x"` | Use a name from the error message's `Features:` list |
| Many "untagged" layers | Add the tag from the brief to each element; untagged elements cannot be measured |
| "text width" in Small differences | The text is clearly wider or narrower than Figma draws it: check its characters and the font file the app loads; do not add padding. The "Text width vs Figma" note (1–3 px) is not counted |

## Developing the tool itself

`npm run check` runs type-check, tests and build. Tests use small fixtures in `tests/fixtures/`. To try a real change, run it against your own app repo; there is no demo app inside this repo.
