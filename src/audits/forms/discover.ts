import type { VidimusConfig } from '../../config/types.ts';
import type { Browser } from '../../core/peer-types.ts';
import type { Finding } from '../../core/types.ts';
import { inParallel, pathOf } from '../../core/util.ts';
import { fingerprintOf, formId } from './cases.ts';
import { scan } from './page.ts';
import { openSession } from './session.ts';
import type { Found } from './types.ts';

export interface Unique {
  first: Found;
  nth: number;
  id: string;
  pages: string[];
}

const cookieHeader = (
  url: string,
  origin: string,
  cookies: VidimusConfig['browser']['state']['cookies'],
): Record<string, string> => {
  const { hostname, pathname, protocol } = new URL(url);
  const fallback = new URL(origin).hostname;
  const sent = cookies.filter(({ domain = fallback, path = '/', secure }) => {
    const host = domain.replace(/^\./, '');
    return (
      (hostname === host || hostname.endsWith(`.${host}`)) &&
      (pathname === path || pathname.startsWith(path.endsWith('/') ? path : `${path}/`)) &&
      (!secure || protocol === 'https:')
    );
  });
  return sent.length ? { cookie: sent.map((c) => `${c.name}=${c.value}`).join('; ') } : {};
};

const servedHtml = (url: string, origin: string, config: VidimusConfig) =>
  fetch(url, {
    headers: cookieHeader(url, origin, config.browser.state.cookies),
    signal: AbortSignal.timeout(config.forms.timeout),
  }).then(
    (r) => r.text(),
    () => '',
  );

export const findForms = async (
  browser: Browser,
  config: VidimusConfig,
  origin: string,
  urls: string[],
) => {
  const options = config.forms;
  const found: Found[] = [];
  const failed: Finding[] = [];
  await inParallel(options.concurrency, urls, async (url) => {
    const path = pathOf(url, origin);
    let session: Awaited<ReturnType<typeof openSession>> | undefined;
    try {
      session = await openSession(browser, config, url, []);
      const list = await scan(session.page);
      const html = list.some((f) => f.ordinal !== null)
        ? await servedHtml(url, origin, config)
        : '';
      for (const form of list)
        found.push({
          url,
          path,
          form,
          id: formId(form, path, html),
          fingerprint: fingerprintOf(form, origin),
        });
    } catch (error) {
      failed.push({
        message: `failed to load ${path}`,
        details: [(error as Error).message],
        where: [path],
        fix: `Check that ${path} loads within forms.timeout (${options.timeout} ms), or add it to forms.exclude.`,
      });
    } finally {
      await session?.close();
    }
  });
  return { found, failed };
};

// The same form on many pages (a footer newsletter) is exercised once. Look-alike forms
// on one page stay apart: the n-th of them only matches the n-th on another page.
export const uniqueForms = (found: Found[]): Unique[] => {
  const groups = new Map<string, { nth: number; items: Found[] }>();
  const seen = new Map<string, number>();
  const sorted = [...found].sort(
    (a, b) => a.path.localeCompare(b.path) || a.form.index - b.form.index,
  );
  for (const item of sorted) {
    const at = `${item.path} ${item.fingerprint}`;
    const nth = seen.get(at) ?? 0;
    seen.set(at, nth + 1);
    const key = `${item.fingerprint}#${nth}`;
    const group = groups.get(key) ?? { nth, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const ids = new Map<string, number>();
  return [...groups.values()].map(({ nth, items }) => {
    const first = items[0] as Found;
    const count = (ids.get(first.id) ?? 0) + 1;
    ids.set(first.id, count);
    return {
      first,
      nth,
      id: count > 1 ? `${first.id}~${count}` : first.id,
      pages: [...new Set(items.map((i) => i.path))],
    };
  });
};
