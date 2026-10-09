import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import {
  classifyRequest,
  firstPartyHostsOf,
  isFirstPartyCookie,
  knownService,
  requestFix,
} from '../src/audits/privacy.ts';
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

const listen = (server: Server, host: string, port = 0) =>
  new Promise<number>((resolve) =>
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port)),
  );

const freePort = async () => {
  const probe = createServer();
  const port = await listen(probe, '127.0.0.1');
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

describe('privacy helpers', () => {
  const hosts = firstPartyHostsOf('http://localhost:4322', 'https://www.example.com');

  it('treats the audit origin and siteUrl hosts as first-party', () => {
    assert.equal(classifyRequest('http://localhost:4322/app.js', hosts, []), 'first-party');
    assert.equal(classifyRequest('https://www.example.com/og.png', hosts, []), 'first-party');
    assert.equal(classifyRequest('https://example.com/og.png', hosts, []), 'third-party');
  });

  it('ignores an empty siteUrl', () => {
    assert.deepEqual([...firstPartyHostsOf('http://localhost:1', '')], ['localhost']);
  });

  it('flags other hosts unless an allow pattern matches the full URL', () => {
    const font = 'https://fonts.googleapis.com/css2?family=Inter';
    assert.equal(classifyRequest(font, hosts, []), 'third-party');
    assert.equal(classifyRequest(font, hosts, ['^https://fonts\\.googleapis\\.com/']), 'allowed');
    assert.equal(classifyRequest(font, hosts, ['family=Roboto']), 'third-party');
  });

  it('ignores data:, blob: and other non-network URLs', () => {
    assert.equal(classifyRequest('data:image/png;base64,AAAA', hosts, []), 'ignored');
    assert.equal(classifyRequest('blob:http://localhost:4322/uuid', hosts, []), 'ignored');
    assert.equal(classifyRequest('chrome-extension://abc/x.js', hosts, []), 'ignored');
  });

  it('labels known services by hostname suffix', () => {
    assert.match(knownService('fonts.gstatic.com') ?? '', /self-host/);
    assert.match(knownService('www.youtube.com') ?? '', /youtube-nocookie/);
    assert.match(knownService('i.ytimg.com') ?? '', /YouTube/);
    assert.match(knownService('region1.google-analytics.com') ?? '', /Google Analytics/);
    assert.match(knownService('cdn.jsdelivr.net') ?? '', /CDN/);
    assert.equal(knownService('notyoutube.com'), undefined);
    assert.equal(knownService('cdn.example.org'), undefined);
  });

  it('suggests a service-specific fix for known hosts and a generic one otherwise', () => {
    assert.match(requestFix('fonts.gstatic.com'), /fontsource/);
    assert.match(requestFix('www.youtube.com'), /youtube-nocookie\.com/);
    assert.equal(requestFix('cdn.jsdelivr.net'), 'Bundle or self-host the file.');
    assert.match(requestFix('cdn.example.org'), /privacy\.allow/);
  });

  it('matches cookie domains against first-party hosts', () => {
    assert.equal(isFirstPartyCookie('localhost', hosts), true);
    assert.equal(isFirstPartyCookie('.example.com', hosts), true);
    assert.equal(isFirstPartyCookie('.doubleclick.net', hosts), false);
  });
});

describe('privacy audit', () => {
  it('reports third-party hosts and first-party cookies', { skip: noBrowser }, async () => {
    const thirdParty = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end('body{color:red}');
    });
    const thirdPartyPort = await listen(thirdParty, '127.0.0.2');
    after(() => thirdParty.close());

    const page = `<!doctype html>
<html lang="en"><head><title>t</title>
<link rel="stylesheet" href="http://127.0.0.2:${thirdPartyPort}/x.css">
<script>document.cookie = 'a=1; path=/'</script>
</head><body><p>hi</p></body></html>`;
    const cwd = fixture({ 'dist/index.html': page, 'dist/about/index.html': page });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['privacy'],
      reporters: [],
      overrides: { port: await freePort(), privacy: { wait: 100 } },
    });
    const result = results[0];
    assert.equal(result?.status, 'failed');
    assert.equal(result?.summary, '2 pages, 1 third-party host(s), 1 cookie(s)');
    const [request, cookie] = result?.findings ?? [];
    assert.equal(request?.message, 'third-party request to 127.0.0.2');
    assert.deepEqual(request?.where, ['/', '/about/']);
    assert.deepEqual(request?.details, [`http://127.0.0.2:${thirdPartyPort}/x.css`]);
    assert.equal(cookie?.message, 'cookie a set on load (127.0.0.1)');
    assert.equal(cookie?.severity, 'warn');
    assert.match(request?.fix ?? '', /privacy\.allow/);
    assert.match(cookie?.fix ?? '', /after consent/);
    for (const finding of result?.findings ?? []) assert.ok(finding.fix?.trim(), finding.message);
  });

  it('reports storage written on load', { skip: noBrowser }, async () => {
    const writer = `<!doctype html><html lang="en"><head><title>t</title>
<script>localStorage.setItem('theme','dark');sessionStorage.setItem('sid','1');indexedDB.open('appdb')</script>
</head><body><p>hi</p></body></html>`;
    const quiet =
      '<!doctype html><html lang="en"><head><title>t</title></head><body>hi</body></html>';
    const check = async (page: string) => {
      const cwd = fixture({ 'dist/index.html': page });
      const { results } = await run({
        cwd,
        env: {},
        audits: ['privacy'],
        reporters: [],
        overrides: { port: 0, privacy: { wait: 100 } },
      });
      return results[0];
    };
    const found = await check(writer);
    const byMessage = (m: string) => found?.findings.find((f) => f.message === m);
    assert.deepEqual(byMessage('localStorage written on load')?.details, ['theme']);
    assert.deepEqual(byMessage('sessionStorage written on load')?.details, ['sid']);
    assert.deepEqual(byMessage('indexedDB written on load')?.details, ['appdb']);
    for (const finding of found?.findings ?? []) assert.match(finding.fix ?? '', /consent/);
    assert.equal((await check(quiet))?.findings.length, 0);
  });

  it('flags third-party preconnect and dns-prefetch hints', { skip: noBrowser }, async () => {
    const page = `<!doctype html><html lang="en"><head><title>t</title>
<link rel="preconnect" href="http://127.0.0.2:9/">
<link rel="dns-prefetch" href="//127.0.0.3:9">
<link rel="preconnect" href="/">
<link rel="preconnect" href="http://127.0.0.4:9/">
</head><body><p>hi</p></body></html>`;
    const cwd = fixture({ 'dist/index.html': page });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['privacy'],
      reporters: [],
      overrides: {
        port: 0,
        privacy: { wait: 0, allow: ['^http://127\\.0\\.0\\.4:9/'] },
      },
    });
    const result = results[0];
    const hints = (result?.findings ?? []).filter((f) =>
      f.message.startsWith('third-party resource hint'),
    );
    assert.deepEqual(
      hints.map((f) => f.message),
      ['third-party resource hint to 127.0.0.2', 'third-party resource hint to 127.0.0.3'],
    );
    assert.deepEqual(hints[0]?.details, ['preconnect http://127.0.0.2:9/']);
    assert.deepEqual(hints[1]?.details, ['dns-prefetch http://127.0.0.3:9/']);
    assert.equal(hints[0]?.severity, 'warn');
    assert.equal(result?.findings.length, 2);
    for (const finding of hints) assert.match(finding.fix ?? '', /remove|consent/);
  });

  it('reports what remains after the reject button is clicked', { skip: noBrowser }, async () => {
    const thirdParty = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    const thirdPartyPort = await listen(thirdParty, '127.0.0.2');
    after(() => thirdParty.close());
    const page = `<!doctype html><html lang="en"><head><title>t</title></head><body>
<button id="reject" onclick="fetch('http://127.0.0.2:${thirdPartyPort}/t', {mode: 'no-cors'})">Reject</button>
<script>document.cookie = 'track=1; path=/'</script></body></html>`;
    const check = async (rejectSelector: string) => {
      const cwd = fixture({ 'dist/index.html': page });
      const { results } = await run({
        cwd,
        env: {},
        audits: ['privacy'],
        reporters: [],
        overrides: { port: 0, privacy: { wait: 100, rejectSelector } },
      });
      return results[0]?.findings ?? [];
    };
    const found = await check('#reject');
    const messages = found.map((f) => f.message);
    assert.ok(messages.includes('third-party request to 127.0.0.2 after rejecting consent'));
    assert.ok(messages.includes('cookie track (127.0.0.1) still set after rejecting consent'));
    const missing = await check('#nope');
    const warn = missing.find((f) => f.message === 'reject button not found: #nope');
    assert.equal(warn?.severity, 'warn');
    assert.ok(!missing.some((f) => f.message.includes('after rejecting')));
    for (const finding of [...found, ...missing]) assert.ok(finding.fix?.trim(), finding.message);
  });

  it('follows the top-level allLocales', { skip: noBrowser }, async () => {
    const page =
      '<!doctype html><html lang="en"><head><title>t</title></head><body>hi</body></html>';
    const cwd = fixture({ 'dist/index.html': page, 'dist/fr/index.html': page });
    const summary = async (allLocales: boolean) => {
      const { results } = await run({
        cwd,
        env: {},
        audits: ['privacy'],
        reporters: [],
        overrides: {
          port: await freePort(),
          locales: ['en', 'fr'],
          defaultLocale: 'en',
          allLocales,
          privacy: { wait: 0 },
        },
      });
      return results[0]?.summary ?? '';
    };
    assert.match(await summary(false), /^1 pages?\b/);
    assert.match(await summary(true), /^2 pages\b/);
  });
});
