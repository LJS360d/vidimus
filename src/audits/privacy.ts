import type { Pattern } from '../config/types.ts';
import type { Audit, Finding } from '../core/types.ts';
import { inParallel, matchesAny, onePagePerTemplate, pathOf } from '../core/util.ts';

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
    hosts: ['youtube.com', 'ytimg.com', 'googlevideo.com'],
    label: 'YouTube: embed from youtube-nocookie.com behind a click-to-load placeholder',
    fix: 'Use youtube-nocookie.com behind a click-to-load facade.',
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

const FIRST_PARTY_COOKIE_FIX =
  'Set it only after consent, or add it to your cookie notice if it is strictly necessary.';

const THIRD_PARTY_COOKIE_FIX =
  'Remove the embed or script that sets it, or load it only on click or after consent.';

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
    const { allow, exclude, sample, allLocales, cookies, wait, concurrency, timeout } =
      config.privacy;
    const urls = onePagePerTemplate(pageUrls({ exclude, allLocales }), sample, origin);
    const firstParty = firstPartyHostsOf(origin, config.siteUrl);
    const hosts = new Map<string, Seen>();
    const cookieJar = new Map<string, { where: Set<string>; firstParty: boolean }>();
    const failed: Finding[] = [];
    const browser = await launchBrowser();

    try {
      await inParallel(concurrency, urls, async (url) => {
        const path = pathOf(url, origin);
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
            failed.push({
              message: `failed to load ${path}`,
              details: [(error as Error).message],
              fix: `Check that ${path} loads in a browser within privacy.timeout (${timeout} ms), or add it to privacy.exclude.`,
            });
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
          fix: requestFix(host),
        };
      }),
      ...sorted(cookieJar).map(([key, { where, firstParty }]) => ({
        message: `cookie ${key}`,
        where: [...where].sort(),
        ...(firstParty ? { severity: 'warn' as const } : {}),
        fix: firstParty ? FIRST_PARTY_COOKIE_FIX : THIRD_PARTY_COOKIE_FIX,
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
