import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UsageError } from '../core/errors.ts';
import { isPlainObject } from '../core/util.ts';
import { defaults } from './defaults.ts';
import { checkKeys, merge, setPath } from './merge.ts';
import type { ConfigInput, UserConfig, VidimusConfig } from './types.ts';

export const CONFIG_FILES = [
  'vidimus.config.ts',
  'vidimus.config.mts',
  'vidimus.config.js',
  'vidimus.config.mjs',
  'vidimus.config.cjs',
  'vidimus.config.json',
  '.vidimusrc',
  '.vidimusrc.json',
];

const ENV_PREFIX = 'VIDIMUS_';
const ENV_CONFIG_FILE = 'VIDIMUS_CONFIG';

export interface LoadConfigOptions {
  cwd?: string;
  configFile?: string | false;
  env?: NodeJS.ProcessEnv;
  set?: string[];
  overrides?: UserConfig;
}

export interface LoadedConfig {
  config: VidimusConfig;
  source: string | undefined;
}

export const defineConfig = <T extends ConfigInput>(config: T): T => config;

const readPackageField = (file: string): UserConfig | undefined => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).vidimus;
  } catch (error) {
    throw new UsageError(`${file}: ${(error as Error).message}`);
  }
};

const findConfigFile = (cwd: string) => {
  const file = CONFIG_FILES.map((name) => resolve(cwd, name)).find((path) => existsSync(path));
  if (file) return file;
  const pkg = resolve(cwd, 'package.json');
  return existsSync(pkg) && readPackageField(pkg) ? pkg : undefined;
};

const readConfigFile = async (file: string, env: NodeJS.ProcessEnv, cwd: string) => {
  const name = basename(file);
  if (name === 'package.json') return readPackageField(file) ?? {};
  if (name.endsWith('.json') || name === '.vidimusrc') {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as UserConfig;
    } catch (error) {
      throw new UsageError(`${file}: ${(error as Error).message}`);
    }
  }
  const module = await import(pathToFileURL(file).href);
  const input: ConfigInput = module.default ?? module;
  return typeof input === 'function' ? await input({ cwd, env }) : input;
};

const fromEnv = (config: VidimusConfig, env: NodeJS.ProcessEnv) =>
  Object.entries(env)
    .filter(
      ([key, value]) =>
        key.startsWith(ENV_PREFIX) && key !== ENV_CONFIG_FILE && value !== undefined,
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce(
      (tree, [key, value]) =>
        setPath(tree, key.slice(ENV_PREFIX.length).split('__'), value ?? '', {
          source: key,
          fuzzy: true,
          lenient: true,
        }),
      config,
    );

const fromSet = (config: VidimusConfig, assignments: string[]) =>
  assignments.reduce((tree, assignment) => {
    const separator = assignment.indexOf('=');
    if (separator < 1) throw new UsageError(`--set ${assignment}: expected key.path=value`);
    return setPath(
      tree,
      assignment.slice(0, separator).split('.'),
      assignment.slice(separator + 1),
      {
        source: `--set ${assignment}`,
      },
    );
  }, config);

const IGNORE_KEYS = ['audit', 'message', 'where'];

const checkIgnoreRules = (rules: unknown) => {
  if (!Array.isArray(rules)) throw new UsageError('ignore: must be a list of rules');
  rules.forEach((rule, index) => {
    const at = `ignore[${index}]`;
    if (!isPlainObject(rule)) throw new UsageError(`${at}: must be an object`);
    const keys = Object.keys(rule);
    const unknown = keys.find((key) => !IGNORE_KEYS.includes(key));
    if (unknown)
      throw new UsageError(`${at}: unknown key "${unknown}". Known: ${IGNORE_KEYS.join(', ')}`);
    if (!keys.length)
      throw new UsageError(
        `${at}: an empty rule would drop every finding; set audit, message or where`,
      );
    for (const key of keys) {
      const pattern = rule[key];
      if (typeof pattern !== 'string') throw new UsageError(`${at}.${key}: must be a string`);
      try {
        new RegExp(pattern);
      } catch (error) {
        throw new UsageError(`${at}.${key}: ${(error as Error).message}`);
      }
    }
  });
};

const PATTERN_LISTS = [
  'exclude',
  'include',
  'sample',
  'allow',
  'ignoreRequests',
  'allowNoindex',
  'skip',
];

const checkPattern = (at: string, pattern: unknown) => {
  if (typeof pattern !== 'string') throw new UsageError(`${at}: must be a string`);
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new UsageError(`${at}: ${(error as Error).message}`);
  }
};

