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

1. In Figma desktop, run the **F2F** plugin on your screens and unzip the download into your app repo, so `your-app/f2f/` exists.
2. Check the export and write the brief:

   ```bash
   f2f validate f2f
   f2f build --feature "<section or screen name>" --repo .
   ```

3. Tell your AI agent: *Read `f2f/briefs/<feature>.md` and follow it: implement the screens, tag the layers, run `f2f verify` and fix until it passes.*
4. Start your app and verify:

   ```bash
   f2f verify --screen <id> --url http://localhost:3000/route   # web, Flutter web
   f2f verify --screen <id> --android                           # needs adb
   f2f verify --screen <id> --ios                               # needs idb
   ```

The report in `f2f/verification/<screen>.md` lists PASS/FAIL, every layer that is off with Δx Δy Δw Δh, clipped text, untagged layers and, on web, a red-pixel diff image.

## Commands

| Command | What it does |
|---|---|
| `f2f validate <dir>` | Check an export: schema, file hashes, cross-references |
| `f2f inspect --repo .` | Show what F2F detects in your repo |
| `f2f build --feature <name> --repo .` | Write the brief for your agent |
| `f2f verify --screen <id> …` | Measure the running app against the design |
| `f2f refresh` | Regenerate outlines with this CLI version |
| `f2f bench` | Measure size, tokens, time and memory |

Flutter helpers (tagging widget and host-test probe) ship in this package under `templates/flutter/`.

## License

MIT
