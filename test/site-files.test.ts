import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adsTxtRecords } from '../src/audits/site-files.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const ONLY_SITE_FILES = { favicon: false, manifest: false, openGraph: false, notFound: false };

const page = (body = '<p>hi</p>', head = '') =>
  `<!doctype html><head><title>t</title>${head}</head><body>${body}</body>`;

const audit = async (
  files: Record<string, string>,
  assets = {},
  siteUrl = 'https://example.com',
) => {
  const cwd = fixture({
    'vidimus.config.json': JSON.stringify({ siteUrl, assets: { ...ONLY_SITE_FILES, ...assets } }),
    ...files,
  });
  const { results } = await run({ cwd, env: {}, audits: ['assets'], reporters: [] });
  const result = results[0];
  assert.ok(result);
  return {
    ...result,
    messages: result.findings.map(({ message, severity }) => `${severity ?? 'error'}: ${message}`),
  };
};

const ADSENSE =
  '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"></script>';

describe('ads.txt parser', () => {
  it('keeps records, skips comments and variables, reports malformed lines', () => {
    const { records, invalid } = adsTxtRecords(`# ads.txt
contact=ads@example.com
google.com, pub-1, DIRECT, f08c47fec0942fa0
AppNexus.com, 99, reseller # comment
nonsense
example.com, 2, MAYBE
`);
    assert.deepEqual(records, [
      { domain: 'google.com', account: 'pub-1' },
      { domain: 'appnexus.com', account: '99' },
    ]);
    assert.deepEqual(invalid, ['line 5: nonsense', 'line 6: example.com, 2, MAYBE']);
  });
});

describe('site files detected from the pages', () => {
  it('asks for nothing on a plain site', async () => {
    const result = await audit({ 'dist/index.html': page() });
    assert.deepEqual(result.messages, []);
  });

  it('warns without ads.txt when a page loads an ad network', async () => {
    const result = await audit({
      'dist/index.html': page(),
      'dist/blog/index.html': page('<ins class="adsbygoogle"></ins>', ADSENSE),
    });
    assert.deepEqual(result.messages, ['warn: no /ads.txt on a site that shows ads']);
    assert.deepEqual(result.findings[0]?.where, ['/blog/']);
  });

  it('ignores advertiser pixels', async () => {
    const pixel = '<script src="https://www.googleadservices.com/pagead/conversion.js"></script>';
    const result = await audit({ 'dist/index.html': page('', pixel) });
    assert.deepEqual(result.messages, []);
  });

  it('checks ads.txt lists the AdSense publisher of the pages', async () => {
    const good = await audit({
      'dist/index.html': page('', ADSENSE),
      'dist/ads.txt': 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n',
    });
    assert.deepEqual(good.messages, []);
    const other = await audit({
      'dist/index.html': page('', ADSENSE),
      'dist/ads.txt': 'google.com, pub-9, DIRECT\nbroken line\n',
    });
    assert.deepEqual(other.messages, [
      'error: ads.txt has malformed lines',
      'error: ads.txt does not list AdSense publisher pub-1234567890123456',
    ]);
    assert.match(other.findings[1]?.fix ?? '', /google\.com, pub-1234567890123456, DIRECT/);
  });

  it('validates an app-ads.txt that exists, and requires ads.txt when on', async () => {
    const result = await audit(
      { 'dist/index.html': page(), 'dist/app-ads.txt': '# nothing yet\n' },
      { adsTxt: 'on' },
    );
    assert.deepEqual(result.messages, [
      'warn: no /ads.txt on a site that shows ads',
      'error: app-ads.txt has no records',
    ]);
    const off = await audit(
      { 'dist/index.html': page('', ADSENSE), 'dist/app-ads.txt': '' },
      { adsTxt: 'off' },
    );
    assert.deepEqual(off.messages, []);
  });

  it('warns without change-password when a page has a password field', async () => {
    const result = await audit({
      'dist/login/index.html': page('<input type="password" autocomplete="current-password">'),
      'dist/account/index.html': page('<input autocomplete="new-password">'),
      'dist/index.html': page(),
    });
    assert.deepEqual(result.messages, [
      'warn: no /.well-known/change-password on a site with password fields',
    ]);
    assert.deepEqual(result.findings[0]?.where, ['/account/', '/login/']);
    assert.match(result.findings[0]?.fix ?? '', /change-password \/account\/ 302/);
  });

  it('accepts change-password as a file or a _redirects rule', async () => {
    const login = page('<input type="password">');
    const redirect = await audit({
      'dist/index.html': login,
      'dist/_redirects': '# rules\n/.well-known/change-password  /account/  302\n',
    });
    assert.deepEqual(redirect.messages, []);
    const file = await audit({
      'dist/index.html': login,
      'dist/.well-known/change-password/index.html': page(),
    });
    assert.deepEqual(file.messages, []);
  });

  it('asks for app association files when the site points at its apps', async () => {
    const result = await audit({
      'dist/index.html': page(
        '',
        '<meta name="apple-itunes-app" content="app-id=123"><link rel="alternate" href="android-app://com.example.app/https/example.com/">',
      ),
    });
    assert.deepEqual(result.messages, [
      'warn: no /.well-known/apple-app-site-association for the iOS app',
      'warn: no /.well-known/assetlinks.json for the Android app',
    ]);
  });

  it('reads related_applications from a linked manifest', async () => {
    const result = await audit({
      'dist/index.html': page('', '<link rel="manifest" href="/site.webmanifest">'),
      'dist/site.webmanifest': JSON.stringify({
        related_applications: [{ platform: 'play', id: 'com.example.app' }],
      }),
    });
    assert.deepEqual(result.messages, [
      'warn: no /.well-known/assetlinks.json for the Android app',
    ]);
  });

  it('validates the app association files it finds', async () => {
    const head =
      '<meta name="apple-itunes-app" content="app-id=1"><meta name="google-play-app" content="app-id=x">';
    const valid = await audit({
      'dist/index.html': page('', head),
      'dist/.well-known/apple-app-site-association': JSON.stringify({ applinks: { details: [] } }),
      'dist/.well-known/assetlinks.json': JSON.stringify([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: { namespace: 'android_app' },
        },
      ]),
    });
    assert.deepEqual(valid.messages, []);
    const invalid = await audit({
      'dist/index.html': page('', head),
      'dist/apple-app-site-association': '{"apps": []}',
      'dist/.well-known/assetlinks.json': '[]',
    });
    assert.deepEqual(invalid.messages, [
      'error: apple-app-site-association is not valid',
      'error: assetlinks.json is not valid',
    ]);
  });

  it('skips root files when the site is under a base path', async () => {
    const result = await audit(
      { 'dist/index.html': page('<input type="password">', ADSENSE) },
      {},
      'https://example.com/docs/',
    );
    assert.deepEqual(result.messages, []);
    assert.ok(result.log.some((line) => line.includes('root file checks skipped')));
  });

  it('rejects an unknown mode', async () => {
    await assert.rejects(
      audit({ 'dist/index.html': page() }, { adsTxt: 'maybe' }),
      /assets\.adsTxt/,
    );
  });
});
