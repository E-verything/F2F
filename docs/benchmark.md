# Benchmark report

All numbers are measured on 2026-10-12 (Windows 11, Node 22.14, Chrome 154, Flutter stable) unless marked as an estimate. Token counts are estimates (characters / 3.5), because the tool ships no tokenizer. Reproduce with `f2f bench --package <dir> [--repo <dir> --feature <name>]`.

## Subject

A real, authorised Figma file of a sample social app on the free plan: the 2 screens of section "Sidebar", 390×844 each (a feed under a scrim, with an open drawer).

## Extraction (Figma plugin)

| Metric | Value |
|---|---|
| Layers read | 676 (43,556 properties) |
| Shared components / variables / styles | 29 / 16 / 48 |
| Assets exported (deduplicated by content hash) | 70 |
| Plugin extraction time | 6.3 s |
| Status | complete, 0 errors, 11 warnings (3 missing font, 8 icons with no exportable paint) |
| Value accuracy against Figma's own `JSON_REST_V1` | 524 layers compared (box, text, font, size, weight, fill, gap, padding, radius): 0 mismatches beyond float rounding below 0.001 px |

## Package size and agent context

| Artifact | Bytes | Tokens (est.) |
|---|---|---|
| Whole package (95 files) | 2.67 MB | — (1.63 MB are images/SVGs) |
| Screen JSON (full reference), per screen | ~245 KB | ~70k |
| **Screen outline** (what the agent reads), per screen | ~39 KB | **~11k** |
| Feature brief (both screens, repo mapping, rules, verify steps) | 19 KB | ~5.5k |
| DESIGN.md | 12 KB | ~3.3k |

Reading the brief plus one outline is about 17k tokens. The first unoptimised export was about 1.6 MB, roughly 400k tokens, per screen.

## Local CLI

| Command | Time |
|---|---|
| CLI start (no-op) | ~160 ms |
| `validate` (95 files, schema + hashes + references) | ~240–390 ms |
| `inspect` (Flutter repo, 74 items) | ~37 ms |
| `build --feature` (brief) | ~23 ms |
| `verify --url` (launch Chrome, load a Flutter web app, measure, screenshot, diff) | ~4.9 s |
| `flutter test` probe (2 screens, host, no device) | ~2 s after Flutter compile |
| Peak memory of the CLI | 67 MB RSS |

## End-to-end: design → code → verify

An AI coding agent implemented both screens in a throwaway Flutter app using only the package: brief, outlines and component definitions. It did not use the Figma file or screenshots.

| Step | Screen 363 | Screen 1018 |
|---|---|---|
| First verification (47 tagged layers, ±1 px) | 31 pass, 16 off | same pattern |
| After 1 fix round driven by the report | 44 pass, 1 off, 2 text-width warnings | 44 pass, 1 off, 2 text-width warnings |
| Visual difference vs Figma screenshot | 3.3% of pixels (mostly anti-aliasing and the deliberately blank OS status bar) | 4.4% |

What the report caught:
- 4 real implementation bugs: a column filling the full height, a row filling the wrong width, an SVG box 3 px narrow, and a text box not filling its width.
- A bordered chip 1 px too tall, because Flutter adds a border to the size while Figma's inside stroke does not.
- A missing icon asset and blurry image scaling, both visible only in the diff image.

The lessons are now rules in every DESIGN.md and brief ("Figma → code rules").

What remains is not layout. Text widths are 3–8% wider because Chrome renders Google Fonts' Urbanist build with different glyph advances than the designer's Figma font. The verifier reports these as warnings, plus one chip that hugs that text.

## Not yet measured

- A second coding agent and different model sizes.
- Very large files (hundreds of screens): memory and time of a whole-file export.
- Live Android (adb) and iOS (idb) runs. Their parsers are tested on recorded output only.
- React/Next/Vue end to end. The web driver is tested on a real headless Chrome page, but not on a real React app.
- Human implementation time and the number of manual interventions in a real project.
