import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { headerPolicies, metaPolicies, type Policy, parsePolicy } from '../core/csp.ts';
import type { BuiltPage, Tag } from '../core/html.ts';
import { relTokens, resolveHref, srcsetUrls, tags } from '../core/html.ts';
import type { Audit, Finding, Severity } from '../core/types.ts';
import { escapeRegExp, inParallel, matchesAny } from '../core/util.ts';

export interface HeaderRule {
  pattern: string;
  match: RegExp;
  set: [string, string][];
  detach: string[];
}

export type HeaderMap = Record<string, string>;

const patternRegExp = (pattern: string) => {
  const source = pattern
    .split(/(\*|:[A-Za-z_]\w*)/)
    .map((part) =>
      part === '*' ? '.*' : part.startsWith(':') && part.length > 1 ? '[^/]+' : escapeRegExp(part),
    )
    .join('');
  return new RegExp(`^${source.replace(/\\\/$/, '')}\\/?$`);
};

const rulePath = (line: string) => {
  const url = line.match(/^[a-z][a-z\d+.-]*:\/\/[^/]+(.*)$/i);
  return url ? url[1] || '/' : line;
};

export const parseHeadersFile = (text: string): HeaderRule[] => {
  const rules: HeaderRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      const pattern = rulePath(line);
      rules.push({ pattern, match: patternRegExp(pattern), set: [], detach: [] });
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

export const headersFor = (rules: HeaderRule[], path: string): HeaderMap => {
  const headers: HeaderMap = {};
  for (const rule of rules) {
    if (!rule.match.test(path)) continue;
    for (const name of rule.detach) delete headers[name];
    for (const [name, value] of rule.set) {
      headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
    }
  }
  return headers;
};

const FETCH_TIMEOUT = 20_000;
const MAX_REDIRECTS = 5;

const request = async (url: string) => {
  const init = { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT) } as const;
  let response = await fetch(url, { ...init, method: 'HEAD' });
  if (response.status === 405) response = await fetch(url, init);
  await response.body?.cancel();
  return response;
};

const fetchHeaders = async (url: string): Promise<HeaderMap> => {
  let current = new URL(url);
  let response = await request(current.href);
  for (let hops = 0; hops < MAX_REDIRECTS; hops += 1) {
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) break;
    const next = new URL(location, current);
    if (next.origin !== current.origin) break;
    current = next;
    response = await request(current.href);
  }
  return Object.fromEntries([...response.headers].map(([name, value]) => [name, value]));
};

