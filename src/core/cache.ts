import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VidimusConfig } from '../config/types.ts';
import { version } from './version.ts';

const sha1 = (...parts: string[]) => {
  const hash = createHash('sha1');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
};

export interface PageCache {
  get: <T>(source: string) => T | undefined;
  set: (source: string, value: unknown) => void;
}

export const createPageCache = (
  config: VidimusConfig,
  audit: string,
  settings: unknown,
): PageCache => {
  if (!config.cache.enabled) return { get: () => undefined, set: () => {} };
  const dir = resolve(config.root, config.cache.dir, audit);
  const scope = sha1(version, audit, JSON.stringify(settings));
  const file = (source: string) => join(dir, `${sha1(scope, source)}.json`);
  return {
    get: (source) => {
      try {
        return JSON.parse(readFileSync(file(source), 'utf8'));
      } catch {
        return undefined;
      }
    },
    set: (source, value) => {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file(source), JSON.stringify(value));
      } catch {}
    },
  };
};
