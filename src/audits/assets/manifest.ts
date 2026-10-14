import { readFileSync } from 'node:fs';
import { linksWithRel, localFile, resolveHref } from '../../core/html.ts';
import { isPlainObject } from '../../core/util.ts';
import type { Env, Report } from './env.ts';

const DISPLAY_MODES = new Set(['fullscreen', 'standalone', 'minimal-ui', 'browser']);
const ICON_EXAMPLE = '{"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}';
const MIN_ICON = 512;

const largestDeclared = (sizes: unknown) =>
  typeof sizes !== 'string'
    ? 0
    : Math.max(
        0,
        ...sizes
          .toLowerCase()
          .split(/\s+/)
          .map((size) => {
            if (size === 'any') return Number.POSITIVE_INFINITY;
            const [width = 0, height = 0] = size.split('x').map(Number);
            return Math.min(width, height) || 0;
          }),
      );

const readJson = (file: string) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

type Problem = (message: string, fix: string, file?: string, severity?: 'warn') => void;
type Manifest = Record<string, unknown>;

interface Check {
  env: Env;
  path: string;
  file: string;
  manifest: Manifest;
  problem: Problem;
}

const checkStartUrl = ({ env, path, file, manifest, problem }: Check) => {
  const scopeValue = typeof manifest.scope === 'string' ? manifest.scope : '.';
  const scope = resolveHref(scopeValue, path, env.siteUrl)?.path;
  const startValue = typeof manifest.start_url === 'string' ? manifest.start_url : '';
  if (!startValue) {
    problem(`manifest ${path} has no start_url`, `Add "start_url": "/" to ${path}.`, file, 'warn');
    return;
  }
  const start = resolveHref(startValue, path, env.siteUrl)?.path;
  const root = scope?.endsWith('/') ? scope : `${scope}/`;
  if (!scope || !start || (start !== root.slice(0, -1) && !start.startsWith(root))) {
    problem(
      `manifest ${path} start_url ${startValue} is outside scope ${scopeValue}`,
      `Set "start_url" inside "scope" in ${path}, or widen "scope".`,
      file,
    );
  } else if (!localFile(env.dist, start)) {
    problem(
      `manifest start_url ${start} not found`,
      `Add ${start} to the build or fix "start_url" in ${path}.`,
      file,
    );
  }
};

const checkIcons = ({ env, path, file, problem }: Check, icons: Manifest[]) => {
  if (
    !icons.some((icon) =>
      String(icon.purpose ?? '')
        .split(/\s+/)
        .includes('maskable'),
    )
  ) {
    problem(
      `manifest ${path} has no maskable icon`,
      `Add a 512x512 icon with "purpose": "maskable" to "icons" in ${path}.`,
      file,
      'warn',
    );
  }
  let largest = 0;
  for (const icon of icons) {
    const src = typeof icon.src === 'string' ? icon.src : '';
    const resolved = resolveHref(src, path, env.siteUrl);
    const iconFile = resolved?.path ? localFile(env.dist, resolved.path) : null;
    if (resolved?.path && !iconFile) {
      problem(
        `manifest icon ${resolved.path} not found`,
        `Add ${resolved.path} to the build or fix its "src" in ${path}.`,
        file,
      );
      continue;
    }
    const measured = iconFile ? env.measure(iconFile) : undefined;
    if (measured && typeof icon.sizes === 'string') {
      const actual = `${measured.width}x${measured.height}`;
      const declared = icon.sizes.toLowerCase().split(/\s+/);
      if (!declared.includes(actual) && !declared.includes('any'))
        problem(
          `manifest icon ${resolved?.path} declares ${icon.sizes} but is ${actual}`,
          `Set "sizes" to "${actual}" for this icon in ${path}.`,
          file,
          'warn',
        );
    }
    largest = Math.max(
      largest,
      measured ? Math.min(measured.width, measured.height) : largestDeclared(icon.sizes),
    );
  }
  if (largest < MIN_ICON)
    problem(
      `manifest ${path} has no icon of at least 512x512`,
      `Add a 512x512 PNG to "icons" in ${path}, e.g. ${ICON_EXAMPLE}.`,
      file,
      'warn',
    );
};

const checkManifest = (env: Env, path: string, linkedFrom: Set<string>, report: Report) => {
  const problem: Problem = (message, fix, file, severity) => {
    for (const where of linkedFrom) report({ message, fix, file, severity }, where);
  };
  const file = localFile(env.dist, path);
  if (!file) {
    problem(
      `manifest ${path} not found`,
      `Add ${path} to the build or fix the href of <link rel="manifest">.`,
    );
    return;
  }
  const manifest = readJson(file);
  if (!isPlainObject(manifest)) {
    problem(
      `manifest ${path} is not valid JSON`,
      `Fix the JSON syntax in ${path} (check it with jq or JSON.parse).`,
      file,
    );
    return;
  }
  if (!manifest.name && !manifest.short_name) {
    problem(
      `manifest ${path} has no name or short_name`,
      `Add "name": "<site name>" (and optionally "short_name") to ${path}.`,
      file,
    );
  }
  const icons = Array.isArray(manifest.icons) ? manifest.icons.filter(isPlainObject) : [];
  if (icons.length === 0) {
    problem(
      `manifest ${path} has no icons`,
      `Add an "icons" array to ${path}, e.g. [${ICON_EXAMPLE}].`,
      file,
    );
    return;
  }
  const check: Check = { env, path, file, manifest, problem };
  checkStartUrl(check);
  if (manifest.display !== undefined && !DISPLAY_MODES.has(String(manifest.display))) {
    problem(
      `manifest ${path} display "${manifest.display}" is not valid`,
      `Set "display" in ${path} to one of ${[...DISPLAY_MODES].join(', ')}.`,
      file,
    );
  }
  checkIcons(check, icons);
};

export const checkManifests = (env: Env, report: Report) => {
  const manifests = new Map<string, Set<string>>();
  let linked = false;
  for (const page of env.pages) {
    for (const { attrs } of linksWithRel(page.html, 'manifest')) {
      linked = true;
      const resolved = resolveHref(attrs.href ?? '', page.path, env.siteUrl);
      if (!resolved?.path) continue;
      manifests.set(resolved.path, (manifests.get(resolved.path) ?? new Set()).add(page.path));
    }
  }
  if (!linked) {
    report({
      message: 'no <link rel="manifest"> on any page',
      severity: 'warn',
      fix: 'Add a site.webmanifest with name and icons to the build and <link rel="manifest" href="/site.webmanifest"> to every page, or set assets.manifest to false.',
    });
  }
  for (const [path, linkedFrom] of manifests) checkManifest(env, path, linkedFrom, report);
};
