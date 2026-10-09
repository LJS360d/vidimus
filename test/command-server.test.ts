import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { serveCommand } from '../src/core/command-server.ts';
import { inParallel } from '../src/core/util.ts';
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

  it('quotes {dist} when its path contains spaces', async () => {
    const root = fixture({ 'My Site/index.html': 'home', 'serve.mjs': SERVE });
    const server = await serveCommand({
      command: `${node} serve.mjs {dist}`,
      cwd: root,
      dist: join(root, 'My Site'),
      port: 0,
      timeout: 10000,
      log: join(root, 'server.log'),
    });
    const res = await fetch(`http://localhost:${server.port}/`);
    assert.equal(await res.text(), `${join(root, 'My Site')}/`);
    await server.close();
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

  it('stops servers the command left running after the shell exited', async () => {
    const root = fixture({ 'dist/index.html': 'home', 'serve.mjs': SERVE });
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });
    const server = await serveCommand({
      command: `${node} serve.mjs {dist} & sleep 1`,
      cwd: root,
      dist: join(root, 'dist'),
      port,
      timeout: 10000,
      log: join(root, 'server.log'),
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await server.close();
    await assert.rejects(fetch(`http://localhost:${port}/`));
  });

  it('reports progress of pooled work to reporters', async () => {
    const cwd = fixture({ 'dist/index.html': 'home' });
    const seen: string[] = [];
    const probe: Audit = {
      name: 'probe',
      description: 'works through a pool',
      requires: 'dist',
      run: async () => {
        await inParallel(2, [1, 2, 3], async () => {});
        return { summary: 'ok' };
      },
    };
    await run({
      cwd,
      env: {},
      audits: ['probe'],
      reporters: [
        {
          name: 'spy',
          onProgress: (running) =>
            seen.push(running.map(({ name, done, total }) => `${name} ${done}/${total}`).join()),
        },
      ],
      overrides: { plugins: [probe] },
    });
    assert.deepEqual(seen, [
      'probe 0/0',
      'probe 0/3',
      'probe 1/3',
      'probe 2/3',
      'probe 3/3',
      '',
      '',
    ]);
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

  it('does not append the siteUrl base path to the command server origin', async () => {
    const cwd = fixture({ 'dist/index.html': 'home', 'serve.mjs': SERVE });
    let seen = '';
    const probe: Audit = {
      name: 'probe',
      description: 'records its origin',
      run: async ({ origin }) => {
        seen = origin;
        return { summary: 'ok' };
      },
    };
    await run({
      cwd,
      env: {},
      audits: ['probe'],
      reporters: [],
      overrides: {
        port: 0,
        siteUrl: 'https://user.github.io/project',
        plugins: [probe],
        server: { command: `${node} serve.mjs cmd` },
      },
    });
    assert.match(seen, /^http:\/\/localhost:[1-9]\d*$/);
  });
});
