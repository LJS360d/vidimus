import type { Page } from 'puppeteer';
import type { Pattern } from '../config/types.ts';
import { linksWithRel } from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';
import { inParallel, matchesAny, navigate, onePagePerTemplate, pathOf } from '../core/util.ts';

interface KnownThirdParty {
  hosts: string[];
  label: string;
  fix: string;
}

const KNOWN_THIRD_PARTIES: KnownThirdParty[] = [
  {
    hosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
    label: 'Google Fonts: self-host the fonts',
    fix: 'Self-host the fonts (e.g. with fontsource) instead of loading them from Google.',
  },
  {
    hosts: ['google-analytics.com', 'googletagmanager.com', 'analytics.google.com'],
    label: 'Google Analytics / Tag Manager: tracking, needs consent before loading',
    fix: 'Load the Google Analytics / Tag Manager snippet only after consent, or switch to a cookieless self-hosted analytics tool.',
  },
  {
    hosts: ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com'],
    label: 'Google Ads / DoubleClick: advertising tracker, needs consent before loading',
    fix: 'Load the Google Ads scripts only after the visitor consents to advertising cookies.',
  },
  {
    hosts: ['connect.facebook.net', 'facebook.com', 'facebook.net'],
    label: 'Facebook / Meta pixel: tracking, needs consent before loading',
    fix: 'Load the Meta pixel only after consent, and replace Facebook widgets with plain links.',
  },
  {
    hosts: ['youtube-nocookie.com'],
    label: 'YouTube (no-cookie): the player still loads YouTube scripts on page load',
    fix: 'Keep youtube-nocookie.com, and put the player behind a click-to-load facade (e.g. lite-youtube-embed) so nothing loads before a click.',
  },
  {
    hosts: ['youtube.com', 'ytimg.com', 'googlevideo.com'],
    label: 'YouTube: embed from youtube-nocookie.com behind a click-to-load placeholder',
    fix: 'Use youtube-nocookie.com behind a click-to-load facade (e.g. lite-youtube-embed).',
  },
  {
    hosts: ['vimeo.com', 'vimeocdn.com'],
    label: 'Vimeo: use dnt=1 and a click-to-load placeholder',
    fix: 'Add dnt=1 to the Vimeo player URL and put the embed behind a click-to-load facade.',
  },
  {
    hosts: ['maps.googleapis.com', 'maps.gstatic.com', 'maps.google.com'],
    label: 'Google Maps: use a static image or a click-to-load placeholder',
    fix: 'Replace the map with a static image linking to Google Maps, or load it only on click.',
  },
  {
    hosts: ['hotjar.com', 'hotjar.io'],
    label: 'Hotjar: session recording, needs consent',
    fix: 'Load the Hotjar script only after the visitor consents.',
  },
  {
    hosts: ['static.cloudflareinsights.com', 'cloudflareinsights.com'],
    label: 'Cloudflare Web Analytics: disable the automatic beacon or disclose it',
    fix: 'Turn off automatic Web Analytics setup in the Cloudflare dashboard, or disclose the beacon in your privacy policy.',
  },
  {
    hosts: ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'],
    label: 'public CDN: visitor IPs leak to the CDN, self-host the files',
    fix: 'Bundle or self-host the file.',
  },
  {
    hosts: ['platform.twitter.com', 'syndication.twitter.com', 'x.com', 'twimg.com'],
    label: 'Twitter / X widgets: use a static embed or click-to-load',
    fix: 'Replace the widget with a static blockquote or screenshot, or load widgets.js only on click.',
  },
  {
    hosts: ['intercom.io', 'intercomcdn.com'],
    label: 'Intercom: chat widget, load on demand',
    fix: 'Show a plain chat button and load the Intercom widget only when it is clicked.',
  },
  {
    hosts: ['clarity.ms'],
    label: 'Microsoft Clarity: session recording, needs consent',
    fix: 'Load the Clarity script only after the visitor consents.',
  },
  {
    hosts: ['linkedin.com', 'licdn.com'],
    label: 'LinkedIn Insight: tracking, needs consent',
    fix: 'Load the LinkedIn Insight Tag only after consent, and replace LinkedIn widgets with plain links.',
  },
  {
    hosts: ['recaptcha.net', 'gstatic.com'],
    label: 'Google (reCAPTCHA / static assets)',
    fix: 'Load reCAPTCHA only on the form that needs it (after consent), and self-host other gstatic.com assets.',
  },
];

const UNKNOWN_HOST_FIX =
  'Self-host the resource, load it only after consent, or add a pattern to privacy.allow if it is covered by your privacy policy.';

const EMBED_FIX =
  'Put the embed behind a click-to-load facade (a static preview that loads the iframe on click), or load it only after consent.';

const FIRST_PARTY_COOKIE_FIX =
  'Set it only after consent, or add it to your cookie notice if it is strictly necessary.';

const THIRD_PARTY_COOKIE_FIX =
  'Remove the embed or script that sets it, or load it only on click or after consent.';

