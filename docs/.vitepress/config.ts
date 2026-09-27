import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitepress';
import { base, dogfoodNote, flavors, repo, site } from '../flavors.ts';
import nav from '../nav.json' with { type: 'json' };

const DESCRIPTION =
  'Pre-publication checks for static websites: accessibility, links, SEO, security headers, privacy, page weight and more, with a fix for every finding.';

export default defineConfig({
  title: 'vidimus',
  titleTemplate: ':title · vidimus',
  description: DESCRIPTION,
  lang: 'en',
  base,
  outDir: 'dist',
  srcExclude: [
    'dist/**',
    'home.md',
    ...flavors.filter(({ path }) => path).map(({ path }) => `${path}**`),
  ],
  cleanUrls: true,
  sitemap: { hostname: `${site}/` },
  head: [
    ['link', { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' }],
    ['link', { rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` }],
    ['meta', { property: 'og:title', content: 'vidimus' }],
    ['meta', { property: 'og:description', content: DESCRIPTION }],
    ['meta', { property: 'og:image', content: `${site}/og.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  themeConfig: {
    logo: { src: '/favicon.svg', width: 24, height: 24, alt: '' },
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Audits', link: '/audits/' },
      { text: 'npm', link: 'https://www.npmjs.com/package/vidimus' },
    ],
    sidebar: nav.map(({ text, items }) => ({
      text,
      items: items.map((item) => ({ text: item.text, link: `/${item.link}` })),
    })),
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path` },
    search: { provider: 'local' },
    footer: { message: `MIT licensed. ${dogfoodNote} <a href="${base}flavors">Why</a>.` },
  },
  transformPageData: (page) => {
    const path = page.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    page.frontmatter.head ??= [];
    page.frontmatter.head.push(['link', { rel: 'canonical', href: `${site}/${path}` }]);
  },
  // Markdown <script> tags would be read as Vue SFC blocks, so page scripts come from frontmatter.
  transformHead: ({ pageData }) =>
    pageData.frontmatter.script
      ? [['script', { type: 'module', src: `${base}${pageData.frontmatter.script}` }]]
      : [],
  buildEnd: ({ outDir }) => {
    const schema = join(import.meta.dirname, '..', '..', 'schema.json');
    if (existsSync(schema)) copyFileSync(schema, join(outDir, 'schema.json'));
  },
});
