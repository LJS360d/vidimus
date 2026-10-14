import type { HeaderMap } from '../core/headers.ts';
import type { Finding } from '../core/types.ts';
import { inParallel } from '../core/util.ts';

export type GroupedFinding = Finding & { where: string[] };

interface AddOptions {
  key?: string;
  appendDetails?: boolean;
}

export const groupFindings = () => {
  const entries = new Map<string, GroupedFinding>();
  const add = (finding: Finding, where?: string | null, options: AddOptions = {}) => {
    const key = options.key ?? [finding.message, ...(finding.details ?? [])].join('\n');
    const entry = entries.get(key);
    if (!entry) {
      entries.set(key, {
        ...finding,
        ...(finding.details && { details: [...finding.details] }),
        where: where ? [where] : [],
      });
      return;
    }
    if (where && !entry.where.includes(where)) entry.where.push(where);
    if (options.appendDetails && finding.details) {
      entry.details = [...(entry.details ?? []), ...finding.details];
    }
    if (finding.file) entry.file = finding.file;
  };
  const values = (): Finding[] =>
    [...entries.values()].map(({ where, details, ...rest }) => ({
      ...rest,
      ...(where.length ? { where } : {}),
      ...(details?.length ? { details } : {}),
    }));
  return { add, values, size: () => entries.size };
};

export const fetchHeaders = async (
  pages: { path: string }[],
  headersFor: (path: string) => Promise<HeaderMap | undefined>,
  onError?: (path: string, error: unknown) => void,
) => {
  const headers = new Map<string, HeaderMap>();
  await inParallel(8, pages, async ({ path }) => {
    try {
      const found = await headersFor(path);
      if (found) headers.set(path, found);
    } catch (error) {
      onError?.(path, error);
    }
  });
  return headers;
};

const NONCE_OR_HASH = /^'(nonce|sha(256|384|512))-/i;

export const hasNonceOrHash = (sources: string[]) =>
  sources.some((source) => NONCE_OR_HASH.test(source));

export const hasKeyword = (sources: string[], keyword: string) =>
  sources.some((source) => source.toLowerCase() === keyword);

export const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export const memo = <T>(compute: (file: string) => T) => {
  const cache = new Map<string, T>();
  return (file: string) => {
    if (!cache.has(file)) cache.set(file, compute(file));
    return cache.get(file) as T;
  };
};
