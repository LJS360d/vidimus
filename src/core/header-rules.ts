import { escapeRegExp } from './util.ts';

export interface HeaderRule {
  pattern: string;
  match: RegExp;
  set: [string, string][];
  detach: string[];
}

export type HeaderMap = Record<string, string>;

const SINGLE_VALUED = new Set([
  'x-frame-options',
  'x-content-type-options',
  'strict-transport-security',
  'referrer-policy',
]);

const placeholder = (part: string) => {
  const modifier = part.at(-1);
  if (modifier === '*') return '.*';
  if (modifier === '+') return '.+';
  return modifier === '?' ? '[^/]*' : '[^/]+';
};

const compiled = new Map<string, RegExp>();

export const patternRegExp = (pattern: string) => {
  let match = compiled.get(pattern);
  if (!match) {
    const source = pattern
      .split(/(\*|:[A-Za-z_]\w*[*+?]?)/)
      .map((part) => {
        if (part === '*') return '.*';
        return part.startsWith(':') && part.length > 1 ? placeholder(part) : escapeRegExp(part);
      })
      .join('');
    match = new RegExp(`^${source.replace(/\\\/$/, '')}\\/?$`);
    compiled.set(pattern, match);
  }
  return match;
};

export const rulePath = (line: string) => {
  const url = line.match(/^[a-z][a-z\d+.-]*:\/\/[^/]+(.*)$/i);
  return url ? url[1] || '/' : line;
};

export const headerRule = (pattern: string, set: [string, string][] = []): HeaderRule => ({
  pattern,
  match: patternRegExp(pattern),
  set,
  detach: [],
});

export const parseHeadersFile = (text: string): HeaderRule[] => {
  const rules: HeaderRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      rules.push(headerRule(rulePath(line)));
      continue;
    }
    const rule = rules.at(-1);
    if (!rule) continue;
    if (line.startsWith('!')) {
      rule.detach.push(line.slice(1).trim().toLowerCase());
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    rule.set.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return rules;
};

const mergeValue = (current: string | undefined, name: string, value: string) => {
  if (!current || SINGLE_VALUED.has(name)) return value;
  const known = current
    .split(',')
    .some((part) => part.trim().toLowerCase() === value.toLowerCase());
  return known ? current : `${current}, ${value}`;
};

export const headersFor = (rules: HeaderRule[], path: string): HeaderMap => {
  const headers: HeaderMap = {};
  for (const rule of rules) {
    if (!rule.match.test(path)) continue;
    for (const name of rule.detach) delete headers[name];
    for (const [name, value] of rule.set) headers[name] = mergeValue(headers[name], name, value);
  }
  return headers;
};
