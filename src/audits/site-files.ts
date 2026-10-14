import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SiteFileCheck } from '../config/types.ts';
import { redirectMatches } from '../core/headers.ts';
import {
  type BuiltPage,
  isFile,
  linksWithRel,
  localFile,
  meta,
  relTokens,
  resolveHref,
  tags,
} from '../core/html.ts';
import type { Finding } from '../core/types.ts';
import { basePathOf, isPlainObject } from '../core/util.ts';

export interface SiteFileOptions {
  adsTxt: SiteFileCheck;
  changePassword: SiteFileCheck;
  appleAppSiteAssociation: SiteFileCheck;
  assetLinks: SiteFileCheck;
}

interface Located {
  finding: Finding;
  where: string[];
}

const AD_HOSTS = [
  'pagead2.googlesyndication.com',
  'securepubads.g.doubleclick.net',
  'googletagservices.com',
  'c.amazon-adsystem.com',
  'adnxs.com',
  'contextual.media.net',
  'ezojs.com',
  'ezoic.net',
  'scripts.mediavine.com',
  'ads.adthrive.com',
  'cdn.taboola.com',
  'widgets.outbrain.com',
  'static.criteo.net',
  'ads.pubmatic.com',
  'micro.rubiconproject.com',
  'openx.net',
  'cdn.carbonads.com',
];

const GOOGLE_CERT = 'f08c47fec0942fa0';

const hostOf = (src: string) => {
  try {
    return new URL(src, 'https://vidimus.invalid').hostname.toLowerCase();
  } catch {
    return '';
  }
};

const loadsAds = (html: string) =>
  tags(html, 'script').some(({ attrs }) => {
    const src = attrs.src ?? '';
    const host = hostOf(src);
    return (
      AD_HOSTS.some((ad) => host === ad || host.endsWith(`.${ad}`)) ||
      /\/prebid[\w.-]*\.js(\?|$)/i.test(src)
    );
  }) || tags(html, 'ins').some(({ attrs }) => /\badsbygoogle\b/.test(attrs.class ?? ''));

const hasPasswordField = (html: string) =>
  tags(html, 'input').some(
    ({ attrs }) =>
      (attrs.type ?? '').toLowerCase() === 'password' ||
      /\b(current|new)-password\b/i.test(attrs.autocomplete ?? ''),
  );

const hasNewPasswordField = (html: string) =>
  tags(html, 'input').some(({ attrs }) => /\bnew-password\b/i.test(attrs.autocomplete ?? ''));

const alternateSchemes = (html: string) =>
  tags(html, 'link')
    .filter((tag) => relTokens(tag).includes('alternate'))
    .map(({ attrs }) => (attrs.href ?? '').trim().toLowerCase());

const readJson = (file: string) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

const relatedPlatforms = (page: BuiltPage, dist: string, siteUrl: string) =>
  linksWithRel(page.html, 'manifest').flatMap(({ attrs }) => {
    const resolved = resolveHref(attrs.href ?? '', page.path, siteUrl);
    const file = resolved?.path ? localFile(dist, resolved.path) : null;
    const manifest = file ? readJson(file) : undefined;
    const related = isPlainObject(manifest) ? manifest.related_applications : undefined;
    return Array.isArray(related)
      ? related.filter(isPlainObject).map(({ platform }) => String(platform).toLowerCase())
      : [];
  });

export const adsTxtRecords = (text: string) => {
  const records: { domain: string; account: string }[] = [];
  const invalid: string[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || /^[a-z]+\s*=/i.test(line)) continue;
    const [domain = '', account = '', relation = ''] = line.split(',').map((part) => part.trim());
    if (domain.includes('.') && account && /^(direct|reseller)$/i.test(relation)) {
      records.push({ domain: domain.toLowerCase(), account: account.toLowerCase() });
    } else invalid.push(`line ${index + 1}: ${raw.trim()}`);
  }
  return { records, invalid };
};

const served = (dist: string, redirects: string[], path: string) =>
  !!localFile(dist, path) || redirectMatches(redirects, path);

const firstFile = (dist: string, paths: string[]) =>
  paths.map((path) => join(dist, path)).find(isFile);

