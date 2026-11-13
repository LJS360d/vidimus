import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const executable = await import('puppeteer').then(
  ({ default: puppeteer }) => puppeteer.executablePath(),
  () => '',
);
const noBrowser = !executable || !existsSync(executable);

describe('links skip', () => {
  it('checks absolute self-links against the build when external links are off', async () => {
    const cwd = fixture({
      'dist/index.html': '<title>home</title><h1>x</h1><a href="https://example.org/old/">old</a>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 0, siteUrl: 'https://example.org', links: { checkExternal: false } },
    });
    assert.deepEqual(
      results[0]?.findings.map(({ message }) => message.replace(/:\d+/, '')),
      ['404 http://127.0.0.1/old/'],
    );
  });
  it('skips look-alike hosts that share the audit origin as a string prefix', async () => {
    const cwd = fixture({
      'dist/index.html':
        '<title>home</title><h1>x</h1><a href="http://127.0.0.1:47210/x">lookalike</a>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 4721, links: { checkExternal: false } },
    });
    assert.deepEqual(results[0]?.findings, []);
    assert.match(results[0]?.summary ?? '', /^1 links checked/);
  });
});

describe('links options', () => {
  it('warns on redirects when warnRedirects is on', async () => {
    const cwd = fixture({
      'dist/index.html': '<title>home</title><h1>x</h1><a href="/new">new</a>',
      'dist/new/index.html': '<title>new</title><h1>x</h1>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 0, links: { checkExternal: false, warnRedirects: true } },
    });
    const [finding] = results[0]?.findings ?? [];
    assert.equal(finding?.severity, 'warn');
    assert.match(finding?.message ?? '', /^redirect .*\/new /);
  });
});

describe('links count', () => {
  it('does not count skipped links', async () => {
    const cwd = fixture({
      'dist/index.html':
        '<title>home</title><h1>x</h1><a href="https://example.com/a">a</a><a href="/b">b</a>',
      'dist/b/index.html': '<title>b</title><h1>x</h1>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 0, links: { checkExternal: false } },
    });
    assert.match(results[0]?.summary ?? '', /^3 links checked/);
  });
});

describe('links fragments', () => {
  it('ignores a malformed percent-encoding in a fragment, as browsers do', async () => {
    const cwd = fixture({
      'dist/index.html': '<title>home</title><h1>x</h1><a href="/target/#%E0%A4%A">bad</a>',
      'dist/target/index.html': '<title>target</title><h1>x</h1>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 0, links: { checkExternal: false, checkFragments: true } },
    });
    assert.deepEqual(results[0]?.findings, []);
  });
  it('accepts Text Fragment directives and still checks the page behind them', async () => {
    const cwd = fixture({
      'dist/index.html':
        '<title>home</title><h1>x</h1><a href="/target/#:~:text=hello">t</a><a href="/missing/#:~:text=x">m</a>',
      'dist/target/index.html': '<title>target</title><h1>x</h1><p>hello</p>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 0, links: { checkExternal: false, checkFragments: true } },
    });
    assert.deepEqual(
      results[0]?.findings.map(({ message }) => message.replace(/http:\/\/[^/]+/, '')),
      ['404 /missing/'],
    );
  });
  it('still reports a missing page behind a malformed fragment', async () => {
    const cwd = fixture({
      'dist/index.html':
        '<title>home</title><h1>x</h1><a href="/missing/#%E0%A4%A">bad</a><a href="/#%E0%A4%A">ok</a>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 0, links: { checkExternal: false, checkFragments: true } },
    });
    assert.deepEqual(
      results[0]?.findings.map(({ message }) => message.replace(/http:\/\/[^/]+/, '')),
      ['404 /missing/#%E0%A4%A'],
    );
  });
  it('counts a permalink href as a fragment target (documented gap)', async () => {
    const cwd = fixture({
      'dist/index.html': '<title>home</title><h1>x</h1><a href="/target/#ghost">ghost</a>',
      'dist/target/index.html':
        '<title>target</title><h1>x</h1><a id="x" href="#ghost">permalink</a>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 0, links: { checkExternal: false, checkFragments: true } },
    });
    assert.deepEqual(results[0]?.findings, []);
  });
});

describe('links base', () => {
  it('uses the first <base> with an href even after a <base> without one', async () => {
    const cwd = fixture({
      'dist/guide/p/index.html':
        '<title>p</title><h1>x</h1><base target="_blank"><base href="/docs/"><a href="rel/x">x</a>',
      'dist/index.html': '<title>home</title><h1>x</h1><a href="/guide/p/">p</a>',
      'dist/docs/rel/x/index.html': '<title>x</title><h1>x</h1>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { port: 0, links: { checkExternal: false } },
    });
    assert.deepEqual(results[0]?.findings, []);
  });
});

describe('links not-found routes', { skip: noBrowser }, () => {
  it('checks a dotted route such as /release-1.2 for a not-found view', async () => {
    const cwd = fixture({
      'dist/index.html': '<title>home</title><div id="root"></div><script src="/app.js"></script>',
      'dist/app.js':
        "const root = document.getElementById('root'); root.innerHTML = location.pathname === '/' ? '<h1>Home</h1><a href=\"/release-1.2\">r</a>' : '<h1 class=\"not-found\">Not found</h1>'; root.dataset.ready = '';",
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: {
        port: 0,
        server: { fallback: 'index.html' },
        render: { mode: 'on', waitFor: '#root[data-ready]' },
        links: { notFound: { selector: '.not-found' }, retry: false, checkExternal: false },
      },
    });
    assert.deepEqual(
      results[0]?.findings.map(({ message }) => message),
      ['not-found view /release-1.2'],
    );
  });
});
