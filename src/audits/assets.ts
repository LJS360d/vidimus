import { join } from 'node:path';
import { redirectSources } from '../core/headers.ts';
import { isFile } from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';
import { matchesAny } from '../core/util.ts';
import { checkFavicon } from './assets/favicon.ts';
import { checkManifests } from './assets/manifest.ts';
import { checkOpenGraph } from './assets/open-graph.ts';
import { imageSizeOf } from './image-size.ts';
import { siteFileFindings } from './site-files.ts';
import { groupFindings, memo } from './util.ts';

const CHANGE_PASSWORD_TIMEOUT = 20_000;

const changePasswordRedirects = async (origin: string) => {
  const response = await fetch(`${origin}/.well-known/change-password`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(CHANGE_PASSWORD_TIMEOUT),
  }).catch(() => undefined);
  await response?.body?.cancel();
  return response && (response.status < 400 || response.type === 'opaqueredirect')
    ? ['/.well-known/change-password']
    : [];
};

export const assets: Audit = {
  name: 'assets',
  description:
    'favicon, web manifest, Open Graph image, 404 page, and ads.txt, change-password and app links when the site needs them',
  requires: 'dist',
  async run({ config, renderedPages, dist, log }) {
    const options = config.assets;
    const pages = (await renderedPages(config.exclude)).filter(
      (page) => !matchesAny(options.exclude, page.path),
    );
    if (pages.length === 0) return { status: 'skipped', summary: 'no built pages' };

    const groups = groupFindings();
    const report = (finding: Finding, where?: string) =>
      groups.add(finding, where, { key: `${finding.severity ?? 'error'} ${finding.message}` });
    const env = { pages, dist, siteUrl: config.siteUrl, options, measure: memo(imageSizeOf) };

    if (options.favicon) checkFavicon(env, report);
    if (options.manifest) checkManifests(env, report);
    if (options.openGraph) checkOpenGraph(env, report);
    if (
      options.notFound &&
      !isFile(join(dist, '404.html')) &&
      !isFile(join(dist, '404', 'index.html'))
    ) {
      report({
        message: 'no 404 page (404.html or 404/index.html)',
        severity: 'warn',
        fix: 'Add a 404.html to the build (most hosts serve it for missing pages).',
      });
    }

    const redirects = redirectSources(config.root, dist);
    const origin = config.origin.replace(/\/$/, '');
    if (origin && options.changePassword !== 'off')
      redirects.push(...(await changePasswordRedirects(origin)));
    for (const { finding, where } of siteFileFindings(
      pages,
      dist,
      config.siteUrl,
      options,
      log,
      redirects,
    )) {
      if (!where.length) report(finding);
      for (const path of where) report(finding, path);
    }

    const findings = groups.values();
    return {
      summary: findings.length
        ? `${findings.length} problem(s) across ${pages.length} page(s)`
        : `${pages.length} page(s), all assets in place`,
      findings,
    };
  },
};
