import type { VidimusConfig } from '../../config/types.ts';
import { linksWithRel } from '../../core/html.ts';
import type { Browser, Page } from '../../core/peer-types.ts';
import type { Finding } from '../../core/types.ts';
import { navigate } from '../../core/util.ts';
import { classifyRequest, hostOf, isFirstPartyCookie, referrerLeaksPath } from './hosts.ts';

export interface Seen {
  where: Set<string>;
  examples: Set<string>;
}

export interface Collected {
  hosts: Map<string, Seen>;
  hints: Map<string, Seen>;
  embeds: Set<string>;
  gpc: Map<string, Seen>;
  referrers: Map<string, Seen>;
  cookieJar: Map<string, { where: Set<string>; attributes: Set<string>; firstParty: boolean }>;
  storageJar: Map<string, { names: Set<string>; where: Set<string> }>;
  rejected: {
    hosts: Map<string, Seen>;
    cookies: Map<string, Seen>;
    storage: Map<string, Seen>;
    missing: Set<string>;
  };
  failed: Finding[];
}

export const newCollected = (): Collected => ({
  hosts: new Map(),
  hints: new Map(),
  embeds: new Set(),
  gpc: new Map(),
  referrers: new Map(),
  cookieJar: new Map(),
  storageJar: new Map(),
  rejected: { hosts: new Map(), cookies: new Map(), storage: new Map(), missing: new Set() },
  failed: [],
});

const EXAMPLES = 3;

const record = (map: Map<string, Seen>, key: string, path: string, example?: string) => {
  const seen = map.get(key) ?? { where: new Set(), examples: new Set() };
  seen.where.add(path);
  if (example && seen.examples.size < EXAMPLES) seen.examples.add(example);
  map.set(key, seen);
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cookieAttributes = (cookie: {
  session: boolean;
  expires: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}) =>
  [
    cookie.session
      ? 'session'
      : `expires ${new Date(cookie.expires * 1000).toISOString().slice(0, 10)}`,
    ...(cookie.secure ? ['Secure'] : []),
    ...(cookie.httpOnly ? ['HttpOnly'] : []),
    ...(cookie.sameSite ? [`SameSite=${cookie.sameSite}`] : []),
  ].join(', ');

const readStorage = (page: Page) =>
  page.evaluate(async () => {
    const keys = (store: () => Storage) => {
      try {
        const s = store();
        return Array.from({ length: s.length }, (_, i) => s.key(i) ?? '');
      } catch {
        return [];
      }
    };
    let databases: string[] = [];
    try {
      databases = ((await indexedDB.databases()) ?? []).map((db) => db.name ?? '');
    } catch {
      databases = [];
    }
    let cacheStorage: string[] = [];
    try {
      cacheStorage = await caches.keys();
    } catch {
      cacheStorage = [];
    }
    let serviceWorker: string[] = [];
    try {
      serviceWorker = (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope);
    } catch {
      serviceWorker = [];
    }
    return {
      localStorage: keys(() => localStorage),
      sessionStorage: keys(() => sessionStorage),
      indexedDB: databases,
      cacheStorage,
      serviceWorker,
    };
  });

interface Visit {
  allow: VidimusConfig['privacy']['allow'];
  firstParty: Set<string>;
  collected: Collected;
  url: string;
  path: string;
  page: Page;
  context: Awaited<ReturnType<Browser['createBrowserContext']>>;
}

const recordHints = (v: Visit, html: string) => {
  for (const rel of ['preconnect', 'dns-prefetch']) {
    for (const { attrs } of linksWithRel(html, rel)) {
      if (!attrs.href) continue;
      let target: URL;
      try {
        target = new URL(attrs.href, v.url);
      } catch {
        continue;
      }
      if (classifyRequest(target.href, v.firstParty, v.allow) !== 'third-party') continue;
      record(v.collected.hints, target.hostname, v.path, `${rel} ${target.href}`);
    }
  }
};

const recordLoaded = async (v: Visit) => {
  const { collected, firstParty, path } = v;
  for (const [kind, names] of Object.entries(await readStorage(v.page))) {
    if (!names.length) continue;
    const entry = collected.storageJar.get(kind) ?? { names: new Set(), where: new Set() };
    for (const name of names) entry.names.add(name);
    entry.where.add(path);
    collected.storageJar.set(kind, entry);
  }
  for (const cookie of await v.context.cookies()) {
    const key = `${cookie.name} set on load (${cookie.domain})`;
    const entry = collected.cookieJar.get(key) ?? {
      where: new Set<string>(),
      attributes: new Set<string>(),
      firstParty: isFirstPartyCookie(cookie.domain, firstParty),
    };
    entry.where.add(path);
    entry.attributes.add(cookieAttributes(cookie));
    collected.cookieJar.set(key, entry);
  }
};

export const visitGpc = async (
  browser: Browser,
  config: VidimusConfig,
  firstParty: Set<string>,
  collected: Collected,
  url: string,
  path: string,
) => {
  const { allow, timeout, wait } = config.privacy;
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({ 'Sec-GPC': '1' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true });
    });
    page.on('request', (request) => {
      const requested = request.url();
      if (classifyRequest(requested, firstParty, allow) !== 'third-party') return;
      record(collected.gpc, hostOf(requested), path, requested);
    });
    try {
      await navigate(page, url, { waitFor: config.render.waitFor, timeout });
      await pause(wait);
    } catch (error) {
      collected.failed.push(
        failure(
          `failed to load ${path} with Global Privacy Control`,
          error,
          `Check that ${path} loads in a browser within privacy.timeout (${timeout} ms), or set privacy.gpc to false.`,
        ),
      );
    }
  } finally {
    await context.close();
  }
};

