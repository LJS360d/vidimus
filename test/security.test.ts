import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { headersFor, parseHeadersFile } from '../src/audits/security.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const GOOD_HEADERS = `# security headers
/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=()
  Content-Security-Policy: default-src 'self'; frame-ancestors 'none'
`;

const page = (body = '<p>hi</p>') => `<!doctype html><title>t</title>${body}`;

const audit = async (files: Record<string, string>, overrides = {}) => {
  const cwd = fixture(files);
  const { results } = await run({ cwd, env: {}, audits: ['security'], reporters: [], overrides });
  const result = results[0];
  assert.ok(result);
  return result;
};

const messages = (result: { findings: { message: string }[] }) =>
  result.findings.map(({ message }) => message);

describe('_headers parser', () => {
  const rules = parseHeadersFile(`# comment
/*
  X-Frame-Options: DENY
  Link: </a.css>; rel=preload

/blog/*
  Link: </b.css>; rel=preload
  ! X-Frame-Options

/:lang/about
  X-Lang: yes

https://example.com/exact
  X-Exact: 1
`);

  it('applies splats to every path', () => {
    assert.deepEqual(headersFor(rules, '/'), {
      'x-frame-options': 'DENY',
      link: '</a.css>; rel=preload',
    });
  });

  it('joins headers from several blocks and detaches with !', () => {
    assert.deepEqual(headersFor(rules, '/blog/2024/post/'), {
      link: '</a.css>; rel=preload, </b.css>; rel=preload',
    });
  });

  it('matches one segment with a placeholder', () => {
    assert.equal(headersFor(rules, '/it/about/')['x-lang'], 'yes');
    assert.equal(headersFor(rules, '/it/x/about/')['x-lang'], undefined);
  });

  it('keeps only the path of a full URL pattern', () => {
    assert.equal(rules.at(-1)?.pattern, '/exact');
    assert.equal(headersFor(rules, '/exact')['x-exact'], '1');
  });
});

describe('security audit', () => {
  it('passes with a good _headers file', async () => {
    const result = await audit({ 'dist/index.html': page(), 'dist/_headers': GOOD_HEADERS });
    assert.equal(result.status, 'passed');
    assert.match(result.summary, /1 pages, headers from _headers, no problems/);
  });

  it('fails on missing and weak headers, grouped across pages', async () => {
    const result = await audit({
      'dist/index.html': page(),
      'dist/about/index.html': page(),
      'dist/_headers': `/*
  Strict-Transport-Security: max-age=300
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: unsafe-url
  Permissions-Policy: camera=()
`,
    });
    assert.equal(result.status, 'failed');
    const missing = result.findings.find(({ message }) => message.includes('x-content-type'));
    assert.equal(missing?.message, 'missing x-content-type-options header');
    assert.deepEqual(missing?.where, ['/about/', '/']);
    const hsts = result.findings.find(({ message }) => message.includes('strict-transport'));
    assert.deepEqual(hsts?.details, ['max-age=300']);
    assert.ok(messages(result).some((message) => message.startsWith('referrer-policy')));
  });

  it('lets require entries be disabled', async () => {
    const result = await audit({
      'dist/index.html': page(),
      'dist/_headers': GOOD_HEADERS.replace(/\s+Permissions-Policy.*/, ''),
      'vidimus.config.json': JSON.stringify({
        security: { require: { 'permissions-policy': false } },
      }),
    });
    assert.equal(result.status, 'passed');
  });

  it('requires frame-ancestors in a header, not in a meta CSP', async () => {
    const result = await audit({
      'dist/index.html': page(
        `<meta http-equiv="content-security-policy" content="frame-ancestors 'none'">`,
      ),
      'dist/_headers': GOOD_HEADERS.replace(/\s+Content-Security-Policy.*/, ''),
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(messages(result), [
      'no clickjacking protection: add CSP frame-ancestors or X-Frame-Options',
    ]);
  });

  it("warns on 'unsafe-inline' unless a hash is present, always on 'unsafe-eval'", async () => {
    const csp = (policy: string) =>
      page(`<meta http-equiv="content-security-policy" content="${policy}">`);
    const result = await audit({
      'dist/index.html': csp("script-src 'self' 'unsafe-inline'"),
      'dist/hashed/index.html': csp("script-src 'unsafe-inline' 'sha256-abc=' 'unsafe-eval'"),
      'dist/fallback/index.html': csp("default-src 'unsafe-inline'"),
      'dist/styles/index.html': csp("script-src 'self'; style-src 'unsafe-inline'"),
      'dist/_headers': GOOD_HEADERS,
    });
    assert.equal(result.status, 'warned');
    const inline = result.findings.find(({ message }) => message.includes('unsafe-inline'));
    const evals = result.findings.find(({ message }) => message.includes('unsafe-eval'));
    assert.deepEqual(inline?.where, ['/fallback/', '/']);
    assert.deepEqual(evals?.where, ['/hashed/']);
  });

  it('fails on mixed content but not on plain http links', async () => {
    const result = await audit({
      'dist/index.html': page(`<img src="http://cdn.test/a.png">
<img srcset="https://ok.test/b.png 1x, http://cdn.test/c.png 2x">
<link rel="stylesheet" href="http://cdn.test/s.css" integrity="sha384-x">
<a href="http://example.test/">external</a>`),
      'dist/other.html': page('<img src="http://cdn.test/a.png">'),
      'dist/_headers': GOOD_HEADERS,
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(messages(result), [
      'mixed content: http://cdn.test/a.png',
      'mixed content: http://cdn.test/c.png',
      'mixed content: http://cdn.test/s.css',
    ]);
    assert.deepEqual(result.findings[0]?.where, ['/', '/other.html']);
  });

  it('warns about cross-origin scripts and styles without integrity', async () => {
    const result = await audit({
      'dist/index.html': page(`<script src="https://cdn.test/lib.js"></script>
<script src="https://cdn.test/safe.js" integrity="sha384-x"></script>
<script src="/local.js"></script>
<link rel="stylesheet" href="//fonts.test/f.css">
<link rel="icon" href="https://cdn.test/icon.png">`),
      'dist/_headers': GOOD_HEADERS,
    });
    assert.equal(result.status, 'warned');
    assert.deepEqual(messages(result), [
      'cross-origin <script> without integrity: https://cdn.test/lib.js',
      'cross-origin <link> without integrity: //fonts.test/f.css',
    ]);
  });

  it('skips header checks without _headers but still checks the HTML', async () => {
    const result = await audit({
      'dist/index.html': page('<script src="http://x.test/a.js" integrity="sha384-x">'),
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(messages(result), ['mixed content: http://x.test/a.js']);
    assert.ok(result.log.some((line) => line.includes('header checks skipped')));
  });

  it('gives every finding a concrete fix', async () => {
    const result = await audit({
      'dist/index.html':
        page(`<meta http-equiv="content-security-policy" content="script-src 'unsafe-inline' 'unsafe-eval'">
<img src="http://cdn.test/a.png">
<script src="https://cdn.test/lib.js"></script>`),
      'dist/_headers': `/*
  Strict-Transport-Security: max-age=300
  Referrer-Policy: unsafe-url
`,
      'vidimus.config.json': JSON.stringify({
        security: { require: { 'x-custom': '^yes$' } },
      }),
    });
    assert.equal(result.findings.length, 10);
    for (const { message, fix } of result.findings) assert.ok(fix?.trim(), message);
    const fixOf = (text: string) =>
      result.findings.find(({ message }) => message.includes(text))?.fix ?? '';
    assert.match(fixOf('missing x-content-type'), /"X-Content-Type-Options: nosniff"/);
    assert.match(fixOf('missing x-content-type'), /_headers.*security\.require/);
    assert.match(fixOf('strict-transport'), /max-age=31536000/);
    assert.match(fixOf('x-custom'), /\^yes\$/);
    assert.match(fixOf('clickjacking'), /frame-ancestors 'self'/);
    assert.match(fixOf('mixed content'), /https:\/\//);
    assert.match(fixOf('integrity'), /crossorigin="anonymous"/);
  });

  it('is skipped when there are no pages', async () => {
    const result = await audit({ 'dist/app.js': '' });
    assert.equal(result.status, 'skipped');
  });
});

describe('security audit against a live origin', () => {
  let server: Server;
  let origin = '';
  const methods: string[] = [];

  before(async () => {
    server = createServer((req, res) => {
      methods.push(req.method ?? '');
      if (req.method === 'HEAD' && req.url === '/about/') {
        res.writeHead(405).end();
        return;
      }
      res.writeHead(200, {
        'strict-transport-security': 'max-age=31536000',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'camera=()',
        'x-frame-options': 'DENY',
        'x-powered-by': 'Express',
        server: 'nginx/1.25.3',
      });
      res.end(req.method === 'HEAD' ? undefined : 'ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('reads response headers and warns about leaky ones', async () => {
    const result = await audit(
      { 'dist/index.html': page(), 'dist/about/index.html': page(), 'dist/_headers': '' },
      { origin },
    );
    assert.equal(result.status, 'warned');
    assert.match(result.summary, /headers from http:\/\/127\.0\.0\.1/);
    assert.deepEqual(messages(result), [
      'x-powered-by header leaks the stack',
      'server header leaks a version',
    ]);
    assert.deepEqual(result.findings[1]?.details, ['nginx/1.25.3']);
    assert.equal(result.findings[0]?.where?.length, 2);
    assert.ok(methods.includes('GET'));
    assert.match(result.findings[0]?.fix ?? '', /X-Powered-By/);
    assert.match(result.findings[1]?.fix ?? '', /server_tokens off/);
  });
});
