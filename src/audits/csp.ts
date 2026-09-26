import { createHash } from 'node:crypto';
import { stripComments } from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';

const INLINE = /<(script|style)\b(?![^>]*\ssrc\s*=)([^>]*)>([\s\S]*?)<\/\1\s*>/dgi;
const DATA_BLOCK = /\btype=["']?application\/(ld\+)?json/i;
const META_CSP = /<meta\s+http-equiv=(["'])content-security-policy\1\s+content=(["'])(.*?)\2/i;
const HASH = /sha256-[A-Za-z0-9+/=]+/g;

const sha256 = (body: string) => `sha256-${createHash('sha256').update(body).digest('base64')}`;

export const csp: Audit = {
  name: 'csp',
  description: 'every inline <script> and <style> is allowed by a hash in the meta CSP',
  requires: 'dist',
  async run({ config, builtPages }) {
    const findings: Finding[] = [];
    let checked = 0;
    let pages = 0;

    for (const { file, html } of builtPages([...config.exclude, ...config.csp.exclude])) {
      const policy = html.match(META_CSP)?.[3];
      if (!policy) continue;
      pages += 1;
      const hashes = new Set(policy.match(HASH));
      for (const match of stripComments(html).matchAll(INLINE)) {
        const [start, end] = match.indices?.[3] ?? [0, 0];
        const kind = (match[1] ?? '').toLowerCase();
        const attrs = match[2] ?? '';
        const body = html.slice(start, end);
        if (!body.trim() || DATA_BLOCK.test(attrs)) continue;
        checked += 1;
        const hash = sha256(body);
        if (hashes.has(hash)) continue;
        findings.push({
          message: `inline <${kind}> has no CSP hash '${hash}'`,
          details: [`${body.trim().slice(0, 80)}…`],
          file,
          fix: `Add '${hash}' to ${kind === 'style' ? 'style-src' : 'script-src'} in the meta CSP, or move the code to a file.`,
        });
      }
    }

    if (pages === 0) return { status: 'skipped', summary: 'no page declares a meta CSP' };
    return {
      summary: findings.length
        ? `${findings.length} of ${checked} inline block(s) would be blocked. Add their hashes to the CSP.`
        : `${checked} inline blocks across ${pages} pages, all hashed`,
      findings,
    };
  },
};
