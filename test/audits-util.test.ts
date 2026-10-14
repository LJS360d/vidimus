import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { disallowedBy, robotsDirectives, robotsRules } from '../src/audits/seo-robots.ts';
import { fetchHeaders, groupFindings } from '../src/audits/util.ts';
import { createHeaderSource } from '../src/core/headers.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

describe('groupFindings', () => {
  it('merges findings with the same key and lists each page once', () => {
    const grouped = groupFindings();
    grouped.add({ message: 'a', fix: 'f', details: ['x'] }, '/1');
    grouped.add({ message: 'a', fix: 'f', details: ['x'] }, '/2');
    grouped.add({ message: 'a', fix: 'f', details: ['x'] }, '/1');
    grouped.add({ message: 'a', fix: 'f', details: ['y'] }, '/3');
    assert.equal(grouped.size(), 2);
    assert.deepEqual(
      grouped.values().map(({ where, details }) => ({ where, details })),
      [
        { where: ['/1', '/2'], details: ['x'] },
        { where: ['/3'], details: ['y'] },
      ],
    );
  });

  it('appends details under an explicit key and omits empty where and details', () => {
    const grouped = groupFindings();
    const options = { key: 'k', appendDetails: true };
    grouped.add({ message: 'm', fix: 'f', details: ['one'] }, null, options);
    grouped.add({ message: 'm', fix: 'f', details: ['two'] }, null, options);
    grouped.add({ message: 'n', fix: 'f' }, null);
    const [first, second] = grouped.values();
    assert.deepEqual(first?.details, ['one', 'two']);
    assert.ok(first && !('where' in first));
    assert.ok(second && !('where' in second) && !('details' in second));
  });
});

describe('fetchHeaders', () => {
  it('keeps found headers and reports failures without stopping', async () => {
    const failed: string[] = [];
    const headers = await fetchHeaders(
      [{ path: '/a' }, { path: '/b' }, { path: '/c' }],
      async (path) => {
        if (path === '/b') throw new Error('down');
        return path === '/a' ? { x: '1' } : undefined;
      },
      (path) => failed.push(path),
    );
    assert.deepEqual([...headers], [['/a', { x: '1' }]]);
    assert.deepEqual(failed, ['/b']);
  });
});

describe('robots.txt rules', () => {
  const robots = robotsRules(`User-agent: *
Disallow: /private/
Allow: /private/ok
Disallow: /*.pdf$

User-agent: Googlebot-News
User-agent: BadBot
Disallow: /

Sitemap: https://example.com/sitemap.xml # trailing`);

  it('collects sitemaps and agents that are blocked entirely', () => {
    assert.deepEqual(robots.sitemaps, ['https://example.com/sitemap.xml']);
    assert.deepEqual(robots.blocked, ['Googlebot-News', 'BadBot']);
  });

  it('prefers the Googlebot group, then the wildcard group, longest match first', () => {
    const star = robotsRules(
      'User-agent: *\nDisallow: /private/\nAllow: /private/ok\nDisallow: /*.pdf$',
    );
    const blocked = disallowedBy(star.groups);
    assert.equal(blocked('/private/x'), true);
    assert.equal(blocked('/private/ok'), false);
    assert.equal(blocked('/doc.pdf'), true);
    assert.equal(blocked('/doc.pdf?x=1'), false);
    assert.equal(blocked('/public'), false);
    assert.equal(disallowedBy(robots.groups)('/anything'), true);
    assert.equal(
      disallowedBy(
        robotsRules('User-agent: Googlebot\nDisallow: /g\nUser-agent: *\nDisallow: /').groups,
      )('/x'),
      false,
    );
  });

  it('breaks a tie between equally long rules in favour of Allow', () => {
    const groups = robotsRules('User-agent: *\nDisallow: /a\nAllow: /a').groups;
    assert.equal(disallowedBy(groups)('/a'), false);
  });

  it('reads X-Robots-Tag directives, ignoring other crawlers', () => {
    assert.deepEqual(robotsDirectives('noindex, nofollow'), ['noindex', 'nofollow']);
    assert.deepEqual(robotsDirectives('bingbot: noindex, googlebot: nofollow'), ['nofollow']);
    assert.deepEqual(robotsDirectives('unavailable_after: 25 Jun 2030 15:00:00 PST'), [
      'unavailable_after: 25 jun 2030 15:00:00 pst',
    ]);
  });
});

