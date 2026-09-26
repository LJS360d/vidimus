import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitepress';

const SITE = 'https://ljs360d.github.io/vidimus';
const REPO = 'https://github.com/LJS360d/vidimus';
const DESCRIPTION =
  'Pre-publication checks for static websites: accessibility, links, SEO, security headers, privacy, page weight and more, with a fix for every finding.';

export default defineConfig({
  title: 'vidimus',
  titleTemplate: ':title · vidimus',
  description: DESCRIPTION,
  lang: 'en',
  base: '/vidimus/',
  cleanUrls: true,
  sitemap: { hostname: `${SITE}/` },
  head: [
    ['link', { rel: 'icon', href: '/vidimus/favicon.svg', type: 'image/svg+xml' }],
    ['link', { rel: 'apple-touch-icon', href: '/vidimus/apple-touch-icon.png' }],
    ['meta', { property: 'og:title', content: 'vidimus' }],
    ['meta', { property: 'og:description', content: DESCRIPTION }],
    ['meta', { property: 'og:image', content: `${SITE}/og.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  themeConfig: {
    logo: { src: '/favicon.svg', width: 24, height: 24, alt: '' },
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Audits', link: '/audits' },
      { text: 'npm', link: 'https://www.npmjs.com/package/vidimus' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Audits', link: '/audits' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'CLI and CI', link: '/cli' },
          { text: 'Custom audits', link: '/plugins' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    editLink: { pattern: `${REPO}/edit/main/docs/:path` },
    search: { provider: 'local' },
    footer: { message: 'MIT licensed' },
  },
  transformPageData: (page) => {
    const path = page.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    page.frontmatter.head ??= [];
    page.frontmatter.head.push(['link', { rel: 'canonical', href: `${SITE}/${path}` }]);
  },
  buildEnd: ({ outDir }) => {
    const schema = join(import.meta.dirname, '..', '..', 'schema.json');
    if (existsSync(schema)) copyFileSync(schema, join(outDir, 'schema.json'));
  },
});
