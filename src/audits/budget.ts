import type { Audit } from '../core/types.ts';
import { matchesAny, regex } from '../core/util.ts';
import { checkPage } from './budget/checks.ts';
import { assetsOf } from './budget/collect.ts';
import { formatBytes } from './budget/format.ts';
import { createMeasures } from './budget/measure.ts';
import { groupFindings } from './util.ts';

export const budget: Audit = {
  name: 'budget',
  description: 'page weight, image size and format, image dimensions',
  requires: 'dist',
  async run({ config, renderedPages, dist, origin }) {
    const options = config.budget;
    const pages = (await renderedPages(config.exclude)).filter(
      (page) => !matchesAny(options.exclude, page.path),
    );
    if (pages.length === 0) return { status: 'skipped', summary: 'no built pages' };

    const env = {
      dist,
      siteUrl: config.siteUrl,
      origin,
      measures: createMeasures(options.compression),
    };
    const groups = groupFindings();
    let heaviest = { path: '', size: 0 };

    for (const page of pages) {
      const route = Object.entries(options.routes).find(([pattern]) =>
        regex(pattern).test(page.path),
      );
      const limits = { ...options, ...route?.[1] };
      const size = checkPage(
        {
          env,
          page,
          limits,
          options,
          report: (key, finding, where) => groups.add(finding, where, { key }),
        },
        assetsOf(env, page),
      );
      if (size > heaviest.size) heaviest = { path: page.path, size };
    }

    const findings = groups.values();
    const problems = findings.length ? `, ${findings.length} problem(s)` : '';
    return {
      summary: `${pages.length} page(s), heaviest ${heaviest.path || pages[0]?.path} ${formatBytes(heaviest.size)}${problems}`,
      findings,
    };
  },
};
