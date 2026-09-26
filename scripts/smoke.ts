import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const devVersion = (name: string) =>
  (
    JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).devDependencies as Record<
      string,
      string
    >
  )[name];

const work = mkdtempSync(join(tmpdir(), 'vidimus-smoke-'));
const project = join(work, 'site');
const failures: string[] = [];

const write = (path: string, content: string) => {
  mkdirSync(resolve(project, path, '..'), { recursive: true });
  writeFileSync(join(project, path), content);
};

const vidimus = (...args: string[]) =>
  spawnSync(join(project, 'node_modules', '.bin', 'vidimus'), args, {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: '', VIDIMUS_UNRELATED: 'ignored' },
  });

const expect = (label: string, ok: boolean, output = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(`${label}\n${output}`);
};

try {
  execFileSync('pnpm', ['pack', '--pack-destination', work], { cwd: repo, stdio: 'inherit' });
  const packed = readdirSync(work).find((name) => name.endsWith('.tgz'));
  if (!packed) throw new Error(`pnpm pack wrote no tarball to ${work}`);
  const tarball = join(work, packed);

  write('package.json', JSON.stringify({ name: 'site', private: true, type: 'module' }));
  write('dist/index.html', '<!doctype html><html lang="en"><title>Smoke</title><p>hi</p></html>');
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        allowImportingTsExtensions: true,
        types: ['node'],
      },
      include: ['*.ts'],
    }),
  );
  write(
    'plugin.ts',
    `import { type Audit, defineConfig, run } from 'vidimus';

export const title: Audit = {
  name: 'title',
  description: 'every page has a title',
  requires: 'dist',
  async run({ launchBrowser }) {
    void launchBrowser;
    return { summary: 'ok', findings: [{ message: 'x', severity: 'warn' }] };
  },
};

export default defineConfig({ plugins: [title], severity: { links: 'off' } });
export const report = () => run({ audits: ['csp'] });
`,
  );

  execFileSync(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      tarball,
      `typescript@${devVersion('typescript')}`,
      `@types/node@${devVersion('@types/node')}`,
    ],
    { cwd: project, stdio: 'inherit' },
  );

  const installed = readdirSync(join(project, 'node_modules'));
  expect(
    'no optional peer got installed',
    !['puppeteer', 'pa11y', 'linkinator', 'lighthouse', 'sharp', 'html-validate'].some((peer) =>
      installed.includes(peer),
    ),
    installed.join(' '),
  );

  const version = vidimus('--version');
  expect(
    '--version prints the version',
    version.status === 0 && /\d+\.\d+\.\d+/.test(version.stdout),
    version.stderr,
  );

  const list = vidimus('list');
  expect(
    'list shows the builtin audits',
    list.status === 0 && list.stdout.includes('seo'),
    list.stderr,
  );

  const zeroDep = vidimus('csp', 'seo', 'budget');
  expect(
    'zero-dependency audits run without peers',
    zeroDep.status !== 2 && !/is not installed/.test(zeroDep.stdout + zeroDep.stderr),
    zeroDep.stdout + zeroDep.stderr,
  );

  const needsPeer = vidimus('a11y');
  expect(
    'a missing peer fails only its audit, with an install hint',
    needsPeer.status === 1 && /"(puppeteer|pa11y)" is not installed/.test(needsPeer.stdout),
    needsPeer.stdout + needsPeer.stderr,
  );

  write('.gitignore', 'node_modules');
  const init = vidimus('init', '--format', 'ts');
  expect('init writes a TS config', init.status === 0, init.stderr);
  const gitignore = () => readFileSync(join(project, '.gitignore'), 'utf8');
  expect(
    'init adds .vidimus to an existing .gitignore',
    gitignore() === 'node_modules\n.vidimus\n',
    gitignore(),
  );
  const again = vidimus('init', '--format', 'ts', '--force');
  expect(
    'init --force leaves a .gitignore that lists .vidimus unchanged',
    again.status === 0 && gitignore() === 'node_modules\n.vidimus\n',
    again.stderr + gitignore(),
  );
  const second = vidimus('init', '--format', 'json');
  expect(
    'init refuses a second config file in another format',
    second.status === 2 && /vidimus\.config\.ts already exists/.test(second.stderr),
    second.stderr,
  );

  const config = vidimus('config');
  expect('config resolves with the generated file', config.status === 0, config.stderr);

  const tsc = spawnSync(join(project, 'node_modules', '.bin', 'tsc'), ['-p', '.'], {
    cwd: project,
    encoding: 'utf8',
  });
  expect(
    'published types compile without skipLibCheck and without puppeteer',
    tsc.status === 0,
    tsc.stdout + tsc.stderr,
  );

  const schema = JSON.parse(
    readFileSync(join(project, 'node_modules', 'vidimus', 'schema.json'), 'utf8'),
  ) as { properties: Record<string, unknown> };
  expect('schema.json ships with the package', 'seo' in schema.properties);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.join('\n\n')}`);
  process.exitCode = 1;
}
