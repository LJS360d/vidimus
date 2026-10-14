import type { VidimusConfig } from '../config/types.ts';
import { effectiveSources, headerPolicies, metaPolicies, parsePolicy } from '../core/csp.ts';
import type { HeaderMap } from '../core/headers.ts';
import type { BuiltPage } from '../core/html.ts';
import { tags } from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';
import { basePathOf, matchesAny } from '../core/util.ts';
import { type PagePolicy, STARTER_CSP, unsafeCspFindings } from './security-csp.ts';
import {
  clickjackingFindings,
  leakFindings,
  type RequiredContext,
  requiredHeaderFindings,
} from './security-headers.ts';
import { mixedContentFindings, sriFindings } from './security-resources.ts';
import { securityTxtFindings } from './security-txt.ts';
import { fetchHeaders, groupFindings } from './util.ts';

export { securityTxtFields } from './security-txt.ts';

type Options = VidimusConfig['security'];

const isLoopbackHttp = (origin: string) => {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname)
    );
  } catch {
    return false;
  }
};

const policiesOf = (page: BuiltPage, received?: HeaderMap): PagePolicy[] => [
  ...(received ? headerPolicies(received) : []).map((text) => ({
    policy: parsePolicy(text),
    meta: false,
  })),
  ...metaPolicies(page.html).map((text) => ({ policy: parsePolicy(text), meta: true })),
];

const missingCspFindings = (policies: PagePolicy[], options: Options): Finding[] => {
  const severity = options.csp === 'error' ? undefined : ('warn' as const);
  const base = { ...(severity && { severity }), fix: STARTER_CSP };
  if (!policies.length) {
    return options.require['content-security-policy']
      ? []
      : [{ message: 'no Content-Security-Policy (header or <meta>)', ...base }];
  }
  return policies.some(({ policy }) => effectiveSources(policy, 'script'))
    ? []
    : [{ message: 'CSP does not restrict scripts (no script-src or default-src)', ...base }];
};

export const security: Audit = {
  name: 'security',
  description: 'security headers, clickjacking, unsafe CSP, mixed content, SRI and security.txt',
  requires: 'dist',
  async run({ config, builtPages, dist, log, headersFor, headerSource }) {
    const options = config.security;
    const pages = builtPages(config.exclude).filter(
      (page) => !matchesAny(options.exclude, page.path),
    );
    if (!pages.length) return { status: 'skipped', summary: 'no pages to check' };

    const grouped = groupFindings();
    const origin = config.origin.replace(/\/$/, '');
    const source = headerSource.sources.join(', ');
    for (const note of headerSource.notes) log(note);

    let headers = new Map<string, HeaderMap>();
    if (origin || headerSource.sources.length) {
      headers = await fetchHeaders(pages, headersFor, (path, error) =>
        grouped.add(
          {
            message: 'could not fetch headers',
            details: [error instanceof Error ? error.message : String(error)],
            fix: `Make sure ${origin} is up and serves this page, or drop ${config.server.command ? 'server.command' : '--origin'} to read ${options.file} from the build.`,
          },
          path,
        ),
      );
      if (!origin && !pages.some((page) => Object.keys(headers.get(page.path) ?? {}).length)) {
        log(`no header rule from ${source} matches any page`);
      }
    } else {
      log(
        `header checks skipped: no ${options.file} in the build and no --origin to fetch headers from`,
      );
    }

    const loopback = isLoopbackHttp(origin);
    if (loopback) {
      log('strict-transport-security not checked: HSTS is ignored over http on localhost');
    }
    const required: RequiredContext = {
      require: options.require,
      skipHsts: loopback,
      home: origin ? "your host's header config" : `/* in ${options.file}`,
    };

    for (const page of pages) {
      const received = headers.get(page.path);
      const policies = policiesOf(page, received);
      const issues: Finding[] = [
        ...(received ? requiredHeaderFindings(received, required) : []),
        ...(received && options.clickjacking ? clickjackingFindings(received) : []),
        ...(received && origin ? leakFindings(received) : []),
        ...(options.unsafeInline
          ? unsafeCspFindings(policies, tags(page.html, 'form').length > 0)
          : []),
        ...(options.csp ? missingCspFindings(policies, options) : []),
        ...(options.mixedContent ? mixedContentFindings(page.html) : []),
        ...(options.sri ? sriFindings(page, config.siteUrl) : []),
      ];
      for (const issue of issues) grouped.add(issue, page.path);
    }

    const findings = grouped.values();
    if (options.securityTxt) {
      const base = basePathOf(config.siteUrl);
      if (base) {
        log(
          `security.txt check skipped: the site is served under ${base}/, security.txt belongs at the origin root`,
        );
      } else findings.push(...securityTxtFindings(dist, Date.now()));
    }
    return {
      summary: `${pages.length} pages, headers from ${source || 'nowhere (skipped)'}, ${
        findings.length ? `${findings.length} problem(s)` : 'no problems'
      }`,
      findings,
    };
  },
};
