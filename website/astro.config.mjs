// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The public URL is set per deploy (SITE_URL); without it the build still works, only the sitemap and absolute links are skipped.
const site = process.env.SITE_URL || undefined;

export default defineConfig({
  site,
  // A sub-path deploy (e.g. GitHub Pages at /F2F) sets BASE_PATH; a domain root needs nothing.
  base: process.env.BASE_PATH || '/',
  // GitHub Pages serves docs/index.html at /docs/ and redirects /docs, so every URL, canonical and sitemap entry uses the slash form.
  trailingSlash: 'always',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: site ? [sitemap({ changefreq: 'weekly', priority: 0.7 })] : [],
  // The Docs page renders ../docs/getting-started.md so the guide has one source.
  vite: { server: { fs: { allow: ['..'] } } },
});
