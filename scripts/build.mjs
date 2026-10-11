import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Figma's sandbox runs an older JS engine; ES2017 output avoids syntax it may not parse.
const PLUGIN_TARGET = 'es2017';

await mkdir('packages/plugin/dist', { recursive: true });
await build({ entryPoints: ['packages/plugin/src/code.ts'], bundle: true, outfile: 'packages/plugin/dist/code.js', target: PLUGIN_TARGET, format: 'iife', logLevel: 'warning' });
const ui = await build({ entryPoints: ['packages/plugin/src/ui.ts'], bundle: true, write: false, target: 'es2020', format: 'iife', minify: true, logLevel: 'warning' });
const html = await readFile('packages/plugin/src/ui.html', 'utf8');
// The plugin has no network access, so the logo is embedded as a data URI.
const logo = `data:image/png;base64,${(await readFile('packages/plugin/assets/icon-128.png')).toString('base64')}`;
await writeFile('packages/plugin/dist/ui.html', html.replace('/*LOGO*/', logo).replace('/*UI_SCRIPT*/', () => ui.outputFiles[0].text.replace(/<\/script/g, '<\\/script')));
await build({ entryPoints: ['packages/cli/src/index.ts'], bundle: true, outfile: 'packages/cli/dist/index.js', platform: 'node', target: 'node22', format: 'esm', packages: 'external', banner: { js: '#!/usr/bin/env node' }, logLevel: 'warning' });
console.log('built packages/plugin/dist/code.js, packages/plugin/dist/ui.html, packages/cli/dist/index.js');
