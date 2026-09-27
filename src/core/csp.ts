import { tags } from './html.ts';

export type Policy = Map<string, string[]>;

export const parsePolicy = (policy: string): Policy =>
  new Map(
    policy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name = '', ...values]) => [name.toLowerCase(), values.map((v) => v.toLowerCase())]),
  );

export const headerPolicies = (headers: Record<string, string>) =>
  (headers['content-security-policy'] ?? '').split(',').filter((policy) => policy.trim());

export const metaPolicies = (html: string) =>
  tags(html, 'meta')
    .filter(({ attrs }) => attrs['http-equiv']?.toLowerCase() === 'content-security-policy')
    .map(({ attrs }) => attrs.content ?? '');

const NETWORK_SCHEMES = ['http:', 'https:', 'ws:', 'wss:'];
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

// A scheme matches itself, and http also allows its secure upgrade.
const schemeMatches = (scheme: string, protocol: string) =>
  protocol === scheme || (scheme === 'http:' && protocol === 'https:');

// CSP source expression matching (CSP Level 3, "Does url match expression in origin").
const matchesSource = (source: string, url: URL, self: URL) => {
  if (source === "'self'") return url.origin === self.origin;
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

const FRAME_DIRECTIVES = ['frame-src', 'child-src', 'default-src'];

// The frame directive in effect and whether it allows url; no directive allows everything.
export const frameAllowed = (policy: Policy, url: URL, self: URL) => {
  const directive = FRAME_DIRECTIVES.find((name) => policy.has(name));
  if (!directive) return { directive: '', allowed: true };
  const sources = policy.get(directive) ?? [];
  return { directive, allowed: sources.some((source) => matchesSource(source, url, self)) };
};
