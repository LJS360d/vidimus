import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { frameAllowed, parsePolicy } from '../src/core/csp.ts';
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

const page = (head: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Embeds on a page of the site</title>
${head}
</head>
<body><h1>Embeds</h1>${body}</body>
</html>`;

const audit = async (name: string, files: Record<string, string>, overrides = {}) => {
  const { results } = await run({
    cwd: fixture(files),
    env: {},
    audits: [name],
    reporters: [],
    overrides: { port: 0, ...overrides },
  });
  const [result] = results;
  assert.ok(result);
  return result;
};

describe('CSP frame sources', () => {
  const self = new URL('https://example.com');
  const allowed = (policy: string, url: string) =>
    frameAllowed(parsePolicy(policy), new URL(url), self).allowed;

  it('follows frame-src, then child-src, then default-src', () => {
    assert.equal(frameAllowed(parsePolicy("img-src 'self'"), self, self).directive, '');
    assert.equal(
      frameAllowed(parsePolicy("default-src 'self'"), self, self).directive,
      'default-src',
    );
    assert.equal(
      frameAllowed(parsePolicy("default-src 'none'; child-src *"), self, self).directive,
      'child-src',
    );
  });

  it('matches self, wildcards, schemes, ports and paths', () => {
    assert.equal(allowed("frame-src 'self'", 'https://example.com/a'), true);
    assert.equal(allowed("frame-src 'self'", 'https://other.com/'), false);
    assert.equal(allowed("frame-src 'none'", 'https://example.com/'), false);
    assert.equal(allowed('frame-src *', 'https://any.test/'), true);
    assert.equal(allowed('frame-src https:', 'https://any.test/'), true);
    assert.equal(allowed('frame-src https:', 'http://any.test/'), false);
    assert.equal(allowed('frame-src *.youtube.com', 'https://www.youtube.com/embed/x'), true);
    assert.equal(allowed('frame-src *.youtube.com', 'https://youtube.com/embed/x'), false);
    assert.equal(allowed('frame-src http://maps.test', 'https://maps.test/'), true);
    assert.equal(allowed('frame-src maps.test:8080', 'https://maps.test:8080/'), true);
    assert.equal(allowed('frame-src maps.test', 'https://maps.test:8080/'), false);
    assert.equal(allowed('frame-src codepen.io/embed/', 'https://codepen.io/embed/abc'), true);
    assert.equal(allowed('frame-src codepen.io/embed/', 'https://codepen.io/pen/abc'), false);
    assert.equal(allowed('frame-src codepen.io/a', 'https://codepen.io/a'), true);
  });
});

describe('embeds in dist audits', () => {
  const embeds = page(
    `<meta http-equiv="content-security-policy" content="frame-src 'self' https://www.youtube-nocookie.com; style-src 'self'">`,
    `<iframe src="https://www.youtube-nocookie.com/embed/abc" title="Video"></iframe>
<iframe src="https://evil.example/widget" title="Widget"></iframe>
<iframe src="https://www.youtube-nocookie.com/embed/def" title="Sandboxed" sandbox="allow-scripts"></iframe>
<iframe src="/same.html" title="Same origin"></iframe>
<iframe src="/same.html"></iframe>
<iframe srcdoc="&lt;style&gt;p{color:red}&lt;/style&gt;&lt;p&gt;inline&lt;div&gt;&lt;/p&gt;" title="Srcdoc"></iframe>`,
  );
  const files = {
    'dist/index.html': embeds,
    'dist/same.html': page('', '<p>same</p>'),
    'dist/headers/index.html': page('', '<iframe src="/same.html" title="Same"></iframe>'),
  };

  it('csp checks frame-src, sandbox and srcdoc inline blocks', async () => {
    const result = await audit('csp', files, {
      server: {
        headers: [
          { match: '^/headers/', headers: { 'Content-Security-Policy': "frame-src 'none'" } },
        ],
      },
    });
    const messages = result.findings.map(({ message, severity, where }) => [
      message,
      severity ?? 'error',
      where ?? [],
    ]);
    assert.deepEqual(messages.filter(([message]) => !String(message).startsWith('inline')).sort(), [
      ['<iframe> from /same.html is blocked by frame-src', 'error', ['/headers/']],
      ['<iframe> from https://evil.example is blocked by frame-src', 'error', ['/']],
      ['third-party <iframe> from https://evil.example without sandbox', 'warn', ['/']],
      ['third-party <iframe> from https://www.youtube-nocookie.com without sandbox', 'warn', ['/']],
    ]);
    assert.ok(
      result.findings.some(({ message }) =>
        /^inline <style> in <iframe srcdoc> has no CSP hash/.test(message),
      ),
    );
  });

  it('csp.sandbox off drops the sandbox warnings', async () => {
    const result = await audit('csp', files, { csp: { sandbox: false } });
    assert.ok(!result.findings.some(({ message }) => message.includes('sandbox')));
  });

  it('html validates srcdoc markup and requires an iframe title', async () => {
    const result = await audit('html', files);
    const byRule = (rule: string) =>
      result.findings.find(({ message }) => message.startsWith(rule));
    assert.ok(byRule('close-order')?.details?.some((line) => line.includes('/ <iframe srcdoc>')));
    assert.match(byRule('element-required-attributes')?.message ?? '', /<iframe>.*"title"/);
  });
});

describe('embeds in browser audits', { skip: noBrowser }, () => {
  let external = '';
  const upstream = createServer((req, res) => {
    if (req.url === '/tracker.js')
      return void res.writeHead(200, { 'content-type': 'text/javascript' }).end('1');
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><title>embed</title><script src="/tracker.js"></script>embed');
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

  it('privacy reports the embed origin and requests made inside the frame', async () => {
    const result = await audit('privacy', {
      'dist/index.html': page('', `<iframe src="${external}/embed" title="Video"></iframe>`),
    });
    const [finding] = result.findings;
    assert.equal(finding?.message, 'third-party embed from 127.0.0.1');
    assert.equal(finding?.details?.[0], 'loaded in an <iframe> on page load');
    assert.ok(finding?.details?.includes(`${external}/tracker.js`));
    assert.match(finding?.fix ?? '', /click-to-load facade/);
  });

  it('r12s reports overflow on phones, with an embed hint for fixed-size iframes', async () => {
    const result = await audit(
      'r12s',
      {
        'dist/index.html': page(
          '',
          '<iframe src="/same.html" width="560" height="315" title="x"></iframe>',
        ),
        'dist/wide.html': page('', '<div style="width:600px">wide</div>'),
        'dist/same.html': page('', '<p>same</p>'),
      },
      { r12s: { viewports: [375] } },
    );
    const overflow = result.findings.filter(({ message }) => message.startsWith('overflow'));
    const iframe = overflow.find(({ where }) => where?.includes('/'));
    assert.match(iframe?.fix ?? '', /aspect-ratio/);
    const wide = overflow.find(({ where }) => where?.includes('/wide.html'));
    assert.match(wide?.fix ?? '', /max-width:100%/);
  });

  it('a11y reports an iframe without a title', async () => {
    const result = await audit('a11y', {
      'dist/index.html': page('', '<iframe src="/same.html"></iframe>'),
      'dist/same.html': page('', '<p>same</p>'),
    });
    assert.ok(result.findings.some(({ details }) => details?.some((line) => /H64/.test(line))));
  });

  it('a11y reports a page it could not audit in time', async () => {
    const result = await audit(
      'a11y',
      { 'dist/index.html': page('', '<p>slow</p>') },
      { a11y: { timeout: 1 } },
    );
    assert.match(result.findings[0]?.message ?? '', /^failed to audit \/: /);
  });
});
