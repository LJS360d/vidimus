import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const browserPath = async () => {
  try {
    const { default: puppeteer } = await import('puppeteer');
    return await puppeteer.executablePath();
  } catch {
    return '';
  }
};

const executable = await browserPath();
const noBrowser = !executable || !existsSync(executable);

const SHELL = `<!doctype html>
<html lang="en">
<head><meta http-equiv="content-security-policy" content="style-src 'self'"></head>
<body><div id="root"></div><script src="/app.js"></script></body>
</html>`;

// A client-rendered app: head tags, an injected <style>, nav links and a not-found view.
const app = (external: string, padding = 0) => `
const pages = { '/': 'Home page of the rendered app', '/a': 'Page A of the rendered app' };
const title = pages[location.pathname];
document.title = title ?? 'Not found';
const meta = document.createElement('meta');
meta.name = 'description';
meta.content = 'A perfectly reasonable description that is long enough for search engines.';
document.head.append(meta);
const style = document.createElement('style');
style.textContent = '.x { color: red }';
document.head.append(style);
fetch('/model.glb');
const root = document.getElementById('root');
root.innerHTML = title
  ? '<h1>' + title + '</h1><a href="/a">a</a><a href="/missing">missing</a><a href="${external}/gone">gone</a>'
  : '<h1 class="not-found">Not found</h1>';
root.dataset.ready = '';
/* ${'x'.repeat(padding)} */
`;

describe('rendered DOM', { skip: noBrowser }, () => {
  let external = '';
  const upstream = createServer((req, res) => {
    res.writeHead(req.url === '/gone' ? 404 : 200).end('ok');
  });

  before(
    () =>
      new Promise<void>((resolve) =>
        upstream.listen(0, '127.0.0.1', () => {
          external = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
          resolve();
        }),
      ),
  );
  after(() => new Promise((resolve) => upstream.close(resolve)));

  const audit = async (name: string, overrides: Record<string, unknown>, padding = 0) => {
    const cwd = fixture({
      'dist/index.html': SHELL,
      'dist/app.js': app(external, padding),
      'dist/model.glb': 'g'.repeat(40_000),
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: [name],
      reporters: [],
      overrides: {
        port: 0,
        siteUrl: 'https://example.com',
        server: { fallback: 'index.html' },
        render: { waitFor: '#root[data-ready]' },
        ...overrides,
      },
    });
    const [result] = results;
    assert.ok(result);
    return result;
  };
  const messages = (result: { findings: { message: string }[] }) =>
    result.findings.map(({ message }) => message);

  it('seo reads the head and headings the app renders', async () => {
    const shell = messages(await audit('seo', {}));
    assert.ok(shell.includes('missing <title>'));
    assert.ok(shell.includes('missing meta description'));
    assert.ok(shell.includes('no <h1>'));
    const rendered = messages(
      await audit('seo', { render: { mode: 'on', waitFor: '#root[data-ready]' } }),
    );
    assert.ok(!rendered.includes('missing <title>'));
    assert.ok(!rendered.includes('missing meta description'));
    assert.ok(!rendered.includes('no <h1>'));
  });

  it('seeds browser.state before the page scripts run', async () => {
    const cwd = fixture({
      'dist/index.html': `<!doctype html><html lang="en"><body><div id="root"></div>
<script>
document.title = [localStorage.getItem('consent'), sessionStorage.getItem('tab'),
  document.cookie, window.injected].join(' ');
document.body.dataset.ready = '';
</script></body></html>`,
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['seo'],
      reporters: [],
      overrides: {
        port: 0,
        siteUrl: 'https://example.com',
        render: { mode: 'on', waitFor: 'body[data-ready]' },
        // Only the fully seeded title, 'denied two c=1 yes', is 18 characters long.
        seo: { titleLength: { min: 18, max: 18 } },
        browser: {
          state: {
            localStorage: { consent: 'denied' },
            sessionStorage: { tab: 'two' },
            cookies: [{ name: 'c', value: '1' }],
            script: 'window.injected = "yes"',
          },
        },
      },
    });
    const messages = results[0]?.findings.map(({ message }) => message) ?? [];
    assert.ok(
      !messages.some((message) => message.startsWith('title outside')),
      messages.join('\n'),
    );
  });

  it('renders only the pages render.include matches', async () => {
    const rendered = { mode: 'on', waitFor: '#root[data-ready]' };
    const skipped = messages(
      await audit('seo', { render: { ...rendered, include: ['^/other/'] } }),
    );
    assert.ok(skipped.includes('missing <title>'));
    const matched = messages(await audit('seo', { render: { ...rendered, include: ['^/$'] } }));
    assert.ok(!matched.includes('missing <title>'));
  });

  it('turns rendering on in auto mode for a one-page build with a large bundle', async () => {
    const auto = { render: { mode: 'auto', waitFor: '#root[data-ready]' } };
    assert.ok(messages(await audit('seo', auto)).includes('missing <title>'));
    assert.ok(!messages(await audit('seo', auto, 120_000)).includes('missing <title>'));
  });

  it('csp sees inline styles injected at runtime', async () => {
    assert.equal((await audit('csp', {})).findings.length, 0);
    const rendered = messages(
      await audit('csp', { render: { mode: 'on', waitFor: '#root[data-ready]' } }),
    );
    assert.equal(rendered.length, 1);
    assert.match(rendered[0] ?? '', /inline <style> has no CSP hash/);
  });

  it('budget counts what the browser fetched', async () => {
    const budget = { page: 5_000, html: 0, css: 0, js: 0, image: 0 };
    const shell = await audit('budget', { budget });
    assert.ok(!shell.findings.some(({ details }) => details?.some((d) => d.includes('model.glb'))));
    const rendered = await audit('budget', {
      budget,
      render: { mode: 'on', waitFor: '#root[data-ready]' },
    });
    assert.ok(
      rendered.findings.some(({ details }) => details?.some((d) => d.includes('/model.glb'))),
    );
  });

  it('links checks rendered links and not-found views', async () => {
    const options = {
      render: { mode: 'on', waitFor: '#root[data-ready]' },
      links: { notFound: { selector: '.not-found' }, retry: false },
    };
    const result = await audit('links', options);
    assert.deepEqual(result.findings.map(({ message, where }) => [message, where]).sort(), [
      [`404 ${external}/gone`, ['/']],
      ['not-found view /missing', ['/']],
    ]);
    const shell = await audit('links', { links: { retry: false } });
    assert.deepEqual(shell.findings, []);
  });
});
