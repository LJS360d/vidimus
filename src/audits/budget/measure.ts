import { existsSync, readFileSync, statSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { VidimusConfig } from '../../config/types.ts';
import { imageSizeOf } from '../image-size.ts';
import { memo } from '../util.ts';

const TEXTUAL = /\.(svg|json|wasm|xml|txt|webmanifest)$/i;
const BROTLI_QUALITY = 5;

const codecs = {
  gzip: gzipSync,
  brotli: (buf: Buffer) =>
    brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }),
  none: undefined,
};

const fontSources = (css: string) =>
  [...css.matchAll(/@font-face\s*{[^}]*}/gi)].flatMap((face) => {
    const sources = [
      ...face[0].matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)(?:\s*format\(\s*(['"]?)(.*?)\3\s*\))?/gi),
    ];
    const pick = sources.find((source) => source[4]?.toLowerCase() === 'woff2') ?? sources[0];
    return pick?.[2] ? [pick[2]] : [];
  });

export const createMeasures = (compression: VidimusConfig['budget']['compression']) => {
  const codec = codecs[compression];
  const raw = memo((file) => statSync(file).size);
  const gzipped = memo((file) => {
    const sibling = ['.br', '.gz'].find((ext) => existsSync(file + ext));
    if (sibling) return raw(file + sibling);
    return codec ? codec(readFileSync(file)).length : raw(file);
  });
  return {
    raw,
    gzipped,
    sized: (file: string) => (TEXTUAL.test(file) ? gzipped(file) : raw(file)),
    fontRefs: memo((file) => fontSources(readFileSync(file, 'utf8'))),
    dimensionsOf: memo(imageSizeOf),
  };
};

export type Measures = ReturnType<typeof createMeasures>;
