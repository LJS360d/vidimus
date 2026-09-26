import type { Pattern } from '../config/types.ts';
import type { Audit, Finding } from '../core/types.ts';
import { inParallel, matchesAny, onePagePerTemplate, pathOf } from '../core/util.ts';

interface KnownThirdParty {
  hosts: string[];
  label: string;
}

const KNOWN_THIRD_PARTIES: KnownThirdParty[] = [
  {
    hosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
    label: 'Google Fonts: self-host the fonts',
  },
  {
    hosts: ['google-analytics.com', 'googletagmanager.com', 'analytics.google.com'],
    label: 'Google Analytics / Tag Manager: tracking, needs consent before loading',
  },
  {
    hosts: ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com'],
    label: 'Google Ads / DoubleClick: advertising tracker, needs consent before loading',
  },
  {
    hosts: ['connect.facebook.net', 'facebook.com', 'facebook.net'],
    label: 'Facebook / Meta pixel: tracking, needs consent before loading',
  },
  {
    hosts: ['youtube.com', 'ytimg.com', 'googlevideo.com'],
    label: 'YouTube: embed from youtube-nocookie.com behind a click-to-load placeholder',
  },
  {
    hosts: ['vimeo.com', 'vimeocdn.com'],
    label: 'Vimeo: use dnt=1 and a click-to-load placeholder',
  },
  {
    hosts: ['maps.googleapis.com', 'maps.gstatic.com', 'maps.google.com'],
    label: 'Google Maps: use a static image or a click-to-load placeholder',
  },
  { hosts: ['hotjar.com', 'hotjar.io'], label: 'Hotjar: session recording, needs consent' },
  {
    hosts: ['static.cloudflareinsights.com', 'cloudflareinsights.com'],
    label: 'Cloudflare Web Analytics: disable the automatic beacon or disclose it',
  },
  {
    hosts: ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'],
    label: 'public CDN: visitor IPs leak to the CDN, self-host the files',
  },
  {
    hosts: ['platform.twitter.com', 'syndication.twitter.com', 'x.com', 'twimg.com'],
    label: 'Twitter / X widgets: use a static embed or click-to-load',
  },
  { hosts: ['intercom.io', 'intercomcdn.com'], label: 'Intercom: chat widget, load on demand' },
  { hosts: ['clarity.ms'], label: 'Microsoft Clarity: session recording, needs consent' },
  { hosts: ['linkedin.com', 'licdn.com'], label: 'LinkedIn Insight: tracking, needs consent' },
  { hosts: ['recaptcha.net', 'gstatic.com'], label: 'Google (reCAPTCHA / static assets)' },
];

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

export const knownService = (host: string) =>
  KNOWN_THIRD_PARTIES.find(({ hosts }) => hosts.some((suffix) => matchesHost(host, suffix)))?.label;

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
    const { allow, exclude, sample, allLocales, cookies, wait, concurrency, timeout } =
      config.privacy;
    const urls = onePagePerTemplate(pageUrls({ exclude, allLocales }), sample);
    const firstParty = firstPartyHostsOf(origin, config.siteUrl);
    const hosts = new Map<string, Seen>();
    const cookieJar = new Map<string, { where: Set<string>; firstParty: boolean }>();
    const failed: Finding[] = [];
    const browser = await launchBrowser();

    try {
      await inParallel(concurrency, urls, async (url) => {
        const path = pathOf(url);
        const context = await browser.createBrowserContext();
        try {
          const page = await context.newPage();
          page.on('request', (request) => {
            const requested = request.url();
            if (classifyRequest(requested, firstParty, allow) === 'third-party')
              record(hosts, hostOf(requested), path, requested);
          });
          try {
            await page.goto(url, { waitUntil: 'load', timeout });
            await new Promise((resolve) => setTimeout(resolve, wait));
          } catch (error) {
            failed.push({ message: `failed to load ${path}`, details: [(error as Error).message] });
            return;
          }
          if (!cookies) return;
          for (const cookie of await context.cookies()) {
            const key = `${cookie.name} set on load (${cookie.domain})`;
            const entry = cookieJar.get(key) ?? {
              where: new Set<string>(),
              firstParty: isFirstPartyCookie(cookie.domain, firstParty),
            };
            entry.where.add(path);
            cookieJar.set(key, entry);
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
        return {
          message: `third-party request to ${host}`,
          details: [...(label ? [label] : []), ...examples],
          where: [...where].sort(),
        };
      }),
      ...sorted(cookieJar).map(([key, { where, firstParty }]) => ({
        message: `cookie ${key}`,
        where: [...where].sort(),
        ...(firstParty ? { severity: 'warn' as const } : {}),
      })),
      ...failed,
    ];
    const clean = !hosts.size && !cookieJar.size;
    const failures = failed.length ? `, ${failed.length} failed to load` : '';
    return {
      summary: clean
        ? `${urls.length} pages, no third-party requests or cookies${failures}`
        : `${urls.length} pages, ${hosts.size} third-party host(s), ${cookieJar.size} cookie(s)${failures}`,
      findings,
    };
  },
};
