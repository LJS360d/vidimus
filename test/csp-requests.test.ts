import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headerPolicies, parsePolicy, requestAllowed } from '../src/core/csp.ts';
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
    assert.equal(off.status, 'passed');
  });
});

describe('csp audit: several policies', () => {
  const blocked = async (head: string) => {
    const result = await audit({
      'dist/index.html': `<!doctype html>${head}<script>run()</script>`,
    });
    return result.findings.filter(({ message }) => message.startsWith('inline <script>')).length;
  };

  it('checks every meta tag and splits a comma list', async () => {
    const meta = (content: string) =>
      `<meta http-equiv="content-security-policy" content="${content}">`;
    assert.equal(await blocked(meta('default-src *') + meta("script-src 'none'")), 1);
    assert.equal(await blocked(meta("default-src *, script-src 'none'")), 1);
  });

  it('checks inline code against a CSP from _headers', async () => {
    const result = await audit({
      'dist/index.html': '<!doctype html><script>run()</script>',
      'dist/_headers': "/*\n  Content-Security-Policy: script-src 'self'",
    });
    assert.equal(
      result.findings.filter(({ message }) => message.startsWith('inline <script>')).length,
      1,
    );
  });
});

describe('policy parsing', () => {
  it('splits comma-joined policies and models base-uri', () => {
    assert.deepEqual(
      headerPolicies({
        'content-security-policy': "img-src /a,b; script-src 'self', base-uri 'none'",
      }),
      ["img-src /a,b; script-src 'self'", "base-uri 'none'"],
    );
    const self = new URL('http://vidimus.invalid');
    assert.equal(
      requestAllowed(parsePolicy("base-uri 'self'"), 'base', new URL('https://x.example/'), self)
        .allowed,
      false,
    );
  });

  it('applies script-src-elem to inline blocks', async () => {
    const result = await audit({
      'dist/index.html': page(
        "script-src 'self' 'unsafe-inline'; script-src-elem 'self' 'sha256-x'",
        '<script>a()</script>',
      ),
    });
    assert.equal(result.findings?.length, 1);
  });
});

describe('nonces', () => {
  it('accepts matching nonces and warns on a nonce shared by every page', async () => {
    const block = '<script nonce="abc">a()</script>';
    const result = await audit({
      'dist/index.html': page("script-src 'nonce-abc'", block),
      'dist/b/index.html': page("script-src 'nonce-abc'", block),
    });
    assert.deepEqual(
      result.findings?.map(({ message }) => message),
      ["nonce 'abc' is the same on every page"],
    );
  });
});

describe('csp inline grouping', () => {
  it('groups the same inline block across pages', async () => {
    const body = '<script>var a=1</script>';
    const result = await audit({
      'dist/a/index.html': page("script-src 'self'", body),
      'dist/b/index.html': page("script-src 'self'", body),
    });
    const inline = result.findings.filter(({ message }) => message.startsWith('inline'));
    assert.equal(inline.length, 1);
    assert.deepEqual(inline[0]?.where?.sort(), ['/a/', '/b/']);
  });
});
