import { type HeaderRule, headerRule, patternRegExp, rulePath } from './header-rules.ts';

export type HostParser = (text: string, ignored: string[]) => HeaderRule[];

const supportedPattern = (source: string) => {
  const pattern = source.replace(/\/\(\.\*\)$/, '/*').replace(/\*\*/g, '*');
  const unsupported = /[(){}[\]?|]/.test(pattern.replace(/:[A-Za-z_]\w*[?]/g, ''));
  return unsupported ? undefined : pattern;
};

const hostRule = (source: unknown, pairs: [string, unknown][], ignored: string[]): HeaderRule[] => {
  if (typeof source !== 'string') return [];
  const pattern = supportedPattern(source);
  if (pattern === undefined) {
    ignored.push(source);
    return [];
  }
  const set = pairs.flatMap(([name, value]): [string, string][] =>
    name && typeof value === 'string' ? [[name.toLowerCase(), value]] : [],
  );
  return pattern && set.length ? [headerRule(pattern, set)] : [];
};

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const keyValues = (value: unknown): [string, unknown][] =>
  list(value).map((item) => [String(obj(item).key ?? ''), obj(item).value]);

const objectPairs = (value: unknown): [string, unknown][] => Object.entries(obj(value));

const hostings = (json: unknown) => [obj(json).hosting].flat().map(obj);

const sourceRules = (value: unknown, ignored: string[]) =>
  list(value).flatMap((item) => hostRule(obj(item).source, keyValues(obj(item).headers), ignored));

const parseVercel: HostParser = (text, ignored) =>
  sourceRules(obj(JSON.parse(text)).headers, ignored);

const parseFirebase: HostParser = (text, ignored) =>
  hostings(JSON.parse(text)).flatMap(({ headers }) => sourceRules(headers, ignored));

const parseStaticWebApp: HostParser = (text, ignored) => {
  const json = obj(JSON.parse(text));
  return [
    ...hostRule('/*', objectPairs(json.globalHeaders), ignored),
    ...list(json.routes).flatMap((route) =>
      hostRule(obj(route).route, objectPairs(obj(route).headers), ignored),
    ),
  ];
};

const parseNetlify: HostParser = (text, ignored) => {
  const rules: HeaderRule[] = [];
  let source: string | undefined;
  let pairs: [string, unknown][] = [];
  let inValues = false;
  const flush = () => {
    if (source !== undefined) rules.push(...hostRule(source, pairs, ignored));
    source = undefined;
    pairs = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inValues = line === '[headers.values]';
      if (line === '[[headers]]') {
        flush();
        source = '';
      } else if (!inValues) flush();
      continue;
    }
    const entry = line.match(/^("[^"]+"|[\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
    if (!entry?.[1] || source === undefined) continue;
    const value = entry[2] ?? entry[3] ?? '';
    if (inValues) pairs.push([entry[1].replace(/^"|"$/g, ''), value]);
    else if (entry[1] === 'for') source = value;
  }
  flush();
  return rules;
};

export const HOST_FILES: [string, HostParser][] = [
  ['vercel.json', parseVercel],
  ['netlify.toml', parseNetlify],
  ['firebase.json', parseFirebase],
  ['staticwebapp.config.json', parseStaticWebApp],
];

const redirectFrom = (source: unknown) => (typeof source === 'string' ? [source] : []);

const jsonSources = (value: unknown) =>
  list(value).flatMap((item) => redirectFrom(obj(item).source));

const REDIRECT_SOURCES: Record<string, (text: string) => string[]> = {
  _redirects: (text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0] ?? '')
      .filter((from) => from && !from.startsWith('#')),
  'netlify.toml': (text) =>
    [...text.matchAll(/^\s*from\s*=\s*(?:"([^"]*)"|'([^']*)')/gm)].map((m) => m[1] ?? m[2] ?? ''),
  'vercel.json': (text) => jsonSources(obj(JSON.parse(text)).redirects),
  'firebase.json': (text) =>
    hostings(JSON.parse(text)).flatMap(({ redirects }) => jsonSources(redirects)),
  'staticwebapp.config.json': (text) =>
    list(obj(JSON.parse(text)).routes).flatMap((route) =>
      obj(route).redirect ? redirectFrom(obj(route).route) : [],
    ),
};

export const redirectSourcesIn = (name: string, text: string) =>
  REDIRECT_SOURCES[name]?.(text) ?? [];

export const redirectPattern = (source: string) => {
  const pattern = supportedPattern(rulePath(source));
  return pattern ? patternRegExp(pattern) : undefined;
};
