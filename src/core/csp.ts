import { tags } from './html.ts';

export type Policy = Map<string, string[]>;

const CASE_SENSITIVE = /^'(?:sha\d+|nonce)-/i;

const lowerOrigin = (source: string) =>
  CASE_SENSITIVE.test(source)
    ? source
    : source.replace(/^(?:[^:/\s]+:\/\/)?[^/]*/, (origin) => origin.toLowerCase());

export const parsePolicy = (policy: string): Policy => {
  const parsed: Policy = new Map();
  for (const [name = '', ...values] of policy
    .split(';')
    .map((directive) => directive.trim().split(/\s+/))) {
    const key = name.toLowerCase();
    if (key && !parsed.has(key)) parsed.set(key, values.map(lowerOrigin));
  }
  return parsed;
};

const splitPolicies = (value: string) =>
  value.split(/,\s*(?=[a-z-]+(?:\s|$))/i).filter((policy) => policy.trim());

export const headerPolicies = (headers: Record<string, string>) =>
  splitPolicies(headers['content-security-policy'] ?? '');

export const metaPolicies = (html: string) =>
  tags(html, 'meta')
    .filter(({ attrs }) => attrs['http-equiv']?.toLowerCase() === 'content-security-policy')
    .flatMap(({ attrs }) => splitPolicies(attrs.content ?? ''));

const NETWORK_SCHEMES = ['http:', 'https:', 'ws:', 'wss:'];
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

const schemeMatches = (scheme: string, protocol: string) =>
  protocol === scheme || (scheme === 'http:' && protocol === 'https:');

const matchesSource = (source: string, url: URL, self: URL) => {
  if (source === "'self'")
    return (
      url.origin === self.origin ||
      (url.host === self.host && url.protocol === (self.protocol === 'http:' ? 'ws:' : 'wss:'))
    );
  if (source === '*') return NETWORK_SCHEMES.includes(url.protocol);
  if (/^[a-z][a-z\d+.-]*:$/.test(source)) return schemeMatches(source, url.protocol);
  if (source.startsWith("'")) return false;
  const parts = /^(?:([a-z][a-z\d+.-]*):\/\/)?(\*|(?:\*\.)?[^/:]+)(?::(\d+|\*))?(\/.*)?$/.exec(
    source,
  );
  if (!parts) return false;
  const [, scheme, host = '', port, path] = parts;
  if (!schemeMatches(scheme ? `${scheme}:` : self.protocol, url.protocol)) return false;
  if (host.startsWith('*.')) {
    if (!url.hostname.endsWith(host.slice(1))) return false;
  } else if (host !== '*' && host !== url.hostname) return false;
  if (port !== '*') {
    const actual = url.port || DEFAULT_PORTS[url.protocol] || '';
    const expected = port ?? DEFAULT_PORTS[url.protocol] ?? '';
    if (actual !== expected && !(port === '80' && actual === '443')) return false;
  }
  if (path && path !== '/') {
    return path.endsWith('/') ? url.pathname.startsWith(path) : url.pathname === path;
  }
  return true;
};

const FETCH_CHAINS: Record<string, string[]> = {
  frame: ['frame-src', 'child-src', 'default-src'],
  connect: ['connect-src', 'default-src'],
  img: ['img-src', 'default-src'],
  font: ['font-src', 'default-src'],
  media: ['media-src', 'default-src'],
  manifest: ['manifest-src', 'default-src'],
  object: ['object-src', 'default-src'],
  style: ['style-src-elem', 'style-src', 'default-src'],
  script: ['script-src-elem', 'script-src', 'default-src'],
  worker: ['worker-src', 'child-src', 'script-src', 'default-src'],
  form: ['form-action'],
  base: ['base-uri'],
  prefetch: ['prefetch-src', 'default-src'],
};

export const effectiveSources = (policy: Policy, kind: string) => {
  const name = (FETCH_CHAINS[kind] ?? []).find((directive) => policy.has(directive));
  return name ? policy.get(name) : undefined;
};

export const requestAllowed = (policy: Policy, kind: string, url: URL, self: URL) => {
  const directive = (FETCH_CHAINS[kind] ?? []).find((name) => policy.has(name));
  if (!directive) return { directive: '', allowed: true };
  const sources = policy.get(directive) ?? [];
  if (kind === 'script' && sources.some((source) => source.toLowerCase() === "'strict-dynamic'"))
    return { directive, allowed: true };
  return { directive, allowed: sources.some((source) => matchesSource(source, url, self)) };
};

export const frameAllowed = (policy: Policy, url: URL, self: URL) =>
  requestAllowed(policy, 'frame', url, self);
