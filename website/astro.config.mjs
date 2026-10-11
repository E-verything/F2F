// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The public URL is set per deploy (SITE_URL); without it the build still works, only the sitemap and absolute links are skipped.
const site = process.env.SITE_URL || undefined;

export default defineConfig({
  site,
  trailingSlash: 'never',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: site ? [sitemap({ changefreq: 'weekly', priority: 0.7 })] : [],
  // The Docs page renders ../docs/getting-started.md so the guide has one source.
  vite: { server: { fs: { allow: ['..'] } } },
});
