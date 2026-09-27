import { defineConfig } from 'vidimus';
import { base, flavors, pageUrl, site } from './flavors.ts';
import nav from './nav.json' with { type: 'json' };

const path = (url: string) => url.slice(base.length - 1);
const apps = flavors.filter(({ id }) => id === 'react' || id === 'angular');

export default defineConfig({
  distDir: 'dist',
  siteUrl: site,
  exclude: ['^mdbook/toc\\.html$'],
  // React and Angular build one index.html each and route in the browser, like a host that
  // rewrites unknown paths to it; every page is a route.
  server: {
    fallback: apps.map(({ path: dir }) => ({ match: `^/${dir}`, file: `${dir}index.html` })),
  },
  routes: {
    paths: apps.flatMap(({ id }) =>
      ['', ...nav.flatMap(({ items }) => items.map(({ link }) => link))].map((link) =>
        path(pageUrl(id, link)),
      ),
    ),
  },
  render: { mode: 'on', include: ['^/(react|angular)/', 'showcase'] },
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
    // mdBook's script adds its copy button as a <div> inside <pre>; the showcase is rendered.
    {
      audit: 'html',
      message: '^element-permitted-content: <div> element is not permitted as content under <pre>$',
      where: '^/mdbook/',
    },
    // The showcase embeds an OpenStreetMap iframe without a facade on purpose, to show the finding.
    {
      audit: 'privacy',
      message: '^third-party (embed from|request to) \\S*openstreetmap\\.org$',
      where: 'showcase',
    },
  ],
  html: { rules: { 'attribute-misuse': 'off' } },
  // Not in `audits`: CI runs `shots` on its own against a baseline it keeps in its cache.
  shots: { exclude: ['^(?!.*showcase)'], viewports: [375, 1280], motion: false },
  links: {
    skip: ['^mailto:', '^tel:', '^https://github\\.com/LJS360d/vidimus/edit/'],
    notFound: { selector: '.not-found' },
  },
  lighthouse: {
    urls: flavors.flatMap(({ id }) =>
      ['', 'audits/seo', 'showcase'].map((slug) => path(pageUrl(id, slug))),
    ),
    thresholds: { accessibility: 0.98 },
    overrides: [
      // Angular boots in one ~500 ms task under Lighthouse's 4x CPU throttling (React: ~190 ms),
      // whatever the page; it lands around 0.9 and would fail every other run.
      { match: '^/angular/', thresholds: { performance: 0.85 } },
      // The showcase carries a WebGL scene, video and embeds on purpose.
      { match: 'showcase', thresholds: { performance: 0.75 } },
    ],
  },
});
