import type { APIRoute } from 'astro';
import { SITE } from '../site';
import { faqs } from '../faqs';
import guide from '../../../docs/getting-started.md?raw';

// Full plain-text content for AI readers: the getting-started guide and the FAQ, from the same sources as the pages.
export const GET: APIRoute = () => {
  const body = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.tagline}`,
    '',
    guide.trim(),
    '',
    '# FAQ',
    '',
    ...faqs.flatMap((f) => [`## ${f.q}`, '', f.a, '']),
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
