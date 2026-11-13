import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { subtractBaseline } from '../src/core/findings.ts';
import type { AuditStatus } from '../src/core/types.ts';
import { createReporters, loadConfig, type RunReport, runAudits } from '../src/index.ts';
import { annotation, github } from '../src/reporters/github.ts';
import { toHtml } from '../src/reporters/html.ts';
import { toJUnit } from '../src/reporters/junit.ts';
import { pretty, progressLine } from '../src/reporters/pretty.ts';
import { toSarif } from '../src/reporters/sarif.ts';
import { fixture } from './helpers.ts';

const report: RunReport = {
  schemaVersion: 1,
  totals: {
    errors: 0,
    warnings: 0,
    suppressed: 0,
    audits: { passed: 0, warned: 0, failed: 0, errored: 0, skipped: 0 },
  },
  ok: false,
  origin: 'http://localhost:4322',
  distDir: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 1500,
  staleBaseline: 0,
  results: [
    {
      name: 'csp',
      status: 'passed',
      summary: 'all hashed',
      findings: [],
      suppressed: 0,
      log: [],
      durationMs: 10,
    },
    {
      name: 'links',
      status: 'failed',
      summary: '1 broken',
      findings: [{ message: '404 <https://x.test/?a=1&b=2>', where: ['/en/'] }],
      suppressed: 0,
      log: [],
      durationMs: 20,
    },
    {
      name: 'a11y',
      status: 'errored',
      summary: 'pa11y missing',
      findings: [],
      suppressed: 0,
      log: [],
      durationMs: 1,
    },
    {
      name: 'i18n',
      status: 'skipped',
      summary: 'not configured',
      findings: [],
      suppressed: 0,
      log: [],
      durationMs: 0,
    },
  ],
};

