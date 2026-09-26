import type { Page } from '../core/peer-types.ts';
import type { Audit, Finding } from '../core/types.ts';
import { inParallelTabs, pathOf, viewport } from '../core/util.ts';

interface LayoutDefect {
  rule: string;
  detail: string;
  nodes: string[];
}

const findLayoutDefectsInPage = (minTarget: number, minFont: number): LayoutDefect[] => {
  const describe = (el: Element) => {
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.');
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${text ? ` «${text}»` : ''}`;
  };
  const isPerceivable = (el: Element) => {
    for (
      let node: Element | null = el;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  };
  const vw = window.innerWidth;
  const findings: LayoutDefect[] = [];

  const scrollWidth = document.documentElement.scrollWidth;
  if (scrollWidth > vw + 1) {
    const overflowing = [...document.querySelectorAll('body *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1));
    const innermost = overflowing.filter(
      ({ el }) => !overflowing.some((other) => other.el !== el && el.contains(other.el)),
    );
    findings.push({
      rule: 'overflow',
      detail: `page scrolls sideways: ${scrollWidth}px of content in a ${vw}px viewport`,
      nodes: innermost
        .slice(0, 5)
        .map(
          ({ el, r }) => `${describe(el)} [w=${Math.round(r.width)} right=${Math.round(r.right)}]`,
        ),
    });
  }

  const targets = [
    ...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]'),
  ]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width > 0 && r.height > 0 && isPerceivable(el));
  const centre = ({ r }: { r: DOMRect }) => [r.x + r.width / 2, r.y + r.height / 2] as const;
  for (const target of targets) {
    if (target.r.width >= minTarget && target.r.height >= minTarget) continue;
    const [x, y] = centre(target);
    const nearestNeighbourCentre = Math.min(
      ...targets
        .filter((other) => other !== target)
        .map((other) => {
          const [ox, oy] = centre(other);
          return Math.hypot(x - ox, y - oy);
        }),
    );
    if (nearestNeighbourCentre >= minTarget) continue;
    findings.push({
      rule: 'target-size',
      detail: `${Math.round(target.r.width)}x${Math.round(target.r.height)}px target, nearest neighbour centre ${nearestNeighbourCentre.toFixed(1)}px away`,
      nodes: [describe(target.el)],
    });
  }

  for (const el of document.querySelectorAll('body :not(svg, svg *)')) {
    if (el.firstChild?.nodeType !== Node.TEXT_NODE) continue;
    if (!el.textContent?.trim() || !isPerceivable(el)) continue;
    const size = Number.parseFloat(getComputedStyle(el).fontSize);
    if (size < minFont)
      findings.push({ rule: 'font-size', detail: `${size}px`, nodes: [describe(el)] });
  }

  const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content');
  if (!meta) {
    findings.push({
      rule: 'viewport',
      detail: 'no viewport meta: the page renders at desktop width on phones',
      nodes: [],
    });
  } else if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(meta)) {
    findings.push({ rule: 'viewport', detail: `pinch zoom is disabled: "${meta}"`, nodes: [] });
  }

  return findings;
};

const measureAfterFontsAndRedirects = async (
  page: Page,
  minTarget: number,
  minFont: number,
  retried = false,
): Promise<LayoutDefect[]> => {
  try {
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(findLayoutDefectsInPage, minTarget, minFont);
  } catch (error) {
    if (retried || !/context (was )?destroyed/i.test((error as Error).message)) throw error;
    await page.waitForNavigation({ waitUntil: 'load', timeout: 5000 }).catch(() => {});
    return measureAfterFontsAndRedirects(page, minTarget, minFont, true);
  }
};

export const r12s: Audit = {
  name: 'r12s',
  description: 'no horizontal overflow, small tap targets, small text or locked zoom',
  async run({ config, pageUrls, launchBrowser }) {
    const { viewports, concurrency, exclude, timeout, minTarget, minFont } = config.r12s;
    const urls = pageUrls({ exclude, allLocales: true });
    const browser = await launchBrowser();
    const failures: (LayoutDefect & { url: string; width: number })[] = [];

    try {
      const tasks = viewports.flatMap((width) => urls.map((url) => ({ width, url })));
      await inParallelTabs(browser, concurrency, tasks, async (page, { width, url }) => {
        await page.setViewport(viewport(width));
        await page.goto(url, { waitUntil: 'load', timeout });
        for (const defect of await measureAfterFontsAndRedirects(page, minTarget, minFont)) {
          failures.push({ url, width, ...defect });
        }
      });
    } finally {
      await browser.close();
    }

    failures.sort(
      (a, b) =>
        a.rule.localeCompare(b.rule) ||
        a.detail.localeCompare(b.detail) ||
        a.url.localeCompare(b.url) ||
        a.width - b.width,
    );

    const byDefect = new Map<string, LayoutDefect & { paths: Set<string>; widths: Set<number> }>();
    for (const failure of failures) {
      const key = [failure.rule, failure.detail, ...failure.nodes].join(' | ');
      const defect = byDefect.get(key) ?? { ...failure, paths: new Set(), widths: new Set() };
      defect.paths.add(pathOf(failure.url));
      defect.widths.add(failure.width);
      byDefect.set(key, defect);
    }

    const findings: Finding[] = [...byDefect.values()].map((defect) => ({
      message: `${defect.rule} @${[...defect.widths].join('/')}px - ${defect.detail}`,
      details: defect.nodes,
      where: [...defect.paths],
    }));
    const scanned = `${urls.length} pages x ${viewports.length} viewports (${viewports.join(', ')}px)`;
    return {
      summary: findings.length
        ? `${findings.length} distinct defects across ${scanned}`
        : `${scanned}, no defects`,
      findings,
    };
  },
};
