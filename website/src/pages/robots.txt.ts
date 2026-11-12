import type { APIRoute } from 'astro';

// Crawlers that read the site for answers and AI search; all are welcome.
const AI_CRAWLERS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'];

export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? `\nSitemap: ${new URL('sitemap-index.xml', site).href}\n` : '';
  const ai = AI_CRAWLERS.map((bot) => `User-agent: ${bot}\nAllow: /\n`).join('\n');
  return new Response(`User-agent: *\nAllow: /\n\n${ai}${sitemap}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
