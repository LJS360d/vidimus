import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UserConfig } from '../src/config/types.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const SITE = 'https://example.com';
const DESCRIPTION = 'A perfectly reasonable description that is long enough for search engines.';

interface PageOptions {
  path: string;
  title?: string | null;
  description?: string | null;
  lang?: string | null;
  canonical?: string | null | string[];
  head?: string;
  body?: string;
  links?: string[];
}

const page = ({
  path,
  title = `Page ${path} of the site`,
  description = `${DESCRIPTION} ${path}`,
  lang = 'en',
  canonical = `${SITE}${path}`,
  head = '',
  body = '<h1>Heading</h1>',
  links = [],
}: PageOptions) => {
  const canonicals = canonical === null ? [] : [canonical].flat();
  return `<!doctype html>
<html${lang === null ? '' : ` lang="${lang}"`}>
<head>
${title === null ? '' : `<title>${title}</title>`}
${description === null ? '' : `<meta name="description" content="${description}">`}
${canonicals.map((href) => `<link rel="canonical" href="${href}">`).join('\n')}
${head}
</head>
<body>${body}${links.map((href) => `<a href="${href}">link</a>`).join('')}</body>
</html>`;
};

const sitemap = (...paths: string[]) =>
  `<?xml version="1.0"?><urlset>${paths.map((path) => `<url><loc>${SITE}${path}</loc></url>`).join('')}</urlset>`;

