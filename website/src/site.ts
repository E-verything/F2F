// Single source for product facts and deploy-specific links; links stay hidden until their env var is set.
export const SITE = {
  name: 'F2F',
  tagline: 'Figma to working frontend, measured, with any AI coding agent.',
  cli: 'f2f',
  license: 'MIT',
  videoId: 'UABhjvub_Zs',
  repoUrl: import.meta.env.PUBLIC_REPO_URL || null,
  // GoatCounter site code for anonymous visit counting; counting and the public count stay off until it is set.
  goatcounter: import.meta.env.PUBLIC_GOATCOUNTER_CODE || null,
} as const;

// Internal links go through url() so the site works at a domain root and under a sub-path (BASE_PATH).
// Page paths get a trailing slash (before any #hash) to match the served URLs; files with an extension keep none.
export const url = (path: string) => {
  const [p, rest = ''] = path.split(/(?=[#?])/);
  const clean = p.endsWith('/') || /\.[a-z0-9]+$/i.test(p) ? p : `${p}/`;
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${clean}${rest}`;
};

export const NAV = [
  { href: url('/how-it-works'), label: 'How it works' },
  { href: url('/docs'), label: 'Docs' },
  { href: url('/developers'), label: 'Developers' },
  { href: url('/faq'), label: 'FAQ' },
] as const;
