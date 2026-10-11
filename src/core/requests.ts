import { readFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { linksWithRel, localFile, srcsetUrls, stripComments, tags } from './html.ts';
import { stripBase } from './util.ts';

export interface Request {
  kind: string;
  ref: string;
  via: string;
  // A literal in a request call is a certain request; a bare URL in code only might be one.
  certain: boolean;
  from: string;
  source: string;
}

interface Ref {
  kind: string;
  ref: string;
  via: string;
  certain?: boolean;
  follow?: 'js' | 'css';
}

const INLINE = /<(script|style)\b(?![^>]*\ssrc\s*=)([^>]*)>([\s\S]*?)<\/\1\s*>/dgi;
const SCRIPT_TYPE = /\btype\s*=\s*["']?([^"'\s>]*)/i;
const EXECUTABLE =
  /^(|module|importmap|speculationrules|(text|application)\/(x-)?(java|ecma|j)script(1\.\d)?)$/i;

export const inlineBlocks = (html: string) =>
  [...stripComments(html).matchAll(INLINE)].flatMap((match) => {
    const [start, end] = match.indices?.[3] ?? [0, 0];
    const kind = (match[1] ?? '').toLowerCase();
    const body = html.slice(start, end);
    const type = SCRIPT_TYPE.exec(match[2] ?? '')?.[1] ?? '';
    const skip = !body.trim() || (kind === 'script' && !EXECUTABLE.test(type));
    return skip ? [] : [{ kind, body }];
  });

const STRING = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
const ABSOLUTE =
  /^\s*((?:https?|wss?):\/\/[^\s"'<>\\/?#]+[^\s"'<>\\]*|\/\/[a-z\d.-]+\.[a-z]{2,}[^\s"'<>\\]*)\s*$/i;
const SKIPPED = /^(?:data:|blob:|about:|javascript:|#)/i;

const SINKS: [RegExp, string, string][] = [
  [/\bfetch\s*\(\s*$/, 'connect', 'fetch()'],
  [/\bRequest\s*\(\s*$/, 'connect', 'Request()'],
  [
    /\.open\s*\(\s*["'](?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\s*,\s*$/i,
    'connect',
    'XMLHttpRequest',
  ],
  [/\bWebSocket\s*\(\s*$/, 'connect', 'WebSocket'],
  [/\bEventSource\s*\(\s*$/, 'connect', 'EventSource'],
  [/\bsendBeacon\s*\(\s*$/, 'connect', 'sendBeacon()'],
  [/\b(?:Shared)?Worker\s*\(\s*$/, 'worker', 'Worker'],
  [/\bimportScripts\s*\(\s*$/, 'worker', 'importScripts()'],
  [/\bimport\s*\(\s*$/, 'script', 'import()'],
];

const EXTENSIONS: [RegExp, string][] = [
  [/\.m?js$/i, 'script'],
  [/\.css$/i, 'style'],
  [/\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i, 'img'],
  [/\.(?:woff2?|ttf|otf|eot)$/i, 'font'],
  [/\.(?:mp4|webm|mp3|ogg|wav|m4a)$/i, 'media'],
];

const decodeEscapes = (text: string) =>
  text.replace(/\\(?:u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi, (_, u, x, char) =>
    u || x ? String.fromCharCode(Number.parseInt(u ?? x, 16)) : char,
  );

const kindOfUrl = (url: string) => {
  const path = url.replace(/[?#].*$/, '');
  return EXTENSIONS.find(([pattern]) => pattern.test(path))?.[1] ?? 'connect';
};

const codeRequests = (code: string): Ref[] => {
  const refs: Ref[] = [];
  for (const match of code.matchAll(STRING)) {
    const [, double, single, template] = match;
    const raw = double ?? single ?? template ?? '';
    const value = decodeEscapes(template === undefined ? raw : (raw.split('${')[0] ?? ''));
    if (!value.trim() || SKIPPED.test(value.trim())) continue;
    const before = code.slice(Math.max(0, match.index - 80), match.index);
    const sink = /[(,]\s*$/.test(before)
      ? SINKS.find(([pattern]) => pattern.test(before))
      : undefined;
    if (sink) {
      refs.push({ kind: sink[1], ref: value.trim(), via: sink[2], certain: true });
    } else if (ABSOLUTE.test(value)) {
      const ref = value.trim();
      refs.push({ kind: kindOfUrl(ref), ref, via: 'URL in code' });
    }
  }
  return refs;
};

const cssRequests = (css: string): Ref[] => {
  const refs: Ref[] = [];
  const found = (ref: string, kind: string, via: string, follow?: 'css') => {
    const value = ref.trim();
    if (value && !SKIPPED.test(value)) refs.push({ kind, ref: value, via, certain: true, follow });
  };
  const url = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
  const urlsIn = (text: string) => [...text.matchAll(url)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
  let rest = css.replace(/\/\*[\s\S]*?\*\//g, '');
  rest = rest.replace(
    /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"')\s;]+))[^;]*;?/gi,
    (_, a, b, c) => {
      found(a ?? b ?? c ?? '', 'style', '@import', 'css');
      return '';
    },
  );
  rest = rest.replace(/@font-face\s*\{[^}]*\}/gi, (block) => {
    for (const ref of urlsIn(block)) found(ref, 'font', '@font-face');
    return '';
  });
  for (const ref of urlsIn(rest)) found(ref, 'img', 'CSS url()');
  return refs;
};

const htmlRequests = (html: string): Ref[] => {
  const refs: Ref[] = [];
  const add = (ref: string | undefined, kind: string, via: string, follow?: 'js' | 'css') => {
    if (ref?.trim() && !SKIPPED.test(ref.trim()))
      refs.push({ kind, ref: ref.trim(), via, certain: true, follow });
  };
  for (const tag of tags(html)) {
    const { name, attrs } = tag;
    if (name === 'img') {
      add(attrs.src, 'img', '<img>');
      for (const url of srcsetUrls(attrs.srcset)) add(url, 'img', '<img srcset>');
    } else if (name === 'source') {
      add(attrs.src, 'media', '<source>');
      for (const url of srcsetUrls(attrs.srcset)) add(url, 'img', '<source srcset>');
    } else if (name === 'script') {
      add(attrs.src, 'script', '<script>', 'js');
    } else if (name === 'audio' || name === 'video' || name === 'track') {
      add(attrs.src, 'media', `<${name}>`);
      if (name === 'video') add(attrs.poster, 'img', '<video poster>');
    } else if (name === 'object') {
      add(attrs.data, 'object', '<object>');
    } else if (name === 'embed') {
      add(attrs.src, 'object', '<embed>');
    } else if (name === 'form') {
      add(attrs.action, 'form', '<form action>');
    }
    if (attrs.style) refs.push(...cssRequests(attrs.style).filter(({ follow }) => !follow));
  }
  for (const [rel, kind] of [
    ['stylesheet', 'style'],
    ['icon', 'img'],
    ['apple-touch-icon', 'img'],
    ['manifest', 'manifest'],
    ['modulepreload', 'script'],
  ] as const) {
    for (const { attrs } of linksWithRel(html, rel))
      add(
        attrs.href,
        kind,
        `<link rel="${rel}">`,
        rel === 'stylesheet' ? 'css' : rel === 'modulepreload' ? 'js' : undefined,
      );
  }
  const preloads: Record<string, string> = {
    font: 'font',
    image: 'img',
    script: 'script',
    style: 'style',
    fetch: 'connect',
    audio: 'media',
    video: 'media',
    worker: 'worker',
  };
  for (const { attrs } of linksWithRel(html, 'preload')) {
    const kind = preloads[(attrs.as ?? '').toLowerCase()];
    if (kind)
      add(
        attrs.href,
        kind,
        '<link rel="preload">',
        kind === 'script' ? 'js' : kind === 'style' ? 'css' : undefined,
      );
  }
  return refs;
};

const MODULE_PATH = /["'`]((?:\.{1,2}\/|\/)?[\w@~./-]+\.m?js)["'`]/g;

export const createRequestScanner = (dist: string, siteUrl: string) => {
  interface Scan {
    refs: Ref[];
    follows: { file: string; path: string }[];
  }
  const scans = new Map<string, Scan>();

  const sitePath = (pathname: string) => stripBase(pathname, siteUrl);
  const exists = (path: string) => {
    const file = localFile(dist, path);
    return file && !file.endsWith('.html') ? file : null;
  };
  const locate = (ref: string, from: string) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) return null;
    const target = ref.replace(/[?#].*$/, '');
    const path = target.startsWith('/') ? sitePath(target) : posix.join(dirname(from), target);
    const file = exists(path);
    return file ? { file, path } : null;
  };

  const scanFile = (file: string, path: string, lang: 'js' | 'css'): Scan => {
    const cached = scans.get(file);
    if (cached) return cached;
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {}
    const follows: Scan['follows'] = [];
    const refs = lang === 'css' ? cssRequests(text) : codeRequests(text);
    if (lang === 'js') {
      for (const [, spec = ''] of text.matchAll(MODULE_PATH)) {
        const candidates = spec.startsWith('/')
          ? [sitePath(spec)]
          : [posix.join(dirname(path), spec), posix.join('/', spec)];
        const found = candidates
          .map((candidate) => ({ path: candidate, file: exists(candidate) }))
          .find((entry) => entry.file);
        if (found?.file) follows.push({ file: found.file, path: found.path });
      }
    } else {
      for (const ref of refs.filter(({ follow }) => follow)) {
        const found = locate(ref.ref, path);
        if (found) follows.push(found);
      }
    }
    const scan = { refs, follows };
    scans.set(file, scan);
    return scan;
  };

  return (html: string, pagePath: string): Request[] => {
    const requests: Request[] = [];
    const visited = new Set<string>();
    const queue: { file: string; path: string; lang: 'js' | 'css' }[] = [];
    const push = (ref: Ref, from: string, source: string) =>
      requests.push({
        kind: ref.kind,
        ref: ref.ref,
        via: ref.via,
        certain: ref.certain ?? false,
        from,
        source,
      });
    const enqueue = (ref: Ref) => {
      const found = ref.follow && locate(ref.ref, pagePath);
      if (found && ref.follow) queue.push({ ...found, lang: ref.follow });
    };

    for (const ref of htmlRequests(html)) {
      push(ref, pagePath, pagePath);
      enqueue(ref);
    }
    for (const { kind, body } of inlineBlocks(html)) {
      const refs = kind === 'script' ? codeRequests(body) : cssRequests(body);
      for (const ref of refs) {
        push(ref, pagePath, pagePath);
        enqueue(ref);
      }
    }
    for (let i = 0; i < queue.length && visited.size < 1000; i += 1) {
      const item = queue[i];
      if (!item || visited.has(item.file)) continue;
      visited.add(item.file);
      const scan = scanFile(item.file, item.path, item.lang);
      for (const ref of scan.refs) push(ref, item.path, item.path);
      for (const next of scan.follows) queue.push({ ...next, lang: item.lang });
    }
    return requests;
  };
};
