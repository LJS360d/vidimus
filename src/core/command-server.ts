import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { UsageError } from './errors.ts';
import type { StaticServer } from './server.ts';

export interface CommandServerOptions {
  command: string;
  cwd: string;
  dist: string;
  port: number;
  timeout: number;
  log: string;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const answers = (port: number) =>
  fetch(`http://localhost:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(1000) })
    .then(async (res) => {
      await res.body?.cancel();
      return true;
    })
    .catch(() => false);

const tail = (file: string) => {
  try {
    return readFileSync(file, 'utf8').trim().split('\n').slice(-10).join('\n');
  } catch {
    return '';
  }
};

const signalGroup = (pid: number, signal: NodeJS.Signals | 0) => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
};

// Kill the whole process tree: wrangler, firebase and friends start servers of their own, and
// those can outlive the shell that started them, so the group is signalled even then.
const killTree = (child: ChildProcess) => {
  if (!child.pid) return;
  if (process.platform !== 'win32') signalGroup(child.pid, 'SIGTERM');
  else if (child.exitCode === null && child.signalCode === null)
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
};

const stop = async (child: ChildProcess) => {
  killTree(child);
  if (!child.pid || process.platform === 'win32') return;
  const deadline = Date.now() + 5000;
  while (signalGroup(child.pid, 0) && Date.now() < deadline) await sleep(100);
  signalGroup(child.pid, 'SIGKILL');
};

export const serveCommand = async ({
  command,
  cwd,
  dist,
  port: requested,
  timeout,
  log,
}: CommandServerOptions): Promise<StaticServer> => {
  const port = requested || (await freePort());
  if (await answers(port)) {
    throw new UsageError(
      `port ${port} is in use; stop what is running there or pick another with --port`,
    );
  }
  const line = command.replaceAll('{port}', String(port)).replaceAll('{dist}', dist);
  const output = createWriteStream(log);
  const child = spawn(line, {
    cwd,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(output);
  child.stderr?.pipe(output);
  let failure: Error | undefined;
  child.once('error', (error) => {
    failure = error;
  });
  child.once('exit', (code, signal) => {
    failure ??= new Error(`exited with ${signal ?? `code ${code}`}`);
  });

  // Ctrl+C or a crash skips the caller's cleanup, and a detached group never sees the signal.
  const onExit = () => killTree(child);
  const onSignal = (signal: NodeJS.Signals) => {
    void close().finally(() => process.kill(process.pid, signal));
  };
  process.once('exit', onExit);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const close = async () => {
    process.off('exit', onExit);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await stop(child);
    await new Promise((resolve) => output.end(resolve));
  };
  const fail = async (reason: string) => {
    await close();
    const last = tail(log);
    throw new UsageError(
      `server.command ${reason}: ${line}${last ? `\n${last}` : ''}\n(full output in ${log})`,
    );
  };

  const deadline = Date.now() + timeout;
  while (!(await answers(port))) {
    if (failure) return fail(failure.message);
    if (Date.now() > deadline)
      return fail(`did not answer on port ${port} within ${timeout} ms (server.startTimeout)`);
    await sleep(200);
  }
  return { port, close };
};
