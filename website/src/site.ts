// Single source for product facts and deploy-specific links; links stay hidden until their env var is set.
export const SITE = {
  name: 'F2F',
  tagline: 'Figma to working frontend, measured, with any AI coding agent.',
  cli: 'f2f',
  license: 'MIT',
  repoUrl: import.meta.env.PUBLIC_REPO_URL || null,
} as const;

// Internal links go through url() so the site works at a domain root and under a sub-path (BASE_PATH).
export const url = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

export const NAV = [
  { href: url('/how-it-works'), label: 'How it works' },
  { href: url('/docs'), label: 'Docs' },
  { href: url('/developers'), label: 'Developers' },
  { href: url('/faq'), label: 'FAQ' },
] as const;
