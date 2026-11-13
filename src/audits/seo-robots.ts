import { existsSync, readFileSync } from 'node:fs';
import type { Finding } from '../core/types.ts';

type Rule = { allow: boolean; path: string };
type Groups = Map<string, Rule[]>;

export interface Robots {
  sitemaps: string[];
  blocked: string[];
  groups: Groups;
  bytes: number;
}

const FULL_BLOCKS = new Set(['/', '/*', '/*$']);
const PARSING_LIMIT = 512_000;

// Google reads two robots meta tokens: `googlebot` for all its text results and `googlebot-news`
// for news only, so a `googlebot-news:` directive does not keep a page out of web search.
const isGooglebot = (agent: string) => agent === 'googlebot';

export const robotsRules = (text: string, bytes = Buffer.byteLength(text)): Robots => {
  const sitemaps: string[] = [];
  const fullBlocks = new Set<string>();
  const allows = new Set<string>();
  const groups: Groups = new Map();
  let agents: string[] = [];
  let inRules = false;
  // RFC 9309 §2.2: a line ends in CR, LF or CRLF.
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (key === 'sitemap') {
      sitemaps.push(value);
    } else if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value);
      // A group with no rules still matches its agent and allows everything (§2.2.1).
      const name = value.toLowerCase();
      if (!groups.has(name)) groups.set(name, []);
    } else {
      inRules = true;
      if (key === 'disallow' && FULL_BLOCKS.has(value)) {
        for (const agent of agents) fullBlocks.add(agent);
      }
      if ((key === 'allow' || key === 'disallow') && value) {
        for (const agent of agents) {
          const name = agent.toLowerCase();
          if (key === 'allow') allows.add(agent);
          groups.set(name, [...(groups.get(name) ?? []), { allow: key === 'allow', path: value }]);
        }
      }
    }
  }
  return {
    sitemaps,
    blocked: [...fullBlocks].filter((agent) => !allows.has(agent)),
    groups,
    bytes,
  };
};

// RFC 9309 §2.2.2: compare paths with non-ASCII octets percent-encoded (UTF-8) and percent-encoded
// unreserved characters decoded; other escapes stay, with upper-case hex.
const normalizePath = (path: string) =>
  path
    .replace(/[^\p{ASCII}]+/gu, (text) => encodeURIComponent(text))
    .replace(/%([\da-f]{2})/gi, (match, hex: string) => {
      const char = String.fromCharCode(Number.parseInt(hex, 16));
      return /[A-Za-z\d\-._~]/.test(char) ? char : match.toUpperCase();
    });

// Matches `*` wildcards left to right without backtracking, so many `*` in one rule stay linear
// (a `.*` regex is exponential on rules like `/*a*a*a*a*c`). A final `$` anchors the end.
const ruleMatcher = (pattern: string) => {
  const anchored = pattern.endsWith('$');
  const [first = '', ...rest] = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  const last = rest.pop();
  return (path: string) => {
    if (!path.startsWith(first)) return false;
    if (last === undefined) return !anchored || path.length === first.length;
    let position = first.length;
    for (const part of rest) {
      const index = path.indexOf(part, position);
      if (index < 0) return false;
      position = index + part.length;
    }
    return anchored
      ? path.length - last.length >= position && path.endsWith(last)
      : path.includes(last, position);
  };
};

export const disallowedBy = (groups: Groups) => {
  const rules = (groups.has('googlebot') ? groups.get('googlebot') : groups.get('*')) ?? [];
  const compiled = rules.map((rule) => ({ rule, test: ruleMatcher(normalizePath(rule.path)) }));
  return (path: string) => {
    const normalized = normalizePath(path);
    let best: { allow: boolean; length: number } | undefined;
    for (const { rule, test } of compiled) {
      if (!test(normalized)) continue;
      const length = rule.path.length;
      if (!best || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
    return best !== undefined && !best.allow;
  };
};

const GOOGLE_DIRECTIVES = new Set([
  'all',
  'none',
  'noindex',
  'nofollow',
  'nosnippet',
  'indexifembedded',
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
  'notranslate',
  'noimageindex',
  'noarchive',
  'nositelinkssearchbox',
  'unavailable_after',
]);

export const robotsDirectives = (value: string) => {
  const found: string[] = [];
  let scoped = false;
  for (const token of value.split(',')) {
    const match = /^\s*([a-z0-9_-]+)\s*:(.*)$/i.exec(token);
    let directive = token;
    if (match && !GOOGLE_DIRECTIVES.has((match[1] ?? '').toLowerCase())) {
      scoped = !isGooglebot((match[1] ?? '').toLowerCase());
      directive = match[2] ?? '';
    }
    if (!scoped) found.push(directive.trim().toLowerCase());
  }
  return found;
};

export const readRobots = (file: string) => {
  if (!existsSync(file)) return undefined;
  const buffer = readFileSync(file);
  return robotsRules(buffer.toString('utf8'), buffer.byteLength);
};

export const robotsFindings = (
  robots: Robots | undefined,
  indexable: { path: string }[],
  file: string,
): Finding[] => {
  if (!robots) {
    return [
      {
        message: 'no robots.txt',
        severity: 'warn',
        fix: 'Add a robots.txt to the build output with a User-agent and Sitemap line, or turn seo.robots off.',
      },
    ];
  }
  const disallowed = disallowedBy(robots.groups);
  return [
    ...(robots.bytes > PARSING_LIMIT
      ? [
          {
            message:
              'robots.txt is larger than 500 KiB, so crawlers may ignore rules past the parsing limit',
            severity: 'warn' as const,
            file,
            fix: 'Shorten robots.txt to 512,000 bytes or less, keeping only the rules crawlers need.',
          },
        ]
      : []),
    ...robots.blocked.map(
      (agent): Finding => ({
        message: `robots.txt disallows everything for User-agent: ${agent}`,
        ...(agent === '*' ? {} : { severity: 'warn' as const }),
        file,
        fix: `Remove the full "Disallow" rule (/ or /*) from the User-agent: ${agent} group in robots.txt so crawlers can index the site.`,
      }),
    ),
    ...indexable
      .filter(({ path }) => disallowed(path))
      .map(
        ({ path }): Finding => ({
          message: 'indexable page disallowed by robots.txt',
          severity: 'warn',
          where: [path],
          file,
          fix: 'Remove the matching Disallow rule from robots.txt, or add robots noindex and drop the page from the sitemap if it should stay out of search.',
        }),
      ),
    ...(robots.sitemaps.length
      ? []
      : [
          {
            message: 'robots.txt has no Sitemap line',
            severity: 'warn' as const,
            file,
            fix: 'Add a line like "Sitemap: https://example.com/sitemap.xml" to robots.txt.',
          },
        ]),
  ];
};
