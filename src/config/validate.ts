import { builtinAudits } from '../audits/registry.ts';
import { UsageError } from '../core/errors.ts';
import { isPlainObject, messageOf } from '../core/util.ts';
import { OPEN_RECORDS } from './merge.ts';
import type { VidimusConfig } from './types.ts';

const IGNORE_KEYS = ['audit', 'rule', 'message', 'where', 'reason'];

const checkIgnoreRules = (rules: unknown) => {
  if (!Array.isArray(rules)) throw new UsageError('ignore: must be a list of rules');
  rules.forEach((rule, index) => {
    const at = `ignore[${index}]`;
    if (!isPlainObject(rule)) throw new UsageError(`${at}: must be an object`);
    const keys = Object.keys(rule);
    const unknown = keys.find((key) => !IGNORE_KEYS.includes(key));
    if (unknown)
      throw new UsageError(`${at}: unknown key "${unknown}". Known: ${IGNORE_KEYS.join(', ')}`);
    if (!keys.some((key) => key !== 'reason'))
      throw new UsageError(
        `${at}: an empty rule would drop every finding; set audit, message or where`,
      );
    for (const key of keys) {
      const pattern = rule[key];
      if (typeof pattern !== 'string') throw new UsageError(`${at}.${key}: must be a string`);
      if (key === 'reason') continue;
      try {
        new RegExp(pattern);
      } catch (error) {
        throw new UsageError(`${at}.${key}: ${messageOf(error)}`);
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
  'allowRequests',
  'allowNoindex',
  'skip',
];

const checkPattern = (at: string, pattern: unknown) => {
  if (typeof pattern !== 'string') throw new UsageError(`${at}: must be a string`);
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new UsageError(`${at}: ${messageOf(error)}`);
  }
};

const checkPatterns = (config: VidimusConfig) => {
  const lists = (tree: Record<string, unknown>, path: string[]) => {
    for (const [key, value] of Object.entries(tree)) {
      const at = [...path, key].join('.');
      if (PATTERN_LISTS.includes(key) && Array.isArray(value) && at !== 'forms.skip') {
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
  for (const [index, { match }] of config.shots.overrides.entries()) {
    if (match !== undefined) checkPattern(`shots.overrides[${index}].match`, match);
  }
  for (const [index, { match }] of config.lighthouse.overrides.entries()) {
    checkPattern(`lighthouse.overrides[${index}].match`, match);
  }
  if (Array.isArray(config.server.fallback)) {
    for (const [index, { match }] of config.server.fallback.entries()) {
      checkPattern(`server.fallback[${index}].match`, match);
    }
  }
  for (const [index, pattern] of config.csp.ignore.entries()) {
    checkPattern(`csp.ignore[${index}]`, pattern);
  }
  for (const pattern of Object.keys(config.forms.values)) {
    checkPattern(`forms.values.${pattern}`, pattern);
  }
  for (const pattern of Object.keys(config.budget.routes)) {
    checkPattern(`budget.routes.${pattern}`, pattern);
  }
  for (const [name, pattern] of Object.entries(config.security.require)) {
    if (pattern !== false) checkPattern(`security.require.${name}`, pattern);
  }
};

const UNION_KEYS = new Set(['render.waitFor', 'server.fallback', 'shots.motion', 'security.csp']);
const KIND_NAMES = ['string', 'number', 'boolean', 'list', 'object'];

const kindOf = (value: unknown) =>
  Array.isArray(value)
    ? 'list'
    : isPlainObject(value)
      ? 'object'
      : typeof value === 'object' && value !== null
        ? 'other'
        : typeof value;

const checkTypes = (base: unknown, value: unknown, path: string[] = []) => {
  if (!isPlainObject(base) || !isPlainObject(value)) return;
  for (const [key, expected] of Object.entries(base)) {
    const at = [...path, key].join('.');
    const actual = value[key];
    if (UNION_KEYS.has(at) || actual === undefined) continue;
    const kind = kindOf(expected);
    if (!KIND_NAMES.includes(kind)) continue;
    if (kindOf(actual) !== kind) {
      const article = kind === 'object' || kind === 'list' ? 'an' : 'a';
      throw new UsageError(`${at}: must be ${article} ${kind}, got ${JSON.stringify(actual)}`);
    }
    if (kind === 'number') {
      const number = Number(actual);
      const min =
        /(^|\.)(concurrency|limit|maxCases|maxPages|runs)$/.test(at) &&
        at !== 'lighthouse.concurrency'
          ? 1
          : 0;
      if (!Number.isFinite(number) || number < min)
        throw new UsageError(`${at}: must be a number of at least ${min}, got ${number}`);
    }
    if (kind === 'object' && !OPEN_RECORDS.has(at)) checkTypes(expected, actual, [...path, key]);
  }
};

const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

const checkThresholds = (at: string, thresholds: Record<string, unknown> | undefined) => {
  for (const [key, value] of Object.entries(thresholds ?? {})) {
    checkOneOf(`${at}.${key}`, key, LIGHTHOUSE_CATEGORIES);
    if (typeof value !== 'number' || !(value >= 0 && value <= 1))
      throw new UsageError(
        `${at}.${key}: must be a number from 0 to 1, got ${JSON.stringify(value)}`,
      );
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

const checkSeverity = ({ severity, plugins }: VidimusConfig) => {
  const known = [...builtinAudits, ...plugins].map((audit) => audit.name);
  for (const [name, value] of Object.entries(severity)) {
    if (!known.includes(name)) {
      throw new UsageError(`severity.${name}: unknown audit. Known: ${known.join(', ')}`);
    }
    checkOneOf(`severity.${name}`, value, ['error', 'warn', 'off']);
  }
};

const checkChoices = ({
  privacy,
  routes,
  render,
  links,
  server,
  a11y,
  forms,
  budget,
  lighthouse,
  shots,
  html,
  browser,
}: VidimusConfig) => {
  if (typeof privacy.rejectSelector !== 'string')
    throw new UsageError('privacy.rejectSelector: must be a string');
  checkOneOf('routes.discover', routes.discover, ['off', 'sitemap', 'crawl']);
  checkOneOf('render.mode', render.mode, ['off', 'auto', 'on']);
  checkOneOf('server.fallbackStatus', String(server.fallbackStatus), ['200', '404']);
  checkOneOf('a11y.standard', a11y.standard, ['WCAG2A', 'WCAG2AA', 'WCAG2AAA']);
  checkOneOf('a11y.runner', a11y.runner, ['htmlcs', 'axe']);
  checkOneOf('html.source', html.source, ['dist', 'rendered']);
  checkOneOf('forms.stub', forms.stub, ['abort', 'ok']);
  checkOneOf('budget.compression', budget.compression, ['gzip', 'brotli', 'none']);
  for (const [index, scheme] of shots.colorSchemes.entries())
    checkOneOf(`shots.colorSchemes[${index}]`, String(scheme), ['light', 'dark']);
  checkOneOf('lighthouse.preset', lighthouse.preset, ['mobile', 'desktop']);
  for (const [id, level] of Object.entries(lighthouse.audits))
    checkOneOf(`lighthouse.audits.${id}`, level, ['off', 'error']);
  if (!Number.isInteger(lighthouse.runs) || lighthouse.runs < 1)
    throw new UsageError('lighthouse.runs: must be an integer of at least 1');
  if (!Number.isInteger(browser.maxPages) || browser.maxPages < 1)
    throw new UsageError('browser.maxPages: must be an integer of at least 1');
  if (!Number.isInteger(lighthouse.concurrency) || lighthouse.concurrency < 0)
    throw new UsageError('lighthouse.concurrency: must be a non-negative integer');
  if (links.notFound.text) checkPattern('links.notFound.text', links.notFound.text);
  for (const [index, path] of routes.paths.entries()) {
    if (typeof path !== 'string' || !path.startsWith('/'))
      throw new UsageError(`routes.paths[${index}]: must be a path starting with /`);
  }
};

const checkMilliseconds = (at: string, value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new UsageError(`${at}: must be a number of milliseconds, 0 for no limit`);
};

const checkTimeouts = (config: VidimusConfig) => {
  checkMilliseconds('timeout', config.timeout);
  checkMilliseconds('auditTimeout', config.auditTimeout);
  checkMilliseconds('forms.caseTimeout', config.forms.caseTimeout);
};

export const validateConfig = (base: unknown, config: VidimusConfig) => {
  checkIgnoreRules(config.ignore);
  checkTypes(base, config);
  checkPatterns(config);
  checkThresholds('lighthouse.thresholds', config.lighthouse.thresholds);
  for (const [index, override] of config.lighthouse.overrides.entries())
    checkThresholds(`lighthouse.overrides[${index}].thresholds`, override.thresholds);
  checkChoices(config);
  checkAssets(config);
  checkSeverity(config);
  checkTimeouts(config);
};
