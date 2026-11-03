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

// CSP3 §2.2.3: a header value is a comma-separated list of policies; every comma splits, so
// `img-src a.com,b.com` is two policies and `b.com` alone is an (ignored) directive name.
const splitPolicies = (value: string) => value.split(',').filter((policy) => policy.trim());

export const headerPolicies = (headers: Record<string, string>) =>
  splitPolicies(headers['content-security-policy'] ?? '');

// A <meta> holds one serialized policy (CSP3 §3.3): commas there do not split.
export const metaPolicies = (html: string) =>
  tags(html, 'meta')
    .filter(({ attrs }) => attrs['http-equiv']?.toLowerCase() === 'content-security-policy')
    .map(({ attrs }) => attrs.content ?? '')
    .filter((policy) => policy.trim());

const NETWORK_SCHEMES = ['http:', 'https:', 'ws:', 'wss:'];
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

const schemeMatches = (scheme: string, protocol: string) =>
  protocol === scheme ||
  (scheme === 'http:' && protocol === 'https:') ||
  (scheme === 'ws:' && protocol === 'wss:');

const implicitSchemes = (self: URL) =>
  self.protocol === 'http:' ? ['http:', 'ws:'] : ['https:', 'wss:'];

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
  const schemes = scheme ? [`${scheme}:`] : implicitSchemes(self);
  if (!schemes.some((candidate) => schemeMatches(candidate, url.protocol))) return false;
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

const canonicalBase64 = (value: string) =>
  value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');

// CSP3 §6.7.2.3 (script-src pre-request check): an external script passes when every item of
// its integrity metadata matches a hash source of the list.
const integrityAllowed = (sources: string[], integrity = '') => {
  const hashes = sources.flatMap((source) => {
    const match = /^'(sha(?:256|384|512))-([A-Za-z0-9+/=_-]+)'$/i.exec(source);
    return match ? [`${match[1]?.toLowerCase()}-${canonicalBase64(match[2] ?? '')}`] : [];
  });
  const items = integrity
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => {
      const [algorithm = '', value = ''] = item.split('?')[0]?.split(/-(.*)/s) ?? [];
      return `${algorithm.toLowerCase()}-${canonicalBase64(value)}`;
    });
  return hashes.length > 0 && items.length > 0 && items.every((item) => hashes.includes(item));
};

export const requestAllowed = (
  policy: Policy,
  kind: string,
  url: URL,
  self: URL,
  tag?: { nonce?: string; integrity?: string },
) => {
  const directive = (FETCH_CHAINS[kind] ?? []).find((name) => policy.has(name));
  if (!directive) return { directive: '', allowed: true };
  const sources = policy.get(directive) ?? [];
  if (kind === 'script' && sources.some((source) => source.toLowerCase() === "'strict-dynamic'")) {
    if (!tag) return { directive, allowed: true };
    return {
      directive,
      allowed:
        (tag.nonce !== undefined && sources.includes(`'nonce-${tag.nonce}'`)) ||
        integrityAllowed(sources, tag.integrity),
    };
  }
  // A matching nonce allows a <script src> or stylesheet <link> wherever it loads from.
  if (tag?.nonce && sources.includes(`'nonce-${tag.nonce}'`)) return { directive, allowed: true };
  if (kind === 'script' && integrityAllowed(sources, tag?.integrity))
    return { directive, allowed: true };
  return { directive, allowed: sources.some((source) => matchesSource(source, url, self)) };
};

export const frameAllowed = (policy: Policy, url: URL, self: URL) =>
  requestAllowed(policy, 'frame', url, self);
