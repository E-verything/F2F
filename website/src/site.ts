// Single source for product facts and deploy-specific links; links stay hidden until their env var is set.
export const SITE = {
  name: 'F2F',
  tagline: 'Figma to working frontend, measured, with any AI coding agent.',
  cli: 'f2f',
  license: 'MIT',
  repoUrl: import.meta.env.PUBLIC_REPO_URL || null,
} as const;

export const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/docs', label: 'Docs' },
  { href: '/developers', label: 'Developers' },
  { href: '/faq', label: 'FAQ' },
] as const;
