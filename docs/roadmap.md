# Roadmap

## Done

- **Phase 1: audit.** Licences and Figma API findings.
- **Phase 2: extraction.** Figma plugin (selection, page and all-pages scopes, sections as features, progress, cancellation, per-property error capture, SVG icons, image fills, export settings, screenshots, optional `JSON_REST_V1`), normaliser, and versioned JSON Schema 1.0.0. Verified on a real file against Figma's own REST JSON with 0 value mismatches.
- **Phase 3 (part): agent context.** Default-value trimming, minified data files, a one-line-per-layer outline (about 11k tokens per real screen), `refresh`, and unsupported-property noise removal.
- **Phase 4: context compiler.** `inspect` and `build --feature`: Flutter, React/Next/Vue/Svelte, CSS variables, Tailwind config, `ColorScheme`/`ThemeExtension` colours, `GoogleFonts` styles. Component, colour, type, font and asset mapping with evidence. Icon and system-UI detection. Framework-specific tagging and verify instructions. Figma→code rules learned from measured mismatches.
- **Phase 5: verification.** One comparator for every runtime: Chrome DevTools driver (web and Flutter web; no browser-automation dependency), Android `adb uiautomator`, iOS `idb`, and the Flutter host test probe. Clip-aware comparison, text-metric warnings, coverage, overflow, a visual diff with alpha compositing, and Markdown/JSON reports.
- **Phase 6: benchmark.** `bench` command and [benchmark.md](benchmark.md) with measured results on a real file and an end-to-end implementation and fix loop.

## Next, by impact

1. **Field tests:** a real React app and a real Flutter mobile app, a second coding agent, and live Android/iOS runs (the parsers are only fixture-tested so far).
2. **Large files:** normalise and release page by page instead of holding the whole snapshot in memory, with incremental re-export by screen `contentHash`.
3. **Responsive:** link the same screen at different widths, derive the differences, and verify at each viewport.
4. **Numeric style checks:** compare computed colours, font family/size/weight and radius on web (`getComputedStyle`) and Flutter, not only geometry and pixels.
5. **Remembered mappings:** persist confirmed Figma→code component and token mappings across runs and teammates.
6. **More inspection:** `ThemeData` text themes, Compose/SwiftUI themes, Angular, CSS-in-JS tokens, and DTCG token output.
7. **Publishing:** release the CLI on npm and the plugin to the Figma Community (needs a published plugin id and review).
