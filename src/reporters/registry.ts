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
  /** `json` or `junit`: also written to `<outDir>/report.json` / `report.xml`, whatever `specs` is. */
  reports?: string[];
  outDir?: string;
}

const REPORT_FILES = new Map([
  ['json', 'report.json'],
  ['junit', 'report.xml'],
]);

const reportSpecs = (reports: string[], outDir: string) =>
  reports.map((name) => {
    const file = REPORT_FILES.get(name);
    if (!file)
      throw new UsageError(
        `unknown report "${name}". Known: ${[...REPORT_FILES.keys()].join(', ')}`,
      );
    return `${name}:${resolve(outDir, file)}`;
  });

const writer = (target: string | undefined, cwd: string) => (content: string) => {
  if (!target) {
    process.stdout.write(content);
    return;
  }
  const file = resolve(cwd, target);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

interface BuiltinSpec {
  kind: 'builtin';
  name: string;
  target: string | undefined;
}

const parse = (spec: string): BuiltinSpec => {
  const separator = spec.indexOf(':');
  return separator === -1
    ? { kind: 'builtin', name: spec, target: undefined }
    : {
        kind: 'builtin',
        name: spec.slice(0, separator),
        target: spec.slice(separator + 1) || undefined,
      };
};

const isBuiltin = (spec: BuiltinSpec | Reporter): spec is BuiltinSpec =>
  (spec as BuiltinSpec).kind === 'builtin';

const withGithub = (specs: (string | Reporter)[], env: NodeJS.ProcessEnv) => {
  const list = specs.length ? specs : ['pretty'];
  const named = list.some(
    (spec) => (typeof spec === 'string' ? parse(spec).name : spec.name) === 'github',
  );
  return env.GITHUB_ACTIONS === 'true' && !named ? [...list, 'github'] : list;
};

export const createReporters = (
  specs: (string | Reporter)[],
  { cwd, env, reports = [], outDir = cwd }: ReporterEnv,
): Reporter[] => {
  const parsed = [...withGithub(specs, env), ...reportSpecs(reports, outDir)].map((spec) =>
    typeof spec === 'string' ? parse(spec) : spec,
  );
  const onStdout = parsed.filter(
    (spec) => isBuiltin(spec) && ['json', 'junit'].includes(spec.name) && !spec.target,
  );
  if (onStdout.length > 1) {
    throw new UsageError(
      `reporters ${onStdout.map(({ name }) => name).join(' and ')} both write to stdout; give one a file (e.g. junit:report.xml)`,
    );
  }
  const stdoutTaken = onStdout.length > 0;

  return parsed.map((spec) => {
    if (!isBuiltin(spec)) return spec;
    const { name, target } = spec;
    switch (name) {
      case 'pretty':
        return pretty(stdoutTaken || target === 'stderr' ? process.stderr : process.stdout);
      case 'github':
        return github(stdoutTaken ? process.stderr : process.stdout, env);
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
