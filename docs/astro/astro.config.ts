import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { base, flavors, repo, site } from '../flavors.ts';
import nav from '../nav.json' with { type: 'json' };

const path = flavors.find(({ id }) => id === 'astro')?.path ?? 'astro/';
const DESCRIPTION =
  'Pre-publication checks for static websites: accessibility, links, SEO, security headers, privacy, page weight and more, with a fix for every finding.';

export default defineConfig({
  base: `${base}${path}`,
  outDir: '../dist/astro',
  integrations: [
    starlight({
      title: 'vidimus',
      description: DESCRIPTION,
      disable404Route: true,
      favicon: '/favicon.svg',
      logo: { src: './public/favicon.svg', alt: 'vidimus' },
      head: [
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: `${base}${path}apple-touch-icon.png` },
        },
        { tag: 'meta', attrs: { property: 'og:image', content: `${site}/og.png` } },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      customCss: ['./src/styles/custom.css'],
      components: {
        Banner: './src/components/FlavorSwitch.astro',
        Head: './src/components/Head.astro',
        EditLink: './src/components/EditLink.astro',
        Footer: './src/components/Footer.astro',
      },
      sidebar: nav.map(({ text, items }) => ({
        label: text,
        items: items.map((item) => ({ label: item.text, link: `/${item.link}` })),
      })),
    }),
  ],
});
