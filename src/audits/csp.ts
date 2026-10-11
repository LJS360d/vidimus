import { createHash } from 'node:crypto';
import {
  frameAllowed,
  headerPolicies,
  metaPolicies,
  parsePolicy,
  requestAllowed,
} from '../core/csp.ts';
import { resolveHref, tags } from '../core/html.ts';
import { createRequestScanner, inlineBlocks } from '../core/requests.ts';
import type { Audit, Finding } from '../core/types.ts';
import { basePathOf, displayPath, matchesAny, regex } from '../core/util.ts';

const HASH_SOURCE = /^'(sha(?:256|384|512))-([A-Za-z0-9+/=_-]+)'$/i;
const SELF = 'http://vidimus.invalid';
const NAMESPACES =
  /^https?:\/\/(?:www\.w3\.org|schema\.org|json-schema\.org|purl\.org|ogp\.me)(?:[/?#]|$)/i;

const sha256 = (body: string) => `sha256-${createHash('sha256').update(body).digest('base64')}`;

const hashOf = (algorithm: string, body: string) =>
  createHash(algorithm).update(body).digest('base64');

const attrAllowed = (sources: string[], value: string) =>
  sources.some((source) => source.toLowerCase() === "'unsafe-hashes'")
    ? blockAllowed(sources, value)
    : !sources.some((source) => /^'(sha\d+-|nonce-)/i.test(source)) &&
      sources.some((source) => source.toLowerCase() === "'unsafe-inline'");

const blockAllowed = (sources: string[], body: string) => {
  const restricted = sources.filter((source) => /^'(sha\d+-|nonce-)/i.test(source));
  if (!restricted.length)
    return sources.some((source) => source.toLowerCase() === "'unsafe-inline'");
  return sources.some((source) => {
    const [, algorithm, value] = HASH_SOURCE.exec(source) ?? [];
    return algorithm && value === hashOf(algorithm.toLowerCase(), body);
  });
};

export const csp: Audit = {
  name: 'csp',
  description:
    'inline <script> and <style> are hashed in the meta CSP, and iframes are allowed and sandboxed',
  requires: 'dist',
  async run({ config, dist, root, renderedPages }) {
    const findings: Finding[] = [];
    const grouped = () => {
      const entries = new Map<string, Finding & { where: string[] }>();
      const report = (key: string, path: string, finding: Finding) => {
        const entry = entries.get(key) ?? { ...finding, where: [] };
        if (!entry.where.includes(path)) entry.where.push(path);
        entries.set(key, entry);
      };
      return { entries, report };
    };
    const { entries: frames, report: reportFrame } = grouped();
    const { entries: reachable, report: reportRequest } = grouped();
    const scan = createRequestScanner(dist, config.siteUrl);
    const siteHost = (() => {
      try {
        return new URL(config.siteUrl);
      } catch {
        return new URL(SELF);
      }
    })();
    const toUrl = (ref: string, from: string) => {
      try {
        const url = new URL(
          ref.startsWith('//') ? `${siteHost.protocol}${ref}` : ref,
          new URL(from, siteHost),
        );
        if (!/^(?:https?|wss?):$/.test(url.protocol)) return null;
        if (url.host !== siteHost.host) return { url, internal: false };
        const socket = url.protocol.startsWith('ws');
        return {
          url: new URL(`${url.pathname}${url.search}`, socket ? 'ws://vidimus.invalid' : SELF),
          internal: true,
        };
      } catch {
        return null;
      }
    };
    let probed = 0;
    let checked = 0;
    let pages = 0;
    let embeds = 0;
    const base = basePathOf(config.siteUrl);

    for (const { file, path, html } of await renderedPages([
      ...config.exclude,
      ...config.csp.exclude,
    ])) {
      const meta = metaPolicies(html)[0];
      const iframes = tags(html, 'iframe');

      if (meta) {
        pages += 1;
        const policy = parsePolicy(meta);
        const sourcesFor = (kind: string) => policy.get(`${kind}-src`) ?? policy.get('default-src');
        // A srcdoc document inherits the policy of the page that embeds it.
        const documents = [
          { html, where: '' },
          ...iframes.flatMap(({ attrs }) =>
            attrs.srcdoc ? [{ html: attrs.srcdoc, where: ' in <iframe srcdoc>' }] : [],
          ),
        ];
        for (const document of documents) {
          for (const { kind, body } of inlineBlocks(document.html)) {
            const sources = sourcesFor(kind);
            if (!sources) continue;
            checked += 1;
            if (blockAllowed(sources, body)) continue;
            const hash = sha256(body);
            findings.push({
              message: `inline <${kind}>${document.where} has no CSP hash '${hash}'`,
              details: [`${body.trim().slice(0, 80)}…`],
              file,
              fix: `Add '${hash}' to ${kind === 'style' ? 'style-src' : 'script-src'} in the meta CSP, or move the code to a file.`,
            });
          }
          for (const { attrs } of tags(document.html)) {
            const uses: [string, string, string, string[]][] = Object.entries(attrs).flatMap(
              ([name, value]): [string, string, string, string[]][] => {
                if (name === 'style')
                  return [[name, value, 'style-src', ['style-src-attr', 'style-src']]];
                if (/^on[a-z]+$/.test(name))
                  return [[name, value, 'script-src', ['script-src-attr', 'script-src']]];
                return name === 'href' && /^\s*javascript:/i.test(value)
                  ? [[name, value, 'script-src', ['script-src-elem', 'script-src']]]
                  : [];
              },
            );
            for (const [name, value, directive, chain] of uses) {
              const sources =
                chain.map((key) => policy.get(key)).find(Boolean) ?? policy.get('default-src');
              if (!sources) continue;
              checked += 1;
              if (attrAllowed(sources, value)) continue;
              findings.push({
                message: `inline ${name}= attribute${document.where} blocked by CSP`,
                details: [`${name}="${value.slice(0, 80)}"`],
                file,
                fix: `Move it to a file or stylesheet, or add 'unsafe-hashes' and its hash to ${directive}.`,
              });
            }
          }
        }
      }

      const headerRules = config.server.headers.filter(({ match }) =>
        regex(match).test(`${base}${path}`),
      );
      const policies = [
        ...(meta ? [meta] : []),
        ...headerRules.flatMap(({ headers }) =>
          headerPolicies(
            Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
          ),
        ),
      ].map(parsePolicy);

      if (config.csp.requests && policies.length) {
        for (const request of scan(html, path)) {
          const target = toUrl(request.ref, request.from);
          if (!target) continue;
          if (!target.internal && NAMESPACES.test(target.url.href)) continue;
          if (!target.internal && matchesAny(config.csp.ignore, target.url.href)) continue;
          probed += 1;
          for (const policy of policies) {
            const { directive, allowed } = requestAllowed(
              policy,
              request.kind,
              target.url,
              new URL(SELF),
            );
            if (allowed) continue;
            const shown = target.internal ? target.url.pathname : target.url.origin;
            reportRequest(`${directive} ${request.certain} ${shown}`, path, {
              message: request.certain
                ? `${request.via} to ${shown} is blocked by ${directive}`
                : `${shown} appears in the code and would be blocked by ${directive}`,
              details: [`${request.ref.slice(0, 80)} in ${displayPath(root, request.source)}`],
              severity: request.certain ? undefined : 'warn',
              file,
              fix: `Add ${target.internal ? "'self'" : target.url.origin} to ${directive} in the CSP, or remove the request.`,
            });
            break;
          }
        }
      }

      for (const { attrs } of iframes) {
        const target = attrs.src ? resolveHref(attrs.src, path, config.siteUrl) : null;
        if (!target || !/^https?:$/.test(target.url.protocol)) continue;
        const url = target.internal ? new URL(target.url.pathname, SELF) : target.url;
        const shown = target.internal ? target.url.pathname : target.url.origin;
        for (const policy of policies) {
          const { directive, allowed } = frameAllowed(policy, url, new URL(SELF));
          if (allowed) continue;
          reportFrame(`blocked ${shown}`, path, {
            message: `<iframe> from ${shown} is blocked by ${directive}`,
            details: [attrs.src ?? ''],
            file,
            fix: `Add ${target.internal ? "'self'" : target.url.origin} to frame-src in the CSP, or remove the iframe.`,
          });
          break;
        }
        if (target.internal) continue;
        embeds += 1;
        if (config.csp.sandbox && attrs.sandbox === undefined) {
          reportFrame(`sandbox ${shown}`, path, {
            message: `third-party <iframe> from ${shown} without sandbox`,
            severity: 'warn',
            fix: 'Add sandbox with only the permissions the embed needs, e.g. sandbox="allow-scripts allow-same-origin allow-popups", or turn csp.sandbox off.',
          });
        }
      }
    }

    findings.push(
      ...[...frames.values(), ...reachable.values()].map(({ file, ...finding }) =>
        finding.where.length > 1 || !file ? finding : { ...finding, file },
      ),
    );
    if (pages === 0 && embeds === 0 && probed === 0)
      return { status: 'skipped', summary: 'no page has a CSP or embeds an iframe' };
    const blocked = findings.filter(({ message }) => message.startsWith('inline')).length;
    return {
      summary: [
        blocked
          ? `${blocked} of ${checked} inline block(s) would be blocked`
          : `${checked} inline blocks across ${pages} pages, all hashed`,
        `${embeds} third-party iframe(s)`,
        ...(probed ? [`${probed} request target(s) checked`] : []),
        ...(frames.size ? [`${frames.size} iframe problem(s)`] : []),
        ...(reachable.size ? [`${reachable.size} blocked request target(s)`] : []),
      ].join(', '),
      findings,
    };
  },
};