describe('html reporter', () => {
  it('escapes untrusted text and lists audits and fixes', () => {
    const out = toHtml({
      ...report,
      results: [
        ...report.results,
        {
          name: 'evil',
          status: 'failed',
          summary: 's',
          suppressed: 0,
          log: [],
          durationMs: 1,
          findings: [
            {
              message: '<script>alert("x")</script> & \'q\'',
              where: ['/a?x=<b>&y="1"'],
              fix: 'do the fix',
            },
          ],
        },
      ],
    });
    assert.match(out, /^<!doctype html>/);
    assert.ok(!out.includes('<script>'));
    assert.ok(!out.includes('<b>'));
    assert.match(out, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;q&#39;/);
    assert.match(out, /\/a\?x=&lt;b&gt;&amp;y=&quot;1&quot;/);
    assert.match(out, /do the fix/);
    for (const { name } of report.results) assert.ok(out.includes(name));
  });

  it('ships a CSP meta that blocks scripts and external resources', () => {
    const out = toHtml(report);
    assert.match(
      out,
      /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">/,
    );
  });
});

describe('sarif reporter', () => {
  it('maps findings to results with levels and locations', () => {
    const withFiles: RunReport = {
      ...report,
      results: [
        {
          name: 'links',
          status: 'failed',
          summary: '2 findings',
          suppressed: 0,
          log: [],
          durationMs: 1,
          findings: [
            { message: 'broken', file: 'dist/a.html', line: 7, fix: 'repair it' },
            { message: 'meh', severity: 'warn' },
          ],
        },
      ],
    };
    const log = toSarif(withFiles);
    assert.equal(log.version, '2.1.0');
    const results = log.runs[0]?.results ?? [];
    assert.equal(results.length, 2);
    assert.equal(results[0]?.ruleId, 'links');
    assert.equal(results[0]?.level, 'error');
    assert.match(results[0]?.message?.text ?? '', /fix: repair it/);
    assert.deepEqual(results[0]?.locations?.[0]?.physicalLocation, {
      artifactLocation: { uri: 'dist/a.html', uriBaseId: '%SRCROOT%' },
      region: { startLine: 7 },
    });
    assert.equal(results[1]?.level, 'warning');
    assert.equal(results[1]?.locations, undefined);
  });

  it('gives every rule the short, full and help text GitHub requires', () => {
    const log = toSarif({
      ...report,
      results: [
        {
          name: 'links',
          status: 'passed',
          summary: 'all good',
          findings: [],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    const [rule] = log.runs[0]?.tool.driver.rules ?? [];
    const text = 'no broken internal links, assets or external targets';
    assert.equal(rule?.id, 'links');
    assert.equal(rule?.shortDescription.text, text);
    assert.equal(rule?.fullDescription.text, text);
    assert.equal(rule?.help.text, text);
  });
});

describe('junit reporter', () => {
  it('counts results and escapes XML', () => {
    const xml = toJUnit(report);
    assert.match(xml, /<testsuites name="vidimus" tests="4" failures="1" errors="1" skipped="1"/);
    assert.match(xml, /404 &lt;https:\/\/x\.test\/\?a=1&amp;b=2&gt;/);
    assert.match(xml, /<error message="pa11y missing" type="error"\/>/);
    assert.match(xml, /<skipped message="not configured"\/>/);
  });

  it('writes the suite attributes and elements Ant JUnit.xsd requires', () => {
    const xml = toJUnit(report);
    const suites = xml.match(/<testsuite [^>]*>/g) ?? [];
    assert.equal(suites.length, 4);
    suites.forEach((tag, index) => {
      assert.match(tag, new RegExp(`package="vidimus" id="${index}"`));
      // xs:dateTime without a zone, per the XSD pattern.
      assert.match(tag, /timestamp="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d" hostname="[^"]+"/);
    });
    assert.equal(xml.match(/<testsuite [^>]*>\n {4}<properties\/>/g)?.length, 4);
    assert.equal(xml.match(/<system-out\/>\n {4}<system-err\/>\n {2}<\/testsuite>/g)?.length, 4);
    for (const tag of xml.match(/<testcase [^>]*>/g) ?? []) assert.match(tag, / time="\d+\.\d{3}"/);
  });

  it('counts errored audit findings as errors, not failures', () => {
    const xml = toJUnit({
      ...report,
      results: [
        {
          name: 'a11y',
          status: 'errored',
          summary: 'did not finish',
          findings: [{ message: 'did not finish' }],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    assert.equal(xml.match(/<failure\b/g)?.length ?? 0, 0);
    assert.equal(xml.match(/<error\b/g)?.length ?? 0, 1);
    assert.match(xml, /<testsuites [^>]*tests="1" failures="0" errors="1"/);
    assert.match(xml, /<testsuite name="a11y" [^>]*failures="0" errors="1"/);
  });
});

describe('junit reporter with warnings', () => {
  it('keeps warnings out of the failure count', () => {
    const xml = toJUnit({
      ...report,
      results: [
        {
          name: 'seo',
          status: 'warned',
          summary: '1 warning',
          findings: [{ message: 'title too long', severity: 'warn' }],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    assert.match(xml, /failures="0"/);
    assert.match(xml, /<system-out>warning: <\/system-out>/);
  });
});

describe('junit reporter edge cases', () => {
  it('keeps characters outside the BMP and drops invalid control characters', () => {
    const xml = toJUnit({
      ...report,
      results: [
        {
          name: 'seo',
          status: 'failed',
          summary: 'x',
          findings: [{ message: 'rocket 🚀 bell \u0007' }],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    assert.match(xml, /rocket 🚀 bell "/);
  });

  it('keeps newlines in attribute values as character references (XML §3.3.3)', () => {
    const xml = toJUnit({
      ...report,
      results: [
        {
          name: 'seo',
          status: 'failed',
          summary: 'x',
          findings: [{ message: 'a\nb\tc\rd' }],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    assert.match(xml, /message="a&#10;b&#9;c&#13;d"/);
  });
});

describe('github reporter', () => {
  it('escapes workflow command data and properties', () => {
    assert.equal(
      annotation('vidimus a:b', 'line 1\nline 2 100%'),
      '::error title=vidimus a%3Ab::line 1%0Aline 2 100%25\n',
    );
    assert.equal(annotation('t', 'm', undefined, 'warning'), '::warning title=t::m\n');
    assert.equal(
      annotation('t', 'm', join('/repo', 'site', 'dist', 'a.html'), 'error', '/repo'),
      '::error file=site/dist/a.html,title=t::m\n',
    );
    assert.equal(
      annotation('t', 'm', join('dist', 'a.html'), 'error', '/elsewhere/repo'),
      '::error file=dist/a.html,title=t::m\n',
    );
  });
});

const COLOR = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, 'g');

const sink = (isTTY = false) => {
  const chunks: string[] = [];
  const stream = Object.assign(new PassThrough(), {
    isTTY,
    columns: 80,
  }) as unknown as NodeJS.WriteStream;
  stream.write = ((chunk: string) => chunks.push(String(chunk)) > 0) as NodeJS.WriteStream['write'];
  return { stream, text: () => chunks.join('').replace(COLOR, '') };
};

describe('pretty reporter', () => {
  it('prints findings, warnings and a closing line', async () => {
    const { stream, text } = sink();
    const reporter = pretty(stream);
    await reporter.onStart?.({
      audits: ['links'],
      origin: 'http://localhost:1',
      serving: 'dist',
      notes: ['looks like a client-rendered app'],
    });
    for (const result of report.results) await reporter.onAuditEnd?.(result);
    await reporter.onAuditEnd?.({
      name: 'seo',
      status: 'warned',
      summary: 'long title',
      findings: [
        {
          message: 'title too long',
          severity: 'warn',
          file: '/x/index.html',
          fix: 'shorten the <title>',
        },
      ],
      suppressed: 2,
      log: ['checked 3 pages'],
      durationMs: 5,
    });
    await reporter.onEnd?.(report);
    const output = text();
    assert.match(output, /serving dist on http:\/\/localhost:1/);
    assert.match(output, /vidimus: looks like a client-rendered app/);
    assert.match(output, /✖ 404 <https:\/\/x\.test\/\?a=1&b=2>/);
    assert.match(output, /⚠ title too long/);
    assert.match(output, /→ shorten the <title>/);
    assert.match(output, /2 ignored or accepted/);
    assert.match(output, /failed: links, a11y/);
  });
});

describe('pretty footer', () => {
  it('counts only passed audits as passed, not warned ones', async () => {
    const { stream, text } = sink();
    const reporter = pretty(stream);
    const results: RunReport['results'] = [
      {
        name: 'csp',
        status: 'passed',
        summary: 'ok',
        findings: [],
        suppressed: 0,
        log: [],
        durationMs: 1,
      },
      {
        name: 'seo',
        status: 'warned',
        summary: 'long',
        findings: [],
        suppressed: 0,
        log: [],
        durationMs: 1,
      },
      {
        name: 'links',
        status: 'failed',
        summary: 'bad',
        findings: [],
        suppressed: 0,
        log: [],
        durationMs: 1,
      },
    ];
    await reporter.onEnd?.({ ...report, results });
    assert.match(text(), /vidimus: 1\/3 passed — warnings: seo — failed: links/);
  });
});

describe('progress', () => {
  it('counts items', () => {
    const line = progressLine([
      { name: 'routes', done: 0, total: 0, since: 0 },
      { name: 'shots', done: 10, total: 40, since: 0 },
      { name: 'a11y', done: 5, total: 5, since: 0 },
    ]);
    assert.equal(line, 'routes · shots 10/40 · a11y 5/5');
  });

  it('pretty redraws one line on a terminal and clears it before printing', async () => {
    const { stream, text } = sink(true);
    const reporter = pretty(stream, {});
    await reporter.onStart?.({ audits: ['shots'], origin: '', serving: undefined, notes: [] });
    reporter.onProgress?.([{ name: 'shots', done: 1, total: 4, since: Date.now() }]);
    await reporter.onAuditEnd?.(report.results[0] as RunReport['results'][number]);
    reporter.onProgress?.([]);
    const output = text();
    const clear = '\r\x1b[2K';
    assert.ok(output.startsWith(clear));
    assert.match(output, /shots 1\/4/);
    assert.ok(output.includes(`${clear}\n`));
  });
});

describe('github reporter output', () => {
  it('annotates findings and appends a step summary', () => {
    const { stream, text } = sink();
    const summary = join(fixture({}), 'summary.md');
    const reporter = github(stream, { GITHUB_STEP_SUMMARY: summary });
    for (const result of report.results) reporter.onAuditEnd?.(result);
    reporter.onEnd?.(report);
    assert.match(text(), /::error title=vidimus links::404/);
    assert.match(text(), /::error title=vidimus a11y::pa11y missing/);
    assert.match(readFileSync(summary, 'utf8'), /\| links \| failed \| 1 broken \|/);
  });

  it('keeps multi-line step summary cells on one table row', () => {
    const { stream } = sink();
    const summary = join(fixture({}), 'summary.md');
    const reporter = github(stream, { GITHUB_STEP_SUMMARY: summary });
    reporter.onEnd?.({
      ...report,
      results: [
        {
          name: 'seo',
          status: 'errored',
          summary: 'Error: bad input | x\nat line 2\r\nat line 3',
          findings: [],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    assert.match(
      readFileSync(summary, 'utf8'),
      /\| seo \| errored \| Error: bad input \\\| x<br>at line 2<br>at line 3 \|\n/,
    );
  });

  it('escapes pipes in step summary names and statuses and caps the step at 1 MiB', () => {
    const { stream } = sink();
    const summary = join(fixture({}), 'summary.md');
    const reporter = github(stream, { GITHUB_STEP_SUMMARY: summary });
    reporter.onEnd?.({
      ...report,
      results: [
        {
          name: 'a|b',
          status: 'failed|x' as AuditStatus,
          summary: 'ok',
          findings: [],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
        {
          name: 'big',
          status: 'passed',
          summary: 'z'.repeat(2 * 1024 * 1024),
          findings: [],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    const written = readFileSync(summary, 'utf8');
    assert.match(written, /\| a\\\|b \| failed\\\|x \| ok \|\n/);
    assert.ok(Buffer.byteLength(written) <= 1024 * 1024);
    assert.match(written, /truncated to fit the 1 MiB step limit/);
    assert.match(written, /\|\n\n_Summary truncated/, 'cuts at a whole row');
  });

  it('writes warnings with file, details, pages and fix, and no summary outside Actions', () => {
    const { stream, text } = sink();
    const root = fixture({});
    const reporter = github(stream, { GITHUB_WORKSPACE: root });
    reporter.onAuditEnd?.({
      name: 'seo',
      status: 'warned',
      summary: '1 problem',
      suppressed: 0,
      log: [],
      durationMs: 1,
      findings: [
        {
          message: 'title, too long: 70%',
          severity: 'warn',
          file: join(root, 'dist', 'index.html'),
          line: 7,
          details: ['line\r\nbreak'],
          where: ['/'],
          fix: 'shorten it',
        },
      ],
    });
    reporter.onEnd?.(report);
    const baseline = {
      version: 1 as const,
      findings: [{ audit: 'seo', message: 'm', file: 'a.html' }],
    };
    assert.deepEqual(
      subtractBaseline(
        root,
        'seo',
        [{ message: 'm', file: join(root, 'a.html'), line: 3 }],
        baseline,
        false,
        false,
      ),
      [],
    );
    assert.equal(
      text(),
      '::warning file=dist/index.html,line=7,title=vidimus seo::title, too long: 70%25%0Aline%0D%0Abreak%0Aon: /%0Afix: shorten it\n',
    );
  });
});

describe('createReporters', () => {
  it('builds reporters from names and adds github on Actions', () => {
    const names = (specs: string[], env: NodeJS.ProcessEnv = {}) =>
      createReporters(specs, { cwd: process.cwd(), env }).map(({ name }) => name);
    assert.deepEqual(names([]), ['pretty']);
    assert.deepEqual(names([], { GITHUB_ACTIONS: 'true' }), ['pretty', 'github']);
    assert.deepEqual(names(['pretty', 'junit:r.xml'], { GITHUB_ACTIONS: 'true' }), [
      'pretty',
      'junit',
      'github',
    ]);
    assert.deepEqual(names(['github', 'json'], { GITHUB_ACTIONS: 'true' }), ['github', 'json']);
    assert.deepEqual(names(['pretty', 'json:out.json', 'junit']), ['pretty', 'json', 'junit']);
    assert.throws(() => names(['nope']), { name: 'UsageError' });
    assert.throws(() => names(['json', 'junit']), /both write to stdout/);
    assert.deepEqual(names(['sarif:r.sarif']), ['sarif']);
    assert.throws(() => names(['json', 'sarif']), /both write to stdout/);
    assert.deepEqual(names(['html:r.html']), ['html']);
    assert.throws(() => names(['json', 'html']), /both write to stdout/);
  });

  it('passes custom reporters through even when they have a target field', () => {
    const custom = { name: 'mine', target: 'somewhere', onEnd: () => {} };
    const [reporter] = createReporters([custom], { cwd: process.cwd(), env: {} });
    assert.equal(reporter, custom);
  });

  it('writes json and junit reports to files', async () => {
    const cwd = fixture({});
    const reporters = createReporters(['json:reports/r.json', 'junit:reports/r.xml'], {
      cwd,
      env: {},
    });
    for (const reporter of reporters) await reporter.onEnd?.(report);
    assert.equal(JSON.parse(readFileSync(join(cwd, 'reports/r.json'), 'utf8')).ok, false);
    assert.match(readFileSync(join(cwd, 'reports/r.xml'), 'utf8'), /<testsuites/);
  });

  it('writes html and sarif files from object entries', async () => {
    const cwd = fixture({});
    const reporters = createReporters(
      [
        { type: 'html', file: 'out/r.html' },
        { type: 'sarif', file: 'out/r.sarif' },
      ],
      { cwd, env: {} },
    );
    for (const reporter of reporters) await reporter.onEnd?.(report);
    assert.match(readFileSync(join(cwd, 'out/r.html'), 'utf8'), /<!doctype html>/);
    assert.match(readFileSync(join(cwd, 'out/r.sarif'), 'utf8'), /"version": "2.1.0"/);
  });

  it('roots sarif locations at GITHUB_WORKSPACE, like github annotations', async () => {
    const cwd = fixture({});
    const [reporter] = createReporters(['sarif:out.sarif'], {
      cwd,
      env: { GITHUB_WORKSPACE: '/repo' },
    });
    await reporter?.onEnd?.(report);
    const run = JSON.parse(readFileSync(join(cwd, 'out.sarif'), 'utf8')).runs[0];
    assert.equal(run.originalUriBaseIds['%SRCROOT%'].uri, 'file:///repo/');
    assert.equal(run.invocations[0].workingDirectory.uri, 'file:///repo/');
  });
});

describe('verbose reports', () => {
  const detailed: RunReport = {
    ...report,
    results: report.results.map((result) => ({ ...result, log: [`${result.name} log line`] })),
    detail: {
      vidimus: '0.0.0',
      node: 'v0',
      platform: 'linux',
      audits: ['csp'],
      serving: undefined,
      notes: [],
      pages: ['/en/'],
      config: { port: 1 },
      stale: [],
      suppressed: { links: [{ message: 'hidden finding' }] },
    },
  };

  it('adds log, suppressed findings and run detail only when verbose', () => {
    for (const render of [toHtml, toJUnit, toSarif]) {
      assert.doesNotMatch(JSON.stringify(render(detailed)), /hidden finding|csp log line/);
      assert.match(JSON.stringify(render(detailed, true)), /hidden finding/);
    }
    assert.match(toHtml(detailed, true), /csp log line/);
    assert.match(toHtml(detailed, true), /\/en\//);
  });

  it('is verbose unless an object says verbose: false', () => {
    const dir = fixture({});
    const reporters = createReporters(
      [
        'json:a.json',
        { type: 'json', file: 'b.json', verbose: false },
        { type: 'junit', file: 'c.xml' },
      ],
      { cwd: dir, env: {} },
    );
    for (const reporter of reporters) reporter.onEnd?.(detailed);
    const read = (file: string) => readFileSync(join(dir, file), 'utf8');
    assert.match(read('a.json'), /"detail"/);
    assert.doesNotMatch(read('b.json'), /"detail"/);
    assert.match(read('c.xml'), /hidden finding/);
  });
});

describe('config redaction', () => {
  it('keeps keys but hides state values and env assignments in the report config', async () => {
    const cwd = fixture({});
    let seen: RunReport | undefined;
    const { config } = await loadConfig({
      cwd,
      env: {},
      overrides: {
        browser: {
          state: {
            cookies: [{ name: 'sid', value: 'secret' }],
            localStorage: { token: 'secret' },
          },
        },
        server: { command: 'TOKEN=abc123 npm start -- --api-token xyz789 --port 8080' },
      },
    });
    await runAudits(
      config,
      [],
      [
        {
          name: 'spy',
          onEnd: (finished) => {
            seen = finished;
          },
        },
      ],
    );
    const text = JSON.stringify(seen?.detail?.config);
    assert.doesNotMatch(text, /secret|abc123|xyz789/);
    assert.match(text, /--api-token <redacted> --port 8080/);
    assert.match(text, /"sid"/);
    assert.match(text, /"token":"<redacted>"/);
    assert.match(text, /TOKEN=<redacted> npm start/);
  });
});

describe('sarif schema', () => {
  it('points $schema at the OASIS SARIF 2.1.0 schema per the OASIS spec', () => {
    const log = toSarif(report);
    assert.equal(
      log.$schema,
      'https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json',
    );
  });
});

describe('sarif partialFingerprints', () => {
  it('gives every result a versioned primaryLocationLineHash per SARIF 3.5.4.2', () => {
    const findings = [
      { message: 'same', file: 'dist/a.html' },
      { message: 'same', file: 'dist/a.html' },
      { message: 'other', file: 'dist/a.html' },
    ];
    const log = toSarif({
      ...report,
      results: [
        {
          name: 'links',
          status: 'failed',
          summary: 'x',
          findings,
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    const hashes = (log.runs[0]?.results ?? []).map(
      (r) => r.partialFingerprints.primaryLocationLineHash,
    );
    assert.equal(hashes.length, 3);
    for (const hash of hashes) assert.match(hash, /^[0-9a-f]{64}:\d$/);
    // Identical findings share the hash and differ in the occurrence count.
    assert.equal(hashes[0]?.replace(/:\d$/, ''), hashes[1]?.replace(/:\d$/, ''));
    assert.deepEqual(
      hashes.map((hash) => hash.slice(-2)),
      [':1', ':2', ':1'],
    );
    assert.notEqual(hashes[0], hashes[2]);
  });
});

describe('sarif locations', () => {
  it('relativises files, maps pages to dist and reports errored audits', () => {
    const log = toSarif(
      {
        ...report,
        distDir: '/repo/dist',
        results: [
          {
            name: 'seo',
            status: 'failed',
            summary: 's',
            findings: [
              { message: 'a', file: '/repo/src/a.astro' },
              { message: 'b', where: ['/blog/'] },
              { message: 'c', file: '/elsewhere/x.html' },
              { message: 'd', where: ['/../../etc/x'] },
            ],
            suppressed: 0,
            log: [],
            durationMs: 1,
          },
          {
            name: 'links',
            status: 'errored',
            summary: 'boom',
            findings: [],
            suppressed: 0,
            log: [],
            durationMs: 1,
          },
        ],
      },
      false,
      '/repo',
    );
    const run = log.runs[0];
    const uris = run?.results.map((r) => r.locations?.[0]?.physicalLocation.artifactLocation.uri);
    assert.deepEqual(uris, ['src/a.astro', 'dist/blog/index.html', undefined, undefined]);
    assert.equal(run?.originalUriBaseIds['%SRCROOT%'].uri, 'file:///repo/');
    assert.equal(run?.invocations[0]?.toolExecutionNotifications[0]?.message.text, 'links: boom');
  });

  it('percent-encodes each path segment of artifactLocation.uri per RFC 3986', () => {
    const log = toSarif(
      {
        ...report,
        results: [
          {
            name: 'links',
            status: 'failed',
            summary: 'x',
            findings: [{ message: 'a', file: 'dist/my page/a#b?.html' }],
            suppressed: 0,
            log: [],
            durationMs: 1,
          },
        ],
      },
      false,
      '/repo',
    );
    const uri = log.runs[0]?.results[0]?.locations?.[0]?.physicalLocation.artifactLocation.uri;
    assert.equal(uri, 'dist/my%20page/a%23b%3F.html');
  });

  it('places a site-wide finding without file or where on the dist index.html', () => {
    const log = toSarif(
      {
        ...report,
        distDir: '/repo/dist',
        results: [
          {
            name: 'robots',
            status: 'failed',
            summary: 'x',
            findings: [{ message: 'no robots.txt' }],
            suppressed: 0,
            log: [],
            durationMs: 1,
          },
        ],
      },
      false,
      '/repo',
    );
    assert.deepEqual(log.runs[0]?.results[0]?.locations, [
      {
        physicalLocation: { artifactLocation: { uri: 'dist/index.html', uriBaseId: '%SRCROOT%' } },
      },
    ]);
  });
});
