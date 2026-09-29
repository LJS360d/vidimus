import type { Page } from '../core/peer-types.ts';
import type { Audit, Finding } from '../core/types.ts';
import { inParallelTabs, navigate, onePagePerTemplate, pathOf, viewport } from '../core/util.ts';

interface LayoutDefect {
  rule: string;
  detail: string;
  nodes: string[];
}

const EMBED = /^(iframe|video|embed|object)\b/;

export const defectFix = (
  { rule, detail, nodes = [] }: Pick<LayoutDefect, 'rule' | 'detail'> & { nodes?: string[] },
  minTarget: number,
  minFont: number,
) => {
  if (rule === 'overflow' && nodes.some((node) => EMBED.test(node))) {
    return 'Size the embed with CSS instead of fixed width/height attributes: width:100%; height:auto; aspect-ratio:16/9 (or its real ratio).';
  }
  if (rule === 'overflow') {
    return 'Constrain the widest element listed so it fits the viewport, e.g. with max-width:100% or overflow-wrap:anywhere.';
  }
  if (rule === 'target-size') {
    return `Make the element listed at least ${minTarget}x${minTarget}px, or add spacing so neighbouring target centres are ${minTarget}px apart.`;
  }
  if (rule === 'font-size')
    return `Set the font-size of the element listed to at least ${minFont}px.`;
  if (detail.startsWith('no viewport')) {
    return 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>.';
  }
  return 'Remove user-scalable=no and maximum-scale from the viewport meta so users can pinch-zoom.';
};

const findLayoutDefectsInPage = (minTarget: number, minFont: number): LayoutDefect[] => {
  const describe = (el: Element) => {
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.');
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${text ? ` «${text}»` : ''}`;
  };
  const isPerceivable = (el: Element) => {
    if (!el.getClientRects().length) return false;
    for (
      let node: Element | null = el;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.opacity === '0') return false;
      // Screen-reader-only elements (sr-only, visually-hidden) are clipped away.
      if (/^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(style.clip)) return false;
      if (style.clipPath === 'inset(50%)') return false;
    }
    return true;
  };
  // innerWidth grows to fit wide content under mobile emulation; the layout viewport does not.
  const vw = document.documentElement.clientWidth;
  const findings: LayoutDefect[] = [];

  const scrollWidth = document.documentElement.scrollWidth;
  if (scrollWidth > vw + 1) {
    // Content inside a scrolling or clipping box does not scroll the page; neither does content
    // off the start edge (a skip link at left:-999px in a left-to-right page).
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    const clipped = (el: Element) => {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement)
        if (getComputedStyle(node).overflowX !== 'visible') return true;
      return false;
    };
    const overflowing = [...document.querySelectorAll('body *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(
        ({ el, r }) =>
          r.width > 0 && r.height > 0 && (rtl ? r.left < -1 : r.right > vw + 1) && !clipped(el),
      );
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
  const isInline = (el: Element) =>
    getComputedStyle(el).display === 'inline' &&
    [...(el.parentElement?.childNodes ?? [])].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
  const centre = ({ r }: { r: DOMRect }) => [r.x + r.width / 2, r.y + r.height / 2] as const;
  for (const target of targets) {
    if (Math.round(target.r.width) >= minTarget && Math.round(target.r.height) >= minTarget)
      continue;
    if (isInline(target.el)) continue;
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
  } else if (
    /user-scalable\s*=\s*(no|0)\b|maximum-scale\s*=\s*(0*\.\d+|0+|1(\.0*)?)(?![\d.])/i.test(meta)
  ) {
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
  async run({ config, origin, pageUrls, launchBrowser }) {
    const { viewports, concurrency, exclude, sample, timeout, minTarget, minFont } = config.r12s;
    const urls = onePagePerTemplate(pageUrls({ exclude, allLocales: true }), sample, origin);
    const browser = await launchBrowser();
    const failures: (LayoutDefect & { url: string; width: number })[] = [];
    const unloaded = new Map<string, { widths: number[]; error: string }>();

    try {
      const tasks = viewports.flatMap((width) => urls.map((url) => ({ width, url })));
      await inParallelTabs(browser, concurrency, tasks, async (page, { width, url }) => {
        await page.setViewport(viewport(width));
        let defects: LayoutDefect[];
        try {
          await navigate(page, url, { waitFor: config.render.waitFor, timeout });
          defects = await measureAfterFontsAndRedirects(page, minTarget, minFont);
        } catch (error) {
          const path = pathOf(url, origin);
          const entry = unloaded.get(path) ?? { widths: [], error: (error as Error).message };
          entry.widths.push(width);
          unloaded.set(path, entry);
          return;
        }
        for (const defect of defects) failures.push({ url, width, ...defect });
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
      defect.paths.add(pathOf(failure.url, origin));
      defect.widths.add(failure.width);
      byDefect.set(key, defect);
    }

    const findings: Finding[] = [...byDefect.values()].map((defect) => ({
      message: `${defect.rule} @${[...defect.widths].join('/')}px - ${defect.detail}`,
      details: defect.nodes,
      where: [...defect.paths],
      fix: defectFix(defect, minTarget, minFont),
    }));
    for (const [path, { widths, error }] of [...unloaded].sort(([a], [b]) => a.localeCompare(b))) {
      findings.push({
        message: `failed to load ${path}`,
        details: [`@${widths.sort((a, b) => a - b).join('/')}px: ${error}`],
        where: [path],
        fix: `Check that ${path} loads in a browser within r12s.timeout (${timeout} ms), or add it to r12s.exclude.`,
      });
    }
    const scanned = `${urls.length} pages x ${viewports.length} viewports (${viewports.join(', ')}px)`;
    return {
      summary: `${
        byDefect.size
          ? `${byDefect.size} distinct defects across ${scanned}`
          : `${scanned}, no defects`
      }${unloaded.size ? `, ${unloaded.size} page(s) failed to load` : ''}`,
      findings,
    };
  },
};
