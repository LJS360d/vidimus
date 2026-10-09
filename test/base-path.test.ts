import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveHref } from '../src/core/html.ts';
import { pathOf, stripBase } from '../src/core/util.ts';
import { type Audit, run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const SITE = 'https://user.github.io/project';

describe('sites under a base path', () => {
  it('strips the siteUrl path from internal URLs', () => {
    assert.equal(stripBase('/project/docs/', SITE), '/docs/');
    assert.equal(stripBase('/project', SITE), '/');
    assert.equal(stripBase('/other/', SITE), '/other/');
    assert.equal(stripBase('/project/x', 'https://example.org'), '/project/x');
    assert.equal(resolveHref('/project/og.png', '/', SITE)?.path, '/og.png');
    assert.equal(resolveHref(`${SITE}/guide`, '/', SITE)?.path, '/guide');
  });

  it('does not resolve root hrefs missing the base path', async () => {
    assert.equal(resolveHref('/favicon.svg', '/', SITE)?.path, null);
    assert.equal(resolveHref('/favicon.svg', '/', 'https://example.org')?.path, '/favicon.svg');
    const cwd = fixture({ 'dist/index.html': '<title>home</title>', 'dist/favicon.svg': '<svg/>' });
    let status = 0;
    const probe: Audit = {
      name: 'probe',
      description: 'fetches a path without the base',
      async run({ origin }) {
        status = (await fetch(`${new URL(origin).origin}/favicon.svg`)).status;
        return { summary: 'ok' };
      },
    };
    await run({
      cwd,
      env: {},
      audits: ['probe'],
      reporters: [],
      overrides: { siteUrl: SITE, port: 4392, plugins: [probe] },
    });
    assert.equal(status, 404);
  });

  it('audits the built-in server through the IPv4 literal it listens on', async () => {
    const cwd = fixture({ 'dist/index.html': '<title>home</title>' });
    let host = '';
    const probe: Audit = {
      name: 'probe',
      description: 'records the origin host',
      async run({ origin }) {
        host = new URL(origin).hostname;
        return { summary: 'ok' };
      },
    };
    await run({
      cwd,
      env: {},
      audits: ['probe'],
      reporters: [],
      overrides: { port: 0, plugins: [probe] },
    });
    assert.equal(host, '127.0.0.1');
  });

  it('finds sitemap entries and assets published under the base path', async () => {
    const head = (path: string) => `<link rel="canonical" href="${SITE}${path}">
<meta name="description" content="A description that is comfortably long enough for the check of ${path}.">
<meta property="og:title" content="t"><meta property="og:image" content="${SITE}/og.png">`;
    const cwd = fixture({
      'dist/index.html': `<html lang="en"><title>Home page of the project</title>${head('/')}<h1>x</h1><a href="/project/guide">g</a>`,
      'dist/guide.html': `<html lang="en"><title>Guide page of the project</title>${head('/guide')}<h1>x</h1><a href="/project/">h</a>`,
      'dist/og.png': 'png',
      'dist/sitemap.xml': `<urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/guide</loc></url></urlset>`,
      'dist/robots.txt': `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`,
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['seo'],
      reporters: [],
      overrides: { siteUrl: SITE },
    });
    assert.deepEqual(
      results[0]?.findings.map(({ message }) => message),
      [],
    );
  });

  it('opens pages under the base path when serving the build', async () => {
    const cwd = fixture({
      'dist/index.html': '<title>home</title>',
      'dist/guide/index.html': '<title>guide</title>',
    });
    const seen: string[] = [];
    const probe: Audit = {
      name: 'probe',
      description: 'fetches every page',
      async run({ origin, pageUrls }) {
        for (const url of pageUrls()) {
          const response = await fetch(url);
          seen.push(`${response.status} ${url} ${pathOf(url, origin)}`);
        }
        return { summary: 'ok' };
      },
    };
    await run({
      cwd,
      env: {},
      audits: ['probe'],
      reporters: [],
      overrides: { siteUrl: SITE, port: 4391, plugins: [probe] },
    });
    assert.deepEqual(seen, [
      '200 http://127.0.0.1:4391/project/guide/ /guide/',
      '200 http://127.0.0.1:4391/project/ /',
    ]);
  });
});
