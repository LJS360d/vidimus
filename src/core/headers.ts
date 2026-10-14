import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type HeaderMap, type HeaderRule, headersFor, parseHeadersFile } from './header-rules.ts';
import { HOST_FILES, type HostParser, redirectPattern, redirectSourcesIn } from './host-config.ts';
import { messageOf } from './util.ts';

export { type HeaderMap, headersFor, parseHeadersFile };

const hostPaths = (root: string, dist: string) =>
  [root, dist].flatMap((dir) =>
    HOST_FILES.map(([name, parse]) => ({ name, parse, path: join(dir, name) })),
  );

const loadHeaderRules = (root: string, dist: string, file: string) => {
  const rules: HeaderRule[] = [];
  const sources: string[] = [];
  const notes: string[] = [];
  const sought: { name: string; parse: HostParser; path: string }[] = [
    { name: file, parse: parseHeadersFile, path: join(dist, file) },
    ...hostPaths(root, dist),
  ];
  for (const { name, parse, path } of sought) {
    if (!existsSync(path)) continue;
    const ignored: string[] = [];
    try {
      rules.push(...parse(readFileSync(path, 'utf8'), ignored));
      sources.push(name);
    } catch (error) {
      notes.push(`${name}: invalid JSON (${messageOf(error)})`);
    }
    if (ignored.length) {
      notes.push(
        `ignored ${ignored.length} unsupported patterns in ${name}: ${ignored.join(', ')}`,
      );
    }
  }
  return { rules, sources: [...new Set(sources)], notes };
};

const FETCH_TIMEOUT = 20_000;
const MAX_REDIRECTS = 5;

const request = async (url: string) => {
  const init = { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT) } as const;
  let response = await fetch(url, { ...init, method: 'HEAD' });
  if (response.status === 405) response = await fetch(url, init);
  await response.body?.cancel();
  return response;
};

const fetchHeaders = async (url: string): Promise<HeaderMap> => {
  let current = new URL(url);
  let response = await request(current.href);
  for (let hops = 0; hops < MAX_REDIRECTS; hops += 1) {
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) break;
    const next = new URL(location, current);
    if (next.origin !== current.origin) break;
    current = next;
    response = await request(current.href);
  }
  return Object.fromEntries([...response.headers].map(([name, value]) => [name, value]));
};

export const redirectSources = (root: string, dist: string) => {
  const sought = [{ name: '_redirects', path: join(dist, '_redirects') }, ...hostPaths(root, dist)];
  return sought.flatMap(({ name, path }) => {
    if (!existsSync(path)) return [];
    try {
      return redirectSourcesIn(name, readFileSync(path, 'utf8'));
    } catch {
      return [];
    }
  });
};

export const redirectMatches = (sources: string[], path: string) =>
  sources.some((source) => redirectPattern(source)?.test(path));

export interface HeaderSource {
  sources: string[];
  notes: string[];
  for: (path: string) => Promise<HeaderMap | undefined>;
}

export const createHeaderSource = (
  root: string,
  dist: string,
  file: string,
  origin: string,
): HeaderSource => {
  const loaded = loadHeaderRules(root, dist, file);
  const cache = new Map<string, Promise<HeaderMap | undefined>>();
  return {
    sources: origin ? [origin] : loaded.sources,
    notes: loaded.notes,
    for(path) {
      let found = cache.get(path);
      if (!found) {
        found = origin
          ? fetchHeaders(origin + path)
          : Promise.resolve(loaded.sources.length ? headersFor(loaded.rules, path) : undefined);
        cache.set(path, found);
      }
      return found;
    },
  };
};
