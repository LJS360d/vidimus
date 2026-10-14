import { createHash } from 'node:crypto';
import {
  effectiveSources,
  frameAllowed,
  headerPolicies,
  metaPolicies,
  type Policy,
  parsePolicy,
  requestAllowed,
} from '../core/csp.ts';
import { resolveHref, type Tag, tags } from '../core/html.ts';
import { createRequestScanner, inlineBlocks } from '../core/requests.ts';
import type { Audit, Finding } from '../core/types.ts';
import { basePathOf, displayPath, matchesAny, regex } from '../core/util.ts';
import { fetchHeaders, groupFindings, hasKeyword, hasNonceOrHash } from './util.ts';

const HASH_SOURCE = /^'(sha(?:256|384|512))-([A-Za-z0-9+/=_-]+)'$/i;
const SELF = 'http://vidimus.invalid';
const SELF_SOCKET = 'ws://vidimus.invalid';
const NAMESPACES =
  /^https?:\/\/(?:www\.w3\.org|schema\.org|json-schema\.org|purl\.org|ogp\.me)(?:[/?#]|$)/i;

const hashOf = (algorithm: string, body: string) =>
  createHash(algorithm).update(body).digest('base64');

const unsafeInline = (sources: string[]) => hasKeyword(sources, "'unsafe-inline'");

const blockAllowed = (sources: string[], body: string) => {
  if (!sources.some((source) => /^'(sha\d+-|nonce-)/i.test(source))) return unsafeInline(sources);
  return sources.some((source) => {
    const [, algorithm, value] = HASH_SOURCE.exec(source) ?? [];
    return algorithm && value === hashOf(algorithm.toLowerCase(), body);
  });
};

const attrAllowed = (sources: string[], value: string) =>
  hasKeyword(sources, "'unsafe-hashes'")
    ? blockAllowed(sources, value)
    : !hasNonceOrHash(sources) && unsafeInline(sources);

interface AttrUse {
  name: string;
  value: string;
  directive: string;
  chain: string[];
}

const attrUses = (tag: Tag): AttrUse[] =>
  Object.entries(tag.attrs).flatMap(([name, value]): AttrUse[] => {
    if (name === 'style') {
      return [{ name, value, directive: 'style-src', chain: ['style-src-attr', 'style-src'] }];
    }
    if (/^on[a-z]+$/.test(name)) {
      return [{ name, value, directive: 'script-src', chain: ['script-src-attr', 'script-src'] }];
    }
    return name === 'href' && /^\s*javascript:/i.test(value)
      ? [{ name, value, directive: 'script-src', chain: ['script-src-elem', 'script-src'] }]
      : [];
  });

interface Doc {
  where: string;
  blocks: ReturnType<typeof inlineBlocks>;
  attrs: AttrUse[];
}

const documentsOf = (html: string, iframes: Tag[]): Doc[] =>
  [
    { html, where: '' },
    ...iframes.flatMap(({ attrs }) =>
      attrs.srcdoc ? [{ html: attrs.srcdoc, where: ' in <iframe srcdoc>' }] : [],
    ),
  ].map(({ html: source, where }) => ({
    where,
    blocks: inlineBlocks(source),
    attrs: tags(source).flatMap(attrUses),
  }));

const attrSources = (policy: Policy, chain: string[]) =>
  chain.map((key) => policy.get(key)).find(Boolean) ?? policy.get('default-src');

const siteHostOf = (siteUrl: string) => (URL.canParse(siteUrl) ? new URL(siteUrl) : new URL(SELF));

const shownOf = (target: { internal: boolean; url: URL }) =>
  target.internal ? target.url.pathname : target.url.origin;

const allowFix = (target: { internal: boolean; url: URL }) =>
  target.internal ? "'self'" : target.url.origin;

export const csp: Audit = {
  name: 'csp',
  description:
    'inline <script> and <style> are hashed in the CSP (meta tag or headers), and iframes are allowed and sandboxed',
  requires: 'dist',
  async run({ config, dist, root, renderedPages, headersFor }) {
    const inline = groupFindings();
    const frames = groupFindings();
    const reachable = groupFindings();
    const scan = createRequestScanner(dist, config.siteUrl);
    const siteHost = siteHostOf(config.siteUrl);
    const toUrl = (ref: string, from: string) => {
      try {
        const url = new URL(
          ref.startsWith('//') ? `${siteHost.protocol}${ref}` : ref,
          new URL(from, siteHost),
        );
        if (!/^(?:https?|wss?):$/.test(url.protocol)) return null;
        if (url.host !== siteHost.host) return { url, internal: false };
        const origin = url.protocol.startsWith('ws') ? SELF_SOCKET : SELF;
        return { url: new URL(`${url.pathname}${url.search}`, origin), internal: true };
      } catch {
        return null;
      }
    };
    const self = new URL(SELF);
    const base = basePathOf(config.siteUrl);
    const hostRules = config.server.headers.map(({ match, headers }) => ({
      match: regex(match),
      policies: headerPolicies(
        Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      ),
    }));

    let probed = 0;
    let checked = 0;
    let pages = 0;
    let noncePages = 0;
    let embeds = 0;
    const nonceUse = new Map<string, number>();

    const rendered = await renderedPages([...config.exclude, ...config.csp.exclude]);
    const headers = await fetchHeaders(rendered, headersFor);

    for (const { file, path, html } of rendered) {
      const iframes = tags(html, 'iframe');
      const received = headers.get(path);
      const policies = [
        ...metaPolicies(html),
        ...(received ? headerPolicies(received) : []),
        ...hostRules.filter(({ match }) => match.test(`${base}${path}`)).flatMap((r) => r.policies),
      ].map(parsePolicy);

      if (policies.length) {
        pages += 1;
        const documents = documentsOf(html, iframes);
        const pageNonces = new Set<string>();
        for (const policy of policies) {
          for (const { where, blocks, attrs } of documents) {
            for (const { kind, body, nonce } of blocks) {
              const sources = effectiveSources(policy, kind);
              if (!sources) continue;
              checked += 1;
              if (nonce && sources.includes(`'nonce-${nonce}'`)) {
                pageNonces.add(nonce);
                checked += 1;
                continue;
              }
              if (blockAllowed(sources, body)) continue;
              const hash = `sha256-${hashOf('sha256', body)}`;
              inline.add(
                {
                  message: `inline <${kind}>${where} has no CSP hash '${hash}'`,
                  details: [`${body.trim().slice(0, 80)}…`],
                  file,
                  fix: `Add '${hash}' to ${kind === 'style' ? 'style-src' : 'script-src'} in the CSP, or move the code to a file.`,
                },
                path,
                { key: `inline <${kind}>${where} has no CSP hash '${hash}'` },
              );
            }
            for (const { name, value, directive, chain } of attrs) {
              const sources = attrSources(policy, chain);
              if (!sources) continue;
              checked += 1;
              if (attrAllowed(sources, value)) continue;
              const detail = `${name}="${value.slice(0, 80)}"`;
              const message = `inline ${name}= attribute${where} blocked by CSP`;
              inline.add(
                {
                  message,
                  details: [detail],
                  file,
                  fix: `Move it to a file or stylesheet, or add 'unsafe-hashes' and its hash to ${directive}.`,
                },
                path,
              );
            }
          }
        }
        if (pageNonces.size) {
          noncePages += 1;
          for (const value of pageNonces) nonceUse.set(value, (nonceUse.get(value) ?? 0) + 1);
        }
      }

      if (config.csp.requests && policies.length) {
        for (const request of scan(html, path)) {
          const target = toUrl(request.ref, request.from);
          if (!target) continue;
          if (!target.internal && NAMESPACES.test(target.url.href)) continue;
          if (!target.internal && matchesAny(config.csp.ignore, target.url.href)) continue;
          probed += 1;
          for (const policy of policies) {
            const { directive, allowed } = requestAllowed(policy, request.kind, target.url, self);
            if (allowed) continue;
            const shown = shownOf(target);
            reachable.add(
              {
                message: request.certain
                  ? `${request.via} to ${shown} is blocked by ${directive}`
                  : `${shown} appears in the code and would be blocked by ${directive}`,
                details: [`${request.ref.slice(0, 80)} in ${displayPath(root, request.source)}`],
                ...(request.certain ? {} : { severity: 'warn' as const }),
                file,
                fix: `Add ${allowFix(target)} to ${directive} in the CSP, or remove the request.`,
              },
              path,
              { key: `${directive} ${request.certain} ${shown}` },
            );
            break;
          }
        }
      }

      for (const { attrs } of iframes) {
        const target = attrs.src ? resolveHref(attrs.src, path, config.siteUrl) : null;
        if (!target || !/^https?:$/.test(target.url.protocol)) continue;
        const url = target.internal ? new URL(target.url.pathname, SELF) : target.url;
        const shown = shownOf(target);
        for (const policy of policies) {
          const { directive, allowed } = frameAllowed(policy, url, self);
          if (allowed) continue;
          frames.add(
            {
              message: `<iframe> from ${shown} is blocked by ${directive}`,
              details: [attrs.src ?? ''],
              file,
              fix: `Add ${allowFix(target)} to frame-src in the CSP, or remove the iframe.`,
            },
            path,
            { key: `blocked ${shown}` },
          );
          break;
        }
        if (target.internal) continue;
        embeds += 1;
        if (config.csp.sandbox && attrs.sandbox === undefined) {
          frames.add(
            {
              message: `third-party <iframe> from ${shown} without sandbox`,
              severity: 'warn',
              fix: 'Add sandbox with only the permissions the embed needs, e.g. sandbox="allow-scripts allow-same-origin allow-popups", or turn csp.sandbox off.',
            },
            path,
            { key: `sandbox ${shown}` },
          );
        }
      }
    }

    if (pages === 0 && embeds === 0 && probed === 0) {
      return { status: 'skipped', summary: 'no page has a CSP or embeds an iframe' };
    }

    const sameNonce: Finding[] = [...nonceUse]
      .filter(([, count]) => count > 1 && count === noncePages)
      .map(([value]) => ({
        message: `nonce '${value}' is the same on every page`,
        severity: 'warn',
        fix: 'Generate a fresh random nonce per response (server or edge), or use hashes for static HTML.',
      }));
    const findings = [
      ...sameNonce,
      ...[...inline.values(), ...frames.values(), ...reachable.values()].map(
        ({ file, ...finding }) =>
          (finding.where?.length ?? 0) > 1 || !file ? finding : { ...finding, file },
      ),
    ];
    const blocked = inline.size();
    return {
      summary: [
        blocked
          ? `${blocked} of ${checked} inline block(s) would be blocked`
          : `${checked} inline blocks across ${pages} pages, all hashed`,
        `${embeds} third-party iframe(s)`,
        ...(probed ? [`${probed} request target(s) checked`] : []),
        ...(frames.size() ? [`${frames.size()} iframe problem(s)`] : []),
        ...(reachable.size() ? [`${reachable.size()} blocked request target(s)`] : []),
      ].join(', '),
      findings,
    };
  },
};