const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`;

const site = (files: Record<string, string> = {}) => ({
  'dist/index.html': page({ path: '/', links: ['/about/'] }),
  'dist/about/index.html': page({ path: '/about/', links: ['/'] }),
  'dist/sitemap.xml': sitemap('/', '/about/'),
  'dist/robots.txt': ROBOTS,
  ...files,
});

const without = (files: Record<string, string>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(files).filter(([key]) => !keys.includes(key)));

const audit = async (files: Record<string, string>, overrides: UserConfig = {}) => {
  const cwd = fixture(files);
  const { results } = await run({
    cwd,
    env: {},
    audits: ['seo'],
    reporters: [],
    overrides: { siteUrl: SITE, ...overrides },
  });
  const result = results[0];
  assert.ok(result);
  return result;
};

const find = (result: Awaited<ReturnType<typeof audit>>, message: RegExp) =>
  result.findings.find((finding) => message.test(finding.message));

describe('seo audit', () => {
  it('skips redirect stubs but still checks pages that only auto-reload', async () => {
    const result = await audit(
      site({
        'dist/old/index.html': '<meta http-equiv="refresh" content="0; url=/about/">',
        'dist/live/index.html': page({
          path: '/live/',
          title: null,
          head: '<meta http-equiv="refresh" content="300">',
          links: ['/'],
        }),
        'dist/sitemap.xml': sitemap('/', '/about/', '/live/'),
      }),
    );
    assert.ok(result.findings.some(({ where }) => where?.includes('/live/')));
    assert.ok(!result.findings.some(({ where }) => where?.includes('/old/')));
  });

  it('passes a clean site', async () => {
    const result = await audit(site());
    assert.deepEqual(result.findings, []);
    assert.equal(result.status, 'passed');
    assert.equal(result.summary, '2 pages, no problems');
  });

  it('is skipped without pages', async () => {
    const result = await audit({ 'dist/404.html': page({ path: '/404.html' }) });
    assert.equal(result.status, 'skipped');
  });

  it('fails on missing lang, title and description', async () => {
    const result = await audit(
      site({
        'dist/about/index.html': page({
          path: '/about/',
          lang: null,
          title: null,
          description: null,
          links: ['/'],
        }),
      }),
    );
    assert.equal(result.status, 'failed');
    for (const message of [/missing <html lang>/, /missing <title>/, /missing meta description/]) {
      const finding = find(result, message);
      assert.deepEqual(finding?.where, ['/about/']);
      assert.equal(finding?.severity, undefined);
    }
  });

  it('warns on duplicate titles and bad lengths', async () => {
    const result = await audit(
      site({
        'dist/index.html': page({ path: '/', title: 'Same title here', links: ['/about/'] }),
        'dist/about/index.html': page({
          path: '/about/',
          title: 'Same title here',
          description: 'Too short',
          links: ['/'],
        }),
      }),
    );
    assert.equal(result.status, 'warned');
    assert.deepEqual(find(result, /duplicate title "Same title here"/)?.where, ['/', '/about/']);
    assert.equal(find(result, /meta description outside 50-160/)?.severity, 'warn');
  });

  it('fails on noindex unless allowed, and skips indexability checks for it', async () => {
    const files = site({
      'dist/draft/index.html': page({
        path: '/draft/',
        canonical: null,
        head: '<meta name="robots" content="noindex, nofollow">',
      }),
    });
    const failing = await audit(files);
    assert.deepEqual(find(failing, /noindex in the production build/)?.where, ['/draft/']);
    assert.equal(find(failing, /orphan/), undefined);
    assert.equal(find(failing, /canonical/), undefined);

    const allowed = await audit(files, { seo: { allowNoindex: ['^/draft/$'] } });
    assert.equal(allowed.status, 'passed');
  });

  it('fails on a noindex page listed in the sitemap', async () => {
    const result = await audit(
      site({
        'dist/about/index.html': page({
          path: '/about/',
          head: '<meta name="googlebot" content="noindex">',
          links: ['/'],
        }),
      }),
      { seo: { allowNoindex: ['^/about/$'] } },
    );
    assert.deepEqual(find(result, /noindex page in the sitemap/)?.where, ['/about/']);
  });

  it('checks canonical links', async () => {
    const result = await audit(
      site({
        'dist/a/index.html': page({ path: '/a/', canonical: '/a/', links: ['/'] }),
        'dist/b/index.html': page({ path: '/b/', canonical: 'https://other.com/b/' }),
        'dist/c/index.html': page({ path: '/c/', canonical: `${SITE}/gone/` }),
        'dist/d/index.html': page({ path: '/d/', canonical: [`${SITE}/d/`, `${SITE}/`] }),
        'dist/e/index.html': page({ path: '/e/', canonical: null }),
        'dist/sitemap.xml': sitemap('/', '/about/', '/a/', '/b/', '/c/', '/d/', '/e/'),
        'dist/index.html': page({
          path: '/',
          links: ['/about/', '/a/', '/b/', '/c/', '/d/', '/e/'],
        }),
      }),
    );
    assert.deepEqual(find(result, /canonical URL is not absolute/)?.where, ['/a/']);
    assert.deepEqual(find(result, /canonical points outside https:\/\/example.com/)?.where, [
      '/b/',
    ]);
    assert.deepEqual(find(result, /canonical is not a built page/)?.where, ['/c/']);
    assert.deepEqual(find(result, /more than one canonical/)?.where, ['/d/']);
    const missing = find(result, /no canonical link/);
    assert.deepEqual(missing?.where, ['/e/']);
    assert.equal(missing?.severity, 'warn');
  });

  it('requires reciprocal, absolute and unique hreflang links', async () => {
    const alt = (lang: string, href: string) =>
      `<link rel="alternate" hreflang="${lang}" href="${href}">`;
    const result = await audit(
      site({
        'dist/index.html': page({
          path: '/',
          links: ['/about/', '/it/'],
          head: alt('en', `${SITE}/`) + alt('it', `${SITE}/it/`) + alt('it', '/it/'),
        }),
        'dist/it/index.html': page({
          path: '/it/',
          lang: 'it',
          links: ['/'],
          head: alt('it', `${SITE}/it/`),
        }),
        'dist/sitemap.xml': sitemap('/', '/about/', '/it/'),
      }),
    );
    assert.deepEqual(find(result, /hreflang not reciprocated/)?.details, ['/ → /it/']);
    assert.deepEqual(find(result, /duplicate hreflang "it"/)?.where, ['/']);
    assert.deepEqual(find(result, /hreflang URL is not absolute/)?.where, ['/']);
  });

  it('warns on missing or repeated h1', async () => {
    const result = await audit(
      site({
        'dist/index.html': page({ path: '/', body: '', links: ['/about/'] }),
        'dist/about/index.html': page({
          path: '/about/',
          body: '<h1>a</h1><h1>b</h1>',
          links: ['/'],
        }),
      }),
    );
    assert.equal(result.status, 'warned');
    assert.deepEqual(find(result, /no <h1>/)?.where, ['/']);
    assert.deepEqual(find(result, /more than one <h1>/)?.where, ['/about/']);
  });

  it('warns when there is no sitemap', async () => {
    const result = await audit(without(site(), 'dist/sitemap.xml'));
    assert.equal(result.status, 'warned');
    assert.equal(find(result, /no sitemap.xml/)?.severity, 'warn');
  });

  it('follows sitemap indexes and reports extra, foreign and missing URLs', async () => {
    const result = await audit(
      without(
        site({
          'dist/sitemap-index.xml': `<sitemapindex><sitemap><loc>${SITE}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
          'dist/sitemap-0.xml': `<urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/gone/</loc></url><url><loc>https://other.com/</loc></url></urlset>`,
        }),
        'dist/sitemap.xml',
      ),
    );
    assert.deepEqual(find(result, /not a built page/)?.where, ['/gone/']);
    assert.deepEqual(find(result, /sitemap URL outside/)?.where, ['https://other.com/']);
    const missing = find(result, /missing from the sitemap/);
    assert.deepEqual(missing?.where, ['/about/']);
    assert.equal(missing?.severity, 'warn');
  });

  it('checks robots.txt', async () => {
    const missing = await audit(without(site(), 'dist/robots.txt'));
    assert.equal(find(missing, /no robots.txt/)?.severity, 'warn');

    const blocked = await audit(site({ 'dist/robots.txt': 'User-agent: *\nDisallow: /\n' }));
    assert.equal(find(blocked, /disallows everything/)?.severity, undefined);
    assert.equal(find(blocked, /no Sitemap line/)?.severity, 'warn');

    const scoped = await audit(
      site({
        'dist/robots.txt': `User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/\nSitemap: ${SITE}/sitemap.xml\n`,
      }),
    );
    assert.equal(scoped.status, 'passed');
  });

  it('warns about orphan pages', async () => {
    const result = await audit(
      site({
        'dist/lonely.html': page({ path: '/lonely.html', links: ['/'] }),
        'dist/sitemap.xml': sitemap('/', '/about/', '/lonely.html'),
      }),
    );
    assert.equal(result.status, 'warned');
    assert.deepEqual(find(result, /orphan/)?.where, ['/lonely.html']);
  });

  it('skips meta refresh redirect stubs', async () => {
    const stub =
      '<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=/about/"><meta name="robots" content="noindex">';
    const result = await audit(
      site({ 'dist/index.html': stub, 'dist/sitemap.xml': sitemap('/about/') }),
      {
        seo: { orphans: false },
      },
    );
    assert.deepEqual(result.findings, []);
  });

  it('does not report duplicate titles between hreflang alternates', async () => {
    const alternates = `<link rel="alternate" hreflang="en" href="${SITE}/en/"><link rel="alternate" hreflang="fr" href="${SITE}/fr/">`;
    const shared = { title: 'Untranslated page title', description: DESCRIPTION, head: alternates };
    const result = await audit(
      site({
        'dist/en/index.html': page({ path: '/en/', ...shared, links: ['/fr/'] }),
        'dist/fr/index.html': page({ path: '/fr/', ...shared, links: ['/en/'] }),
        'dist/sitemap.xml': sitemap('/', '/about/', '/en/', '/fr/'),
      }),
      { seo: { orphans: false } },
    );
    assert.equal(find(result, /duplicate/), undefined);
  });

  it('treats pages canonical to another page as duplicates by design', async () => {
    const copy = {
      title: 'Page /about/ of the site',
      description: `${DESCRIPTION} /about/`,
      canonical: `${SITE}/about/`,
    };
    const unlisted = await audit(
      site({ 'dist/mirror/about/index.html': page({ path: '/mirror/about/', ...copy }) }),
    );
    assert.deepEqual(unlisted.findings, []);

    const listed = await audit(
      site({
        'dist/mirror/about/index.html': page({ path: '/mirror/about/', ...copy }),
        'dist/sitemap.xml': sitemap('/', '/about/', '/mirror/about/'),
      }),
    );
    assert.deepEqual(find(listed, /non-canonical page in the sitemap/)?.where, ['/mirror/about/']);
    assert.equal(find(listed, /duplicate/), undefined);
  });

  it('gives every finding a fix', async () => {
    const alt = (lang: string, href: string) =>
      `<link rel="alternate" hreflang="${lang}" href="${href}">`;
    const broken = await audit(
      site({
        'dist/index.html': page({
          path: '/',
          lang: null,
          title: 'Same title here',
          body: '',
          links: ['/about/', '/a/', '/b/', '/c/', '/d/', '/e/', '/it/', '/draft/'],
          head:
            alt('en', `${SITE}/`) +
            alt('it', `${SITE}/it/`) +
            alt('it', '/it/') +
            alt('fr', `${SITE}/fr/`),
        }),
        'dist/about/index.html': page({
          path: '/about/',
          title: 'Same title here',
          description: 'Too short',
          body: '<h1>a</h1><h1>b</h1>',
          links: ['/'],
        }),
        'dist/a/index.html': page({
          path: '/a/',
          title: null,
          description: null,
          canonical: '/a/',
        }),
        'dist/b/index.html': page({ path: '/b/', title: 'x', canonical: 'https://other.com/b/' }),
        'dist/c/index.html': page({
          path: '/c/',
          description: DESCRIPTION,
          canonical: `${SITE}/gone/`,
        }),
        'dist/d/index.html': page({ path: '/d/', canonical: [`${SITE}/d/`, `${SITE}/`] }),
        'dist/e/index.html': page({ path: '/e/', description: DESCRIPTION, canonical: null }),
        'dist/it/index.html': page({ path: '/it/', lang: 'it', head: alt('it', `${SITE}/it/`) }),
        'dist/draft/index.html': page({
          path: '/draft/',
          head: '<meta name="robots" content="noindex">',
        }),
        'dist/lonely.html': page({ path: '/lonely.html' }),
        'dist/sitemap.xml': sitemap('/', '/a/', '/b/', '/draft/', '/gone/').replace(
          '</urlset>',
          '<url><loc>/relative/</loc></url><url><loc>https://other.com/</loc></url></urlset>',
        ),
        'dist/robots.txt': 'User-agent: *\nDisallow: /\n',
      }),
    );
    const missing = await audit(without(site(), 'dist/robots.txt', 'dist/sitemap.xml'));
    const findings = [...broken.findings, ...missing.findings];
    assert.ok(findings.length >= 29, `only ${findings.length} findings`);
    for (const finding of findings) {
      assert.ok(finding.fix?.trim(), `no fix for "${finding.message}"`);
    }
  });
});
