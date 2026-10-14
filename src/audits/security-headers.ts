import type { VidimusConfig } from '../config/types.ts';
import { headerPolicies, parsePolicy } from '../core/csp.ts';
import type { HeaderMap } from '../core/headers.ts';
import type { Finding } from '../core/types.ts';
import { ANY_ANCESTOR } from './security-csp.ts';

const VERSION = /[A-Za-z][\w.-]*(?:\/\d+(?:\.\d+)*\b|\s\d+\.\d+)/;

const RECOMMENDED: Record<string, string> = {
  'strict-transport-security': 'Strict-Transport-Security: max-age=31536000; includeSubDomains',
  'x-content-type-options': 'X-Content-Type-Options: nosniff',
  'referrer-policy': 'Referrer-Policy: strict-origin-when-cross-origin',
  'permissions-policy': 'Permissions-Policy: camera=(), microphone=(), geolocation=()',
};

export interface RequiredContext {
  require: VidimusConfig['security']['require'];
  home: string;
  skipHsts: boolean;
}

export const requiredHeaderFindings = (
  received: HeaderMap,
  { require, home, skipHsts }: RequiredContext,
): Finding[] =>
  Object.entries(require).flatMap(([name, pattern]): Finding[] => {
    if (pattern === false) return [];
    const key = name.toLowerCase();
    if (skipHsts && key === 'strict-transport-security') return [];
    const value = received[key];
    const recommended = RECOMMENDED[key];
    if (value === undefined) {
      const skip = `set security.require["${key}"] to false to skip`;
      return [
        {
          message: `missing ${key} header`,
          fix: recommended
            ? `Add "${recommended}" to ${home}, or ${skip}.`
            : `Add a ${key} header matching ${pattern || 'any value'} to ${home}, or ${skip}.`,
        },
      ];
    }
    if (!pattern || new RegExp(pattern, 'i').test(value)) return [];
    return [
      {
        message: `${key} header does not match ${pattern}`,
        details: [value],
        fix: recommended
          ? `Change it to "${recommended}" in ${home}, or relax security.require["${key}"].`
          : `Change it to a value matching ${pattern} in ${home}, or relax security.require["${key}"].`,
      },
    ];
  });

export const clickjackingFindings = (received: HeaderMap): Finding[] => {
  const ancestors = headerPolicies(received)
    .map((policy) => parsePolicy(policy).get('frame-ancestors'))
    .filter((sources) => sources !== undefined);
  const framed = ancestors.some((sources) => !sources.some((s) => ANY_ANCESTOR.test(s)));
  const xfo = /^\s*(deny|sameorigin)\s*$/i.test(received['x-frame-options'] ?? '');
  if (framed || xfo) return [];
  return ancestors.length
    ? [
        {
          message: 'no clickjacking protection: frame-ancestors allows any origin',
          fix: `Replace the "*" or scheme source in frame-ancestors with 'self' or explicit hosts, or send X-Frame-Options: DENY as a header.`,
        },
      ]
    : [
        {
          message: 'no clickjacking protection: add CSP frame-ancestors or X-Frame-Options',
          fix: `Send "Content-Security-Policy: frame-ancestors 'self'" (or X-Frame-Options: DENY) as a header; a <meta> CSP can't set frame-ancestors.`,
        },
      ];
};

export const leakFindings = (received: HeaderMap): Finding[] => {
  const poweredBy = received['x-powered-by'];
  const server = received.server;
  return [
    ...(poweredBy
      ? [
          {
            message: 'x-powered-by header leaks the stack',
            severity: 'warn' as const,
            details: [poweredBy],
            fix: 'Remove the X-Powered-By header in your server or framework config (e.g. app.disable("x-powered-by") in Express).',
          },
        ]
      : []),
    ...(server && VERSION.test(server)
      ? [
          {
            message: 'server header leaks a version',
            severity: 'warn' as const,
            details: [server],
            fix: 'Hide the version in the Server header (e.g. "server_tokens off;" in nginx, "ServerTokens Prod" in Apache).',
          },
        ]
      : []),
  ];
};
