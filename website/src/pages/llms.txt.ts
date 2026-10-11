import type { APIRoute } from 'astro';
import { NAV, SITE } from '../site';

// AI-readable site index (llmstxt.org format); links are absolute only when SITE_URL is set.
export const GET: APIRoute = ({ site }) => {
  const url = (path: string) => (site ? new URL(path, site).href : path);
  const body = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.tagline} A free, open-source, local-first tool: a Figma plugin exports exact design values, the \`${SITE.cli}\` CLI writes a repo-aware brief for any AI coding agent, then measures the running app against the design to ±1 px on web, Flutter, Android and iOS.`,
    '',
    '## Pages',
    '',
    `- [Home](${url('/')}): Overview and the export, brief, implement, verify loop.`,
    ...NAV.map((n) => `- [${n.label}](${url(n.href)})`),
    `- [Privacy](${url('/privacy')})`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