const checkPatterns = (config: VidimusConfig) => {
  const lists = (tree: Record<string, unknown>, path: string[]) => {
    for (const [key, value] of Object.entries(tree)) {
      const at = [...path, key].join('.');
      if (PATTERN_LISTS.includes(key) && Array.isArray(value)) {
        for (const [index, pattern] of value.entries()) checkPattern(`${at}[${index}]`, pattern);
      } else if (isPlainObject(value) && path.length === 0) {
        lists(value, [key]);
      }
    }
  };
  lists(config as unknown as Record<string, unknown>, []);
  for (const [index, { match }] of config.server.headers.entries()) {
    checkPattern(`server.headers[${index}].match`, match);
  }
  for (const [index, { match }] of config.lighthouse.overrides.entries()) {
    checkPattern(`lighthouse.overrides[${index}].match`, match);
  }
  if (Array.isArray(config.server.fallback)) {
    for (const [index, { match }] of config.server.fallback.entries()) {
      checkPattern(`server.fallback[${index}].match`, match);
    }
  }
  for (const [name, pattern] of Object.entries(config.security.require)) {
    if (pattern !== false) checkPattern(`security.require.${name}`, pattern);
  }
};

const checkOneOf = (at: string, value: string, allowed: string[]) => {
  if (!allowed.includes(value))
    throw new UsageError(`${at}: "${value}" is not one of ${allowed.join(', ')}`);
};

const checkAssets = ({ assets }: VidimusConfig) => {
  for (const key of ['adsTxt', 'changePassword', 'appleAppSiteAssociation', 'assetLinks'] as const)
    checkOneOf(`assets.${key}`, assets[key], ['off', 'auto', 'on']);
};

const checkRoutes = ({ routes, render, links }: VidimusConfig) => {
  checkOneOf('routes.discover', routes.discover, ['off', 'sitemap', 'crawl']);
  checkOneOf('render.mode', render.mode, ['off', 'auto', 'on']);
  if (links.notFound.text) checkPattern('links.notFound.text', links.notFound.text);
  for (const [index, path] of routes.paths.entries()) {
    if (typeof path !== 'string' || !path.startsWith('/'))
      throw new UsageError(`routes.paths[${index}]: must be a path starting with /`);
  }
};

const resolveRoot = (root: string | undefined, base: string) =>
  root === undefined ? undefined : isAbsolute(root) ? root : resolve(base, root);

export const loadConfig = async ({
  cwd: cwdOption,
  configFile,
  env = process.env,
  set = [],
  overrides = {},
}: LoadConfigOptions = {}): Promise<LoadedConfig> => {
  const cwd = resolve(cwdOption ?? process.cwd());
  const requested = configFile ?? env[ENV_CONFIG_FILE];
  let source: string | undefined;
  if (requested) {
    source = resolve(cwd, requested);
    if (!existsSync(source)) throw new UsageError(`config file not found: ${source}`);
  } else if (requested !== false) {
    source = findConfigFile(cwd);
  }

  const { $schema: _schema, ...fileConfig } = (
    source ? await readConfigFile(source, env, cwd) : {}
  ) as UserConfig & { $schema?: string };
  const fileBase = source ? dirname(source) : cwd;
  const base = defaults(cwd);
  if (source) checkKeys(base, fileConfig, source);

  let config = merge(base, {
    ...fileConfig,
    root: resolveRoot(fileConfig.root, fileBase) ?? fileBase,
  });
  config = fromEnv(config, env);
  config = { ...config, root: resolveRoot(config.root, cwd) ?? cwd };
  config = fromSet(config, set);
  config = merge(config, { ...overrides, root: resolveRoot(overrides.root, cwd) });
  config = { ...config, root: resolveRoot(config.root, cwd) ?? cwd };
  checkIgnoreRules(config.ignore);
  checkPatterns(config);
  checkRoutes(config);
  checkAssets(config);

  return { config, source };
};
