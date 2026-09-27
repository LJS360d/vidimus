import { createHash } from 'node:crypto';
import { frameAllowed, headerPolicies, parsePolicy } from '../core/csp.ts';
import { resolveHref, stripComments, tags } from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';
import { basePathOf, regex } from '../core/util.ts';

const INLINE = /<(script|style)\b(?![^>]*\ssrc\s*=)([^>]*)>([\s\S]*?)<\/\1\s*>/dgi;
const DATA_BLOCK = /\btype=["']?application\/(ld\+)?json/i;
const META_CSP = /<meta\s+http-equiv=(["'])content-security-policy\1\s+content=(["'])(.*?)\2/i;
const HASH = /sha256-[A-Za-z0-9+/=]+/g;
const SELF = 'http://vidimus.invalid';

const sha256 = (body: string) => `sha256-${createHash('sha256').update(body).digest('base64')}`;

const inlineBlocks = (html: string) =>
  [...stripComments(html).matchAll(INLINE)].flatMap((match) => {
    const [start, end] = match.indices?.[3] ?? [0, 0];
    const kind = (match[1] ?? '').toLowerCase();
    const body = html.slice(start, end);
    return !body.trim() || DATA_BLOCK.test(match[2] ?? '') ? [] : [{ kind, body }];
  });

export const csp: Audit = {
  name: 'csp',
  description:
    'inline <script> and <style> are hashed in the meta CSP, and iframes are allowed and sandboxed',
  requires: 'dist',
  async run({ config, renderedPages }) {
    const findings: Finding[] = [];
    const frames = new Map<string, Finding & { where: string[] }>();
    const reportFrame = (key: string, path: string, finding: Finding) => {
      const entry = frames.get(key) ?? { ...finding, where: [] };
      if (!entry.where.includes(path)) entry.where.push(path);
      frames.set(key, entry);
    };
    let checked = 0;
    let pages = 0;
    let embeds = 0;
    const base = basePathOf(config.siteUrl);

    for (const { file, path, html } of await renderedPages([
      ...config.exclude,
      ...config.csp.exclude,
    ])) {
      const meta = html.match(META_CSP)?.[3];
      const iframes = tags(html, 'iframe');

      if (meta) {
        pages += 1;
        const hashes = new Set(meta.match(HASH));
        // A srcdoc document inherits the policy of the page that embeds it.
        const documents = [
          { html, where: '' },
          ...iframes.flatMap(({ attrs }) =>
            attrs.srcdoc ? [{ html: attrs.srcdoc, where: ' in <iframe srcdoc>' }] : [],
          ),
        ];
        for (const document of documents) {
          for (const { kind, body } of inlineBlocks(document.html)) {
            checked += 1;
            const hash = sha256(body);
            if (hashes.has(hash)) continue;
            findings.push({
              message: `inline <${kind}>${document.where} has no CSP hash '${hash}'`,
              details: [`${body.trim().slice(0, 80)}…`],
              file,
              fix: `Add '${hash}' to ${kind === 'style' ? 'style-src' : 'script-src'} in the meta CSP, or move the code to a file.`,
            });
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
      ...[...frames.values()].map(({ file, ...finding }) =>
        finding.where.length > 1 || !file ? finding : { ...finding, file },
      ),
    );
    if (pages === 0 && embeds === 0)
      return { status: 'skipped', summary: 'no page declares a meta CSP or embeds an iframe' };
    const blocked = findings.filter(({ message }) => message.startsWith('inline')).length;
    return {
      summary: [
        blocked
          ? `${blocked} of ${checked} inline block(s) would be blocked`
          : `${checked} inline blocks across ${pages} pages, all hashed`,
        `${embeds} third-party iframe(s)`,
        ...(frames.size ? [`${frames.size} iframe problem(s)`] : []),
      ].join(', '),
      findings,
    };
  },
};
