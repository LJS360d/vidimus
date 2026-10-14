import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { UsageError } from '../core/errors.ts';
import { github } from './github.ts';
import { html } from './html.ts';
import { junit } from './junit.ts';
import { pretty } from './pretty.ts';
import { sarif } from './sarif.ts';
import type { Reporter, ReporterOptions } from './types.ts';

export const REPORTERS = ['pretty', 'json', 'github', 'junit', 'sarif', 'html'];

export interface ReporterEnv {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const FORMATS = ['json', 'junit', 'sarif', 'html'];

interface BuiltinSpec {
  kind: 'builtin';
  name: string;
  target: string | undefined;
  verbose: boolean;
}

const writer = (target: string | undefined, cwd: string) => (content: string) => {
  if (!target) {
    process.stdout.write(content);
    return;
  }
  const file = resolve(cwd, target);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

/** The command-line form: `name` or `name:file`. Everything else is an object. */
const parse = (spec: string | ReporterOptions): BuiltinSpec => {
  if (typeof spec !== 'string')
    return { kind: 'builtin', name: spec.type, target: spec.file, verbose: spec.verbose ?? true };
  const separator = spec.indexOf(':');
  return {
    kind: 'builtin',
    name: separator === -1 ? spec : spec.slice(0, separator),
    target: (separator === -1 ? '' : spec.slice(separator + 1)) || undefined,
    verbose: true,
  };
};

const isBuiltin = (spec: BuiltinSpec | Reporter): spec is BuiltinSpec =>
  (spec as BuiltinSpec).kind === 'builtin';

const isOptions = (spec: string | ReporterOptions | Reporter): spec is string | ReporterOptions =>
  typeof spec === 'string' || 'type' in spec;

const withGithub = (specs: (string | ReporterOptions | Reporter)[], env: NodeJS.ProcessEnv) => {
  const list = specs.length ? specs : ['pretty'];
  const named = list.some((spec) => (isOptions(spec) ? parse(spec).name : spec.name) === 'github');
  return env.GITHUB_ACTIONS === 'true' && !named ? [...list, 'github'] : list;
};

export const createReporters = (
  specs: (string | ReporterOptions | Reporter)[],
  { cwd, env }: ReporterEnv,
): Reporter[] => {
  const parsed = withGithub(specs, env).map((spec) => (isOptions(spec) ? parse(spec) : spec));
  const onStdout = parsed.filter(
    (spec) => isBuiltin(spec) && FORMATS.includes(spec.name) && !spec.target,
  );
  if (onStdout.length > 1) {
    throw new UsageError(
      `reporters ${onStdout.map(({ name }) => name).join(' and ')} both write to stdout; give one a file (e.g. junit:report.xml)`,
    );
  }
  const stdoutTaken = onStdout.length > 0;

  return parsed.map((spec) => {
    if (!isBuiltin(spec)) return spec;
    const { name, target, verbose } = spec;
    const write = writer(target, cwd);
    switch (name) {
      case 'pretty':
        return pretty(stdoutTaken || target === 'stderr' ? process.stderr : process.stdout);
      case 'github':
        return github(stdoutTaken ? process.stderr : process.stdout, env);
      case 'json':
        return {
          name,
          onEnd: (report) =>
            write(
              `${JSON.stringify(verbose ? report : { ...report, detail: undefined }, null, 2)}\n`,
            ),
        };
      case 'junit':
        return junit(write, verbose);
      case 'sarif':
        return sarif(write, verbose, cwd);
      case 'html':
        return html(write, verbose);
      default:
        throw new UsageError(`unknown reporter "${name}". Known: ${REPORTERS.join(', ')}`);
    }
  });
};
