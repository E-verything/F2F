import type { APIRoute } from 'astro';
import { NAV, SITE, url as path } from '../site';

// AI-readable site index (llmstxt.org format); links are absolute only when SITE_URL is set.
export const GET: APIRoute = ({ site }) => {
  const url = (p: string) => (site ? new URL(p.startsWith(path('/')) ? p : path(p), site).href : p);
  const body = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.tagline} A free, open-source, local-first tool: a Figma plugin exports exact design values, the \`${SITE.cli}\` CLI writes a repo-aware brief for any AI coding agent, then measures the running app against the design to ±1 px on web, Flutter, Android and iOS.`,
    '',
    '## Pages',
    '',
    `- [Home](${url(path('/'))}): Overview and the export, brief, implement, verify loop.`,
    ...NAV.map((n) => `- [${n.label}](${url(n.href)})`),
    `- [Privacy](${url(path('/privacy'))})`,
    '',
    '## Full text',
    '',
    `- [llms-full.txt](${url(path('/llms-full.txt'))}): the getting-started guide and the FAQ as plain text.`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
