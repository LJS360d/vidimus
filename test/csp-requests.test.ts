import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headerPolicies, metaPolicies, parsePolicy, requestAllowed } from '../src/core/csp.ts';
import { inlineBlocks } from '../src/core/requests.ts';
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

const messages = (result: Awaited<ReturnType<typeof audit>>) =>
  result.findings.map(({ message, severity }) => [message, severity ?? 'error']);

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

  it('matches ws: and scheme-less sources against wss: on an https site', () => {
    const secure = new URL('https://vidimus.invalid');
    const wss = new URL('wss://api.example.com/x');
    const checkSecure = (policy: string) =>
      requestAllowed(parsePolicy(policy), 'connect', wss, secure).allowed;
    assert.equal(checkSecure('connect-src ws:'), true);
    assert.equal(checkSecure('connect-src api.example.com'), true);
    assert.equal(checkSecure('connect-src http://api.example.com'), false);
  });

  it("'self' covers same-host websockets, strict-dynamic skips code-loaded scripts only", async () => {
    assert.equal(check("connect-src 'self'", 'connect', 'ws://vidimus.invalid/live').allowed, true);
    assert.equal(
      check("script-src 'strict-dynamic' 'nonce-a'", 'script', 'https://x.example/a.js').allowed,
      true,
    );
    const strict = parsePolicy("script-src 'strict-dynamic' 'nonce-a'");
    const app = new URL('https://x.example/a.js');
    assert.equal(requestAllowed(strict, 'script', app, self, { nonce: 'a' }).allowed, true);
    assert.equal(requestAllowed(strict, 'script', app, self, {}).allowed, false);
    const result = await audit({
      'dist/index.html': page(
        "script-src 'strict-dynamic' 'nonce-a'",
        '<script nonce="a" src="/app.js"></script><script src="https://evil.example/x.js"></script>',
      ),
      'dist/app.js': 'export {};',
    });
    assert.deepEqual(messages(result), [
      ['<script> to https://evil.example is blocked by script-src', 'error'],
    ]);
  });
});

describe('inlineBlocks: type and nonce are attributes, not data-* suffixes', () => {
  it('keeps a data-type script executable and ignores data-nonce', () => {
    assert.deepEqual(
      inlineBlocks('<script data-type="json">{"a":1}</script>').map(({ body }) => body),
      ['{"a":1}'],
    );
    assert.equal(inlineBlocks('<script data-nonce="zzz">a()</script>')[0]?.nonce, undefined);
    assert.equal(inlineBlocks('<script type="application/json">{}</script>').length, 0);
  });
});

