# f2f-cli

The command-line half of **F2F**: Figma to working frontend, measured, with any AI coding agent.

The F2F Figma plugin exports exact design values as an `f2f/` folder. This CLI maps that design to your existing codebase, writes a brief your AI agent follows, then measures the running app against the design to ±1 px on web, Flutter, Android and iOS.

Local-first: no server, no paid API, no telemetry. It reads your repo read-only and never opens env or key files.

## Install

Needs Node 22 or newer.

```bash
npm install -g f2f-cli
f2f --help
```

Or without installing: `npx f2f-cli --help`.

## Use

The full guide with the copy-paste agent prompts is [Getting started](https://github.com/E-verything/F2F/blob/main/docs/getting-started.md). In short:

1. Run the [F2F Figma plugin](https://www.figma.com/community/plugin/1691251414681348956) on your screens and unzip the download into your app root, so `your-app/f2f/` exists. Then `f2f validate f2f`.
2. Describe your stack and folders once in `f2f-project.md` (prompt 0), and let your agent set up the design system (prompt 1).
3. Write the brief for the page(s) to build, then give it to your agent with prompt 2:

   ```bash
   f2f build --feature "<page or section name>" --repo .
   f2f build --feature "Page A, Page B" --name "My Pages" --repo .   # several pages
   ```

4. Start your app and verify (the brief has the exact command):

   ```bash
   f2f verify --screen <id> --url http://localhost:3000/<route>   # web, Flutter web
   f2f verify --screens "<id>=<route>,<id>=<route>" --url http://localhost:3000   # several web pages
   f2f verify --screen <id> --android                             # needs adb
   f2f verify --screen <id> --ios                                 # needs idb
   ```

The report in `f2f/verification/<screen>.md` gives PASS/FAIL with layout offsets (Δx Δy Δw Δh), and on web exact style differences (font, italic, colour, background, radius, fonts the browser fakes), a 375 px small-screen check, code-rule issues, clipped text, untagged layers and a diff image.

## Commands

| Command | What it does |
|---|---|
| `f2f validate <dir>` | Check an export: schema, file hashes, cross-references |
| `f2f inspect --repo .` | Show what F2F detects in your repo |
| `f2f build --feature <name> --repo . [--name <brief>]` | Write the brief for your agent (one page, a section, or several pages) |
| `f2f verify --screen <id> …` | Measure the running app against the design |
| `f2f refresh` | Regenerate outlines with this CLI version |
| `f2f bench` | Measure size, tokens, time and memory |

Flutter helpers (tagging widget and host-test probe) ship in this package under `templates/flutter/`.

## License

MIT
