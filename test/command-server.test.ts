import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { serveCommand } from '../src/core/command-server.ts';
import { type Audit, run, UsageError } from '../src/index.ts';
import { fixture } from './helpers.ts';

const node = JSON.stringify(process.execPath);

const SERVE = `import { createServer } from 'node:http';
createServer((req, res) => res.writeHead(200, { 'x-served-by': 'command' }).end(process.argv[2] + req.url))
  .listen(Number(process.env.PORT));
console.log('ready');`;

describe('server.command', () => {
  it('starts the command on {port}, waits for it and stops it on close', async () => {
    const root = fixture({ 'dist/index.html': 'home', 'serve.mjs': SERVE });
    const server = await serveCommand({
      command: `${node} serve.mjs {dist}`,
      cwd: root,
      dist: join(root, 'dist'),
      port: 0,
      timeout: 10000,
      log: join(root, 'server.log'),
    });
    const res = await fetch(`http://localhost:${server.port}/about/`);
    assert.equal(res.headers.get('x-served-by'), 'command');
    assert.equal(await res.text(), `${join(root, 'dist')}/about/`);
    await server.close();
    await assert.rejects(fetch(`http://localhost:${server.port}/`));
    assert.match(readFileSync(join(root, 'server.log'), 'utf8'), /ready/);
  });

  it('reports a command that exits before answering, with its output', async () => {
    const root = fixture({});
    await assert.rejects(
      serveCommand({
        command: `${node} -e "console.error('no wrangler.toml'); process.exit(3)"`,
        cwd: root,
        dist: root,
        port: 0,
        timeout: 10000,
        log: join(root, 'server.log'),
      }),
      (error) =>
        error instanceof UsageError &&
        /exited with code 3/.test(error.message) &&
        /no wrangler\.toml/.test(error.message),
    );
  });

  it('gives up after startTimeout', async () => {
    const root = fixture({});
    await assert.rejects(
      serveCommand({
        command: `${node} -e "setInterval(() => {}, 1000)"`,
        cwd: root,
        dist: root,
        port: 0,
        timeout: 300,
        log: join(root, 'server.log'),
      }),
      (error) => error instanceof UsageError && /within 300 ms/.test(error.message),
    );
  });

  it('points audits at the command server and treats it as the origin', async () => {
    const cwd = fixture({ 'dist/index.html': 'home', 'serve.mjs': SERVE });
    const seen: { origin: string; configOrigin: string; body: string }[] = [];
    const probe: Audit = {
      name: 'probe',
      description: 'records its origin',
      run: async ({ origin, config }) => {
        const body = await fetch(`${origin}/x`).then((res) => res.text());
        seen.push({ origin, configOrigin: config.origin, body });
        return { summary: 'ok' };
      },
    };
    const { ok } = await run({
      cwd,
      env: {},
      audits: ['probe'],
      reporters: [],
      overrides: {
        port: 0,
        plugins: [probe],
        server: { command: `${node} serve.mjs cmd` },
      },
    });
    assert.equal(ok, true);
    assert.match(seen[0]?.origin ?? '', /^http:\/\/localhost:[1-9]\d*$/);
    assert.equal(seen[0]?.configOrigin, seen[0]?.origin);
    assert.equal(seen[0]?.body, 'cmd/x');
  });
});
