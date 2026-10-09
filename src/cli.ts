#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import { CONFIG_FILES, type LoadConfigOptions, loadConfig } from './config/load.ts';
import type { UserConfig } from './config/types.ts';
import { UsageError } from './core/errors.ts';
import { diffProfiles, type ProfileLevel } from './core/profile.ts';
import { auditRegistry, run } from './core/run.ts';
import { REPORTERS } from './reporters/registry.ts';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

interface ConfigFlags {
  config?: string | false;
  set?: string[];
}

interface RunFlags extends ConfigFlags {
  root?: string;
  dist?: string;
  outDir?: string;
  origin?: string;
  siteUrl?: string;
  port?: number;
  serve?: string;
  allLocales?: boolean;
  updateBaseline?: boolean;
  acceptFindings?: boolean;
  strict?: boolean;
  reporter?: string[];
  profile?: ProfileLevel | true;
  serial?: boolean;
}

const collect = (value: string, previous: string[] = []) => [...previous, value];

const toPort = (value: string) => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError('expected a port number');
  }
  return port;
};

const withConfigOptions = (command: Command) =>
  command
    .option('-c, --config <file>', 'config file (default: search the working directory)')
    .option('--no-config', 'ignore config files')
    .option('--set <key=value>', 'override one config value, repeatable', collect);

const loadOptions = (flags: ConfigFlags, overrides: UserConfig = {}): LoadConfigOptions => ({
  configFile: flags.config,
  set: flags.set,
  overrides,
});

const runOverrides = (flags: RunFlags): UserConfig => ({
  root: flags.root,
  distDir: flags.dist,
  outDir: flags.outDir,
  origin: flags.origin,
  siteUrl: flags.siteUrl,
  port: flags.port,
  ...(flags.serve && { server: { command: flags.serve } }),
  ...(flags.allLocales && { allLocales: true }),
  ...(flags.updateBaseline && { shots: { updateBaseline: true } }),
  ...(flags.acceptFindings && { baseline: { update: true } }),
  ...(flags.strict && { strict: true }),
  ...(flags.reporter?.length && { reporters: flags.reporter }),
});

const INIT_TEMPLATES = {
  ts: {
    file: 'vidimus.config.ts',
    content: `import { defineConfig } from 'vidimus';

export default defineConfig({
  distDir: 'dist',
  siteUrl: '',
  exclude: [],
});
`,
  },
  js: {
    file: 'vidimus.config.mjs',
    content: `import { defineConfig } from 'vidimus';

export default defineConfig({
  distDir: 'dist',
  siteUrl: '',
  exclude: [],
});
`,
  },
  json: {
    file: 'vidimus.config.json',
    content: `${JSON.stringify(
      { $schema: './node_modules/vidimus/schema.json', distDir: 'dist', siteUrl: '', exclude: [] },
      null,
      2,
    )}\n`,
  },
};

const program = new Command('vidimus')
  .description('Pre-publication checks for public static websites')
  .version(version)
  .showHelpAfterError()
  .exitOverride((error) => process.exit(error.exitCode === 0 ? 0 : 2));

withConfigOptions(
  program
    .command('run', { isDefault: true })
    .description('run audits (default: the "audits" list from config, "all" for every audit)')
    .argument('[audits...]', 'audit names, or "all"'),
)
  .option('--root <dir>', 'project root that relative paths resolve from')
  .option('--dist <dir>', 'build output directory')
  .option('--out-dir <dir>', 'where reports and screenshots are written')
  .option('--origin <url>', 'audit a running server instead of serving the build')
  .option(
    '--site-url <url>',
    'production origin; absolute self-links are rewritten to the audit origin',
  )
  .option('--serve <command>', "serve the build with this command, e.g. your host's dev server")
  .option('--port <port>', 'port the build is served on', toPort)
  .option('--all-locales', 'include every locale, not only the default one')
  .option('--update-baseline', 'shots: record the current screenshots as the baseline')
  .option('--accept-findings', 'record current findings in the baseline file so only new ones fail')
  .option('--strict', 'fail on warnings too')
  .option('-r, --reporter <name[:file]>', `${REPORTERS.join(' | ')}, repeatable`, collect)
  .addOption(
    new Option(
      '--profile [level]',
      'record where time goes: spans (default) or cpu (adds a Node CPU profile)',
    ).choices(['spans', 'cpu']),
  )
  .option('--serial', 'run audits one at a time instead of in parallel')
  .action(async (audits: string[], flags: RunFlags) => {
    const { config } = await loadConfig(loadOptions(flags, runOverrides(flags)));
    const report = await run({
      audits,
      config,
      profile: flags.profile === true ? 'spans' : flags.profile,
      serial: flags.serial,
    });
    process.exitCode = report.ok ? 0 : 1;
  });

withConfigOptions(program.command('list').description('list available audits')).action(
  async (flags: ConfigFlags) => {
    const { config } = await loadConfig(loadOptions(flags));
    const registry = auditRegistry(config);
    const width = Math.max(...[...registry.keys()].map((name) => name.length));
    for (const audit of registry.values()) {
      const severity = config.severity[audit.name];
      const marker = severity === 'off' ? '-' : config.audits.includes(audit.name) ? '*' : ' ';
      const note = severity === 'warn' ? ' (warn only)' : '';
      console.log(`${marker} ${audit.name.padEnd(width)}  ${audit.description}${note}`);
    }
    console.log('\n* runs by default, - turned off by severity');
  },
);

withConfigOptions(
  program.command('config').description('print the resolved configuration as JSON'),
).action(async (flags: ConfigFlags) => {
  const { config, source } = await loadConfig(loadOptions(flags));
  console.error(`source: ${source ?? '(defaults only)'}`);
  const printable = {
    ...config,
    plugins: config.plugins.map(({ name }) => name),
    reporters: config.reporters.map((reporter) =>
      typeof reporter === 'string' ? reporter : reporter.name,
    ),
  };
  console.log(JSON.stringify(printable, null, 2));
});

program
  .command('profile')
  .description('work with traces written by --profile')
  .command('diff')
  .description('compare two traces: self time per audit and span, largest changes first')
  .argument('<before>', 'trace file from the earlier run')
  .argument('<after>', 'trace file from the later run')
  .option('--top <n>', 'rows to print', (value) => Number(value), 15)
  .action((before: string, after: string, flags: { top: number }) => {
    for (const line of diffProfiles(before, after, flags.top)) console.log(line);
  });

program
  .command('init')
  .description('create a config file in the working directory')
  .addOption(
    new Option('--format <format>', 'config format').choices(['ts', 'js', 'json']).default('ts'),
  )
  .option('--force', 'overwrite an existing config file')
  .action((flags: { format: keyof typeof INIT_TEMPLATES; force?: boolean }) => {
    const { file, content } = INIT_TEMPLATES[flags.format];
    const target = resolve(file);
    if (existsSync(target) && !flags.force)
      throw new UsageError(`${file} already exists (use --force)`);
    const other = CONFIG_FILES.find((name) => name !== file && existsSync(resolve(name)));
    if (other) throw new UsageError(`${other} already exists; remove it before creating ${file}`);
    writeFileSync(target, content);
    console.log(`created ${file}`);
  });

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`vidimus: ${error.message}`);
  } else {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
  process.exitCode = 2;
}
