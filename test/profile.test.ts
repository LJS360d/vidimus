import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';
import {
  addSpans,
  diffProfiles,
  formatProfile,
  hintsOf,
  instrument,
  type ProfileSummary,
  profiling,
  span,
  startProfile,
  stopProfile,
} from '../src/core/profile.ts';
import { run } from '../src/index.ts';
import { pretty } from '../src/reporters/pretty.ts';
import { fixture } from './helpers.ts';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface TraceEvent {
  name: string;
  ph: string;
  tid?: number;
}

describe('profile', () => {
  it('does nothing when off', async () => {
    assert.equal(profiling(), false);
    assert.equal(await span('x', async () => 42), 42);
    const page = { goto: async () => 1 };
    assert.equal(instrument(page, 'page'), page);
  });

  it('nests spans across awaits and subtracts parallel children once', async () => {
    const out = fixture({});
    await startProfile('spans');
    const page = instrument({ goto: async (_url: string) => sleep(5) }, 'page');
    await span('audit demo', async () => {
      await Promise.all([
        span('task', () => sleep(150), { item: 'a' }),
        span('task', () => sleep(150), { item: 'b' }),
      ]);
      await page.goto('http://localhost/x/');
    });
    const summary = await stopProfile(join(out, 'profile'), out);
    assert.ok(summary);
    assert.equal(profiling(), false);
    const [audit] = summary.audits;
    assert.equal(audit?.name, 'demo');
    const row = (name: string) => audit?.rows.find((r) => r.name === name);
    assert.equal(row('task')?.count, 2);
    assert.equal(row('page.goto')?.count, 1);
    // Two 150ms tasks in parallel take ~150ms, not 300.
    assert.ok((audit?.wallMs ?? 999) < 280, String(audit?.wallMs));
    assert.deepEqual(
      audit?.pages.map((p) => p.path),
      ['/x/'],
    );

    const trace = JSON.parse(readFileSync(join(out, summary.trace), 'utf8'));
    const tasks = (trace.traceEvents as TraceEvent[]).filter((e) => e.name === 'task');
    assert.equal(tasks.length, 2);
    assert.notEqual(tasks[0]?.tid, tasks[1]?.tid, 'parallel spans get their own lanes');
    assert.equal(trace.vidimus.spans.length, summary.spans);

    const lines = diffProfiles(join(out, summary.trace), join(out, summary.trace));
    assert.match(lines[0] ?? '', /^span +before +after +change$/);
    assert.ok(lines.some((line) => line.startsWith('demo › task')));
  });

  it('profiles a run without changing its findings', async () => {
    const files = {
      'dist/index.html': '<!doctype html><html><head><title>x</title></head><body></body></html>',
    };
    const plain = await run({ cwd: fixture(files), env: {}, audits: ['seo'], reporters: [] });
    const cwd = fixture(files);
    const profiled = await run({ cwd, env: {}, audits: ['seo'], reporters: [], profile: 'spans' });
    assert.deepEqual(
      profiled.results.map((r) => r.findings),
      plain.results.map((r) => r.findings),
    );
    assert.equal(plain.profile, undefined);
    assert.equal(profiled.profile?.audits[0]?.name, 'seo');
    assert.ok(existsSync(join(cwd, profiled.profile?.trace ?? '')));
  });

  it('names every async call on wrapped browser objects', async () => {
    const out = fixture({});
    const page = {
      keyboard: { type: async (_text: string) => {} },
      evaluate: async (_fn: unknown) => 1,
      goto: async (_url: string) => {
        throw new Error('net::ERR');
      },
      url: () => 'http://localhost/',
    };
    const browser = {
      createBrowserContext: async () => ({ newPage: async () => page }),
    };
    await startProfile('spans');
    await span('audit wrap', async () => {
      const context = await instrument(browser, 'browser').createBrowserContext();
      const tab = await context.newPage();
      assert.equal(tab.url(), 'http://localhost/', 'sync calls pass straight through');
      assert.equal(tab.keyboard, tab.keyboard, 'one wrapper per object');
      assert.equal((tab as unknown as Record<symbol, unknown>)[Symbol.toStringTag], undefined);
      await tab.evaluate(() => 1);
      await tab.evaluate(42);
      await tab.keyboard.type('x');
      await tab.evaluate(function measure() {});
      await tab.evaluate(`/* injected */\n${'x'.repeat(100)}`);
      await tab.goto('http://localhost/missing/').catch(() => {});
    });
    const summary = await stopProfile(join(out, 'profile'), out, 20);
    const names = summary?.audits[0]?.rows.map((r) => r.name) ?? [];
    for (const name of [
      'browser.createBrowserContext',
      'context.newPage',
      'page.keyboard.type',
      'page.evaluate measure',
      'page.evaluate () => 1',
      'page.evaluate ',
      'page.evaluate <script 115 chars>',
      'page.goto',
    ])
      assert.ok(names.includes(name), `${name}\n${names.join('\n')}`);
    const trace = JSON.parse(readFileSync(join(out, summary?.trace ?? ''), 'utf8'));
    const goto = trace.vidimus.spans.find((s: { name: string }) => s.name === 'page.goto');
    assert.equal(goto.error, true);
    assert.equal(goto.attrs.url, 'http://localhost/missing/');
  });

  it('times Node requests, imported timings, unfinished spans and gives hints', async () => {
    const out = fixture({});
    const server = createServer((req, res) => {
      if (req.url === '/broken') req.socket.destroy();
      else res.end('ok');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await startProfile('spans');
      await span('audit busy', async () => {
        await (await fetch(`${base}/ok`)).text();
        await fetch(`${base}/broken`).catch(() => {});
        // Lighthouse-style timings on another clock are moved to start with the parent.
        const now = performance.now();
        addSpans(
          [
            { name: 'lh:gather', startTime: 1_000_000, duration: 30 },
            { name: 'lh:navigate', startTime: 1_000_005, duration: 10 },
            { name: 'import slowlib', startTime: 1_000_000, duration: 1500 },
          ],
          now,
          now + 1,
        );
        await span(
          'pool',
          () =>
            Promise.all([
              span('task', () => sleep(5), { item: 'a', waitMs: 0 }),
              span('task', () => sleep(5), { item: 'b', waitMs: 0 }),
              span('task', () => sleep(1000), { item: 'slow', waitMs: 0 }),
            ]),
          { workers: 3, items: 3 },
        );
      });
      void span('never ends', () => new Promise(() => {}));
      const summary = await stopProfile(join(out, 'profile'), out, 20);
      assert.ok(summary);
      const rows = summary.audits[0]?.rows ?? [];
      const fetches = rows.find((r) => r.name === 'fetch GET');
      assert.equal(fetches?.count, 2);
      const trace = JSON.parse(readFileSync(join(out, summary.trace), 'utf8'));
      const spans = trace.vidimus.spans as {
        id: number;
        name: string;
        parent: number;
        error?: boolean;
        attrs?: { status?: number };
      }[];
      const named = (name: string) => spans.filter((s) => s.name === name);
      assert.deepEqual(
        named('fetch GET').map((s) => s.attrs?.status ?? 'error'),
        [200, 'error'],
      );
      assert.equal(
        named('lh:navigate')[0]?.parent,
        named('lh:gather')[0]?.id,
        'imported timings nest',
      );
      assert.equal(named('never ends')[0]?.error, true);
      assert.ok(
        summary.hints.some((h) => h.includes('import slowlib took 1500ms')),
        summary.hints.join('\n'),
      );
      assert.ok(
        summary.hints.some((h) => h.includes('one item (slow)')),
        summary.hints.join('\n'),
      );
      const text = formatProfile(summary).join('\n');
      assert.match(text, /^busy +\d/m);
      assert.match(text, /pool +3 workers · 3 items/);
      assert.match(text, /^hint +/m);
    } finally {
      server.close();
    }
  });

  it('writes a CPU profile at the cpu level', () => {
    // In a child process: starting V8's profiler resets the coverage counters of this one.
    const out = fixture({});
    const profile = new URL('../src/core/profile.ts', import.meta.url).href;
    const written = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const p = await import(${JSON.stringify(profile)});
        await p.startProfile('cpu');
        await p.span('audit cpu', async () => { let x = 0; for (let i = 0; i < 1e6; i++) x += i; });
        const summary = await p.stopProfile(${JSON.stringify(join(out, 'profile'))}, ${JSON.stringify(out)});
        process.stdout.write(summary.cpuProfile);`,
      ],
      { encoding: 'utf8' },
    );
    assert.ok(JSON.parse(readFileSync(join(out, written), 'utf8')).nodes.length > 0);
  });

  it('ignores the output directory when a profiled run fails before creating it', async () => {
    const cwd = fixture({});
    await assert.rejects(run({ cwd, env: {}, audits: ['seo'], reporters: [], profile: 'spans' }));
    assert.equal(readFileSync(join(cwd, '.vidimus', '.gitignore'), 'utf8'), '*\n');
  });

  it('stops recording when a run throws, runs audits serially, prints with pretty', async () => {
    const empty = fixture({});
    await assert.rejects(
      run({ cwd: empty, env: {}, audits: ['seo'], reporters: [], profile: 'spans' }),
    );
    assert.equal(profiling(), false);

    const cwd = fixture({
      'dist/index.html': '<!doctype html><html><head><title>x</title></head><body></body></html>',
    });
    let printed = '';
    const stream = new Writable({
      write(chunk, _encoding, done) {
        printed += chunk;
        done();
      },
    }) as unknown as NodeJS.WriteStream;
    const report = await run({
      cwd,
      env: {},
      audits: ['seo', 'budget'],
      reporters: [pretty(stream)],
      profile: 'spans',
      serial: true,
    });
    const audits = report.profile?.audits ?? [];
    assert.deepEqual(
      audits.map((a) => a.name),
      ['seo', 'budget'],
    );
    assert.match(printed, /─── profile/);
    assert.match(printed, /^trace \.vidimus\/profile\/.+\.trace\.json/m);
  });

  it('diffs runs with different spans, and prints CPU profiles and unnamed pool items', async () => {
    const out = fixture({});
    const record = async (extra: boolean) => {
      await startProfile('spans');
      await span('audit a', async () => {
        await span('kept', () => sleep(5));
        if (extra) await span('added', () => sleep(5));
      });
      return join(out, (await stopProfile(join(out, String(extra)), out))?.trace ?? '');
    };
    const lines = diffProfiles(await record(false), await record(true));
    const added = lines.find((line) => line.startsWith('a › added'));
    assert.match(added ?? '', /^a › added +- +\d+ms +\+\d+ms$/);
    // Imported timings already inside the parent's window stay where they are, side by side.
    await startProfile('spans');
    await span('audit b', async () => {
      const now = performance.now();
      addSpans(
        [
          { name: 'first', startTime: now, duration: 1 },
          { name: 'second', startTime: now + 2, duration: 1 },
        ],
        now,
        now + 10,
      );
    });
    const summary = (await stopProfile(join(out, 'b'), out)) as ProfileSummary;
    const trace = JSON.parse(readFileSync(join(out, summary.trace), 'utf8'));
    const second = trace.vidimus.spans.find((s: { name: string }) => s.name === 'second');
    assert.equal(trace.vidimus.spans[second.parent].name, 'audit b');
    const text = formatProfile({
      ...summary,
      cpuProfile: 'x.cpuprofile',
      audits: [
        {
          name: 'p',
          wallMs: 1,
          workMs: 1,
          rows: [],
          pages: [],
          pools: [
            { workers: 1, items: 1, busy: 1, queuedMs: 0, meanMs: 1, slowest: { item: '', ms: 1 } },
          ],
        },
      ],
    }).join('\n');
    assert.match(text, /pool +1 workers · 1 items · busy 100% · queued 0ms$/m);
    assert.match(text, /^cpu +x\.cpuprofile/m);
  });

  it('rejects a --top that is not a positive integer as a usage error', () => {
    const cli = new URL('../src/cli.ts', import.meta.url).pathname;
    for (const top of ['abc', '-3', '1.5']) {
      const run = spawnSync(
        process.execPath,
        [cli, 'profile', 'diff', 'a.trace.json', 'b.trace.json', '--top', top],
        { encoding: 'utf8' },
      );
      assert.equal(run.status, 2);
      assert.match(run.stderr, new RegExp(`--top: "${top}" is not a positive integer`));
    }
  });

  it('diffs traces and rejects other files', () => {
    const out = fixture({ 'other.json': '{}' });
    assert.throws(
      () => diffProfiles(join(out, 'other.json'), join(out, 'other.json')),
      /not a vidimus trace/,
    );
  });

  it('marks failed spans, attributes pages once, and keeps bad URLs as they are', async () => {
    const out = fixture({});
    await startProfile('spans');
    await span('audit pages', async () => {
      await span('task', () => span('navigate', () => sleep(5), { url: 'http://x.test/a/' }), {
        url: 'http://x.test/a/',
      });
      await span('task', () => sleep(1), { url: 'not a url' });
      await assert.rejects(
        span('broken', async () => Promise.reject(new Error('boom'))),
        /boom/,
      );
    });
    const summary = await stopProfile(join(out, 'profile'), out);
    const pages = summary?.audits[0]?.pages.map((p) => p.path).sort();
    assert.deepEqual(pages, ['/a/', 'not a url']);
    const trace = JSON.parse(readFileSync(join(out, summary?.trace ?? ''), 'utf8'));
    assert.equal(
      trace.vidimus.spans.find((s: { name: string }) => s.name === 'broken').error,
      true,
    );
    assert.match(formatProfile(summary as ProfileSummary).join('\n'), /slowest pages .*\/a\/ \d/);
  });

  it('hints at saturated pools, garbage collection and a CPU-bound process', () => {
    const hints = hintsOf({
      trace: 't',
      wallMs: 1000,
      spans: 1,
      overheadMs: 0,
      setup: [],
      audits: [
        {
          name: 'r12s',
          wallMs: 1000,
          workMs: 4000,
          rows: [],
          pages: [],
          pools: [
            {
              workers: 4,
              items: 40,
              busy: 0.95,
              queuedMs: 9000,
              meanMs: 100,
              slowest: { item: 'x', ms: 120 },
            },
          ],
        },
      ],
      node: { cpu: 0.95, heapMaxMb: 100, loopBusy: 0.9, lagMaxMs: 5, gcMs: 100, gcMaxMs: 10 },
    });
    assert.deepEqual(hints, [
      'r12s: all 4 workers busy 95% of the time with 40 items; more concurrency may help if the machine has spare CPU',
      'garbage collection took 100ms (10% of the run)',
      'the Node process was CPU bound: try --profile cpu',
    ]);
  });

  it('takes very large timing lists without spreading them into arguments', async () => {
    const out = fixture({});
    await startProfile('spans');
    const entries = Array.from({ length: 200_000 }, (_, i) => ({
      name: 'lighthouse',
      startTime: i,
      duration: 0.5,
    }));
    addSpans(entries, 0, 1e9);
    const summary = await stopProfile(join(out, 'profile'), out);
    assert.equal(summary?.spans, 200_000);
  });
});
