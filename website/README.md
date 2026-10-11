# Website

Static marketing and docs site, built with Astro and plain CSS. It ships only a few KB of JavaScript, for the menu, the hero demo and the copy buttons.

## Local dev

```bash
cd website
npm install
npm run dev       # http://localhost:4321
npm run build     # outputs to website/dist/
npm run preview   # serve the production build
```

## Configuration

| Variable | Use | When unset |
|---|---|---|
| `SITE_URL` | Public URL: canonical links, sitemap, absolute links in `llms.txt` and `robots.txt` | Build still works; sitemap and absolute links are skipped |
| `PUBLIC_REPO_URL` | Source-code, issues and license links | Those links are hidden |

## Content sources

- `src/site.ts`: product name, tagline and navigation (single source).
- `/docs` renders `../docs/getting-started.md`. Edit the guide there, not in the site.
- Numbers on the site come from `../docs/benchmark.md`. Update both together.

## Deploy

Any static host. Build command `npm run build`, output `dist`, root directory `website`.
