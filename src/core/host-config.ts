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

const conditional = (item: Record<string, unknown>) =>
  list(item.has).length > 0 || list(item.missing).length > 0;

const parseVercel: HostParser = (text, ignored) =>
  list(obj(JSON.parse(text)).headers).flatMap((item) => {
    const entry = obj(item);
    if (!conditional(entry)) return hostRule(entry.source, keyValues(entry.headers), ignored);
    if (typeof entry.source === 'string') ignored.push(entry.source);
    return [];
  });

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

const TOML_ESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '"': '"',
  '\\': '\\',
};

// TOML basic strings: \uXXXX, \UXXXXXXXX and the short escapes; a line-ending backslash in a
// multi-line string drops the newline and the whitespace after it.
const unescapeToml = (value: string) =>
  value.replace(
    /\\(?:u([\da-fA-F]{4})|U([\da-fA-F]{8})|([btnfr"\\])|[ \t]*\r?\n\s*)/g,
    (match, u, U, short) =>
      u || U
        ? String.fromCodePoint(Number.parseInt(u ?? U, 16))
        : short
          ? (TOML_ESCAPES[short] ?? match)
          : '',
  );

const TOML_KEY = /^("[^"]+"|[\w-]+)\s*=\s*/;

// Reads the string value starting at `rest` (after `key =`), pulling more lines for a multi-line
// string. Returns the value and how many extra lines it used.
const tomlString = (rest: string, lines: string[], at: number) => {
  for (const quote of ['"""', "'''"]) {
    if (!rest.startsWith(quote)) continue;
    let body = rest.slice(3);
    let used = 0;
    while (!body.includes(quote) && at + used + 1 < lines.length) {
      used += 1;
      body += `\n${lines[at + used]}`;
    }
    const raw = body.slice(0, body.indexOf(quote)).replace(/^\r?\n/, '');
    return { value: quote === '"""' ? unescapeToml(raw) : raw, used };
  }
  const basic = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
  if (basic) return { value: unescapeToml(basic[1] ?? ''), used: 0 };
  const literal = /^'([^']*)'/.exec(rest);
  return literal ? { value: literal[1] ?? '', used: 0 } : undefined;
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
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inValues = line === '[headers.values]';
      if (line === '[[headers]]') {
        flush();
        source = '';
      } else if (!inValues) flush();
      continue;
    }
    const key = TOML_KEY.exec(line);
    if (!key?.[1] || source === undefined) continue;
    const parsed = tomlString(line.slice(key[0].length), lines, index);
    if (!parsed) continue;
    index += parsed.used;
    // A multi-line header value is folded to one line, as a header cannot carry newlines.
    const value = parsed.value.replace(/\s*\n\s*/g, ' ').trim();
    if (inValues) pairs.push([key[1].replace(/^"|"$/g, ''), value]);
    else if (key[1] === 'for') source = value;
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