const unsafeSources = (policy: Policy) => {
  const sources = policy.get('script-src') ?? policy.get('default-src') ?? [];
  const guarded = sources.some((source) => /^'(nonce|sha(256|384|512))-/.test(source));
  return [
    ...(sources.includes("'unsafe-inline'") && !guarded ? ["'unsafe-inline'"] : []),
    ...(sources.includes("'unsafe-eval'") ? ["'unsafe-eval'"] : []),
  ];
};

const RESOURCES: Record<string, string[]> = {
  script: ['src'],
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  iframe: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  object: ['data'],
  embed: ['src'],
  form: ['action'],
};

const LINK_RESOURCES = ['stylesheet', 'icon', 'preload', 'modulepreload', 'manifest'];

const urlsIn = (tag: Tag, attr: string) => {
  const value = tag.attrs[attr];
  if (!value) return [];
  return attr === 'srcset' ? srcsetUrls(value) : [value.trim()];
};

const insecureResources = (html: string) => {
  const found: string[] = [];
  for (const tag of tags(html, 'link', ...Object.keys(RESOURCES))) {
    const attrs =
      tag.name === 'link'
        ? relTokens(tag).some((rel) => LINK_RESOURCES.includes(rel))
          ? ['href']
          : []
        : (RESOURCES[tag.name] ?? []);
    for (const attr of attrs) {
      for (const url of urlsIn(tag, attr)) if (/^http:\/\//i.test(url)) found.push(url);
    }
  }
  return found;
};

const crossOriginWithoutIntegrity = (page: BuiltPage, siteUrl: string) => {
  const candidates = [
    ...tags(page.html, 'script').map((tag) => ({ tag, href: tag.attrs.src })),
    ...tags(page.html, 'link')
      .filter((tag) => relTokens(tag).includes('stylesheet'))
      .map((tag) => ({ tag, href: tag.attrs.href })),
  ];
  return candidates.flatMap(({ tag, href }) => {
    if (!href || tag.attrs.integrity) return [];
    const target = resolveHref(href, page.path, siteUrl);
    if (!target || target.internal || !target.absolute) return [];
    if (!/^https?:$/.test(target.url.protocol)) return [];
    return [{ kind: tag.name, url: target.href }];
  });
};

const VERSION = /\d+\.\d+|\/\s*\d/;

const RECOMMENDED: Record<string, string> = {
  'strict-transport-security': 'Strict-Transport-Security: max-age=31536000; includeSubDomains',
  'x-content-type-options': 'X-Content-Type-Options: nosniff',
  'referrer-policy': 'Referrer-Policy: strict-origin-when-cross-origin',
  'permissions-policy': 'Permissions-Policy: camera=(), microphone=(), geolocation=()',
};

const UNSAFE_FIXES: Record<string, string> = {
  "'unsafe-inline'":
    "Drop 'unsafe-inline' from script-src and allow inline scripts by 'sha256-…' hash or nonce, or move them to files.",
  "'unsafe-eval'":
    "Drop 'unsafe-eval' from script-src and replace the eval()/new Function() code or the library that needs it.",
};

interface ReportOptions {
  severity?: Severity;
  details?: string[];
  fix: string;
}

export const security: Audit = {
  name: 'security',
  description: 'security headers, clickjacking, unsafe CSP, mixed content and SRI',
  requires: 'dist',
  async run({ config, builtPages, dist, log }) {
    const options = config.security;
    const pages = builtPages(config.exclude).filter(
      (page) => !matchesAny(options.exclude, page.path),
    );
    if (!pages.length) return { status: 'skipped', summary: 'no pages to check' };

    const grouped = new Map<string, Finding>();
    const report = (message: string, where: string, { severity, details, fix }: ReportOptions) => {
      const key = [message, ...(details ?? [])].join('\n');
      const finding = grouped.get(key) ?? {
        message,
        where: [],
        ...(details ? { details } : {}),
        ...(severity ? { severity } : {}),
        fix,
      };
      if (!finding.where?.includes(where)) finding.where?.push(where);
      grouped.set(key, finding);
    };

    const origin = config.origin.replace(/\/$/, '');
    const headersFile = join(dist, options.file);
    const headers = new Map<string, HeaderMap>();
    let source = '';

    if (origin) {
      source = origin;
      await inParallel(8, pages, async (page) => {
        try {
          headers.set(page.path, await fetchHeaders(origin + page.path));
        } catch (error) {
          report('could not fetch headers', page.path, {
            details: [error instanceof Error ? error.message : String(error)],
            fix: `Make sure ${origin} is up and serves this page, or drop --origin to read ${options.file} from the build.`,
          });
        }
      });
    } else if (existsSync(headersFile)) {
      source = options.file;
      const rules = parseHeadersFile(readFileSync(headersFile, 'utf8'));
      for (const page of pages) headers.set(page.path, headersFor(rules, page.path));
    } else {
      log(
        `header checks skipped: no ${options.file} in the build and no --origin to fetch headers from`,
      );
    }

    const headerHome = origin ? "your host's header config" : `/* in ${options.file}`;

    for (const page of pages) {
      const where = page.path;
      const received = headers.get(where);

      if (received) {
        for (const [name, pattern] of Object.entries(options.require)) {
          if (pattern === false) continue;
          const key = name.toLowerCase();
          const value = received[key];
          const skip = `set security.require["${key}"] to false to skip`;
          const recommended = RECOMMENDED[key];
          if (value === undefined) {
            report(`missing ${key} header`, where, {
              fix: recommended
                ? `Add "${recommended}" to ${headerHome}, or ${skip}.`
                : `Add a ${key} header matching ${pattern || 'any value'} to ${headerHome}, or ${skip}.`,
            });
          } else if (pattern && !new RegExp(pattern, 'i').test(value)) {
            report(`${key} header does not match ${pattern}`, where, {
              details: [value],
              fix: recommended
                ? `Change it to "${recommended}" in ${headerHome}, or relax security.require["${key}"].`
                : `Change it to a value matching ${pattern} in ${headerHome}, or relax security.require["${key}"].`,
            });
          }
        }

        if (options.clickjacking) {
          const framed = headerPolicies(received).some((policy) =>
            parsePolicy(policy).has('frame-ancestors'),
          );
          const xfo = /^\s*(deny|sameorigin)\s*$/i.test(received['x-frame-options'] ?? '');
          if (!framed && !xfo) {
            report(
              'no clickjacking protection: add CSP frame-ancestors or X-Frame-Options',
              where,
              {
                fix: `Send "Content-Security-Policy: frame-ancestors 'self'" (or X-Frame-Options: DENY) as a header; a <meta> CSP can't set frame-ancestors.`,
              },
            );
          }
        }

        if (origin) {
          const poweredBy = received['x-powered-by'];
          if (poweredBy) {
            report('x-powered-by header leaks the stack', where, {
              severity: 'warn',
              details: [poweredBy],
              fix: 'Remove the X-Powered-By header in your server or framework config (e.g. app.disable("x-powered-by") in Express).',
            });
          }
          const server = received.server;
          if (server && VERSION.test(server)) {
            report('server header leaks a version', where, {
              severity: 'warn',
              details: [server],
              fix: 'Hide the version in the Server header (e.g. "server_tokens off;" in nginx, "ServerTokens Prod" in Apache).',
            });
          }
        }
      }

      if (options.unsafeInline) {
        const policies = [
          ...(received ? headerPolicies(received) : []),
          ...metaPolicies(page.html),
        ];
        const unsafe = new Set(policies.flatMap((policy) => unsafeSources(parsePolicy(policy))));
        for (const keyword of unsafe) {
          report(`CSP allows ${keyword} scripts`, where, {
            severity: 'warn',
            fix: UNSAFE_FIXES[keyword] ?? `Drop ${keyword} from script-src.`,
          });
        }
      }

      if (options.mixedContent) {
        for (const url of new Set(insecureResources(page.html))) {
          report(`mixed content: ${url}`, where, { fix: 'Load it over https:// or self-host it.' });
        }
      }

      if (options.sri) {
        for (const { kind, url } of crossOriginWithoutIntegrity(page, config.siteUrl)) {
          report(`cross-origin <${kind}> without integrity: ${url}`, where, {
            severity: 'warn',
            fix: 'Add integrity="sha384-…" and crossorigin="anonymous", or self-host the file.',
          });
        }
      }
    }

    const findings = [...grouped.values()];
    return {
      summary: `${pages.length} pages, headers from ${source || 'nowhere (skipped)'}, ${
        findings.length ? `${findings.length} problem(s)` : 'no problems'
      }`,
      findings,
    };
  },
};