const STORAGE_FIX =
  'Defer writing to client-side storage until the visitor consents, or document it in your privacy notice if it is strictly necessary.';

const HINT_FIX =
  'Remove the preconnect or dns-prefetch hint, or add it only after the visitor consents, so the browser does not contact the host before then.';

const REJECTED_FIX =
  'Clear it, or never set it, when the visitor rejects consent: only strictly necessary cookies and storage may remain.';

const STORAGE_LIST_CAP = 10;

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
    return {
      localStorage: keys(() => localStorage),
      sessionStorage: keys(() => sessionStorage),
      indexedDB: databases,
    };
  });

export type RequestKind = 'ignored' | 'first-party' | 'allowed' | 'third-party';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const matchesHost = (host: string, suffix: string) =>
  host === suffix || host.endsWith(`.${suffix}`);

const knownEntry = (host: string) =>
  KNOWN_THIRD_PARTIES.find(({ hosts }) => hosts.some((suffix) => matchesHost(host, suffix)));

export const knownService = (host: string) => knownEntry(host)?.label;

export const requestFix = (host: string) => knownEntry(host)?.fix ?? UNKNOWN_HOST_FIX;

export const firstPartyHostsOf = (...origins: string[]) =>
  new Set(origins.map(hostOf).filter(Boolean));

export const classifyRequest = (
  url: string,
  firstPartyHosts: Set<string>,
  allow: Pattern[],
): RequestKind => {
  if (!/^(https?|wss?):/i.test(url)) return 'ignored';
  if (firstPartyHosts.has(hostOf(url))) return 'first-party';
  if (matchesAny(allow, url)) return 'allowed';
  return 'third-party';
};

export const isFirstPartyCookie = (domain: string, firstPartyHosts: Set<string>) => {
  const bare = domain.replace(/^\./, '');
  return [...firstPartyHosts].some((host) => matchesHost(host, bare));
};

interface Seen {
  where: Set<string>;
  examples: Set<string>;
}

const record = (map: Map<string, Seen>, key: string, path: string, example?: string) => {
  const seen = map.get(key) ?? { where: new Set(), examples: new Set() };
  seen.where.add(path);
  if (example && seen.examples.size < 3) seen.examples.add(example);
  map.set(key, seen);
};