describe('csp audit: requests the code can make', () => {
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

  it('allows same-origin requests under an https: scheme source on an https site', async () => {
    const result = await audit(
      {
        'dist/index.html': page(
          "default-src 'none'; img-src https:; connect-src wss: https:; script-src 'unsafe-inline'",
          '<img src="/a.png"><script>fetch("/api"); new WebSocket("wss://site.example/live")</script>',
        ),
      },
      { siteUrl: 'https://site.example' },
    );
    assert.deepEqual(messages(result), []);
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

  it('resolves local references against <base href> and checks image inputs', async () => {
    const result = await audit({
      'dist/index.html': page(
        "default-src 'self'; style-src 'self'",
        '<base href="/assets/"><link rel="stylesheet" href="site.css"><input type="image" src="https://img.example.com/b.png">',
      ),
      'dist/assets/site.css': 'body{background:url("https://cdn.example.com/bg.jpg")}',
    });
    assert.deepEqual(
      messages(result)
        .map(([message]) => message)
        .sort(),
      [
        '<input type=image> to https://img.example.com is blocked by default-src',
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
      // CSP3 splits on every comma: a comma in a path must be percent-encoded.
      ['img-src /a', "b; script-src 'self'", " base-uri 'none'"],
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

describe('CSP standard edge cases', () => {
  const self = new URL('https://site.example');
  it('allows an external script or stylesheet with a matching nonce', () => {
    const policy = parsePolicy("script-src 'nonce-abc'; style-src 'nonce-abc'");
    const cdn = new URL('https://cdn.example.net/a.js');
    assert.equal(requestAllowed(policy, 'script', cdn, self, { nonce: 'abc' }).allowed, true);
    assert.equal(requestAllowed(policy, 'style', cdn, self, { nonce: 'abc' }).allowed, true);
    assert.equal(requestAllowed(policy, 'script', cdn, self, { nonce: 'xyz' }).allowed, false);
    assert.equal(requestAllowed(policy, 'script', cdn, self).allowed, false);
  });

  it('keeps commas inside a <meta> policy', () => {
    assert.deepEqual(
      metaPolicies(`<meta http-equiv="content-security-policy" content="img-src a.com,b.com">`),
      ['img-src a.com,b.com'],
    );
  });

  it("ignores 'unsafe-inline' next to 'strict-dynamic'", async () => {
    const result = await audit({
      'dist/index.html': page(
        "script-src 'strict-dynamic' 'unsafe-inline'",
        '<script>a()</script><button onclick="b()">x</button>',
      ),
    });
    assert.equal(result.findings?.length, 2);
  });

  it('counts a nonce-matched block once', async () => {
    const result = await audit({
      'dist/index.html': page(
        "script-src 'nonce-a'",
        '<script nonce="a">a()</script><script nonce="a">b()</script>',
      ),
    });
    assert.match(result.summary, /\b2 inline blocks?\b/);
  });

  it('allows same-site targets named by their production host-source', async () => {
    const result = await audit(
      {
        'dist/index.html': page(
          'script-src https://site.example',
          '<script src="/app.js"></script>',
        ),
        'dist/app.js': '',
      },
      { siteUrl: 'https://site.example' },
    );
    assert.equal(result.findings?.length ?? 0, 0);
  });
});

describe('CSP hashes and handlers', () => {
  const self = new URL('https://site.example');
  const cdn = new URL('https://cdn.example.net/a.js');
  const hash = 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC';

  it('allows an external script whose integrity matches a hash source', () => {
    const policy = parsePolicy(`script-src 'self' '${hash}'`);
    assert.equal(requestAllowed(policy, 'script', cdn, self, { integrity: hash }).allowed, true);
    assert.equal(
      requestAllowed(policy, 'script', cdn, self, { integrity: `${hash} sha256-other` }).allowed,
      false,
    );
    assert.equal(requestAllowed(policy, 'script', cdn, self, { integrity: '' }).allowed, false);
    const dynamic = parsePolicy(`script-src 'strict-dynamic' '${hash}'`);
    assert.equal(requestAllowed(dynamic, 'script', cdn, self, { integrity: hash }).allowed, true);
  });

  it('treats only event handler attributes as inline script', async () => {
    const result = await audit({
      'dist/index.html': page(
        "script-src 'self'",
        '<div once="x" ontology="y" onClick="z()" onpointerdown="w()">x</div>',
      ),
    });
    assert.deepEqual(
      result.findings.map(({ message }) => message),
      [
        'inline onclick= attribute blocked by CSP',
        'inline onpointerdown= attribute blocked by CSP',
      ],
    );
  });
});

describe('request scanning depth', () => {
  it('follows a long @import chain to its end', async () => {
    const files: Record<string, string> = {
      'dist/index.html': page("style-src 'self'", '<link rel="stylesheet" href="/c0.css">'),
    };
    for (let i = 0; i < 1100; i += 1) files[`dist/c${i}.css`] = `@import "/c${i + 1}.css";`;
    files['dist/c1100.css'] = '@import "https://evil.example/x.css";';
    const result = await audit(files);
    assert.ok(
      result.findings.some(({ message }) => message.includes('https://evil.example')),
      JSON.stringify(result.findings),
    );
  });
});
