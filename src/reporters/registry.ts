import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { UsageError } from '../core/errors.ts';
import { github } from './github.ts';
import { junit } from './junit.ts';
import { pretty } from './pretty.ts';
import type { Reporter } from './types.ts';

export const REPORTERS = ['pretty', 'json', 'github', 'junit'];

export interface ReporterEnv {
  cwd: string;
  env: NodeJS.ProcessEnv;
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

const parse = (spec: string) => {
  const separator = spec.indexOf(':');
  return separator === -1
    ? { name: spec, target: undefined }
    : { name: spec.slice(0, separator), target: spec.slice(separator + 1) || undefined };
};

const defaultReporters = (env: NodeJS.ProcessEnv) => [
  'pretty',
  ...(env.GITHUB_ACTIONS === 'true' ? ['github'] : []),
];

export const createReporters = (
  specs: (string | Reporter)[],
  { cwd, env }: ReporterEnv,
): Reporter[] => {
  const list = specs.length ? specs : defaultReporters(env);
  const parsed = list.map((spec) => (typeof spec === 'string' ? parse(spec) : spec));
  const stdoutTaken = parsed.some(
    (spec) => 'target' in spec && ['json', 'junit'].includes(spec.name) && !spec.target,
  );

  return parsed.map((spec) => {
    if (!('target' in spec)) return spec;
    const { name, target } = spec;
    switch (name) {
      case 'pretty':
        return pretty(stdoutTaken || target === 'stderr' ? process.stderr : process.stdout);
      case 'github':
        return github(process.stdout, env);
      case 'json':
        return {
          name,
          onEnd: (report) => writer(target, cwd)(`${JSON.stringify(report, null, 2)}\n`),
        };
      case 'junit':
        return junit(writer(target, cwd));
      default:
        throw new UsageError(`unknown reporter "${name}". Known: ${REPORTERS.join(', ')}`);
    }
  });
};
