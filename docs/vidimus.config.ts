import { defineConfig } from 'vidimus';
import { flavors, site } from './flavors.ts';

export default defineConfig({
  distDir: 'dist',
  siteUrl: site,
  exclude: ['^mdbook/toc\\.html$'],
  audits: [
    'seo',
    'security',
    'html',
    'budget',
    'assets',
    'csp',
    'links',
    'a11y',
    'r12s',
    'privacy',
    'lighthouse',
  ],
  ignore: [
    // Starlight's Expressive Code puts <div> lines inside <code> and <button>.
    {
      audit: 'html',
      message:
        '^element-permitted-content: <div> element is not permitted as content under <(code|button)>$',
      where: '^/astro/',
    },
    // mdBook's default theme: a search <form> without a submit button, ARIA attributes on the
    // sidebar toggle <label>, a small GitHub icon link and a deprecated unload listener.
    { audit: 'a11y', message: '^This form does not contain a submit button', where: '^/mdbook/' },
    { audit: 'lighthouse', message: '^/mdbook/\\S* (accessibility|best-practices) ' },
  ],
  html: { rules: { 'attribute-misuse': 'off' } },
  links: { skip: ['^mailto:', '^tel:', '^https://github\\.com/LJS360d/vidimus/edit/'] },
  lighthouse: {
    urls: flavors.flatMap(({ id, path }) => [
      `/${path}`,
      id === 'vitepress'
        ? '/audits/seo'
        : id === 'mdbook'
          ? `/${path}audits/seo.html`
          : `/${path}audits/seo/`,
    ]),
    thresholds: { accessibility: 0.98 },
  },
});
