import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveHref, stripBase } from '../src/core/html.ts';
import { run } from '../src/index.ts';
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
});