export const siteFileFindings = (
  pages: BuiltPage[],
  dist: string,
  siteUrl: string,
  options: SiteFileOptions,
  log: (line: string) => void,
  redirects: string[] = [],
): Located[] => {
  const pathsWhere = (mode: SiteFileCheck, test: (page: BuiltPage) => boolean) =>
    mode === 'off' ? [] : pages.filter(test).map(({ path }) => path);
  const platforms = new Map<BuiltPage, string[]>();
  const platformsOf = (page: BuiltPage) => {
    const known = platforms.get(page) ?? relatedPlatforms(page, dist, siteUrl);
    platforms.set(page, known);
    return known;
  };
  const promotesApp = (page: BuiltPage, metaName: string, scheme: string, platform: string) =>
    !!meta(page.html, metaName) ||
    alternateSchemes(page.html).some((href) => href.startsWith(scheme)) ||
    platformsOf(page).includes(platform);
  const adPages = pathsWhere(options.adsTxt, (page) => loadsAds(page.html));
  const passwordPages = pathsWhere(options.changePassword, (page) => hasPasswordField(page.html));
  const iosPages = pathsWhere(options.appleAppSiteAssociation, (page) =>
    promotesApp(page, 'apple-itunes-app', 'ios-app://', 'itunes'),
  );
  const androidPages = pathsWhere(options.assetLinks, (page) =>
    promotesApp(page, 'google-play-app', 'android-app://', 'play'),
  );

  const wanted = (mode: SiteFileCheck, where: string[]) =>
    mode === 'on' || (mode === 'auto' && where.length > 0);
  const checks = {
    ads: wanted(options.adsTxt, adPages),
    password: wanted(options.changePassword, passwordPages),
    ios: wanted(options.appleAppSiteAssociation, iosPages),
    android: wanted(options.assetLinks, androidPages),
  };
  const base = basePathOf(siteUrl);
  if (base) {
    if (Object.values(checks).some(Boolean))
      log(
        `root file checks skipped: the site is served under ${base}/, they belong at the origin root`,
      );
    return [];
  }

  const found: Located[] = [];
  const add = (finding: Finding, where: string[] = []) => found.push({ finding, where });

  const checkAdsFile = (name: string, where: string[], publishers: Map<string, string[]>) => {
    const file = join(dist, name);
    const { records, invalid } = adsTxtRecords(readFileSync(file, 'utf8'));
    if (invalid.length) {
      add({
        message: `${name} has malformed lines`,
        details: invalid,
        file,
        fix: 'Write each record as "<ad system domain>, <account id>, DIRECT|RESELLER[, <cert id>]", e.g. "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0".',
      });
    }
    if (!records.length) {
      add(
        {
          message: `${name} has no records`,
          file,
          fix: 'List every ad system allowed to sell your inventory, one "<domain>, <account id>, DIRECT|RESELLER" per line.',
        },
        where,
      );
    }
    for (const [publisher, on] of publishers) {
      if (records.some(({ domain, account }) => domain === 'google.com' && account === publisher))
        continue;
      add(
        {
          message: `${name} does not list AdSense publisher ${publisher}`,
          file,
          fix: `Add "google.com, ${publisher}, DIRECT, ${GOOGLE_CERT}" to ${name}.`,
        },
        on,
      );
    }
  };

  if (checks.ads) {
    const publishers = new Map<string, string[]>();
    for (const page of pages) {
      for (const [, id] of page.html.matchAll(/\bca-pub-(\d{10,20})\b/g)) {
        const key = `pub-${id}`;
        const on = publishers.get(key) ?? [];
        if (!on.includes(page.path)) on.push(page.path);
        publishers.set(key, on);
      }
    }
    if (isFile(join(dist, 'ads.txt'))) checkAdsFile('ads.txt', adPages, publishers);
    else {
      add(
        {
          message: 'no /ads.txt on a site that shows ads',
          severity: 'warn',
          fix: `Add an ads.txt to the build root listing the ad systems allowed to sell your ad space (your ad network gives you the lines), or set assets.adsTxt to "off". Without it many buyers skip the inventory.`,
        },
        adPages,
      );
    }
  }
  if (options.adsTxt !== 'off' && isFile(join(dist, 'app-ads.txt')))
    checkAdsFile('app-ads.txt', [], new Map());

  if (checks.password && !served(dist, redirects, '/.well-known/change-password')) {
    const target =
      pages.find((page) => hasNewPasswordField(page.html))?.path ?? '/account/password';
    add(
      {
        message: 'no /.well-known/change-password on a site with password fields',
        severity: 'warn',
        fix: `Redirect /.well-known/change-password to the page where users change their password, e.g. "/.well-known/change-password ${target} 302" in _redirects, so password managers can send users there; or set assets.changePassword to "off".`,
      },
      passwordPages,
    );
  }

  if (checks.ios) {
    const file = firstFile(dist, [
      '.well-known/apple-app-site-association',
      'apple-app-site-association',
    ]);
    const json = file ? readJson(file) : undefined;
    if (!file) {
      add(
        {
          message: 'no /.well-known/apple-app-site-association for the iOS app',
          severity: 'warn',
          fix: 'Add .well-known/apple-app-site-association (JSON, no extension) with "applinks" and/or "webcredentials" for your app ID, served as application/json, so links open the app and passwords are shared; or set assets.appleAppSiteAssociation to "off".',
        },
        iosPages,
      );
    } else if (
      !isPlainObject(json) ||
      !['applinks', 'webcredentials', 'appclips', 'activitycontinuation'].some((key) =>
        isPlainObject(json[key]),
      )
    ) {
      add({
        message: 'apple-app-site-association is not valid',
        file,
        fix: 'Make it a JSON object with an "applinks", "webcredentials" or "appclips" section, e.g. {"applinks": {"details": [{"appIDs": ["TEAMID.com.example.app"], "components": [{"/": "/*"}]}]}}.',
      });
    }
  }

  if (checks.android) {
    const file = firstFile(dist, ['.well-known/assetlinks.json']);
    const json = file ? readJson(file) : undefined;
    if (!file) {
      add(
        {
          message: 'no /.well-known/assetlinks.json for the Android app',
          severity: 'warn',
          fix: 'Add .well-known/assetlinks.json with your package name and signing certificate fingerprint so App Links open the app and credentials are shared; or set assets.assetLinks to "off".',
        },
        androidPages,
      );
    } else if (
      !Array.isArray(json) ||
      !json.length ||
      !json.every(
        (entry) =>
          isPlainObject(entry) && Array.isArray(entry.relation) && isPlainObject(entry.target),
      )
    ) {
      add({
        message: 'assetlinks.json is not valid',
        file,
        fix: 'Make it a JSON array of statements like {"relation": ["delegate_permission/common.handle_all_urls"], "target": {"namespace": "android_app", "package_name": "com.example.app", "sha256_cert_fingerprints": ["…"]}}.',
      });
    }
  }

  return found;
};