describe('host header config parsers', () => {
  const headersOf = (files: Record<string, string>, path: string) => {
    const root = fixture({ ...files, 'dist/.keep': '' });
    const source = createHeaderSource(root, `${root}/dist`, '_headers', '');
    return source.for(path).then((headers) => ({ headers, source }));
  };

  it('reads staticwebapp.config.json global headers and per-route headers', async () => {
    const config = JSON.stringify({
      globalHeaders: { 'X-Global': 'g' },
      routes: [{ route: '/api/*', headers: { 'X-Api': 'a' } }, { route: '/nohdr' }],
    });
    const { headers, source } = await headersOf({ 'staticwebapp.config.json': config }, '/api/x');
    assert.deepEqual(headers, { 'x-global': 'g', 'x-api': 'a' });
    assert.deepEqual(await source.for('/other'), { 'x-global': 'g' });
    assert.deepEqual(source.sources, ['staticwebapp.config.json']);
  });

  it('reads firebase.json with one hosting object or an array of them', async () => {
    const rule = { source: '/docs/**', headers: [{ key: 'X-Docs', value: 'd' }] };
    const single = await headersOf(
      { 'firebase.json': JSON.stringify({ hosting: { headers: [rule] } }) },
      '/docs/a/b',
    );
    assert.deepEqual(single.headers, { 'x-docs': 'd' });
    const multi = await headersOf(
      {
        'firebase.json': JSON.stringify({
          hosting: [{ headers: [rule] }, { headers: [{ ...rule, source: '/x' }] }],
        }),
      },
      '/x',
    );
    assert.deepEqual(multi.headers, { 'x-docs': 'd' });
    assert.deepEqual(await single.source.for('/else'), {});
  });

  it('reads netlify.toml headers with quoted keys, single-quoted values and several blocks', async () => {
    const toml = `[build]
  publish = "dist"

[[headers]]
  for = "/*"
  [headers.values]
    "X-Quoted" = "q"
    X-Single = 'single value'

[[headers]]
  for = "/app/*"
  [headers.values]
    X-App = "app"
`;
    const { headers, source } = await headersOf({ 'netlify.toml': toml }, '/app/page');
    assert.deepEqual(headers, { 'x-quoted': 'q', 'x-single': 'single value', 'x-app': 'app' });
    assert.deepEqual(await source.for('/x'), { 'x-quoted': 'q', 'x-single': 'single value' });
  });

  it('notes patterns it cannot express and invalid files', async () => {
    const config = JSON.stringify({
      headers: [{ source: '/(a|b)/{x}', headers: [{ key: 'X-A', value: '1' }] }],
    });
    const { source } = await headersOf({ 'vercel.json': config, 'firebase.json': '{' }, '/');
    assert.ok(
      source.notes.some((note) => note.startsWith('ignored 1 unsupported patterns in vercel.json')),
    );
    assert.ok(source.notes.some((note) => note.startsWith('firebase.json: invalid JSON')));
  });
});

describe('security audit when the origin cannot be reached', () => {
  it('reports each page whose headers could not be fetched, once', async () => {
    const stub = mock.method(globalThis, 'fetch', async () => {
      throw new Error('connect ECONNREFUSED');
    });
    try {
      const cwd = fixture({
        'dist/index.html': '<!doctype html><title>t</title>',
        'dist/about/index.html': '<!doctype html><title>t</title>',
        'dist/_headers': '',
      });
      const { results } = await run({
        cwd,
        env: {},
        audits: ['security'],
        reporters: [],
        overrides: {
          origin: 'https://example.test',
          security: { csp: false, securityTxt: false },
        },
      });
      const finding = results[0]?.findings.find((f) => f.message === 'could not fetch headers');
      assert.deepEqual(finding?.where?.toSorted(), ['/', '/about/']);
      assert.deepEqual(finding?.details, ['connect ECONNREFUSED']);
      assert.match(finding?.fix ?? '', /https:\/\/example\.test is up/);
    } finally {
      stub.mock.restore();
    }
  });
});
