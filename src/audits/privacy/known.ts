import { matchesHost } from './hosts.ts';

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

export const EMBED_FIX =
  'Put the embed behind a click-to-load facade (a static preview that loads the iframe on click), or load it only after consent.';

export const FIRST_PARTY_COOKIE_FIX =
  'Set it only after consent, or add it to your cookie notice if it is strictly necessary.';

export const THIRD_PARTY_COOKIE_FIX =
  'Remove the embed or script that sets it, or load it only on click or after consent.';

export const STORAGE_FIX =
  'Defer writing to client-side storage until the visitor consents, or document it in your privacy notice if it is strictly necessary.';

export const HINT_FIX =
  'Remove the preconnect or dns-prefetch hint, or add it only after the visitor consents, so the browser does not contact the host before then.';

export const REJECTED_FIX =
  'Clear it, or never set it, when the visitor rejects consent: only strictly necessary cookies and storage may remain.';

export const knownEntry = (host: string) =>
  KNOWN_THIRD_PARTIES.find(({ hosts }) => hosts.some((suffix) => matchesHost(host, suffix)));

export const knownService = (host: string) => knownEntry(host)?.label;

export const requestFix = (host: string) => knownEntry(host)?.fix ?? UNKNOWN_HOST_FIX;
