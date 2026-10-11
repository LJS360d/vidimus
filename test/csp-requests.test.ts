import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePolicy, requestAllowed } from '../src/core/csp.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const audit = async (files: Record<string, string>, overrides = {}) => {
  const { results } = await run({
    cwd: fixture(files),
    env: {},
    audits: ['csp'],
    reporters: [],
    overrides,
  });
  const [result] = results;
  assert.ok(result);
  return result;
};

const page = (policy: string, body = '') =>
  `<!doctype html><meta http-equiv="content-security-policy" content="${policy}">${body}`;

describe('requestAllowed', () => {
  const self = new URL('http://vidimus.invalid');
  const check = (policy: string, kind: string, url: string) =>
    requestAllowed(parsePolicy(policy), kind, new URL(url), self);

  it('falls back through the directive chain', () => {
    assert.equal(
      check("default-src 'self'", 'connect', 'https://api.example.com').directive,
      'default-src',
    );
    assert.equal(
      check("connect-src 'self'; default-src *", 'connect', 'https://api.example.com').allowed,
      false,
    );
    assert.equal(
      check("script-src 'self'", 'worker', 'https://x.example/w.js').directive,
      'script-src',
    );
    assert.equal(check("img-src 'self'", 'connect', 'https://x.example').directive, '');
    assert.equal(check("form-action 'self'", 'form', 'https://x.example/post').allowed, false);
  });

  it("'self' covers same-host websockets, strict-dynamic skips script hosts", () => {
    assert.equal(check("connect-src 'self'", 'connect', 'ws://vidimus.invalid/live').allowed, true);
    assert.equal(
      check("script-src 'strict-dynamic' 'nonce-a'", 'script', 'https://x.example/a.js').allowed,
      true,
    );
  });
});

describe('csp audit: requests the code can make', () => {
  const messages = (result: Awaited<ReturnType<typeof audit>>) =>
    result.findings.map(({ message, severity }) => [message, severity ?? 'error']);

  it('finds fetch, WebSocket and bare URLs in an external bundle', async () => {
    const result = await audit({
      'dist/index.html': page(
        "default-src 'self'",
        '<script type="module" src="/app.js"></script>',
      ),
      'dist/app.js': `import "./chunk.js";
fetch("https://translations.example.com/api/en");
fetch("/local.json");
new WebSocket("wss://live.example.com/socket");
const API = "https://cms.example.com";
const NS = "http://www.w3.org/2000/svg";`,
      'dist/chunk.js': ['navigator.sendBeacon(`https://beacon.example.net/', '$', '{id}`);'].join(
        '',
      ),
    });
    assert.deepEqual(
      messages(result).sort(),
      [
        ['WebSocket to wss://live.example.com is blocked by default-src', 'error'],
        ['fetch() to https://translations.example.com is blocked by default-src', 'error'],
        ['https://cms.example.com appears in the code and would be blocked by default-src', 'warn'],
        ['sendBeacon() to https://beacon.example.net is blocked by default-src', 'error'],
      ].sort(),
    );
  });

  it('passes when connect-src lists the origins', async () => {
    const result = await audit({
      'dist/index.html': page(
        "default-src 'self'; script-src 'unsafe-inline'; connect-src 'self' https://api.example.com",
        '<script>fetch("https://api.example.com/x"); fetch("/y")</script>',
      ),
    });
    assert.equal(result.findings.length, 0);
  });

  it('checks images, fonts and stylesheets, including CSS imports', async () => {
    const result = await audit({
      'dist/index.html': page(
        "default-src 'self'; style-src 'self'; form-action 'self'",
        '<link rel="stylesheet" href="/a.css"><img src="https://img.example.com/a.png"><form action="https://pay.example.com"></form>',
      ),
      'dist/a.css': '@import "/b.css"; @font-face{src:url(https://fonts.example.com/f.woff2)}',
      'dist/b.css': 'body{background:url("https://cdn.example.com/bg.jpg")}',
    });
    assert.deepEqual(
      messages(result)
        .map(([message]) => message)
        .sort(),
      [
        '<form action> to https://pay.example.com is blocked by form-action'.replace(
          'default-src',
          'default-src',
        ),
        '<img> to https://img.example.com is blocked by default-src',
        '@font-face to https://fonts.example.com is blocked by default-src',
        'CSS url() to https://cdn.example.com is blocked by default-src',
      ].sort(),
    );
  });

  it('reads CSPs from server headers and honors csp.ignore and csp.requests', async () => {
    const files = {
      'dist/index.html': '<!doctype html><script>fetch("https://api.example.com/x")</script>',
    };
    const headers = [{ match: '.*', headers: { 'Content-Security-Policy': "connect-src 'self'" } }];
    const found = await audit(files, { server: { headers } });
    assert.equal(found.findings.length, 1);
    const ignored = await audit(files, {
      server: { headers },
      csp: { ignore: ['api\\.example\\.com'] },
    });
    assert.equal(ignored.findings.length, 0);
    const off = await audit(files, { server: { headers }, csp: { requests: false } });
    assert.equal(off.status, 'skipped');
  });
});
