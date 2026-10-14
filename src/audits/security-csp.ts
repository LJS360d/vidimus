import { effectiveSources, type Policy } from '../core/csp.ts';
import type { Finding } from '../core/types.ts';
import { hasKeyword, hasNonceOrHash } from './util.ts';

export interface PagePolicy {
  policy: Policy;
  meta: boolean;
}

const BYPASS_HOSTS = [
  'ajax.googleapis.com',
  'cdnjs.cloudflare.com',
  'accounts.google.com',
  'www.google.com',
  'www.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'googleapis.com',
  'cloudfront.net',
  'amazonaws.com',
  'appspot.com',
  'herokuapp.com',
];

const WILDCARD_HOST = /^(?:[a-z][a-z\d+.-]*:\/\/)?\*\.[^/]+/;
const META_IGNORED = ['frame-ancestors', 'report-uri', 'sandbox'];

export const ANY_ANCESTOR = /^(\*|[a-z][a-z\d+.-]*:)$/;

export const STARTER_CSP =
  "Send a Content-Security-Policy header, e.g. \"default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'\", and hash or nonce inline scripts.";

const UNSAFE_FIXES: Record<string, string> = {
  "'unsafe-inline'":
    "Drop 'unsafe-inline' from script-src and allow inline scripts by 'sha256-…' hash or nonce, or move them to files.",
  "'unsafe-eval'":
    "Drop 'unsafe-eval' from script-src and replace the eval()/new Function() code or the library that needs it.",
};

const bypassHost = (source: string) => {
  const host = source
    .replace(/^[a-z][a-z\d+.-]*:\/\//, '')
    .replace(/[/:].*$/, '')
    .replace(/^\*\./, '');
  return BYPASS_HOSTS.find((known) => host === known || host.endsWith(`.${known}`));
};

const warn = (message: string, fix: string): Finding => ({ message, severity: 'warn', fix });

const unsafeScripts = (policy: Policy) => {
  const sources = effectiveSources(policy, 'script') ?? [];
  const guarded = hasKeyword(sources, "'strict-dynamic'") || hasNonceOrHash(sources);
  return [
    ...(hasKeyword(sources, "'unsafe-inline'") && !guarded ? ["'unsafe-inline'"] : []),
    ...(hasKeyword(sources, "'unsafe-eval'") ? ["'unsafe-eval'"] : []),
  ];
};

const scriptSourceIssues = (scripts: string[], where: string) => {
  const issues: Finding[] = [];
  if (!scripts.includes("'strict-dynamic'")) {
    for (const source of ['*', 'https:', 'data:']) {
      if (!scripts.includes(source)) continue;
      issues.push(
        warn(
          `CSP ${where} allows ${source}`,
          `Replace ${source} in ${where} with the exact origins, nonces or hashes your scripts need.`,
        ),
      );
    }
  }
  if (scripts.includes('http:')) {
    issues.push(
      warn(
        `CSP ${where} allows http:`,
        `Replace http: in ${where} with https: origins, nonces or hashes.`,
      ),
    );
  }
  if (scripts.includes("'strict-dynamic'")) return issues;
  for (const source of scripts) {
    const known = bypassHost(source);
    if (known) {
      issues.push(
        warn(
          `CSP ${where} allows ${known}, which hosts script gadgets that bypass the policy`,
          `Remove ${source} from ${where} and use nonces or hashes, or self-host the script.`,
        ),
      );
    } else if (WILDCARD_HOST.test(source)) {
      issues.push(
        warn(
          `CSP ${where} allows the wildcard host ${source}`,
          `Replace ${source} in ${where} with the exact hosts you load scripts from.`,
        ),
      );
    }
  }
  return issues;
};

const styleIssues = (policy: Policy) => {
  const styles = effectiveSources(policy, 'style') ?? [];
  const unsafe = ["'unsafe-inline'", "'unsafe-eval'"].filter(
    (keyword) =>
      hasKeyword(styles, keyword) &&
      !(keyword === "'unsafe-inline'" && styles.some((s) => /^'(nonce|sha\d+)-/i.test(s))),
  );
  return unsafe.map((keyword) =>
    warn(
      `CSP style-src allows ${keyword}`,
      `Drop ${keyword} from style-src and use nonces or hashes for inline styles.`,
    ),
  );
};

const missingIssues = (policy: Policy, forms: boolean) => [
  ...(policy.has('report-uri') && !policy.has('report-to')
    ? [
        warn(
          'CSP uses report-uri without report-to',
          'Add report-to (with a Reporting-Endpoints header) next to report-uri.',
        ),
      ]
    : []),
  ...(forms && !policy.has('form-action')
    ? [warn('CSP lacks form-action', "Add form-action 'self' to the CSP.")]
    : []),
  ...(!policy.has('object-src') && !policy.has('default-src')
    ? [warn('CSP lacks object-src', "Add object-src 'none' to the CSP.")]
    : []),
  ...(!policy.has('base-uri')
    ? [warn('CSP lacks base-uri', "Add base-uri 'self' (or 'none') to the CSP.")]
    : []),
];

const weakCsp = ({ policy, meta }: PagePolicy, forms: boolean): Finding[] => {
  const scripts = effectiveSources(policy, 'script');
  if (!scripts) return [];
  const where = ['script-src-elem', 'script-src'].find((name) => policy.has(name)) ?? 'default-src';
  return [
    ...scriptSourceIssues(scripts, where),
    ...(hasKeyword(scripts, "'unsafe-hashes'")
      ? [
          warn(
            `CSP ${where} uses 'unsafe-hashes'`,
            `Move inline event handlers to addEventListener and drop 'unsafe-hashes' from ${where}.`,
          ),
        ]
      : []),
    ...styleIssues(policy),
    ...missingIssues(policy, forms),
    ...(meta
      ? META_IGNORED.filter((name) => policy.has(name)).map((name) =>
          warn(
            `<meta> CSP ignores ${name}`,
            `Move ${name} to a Content-Security-Policy header; browsers ignore it in <meta>.`,
          ),
        )
      : []),
  ];
};

export const unsafeCspFindings = (policies: PagePolicy[], forms: boolean): Finding[] => [
  ...policies.flatMap((entry) => weakCsp(entry, forms)),
  ...[...new Set(policies.flatMap(({ policy }) => unsafeScripts(policy)))].map((keyword) =>
    warn(
      `CSP allows ${keyword} scripts`,
      UNSAFE_FIXES[keyword] ?? `Drop ${keyword} from script-src.`,
    ),
  ),
];