export const privacy: Audit = {
  name: 'privacy',
  description: 'no third-party requests or cookies on page load',
  requires: 'server',
  async run({ config, origin, pageUrls, launchBrowser }) {
    const {
      allow,
      exclude,
      sample,
      allLocales,
      cookies,
      wait,
      concurrency,
      timeout,
      rejectSelector,
    } = config.privacy;
    const urls = onePagePerTemplate(
      pageUrls({ exclude, allLocales: allLocales || config.allLocales }),
      sample,
      origin,
    );
    const firstParty = firstPartyHostsOf(origin, config.siteUrl);
    const hosts = new Map<string, Seen>();
    const hints = new Map<string, Seen>();
    const embeds = new Set<string>();
    const cookieJar = new Map<string, { where: Set<string>; firstParty: boolean }>();
    const storageJar = new Map<string, { names: Set<string>; where: Set<string> }>();
    const rejected = {
      hosts: new Map<string, Seen>(),
      cookies: new Map<string, Seen>(),
      storage: new Map<string, Seen>(),
      missing: new Set<string>(),
    };
    const failed: Finding[] = [];
    const browser = await launchBrowser();

    try {
      await inParallel(concurrency, urls, async (url) => {
        const path = pathOf(url, origin);
        const context = await browser.createBrowserContext();
        try {
          const page = await context.newPage();
          let rejecting = false;
          page.on('request', (request) => {
            const requested = request.url();
            if (classifyRequest(requested, firstParty, allow) !== 'third-party') return;
            record(rejecting ? rejected.hosts : hosts, hostOf(requested), path, requested);
            if (rejecting) return;
            if (request.isNavigationRequest() && request.frame() !== page.mainFrame())
              embeds.add(hostOf(requested));
          });
          try {
            await navigate(page, url, { waitFor: config.render.waitFor, timeout });
            await new Promise((resolve) => setTimeout(resolve, wait));
            const html = await page.content();
            for (const rel of ['preconnect', 'dns-prefetch']) {
              for (const { attrs } of linksWithRel(html, rel)) {
                if (!attrs.href) continue;
                let target: URL;
                try {
                  target = new URL(attrs.href, url);
                } catch {
                  continue;
                }
                if (classifyRequest(target.href, firstParty, allow) !== 'third-party') continue;
                record(hints, target.hostname, path, `${rel} ${target.href}`);
              }
            }
          } catch (error) {
            failed.push({
              message: `failed to load ${path}`,
              details: [(error as Error).message],
              fix: `Check that ${path} loads in a browser within privacy.timeout (${timeout} ms), or add it to privacy.exclude.`,
            });
            return;
          }
          if (cookies) {
            for (const [kind, names] of Object.entries(await readStorage(page))) {
              if (!names.length) continue;
              const entry = storageJar.get(kind) ?? { names: new Set(), where: new Set() };
              for (const name of names) entry.names.add(name);
              entry.where.add(path);
              storageJar.set(kind, entry);
            }
            for (const cookie of await context.cookies()) {
              const key = `${cookie.name} set on load (${cookie.domain})`;
              const entry = cookieJar.get(key) ?? {
                where: new Set<string>(),
                firstParty: isFirstPartyCookie(cookie.domain, firstParty),
              };
              entry.where.add(path);
              cookieJar.set(key, entry);
            }
          }
          if (!rejectSelector) return;
          const button = await page.$(rejectSelector).catch(() => null);
          if (!button) {
            rejected.missing.add(path);
            return;
          }
          rejecting = true;
          await button.click();
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (!cookies) return;
          for (const [kind, names] of Object.entries(await readStorage(page))) {
            if (names.length) record(rejected.storage, kind, path, names.join(', '));
          }
          for (const cookie of await context.cookies()) {
            record(rejected.cookies, `${cookie.name} (${cookie.domain})`, path);
          }
        } finally {
          await context.close();
        }
      });
    } finally {
      await browser.close();
    }

    const sorted = <T>(map: Map<string, T>) =>
      [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    const findings: Finding[] = [
      ...sorted(hosts).map(([host, { where, examples }]) => {
        const label = knownService(host);
        const embedded = embeds.has(host);
        return {
          message: `third-party ${embedded ? 'embed' : 'request'} ${embedded ? 'from' : 'to'} ${host}`,
          details: [
            ...(embedded ? ['loaded in an <iframe> on page load'] : []),
            ...(label ? [label] : []),
            ...examples,
          ],
          where: [...where].sort(),
          fix: embedded && !knownEntry(host) ? EMBED_FIX : requestFix(host),
        };
      }),
      ...sorted(hints).map(([host, { where, examples }]) => {
        const label = knownService(host);
        return {
          message: `third-party resource hint to ${host}`,
          details: [...(label ? [label] : []), ...examples],
          where: [...where].sort(),
          severity: 'warn' as const,
          fix: HINT_FIX,
        };
      }),
      ...sorted(cookieJar).map(([key, { where, firstParty }]) => ({
        message: `cookie ${key}`,
        where: [...where].sort(),
        ...(firstParty ? { severity: 'warn' as const } : {}),
        fix: firstParty ? FIRST_PARTY_COOKIE_FIX : THIRD_PARTY_COOKIE_FIX,
      })),
      ...sorted(storageJar).map(([kind, { names, where }]) => {
        const list = [...names].sort();
        const extra = list.length - STORAGE_LIST_CAP;
        return {
          message: `${kind} written on load`,
          details: [
            ...list.slice(0, STORAGE_LIST_CAP),
            ...(extra > 0 ? [`and ${extra} more`] : []),
          ],
          where: [...where].sort(),
          severity: 'warn' as const,
          fix: STORAGE_FIX,
        };
      }),
      ...sorted(rejected.hosts).map(([host, { where, examples }]) => ({
        message: `third-party request to ${host} after rejecting consent`,
        details: [...examples],
        where: [...where].sort(),
        fix: `Make the reject button (${rejectSelector}) stop every request to ${host}: load it only after the visitor accepts.`,
      })),
      ...sorted(rejected.cookies).map(([key, { where }]) => ({
        message: `cookie ${key} still set after rejecting consent`,
        where: [...where].sort(),
        fix: REJECTED_FIX,
      })),
      ...sorted(rejected.storage).map(([kind, { where, examples }]) => ({
        message: `${kind} still present after rejecting consent`,
        details: [...examples],
        where: [...where].sort(),
        fix: REJECTED_FIX,
      })),
      ...(rejected.missing.size
        ? [
            {
              message: `reject button not found: ${rejectSelector}`,
              where: [...rejected.missing].sort(),
              severity: 'warn' as const,
              fix: 'Fix privacy.rejectSelector so it matches the reject button of your consent banner on these pages, or clear it to skip the check.',
            },
          ]
        : []),
      ...failed,
    ];
    const clean =
      !rejected.hosts.size &&
      !rejected.cookies.size &&
      !rejected.storage.size &&
      !hosts.size &&
      !hints.size &&
      !cookieJar.size &&
      !storageJar.size;
    const failures = failed.length ? `, ${failed.length} failed to load` : '';
    return {
      summary: clean
        ? `${urls.length} pages, no third-party requests, cookies or storage writes${failures}`
        : `${urls.length} pages, ${hosts.size} third-party host(s), ${cookieJar.size} cookie(s)${storageJar.size ? `, ${storageJar.size} storage kind(s)` : ''}${hints.size ? `, ${hints.size} resource hint host(s)` : ''}${failures}`,
      findings,
    };
  },
};
