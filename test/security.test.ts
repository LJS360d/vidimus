import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { headersFor, parseHeadersFile, securityTxtFields } from '../src/audits/security.ts';
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

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const securityTxt = (expires = inDays(180)) =>
  `Contact: mailto:security@example.com\nExpires: ${expires}\n`;
const WELL_KNOWN = 'dist/.well-known/security.txt';

const audit = async (files: Record<string, string | undefined>, overrides = {}) => {
  const cwd = fixture(
    Object.fromEntries(
      Object.entries({ [WELL_KNOWN]: securityTxt(), ...files }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  );
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

describe('security.txt', () => {
  const txt = async (files: Record<string, string | undefined>, config = {}) =>
    audit({
      'dist/index.html': page(),
      'dist/_headers': GOOD_HEADERS,
      'vidimus.config.json': JSON.stringify(config),
      ...files,
    });
  const findings = (result: { findings: { message: string; severity?: string }[] }) =>
    result.findings.map(({ message, severity }) => `${severity ?? 'error'}: ${message}`);

  it('parses fields, repeated ones and PGP-signed files', () => {
    const fields = securityTxtFields(`-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA256

# comment
Contact: mailto:a@example.com
contact: https://example.com/security
Expires: 2030-01-01T00:00:00Z
-----BEGIN PGP SIGNATURE-----
Version: x
`);
    assert.deepEqual(fields.get('contact'), [
      'mailto:a@example.com',
      'https://example.com/security',
    ]);
    assert.deepEqual(fields.get('expires'), ['2030-01-01T00:00:00Z']);
    assert.equal(fields.get('version'), undefined);
  });

  it('warns when there is none', async () => {
    const result = await txt({ [WELL_KNOWN]: undefined });
    assert.equal(result.status, 'warned');
    assert.deepEqual(findings(result), ['warn: no /.well-known/security.txt']);
    assert.match(result.findings[0]?.fix ?? '', /securityTxt/);
  });

  it('warns about a security.txt in the root only', async () => {
    const result = await txt({ [WELL_KNOWN]: undefined, 'dist/security.txt': securityTxt() });
    assert.deepEqual(findings(result), ['warn: security.txt is not under /.well-known/']);
  });

  it('requires Contact and Expires', async () => {
    const result = await txt({ [WELL_KNOWN]: 'Preferred-Languages: en\n' });
    assert.equal(result.status, 'failed');
    assert.deepEqual(findings(result), [
      'error: security.txt has no Contact field',
      'error: security.txt has no Expires field',
    ]);
  });

  it('checks Contact URIs', async () => {
    const result = await txt({
      [WELL_KNOWN]: `Contact: security@example.com\nContact: http://example.com/sec\nContact: tel:+1-201-555-0123\nExpires: ${inDays(30)}\n`,
    });
    assert.deepEqual(findings(result), [
      'error: security.txt Contact "security@example.com" is not a mailto:, tel: or https:// URI',
      'error: security.txt Contact "http://example.com/sec" is not a mailto:, tel: or https:// URI',
    ]);
  });

  it('checks Expires', async () => {
    const expired = await txt({ [WELL_KNOWN]: securityTxt('2020-01-01T00:00:00Z') });
    assert.deepEqual(findings(expired), ['error: security.txt expired on 2020-01-01T00:00:00Z']);
    const far = inDays(400);
    const distant = await txt({ [WELL_KNOWN]: securityTxt(far) });
    assert.deepEqual(findings(distant), [
      `warn: security.txt Expires ${far} is more than a year away`,
    ]);
    const garbled = await txt({ [WELL_KNOWN]: securityTxt('soon') });
    assert.deepEqual(findings(garbled), ['error: security.txt Expires "soon" is not a date']);
    const twice = await txt({ [WELL_KNOWN]: `${securityTxt()}Expires: ${inDays(10)}\n` });
    assert.deepEqual(findings(twice), ['error: security.txt has more than one Expires field']);
  });

  it('is skipped when turned off or when the site is under a base path', async () => {
    const off = await txt({ [WELL_KNOWN]: undefined }, { security: { securityTxt: false } });
    assert.deepEqual(findings(off), []);
    const based = await txt({ [WELL_KNOWN]: undefined }, { siteUrl: 'https://example.com/docs/' });
    assert.deepEqual(findings(based), []);
    assert.ok(based.log.some((line) => line.includes('security.txt check skipped')));
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

describe('security audit following redirects', () => {
  let server: Server;
  let origin = '';

  before(async () => {
    server = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(301, { location: '/home/' }).end();
        return;
      }
      if (req.url === '/away/') {
        res.writeHead(302, { location: 'https://elsewhere.invalid/' }).end();
        return;
      }
      res
        .writeHead(200, {
          'strict-transport-security': 'max-age=31536000',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'permissions-policy': 'camera=()',
          'x-frame-options': 'DENY',
        })
        .end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('checks the headers of the page a same-origin redirect leads to', async () => {
    const result = await audit(
      { 'dist/index.html': page(), 'dist/away/index.html': page(), 'dist/_headers': '' },
      { origin },
    );
    const onHome = result.findings.filter(({ where }) => where?.includes('/'));
    assert.deepEqual(onHome, []);
    assert.ok(result.findings.some(({ where }) => where?.includes('/away/')));
  });
});
