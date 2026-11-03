import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fixture } from './helpers.ts';

describe('cli', () => {
  it('rejects a --timeout or --audit-timeout that is not a whole number of milliseconds as a usage error', () => {
    const cli = new URL('../src/cli.ts', import.meta.url).pathname;
    const root = fixture({});
    for (const flag of ['--timeout', '--audit-timeout'])
      for (const value of ['abc', '-5', '1.5', 'Infinity']) {
        const run = spawnSync(
          process.execPath,
          [cli, 'run', '--no-config', '--root', root, flag, value],
          { encoding: 'utf8' },
        );
        assert.equal(run.status, 2, `${flag} ${value}`);
        assert.match(run.stderr, new RegExp(`${flag} <ms>`), `${flag} ${value}`);
      }
  });

  it('flushes delayed stdout before exiting after a timed-out run', () => {
    const cli = new URL('../src/cli.ts', import.meta.url).pathname;
    const root = fixture({
      'dist/index.html': '<!doctype html><html lang="en"><title>x</title><body>hi</body></html>',
    });
    const delay = `const write = process.stdout.write.bind(process.stdout); process.stdout.write = (chunk, ...rest) => { setTimeout(() => write(chunk, ...rest), 300); return true; };`;
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(delay)}`,
        cli,
        'run',
        '--no-config',
        '--root',
        root,
        '--timeout',
        '1',
        '--reporter',
        'json',
        '--port',
        '0',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    assert.match(run.stderr, /run stopped after timeout/);
    assert.equal(run.status, 2);
    assert.doesNotThrow(() => JSON.parse(run.stdout));
  });
});