const recordRejected = async (v: Visit) => {
  const { collected, path } = v;
  for (const [kind, names] of Object.entries(await readStorage(v.page))) {
    if (names.length) record(collected.rejected.storage, kind, path, names.join(', '));
  }
  for (const cookie of await v.context.cookies()) {
    record(collected.rejected.cookies, `${cookie.name} (${cookie.domain})`, path);
  }
};

const failure = (message: string, error: unknown, fix: string): Finding => ({
  message,
  details: [(error as Error).message],
  fix,
});

export const visitPage = async (
  browser: Browser,
  config: VidimusConfig,
  firstParty: Set<string>,
  collected: Collected,
  url: string,
  path: string,
) => {
  const { allow, cookies, rejectSelector, timeout, wait } = config.privacy;
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    const visit: Visit = { allow, firstParty, collected, url, path, page, context };
    let rejecting = false;
    page.on('request', (request) => {
      const requested = request.url();
      if (classifyRequest(requested, firstParty, allow) !== 'third-party') return;
      const host = hostOf(requested);
      record(rejecting ? collected.rejected.hosts : collected.hosts, host, path, requested);
      const referrer = request.headers().referer;
      if (!rejecting && referrerLeaksPath(referrer))
        record(collected.referrers, host, path, referrer);
      if (!rejecting && request.isNavigationRequest() && request.frame() !== page.mainFrame())
        collected.embeds.add(host);
    });
    try {
      await navigate(page, url, { waitFor: config.render.waitFor, timeout });
      await pause(wait);
      recordHints(visit, await page.content());
    } catch (error) {
      collected.failed.push(
        failure(
          `failed to load ${path}`,
          error,
          `Check that ${path} loads in a browser within privacy.timeout (${timeout} ms), or add it to privacy.exclude.`,
        ),
      );
      return;
    }
    try {
      if (cookies) await recordLoaded(visit);
    } catch (error) {
      collected.failed.push(
        failure(
          `failed to read storage and cookies on ${path}`,
          error,
          `Check that ${path} stays open after load, or add it to privacy.exclude.`,
        ),
      );
      return;
    }
    if (!rejectSelector) return;
    const button = await page.$(rejectSelector).catch(() => null);
    if (!button) {
      collected.rejected.missing.add(path);
      return;
    }
    try {
      rejecting = true;
      await button.click();
      await pause(wait);
      if (cookies) await recordRejected(visit);
    } catch (error) {
      collected.failed.push(
        failure(
          `could not click reject button on ${path}`,
          error,
          `Check that ${rejectSelector} is visible and does not navigate, or use a text selector such as ::-p-text(Reject).`,
        ),
      );
    }
  } finally {
    await context.close();
  }
};
