import { closeSync, createReadStream, openSync, readFile } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, extname } from 'node:path';
import { pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { VidimusConfig } from '../config/types.ts';
import { UsageError } from './errors.ts';
import { fileCharset, localFile } from './html.ts';
import { fallbackFor, regex, stripBase, underBase } from './util.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/vnd.microsoft.icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wave',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/x-exr',
  '.map': 'application/json',
  '.vtt': 'text/vtt; charset=utf-8',
  '.xhtml': 'application/xhtml+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.yaml': 'application/yaml',
  '.ics': 'text/calendar; charset=utf-8',
  '.vcf': 'text/vcard; charset=utf-8',
  '.rss': 'application/rss+xml',
  '.atom': 'application/atom+xml',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.epub': 'application/epub+zip',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.oga': 'audio/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.bmp': 'image/bmp',
  '.eot': 'application/vnd.ms-fontobject',
};

const COMPRESSIBLE = /text|json|xml|svg|manifest|wasm/;

const acceptsGzip = (header: string) => {
  const codings = header.split(',').map((item) => {
    const [coding = '', ...params] = item.split(';').map((part) => part.trim().toLowerCase());
    const q = params.find((param) => param.startsWith('q='));
    return { coding, q: q === undefined ? 1 : Number(q.slice(2)) };
  });
  const match =
    codings.find(({ coding }) => coding === 'gzip' || coding === 'x-gzip') ??
    codings.find(({ coding }) => coding === '*');
  return (match?.q ?? 0) > 0;
};

const wantsPage = (req: IncomingMessage, pathname: string) =>
  !extname(pathname) || /text\/html/.test(String(req.headers.accept ?? ''));

export const RENDERED_HEADER = 'x-vidimus-rendered';
export const LINKS_HEADER = 'x-vidimus-links';

const BASE_TAG = /<base\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
const stripHreflessBase = (html: string) =>
  html.replace(BASE_TAG, (tag) => (/[\s"'/]href(?=[\s=/>])/i.test(tag) ? tag : ''));

type Snapshot = (pathname: string) => string | undefined;

type ServeOptions = Pick<
  VidimusConfig['server'],
  'gzip' | 'headers' | 'fallback' | 'fallbackStatus'
>;

export interface StaticServer {
  port: number;
  close: () => Promise<void>;
}

const handle = (
  req: IncomingMessage,
  res: ServerResponse,
  dist: string,
  options: ServeOptions,
  siteUrl: string,
  snapshot: Snapshot,
) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res
      .writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain' })
      .end('Method not allowed');
    return;
  }
  const target = req.url ?? '/';
  const url = new URL(
    target.startsWith('/') ? `http://localhost${target}` : target,
    'http://localhost',
  );
  const { pathname } = url;
  const rendered = req.headers[RENDERED_HEADER] ? snapshot(pathname) : undefined;
  const forLinks = !!req.headers[LINKS_HEADER];
  if (rendered !== undefined) {
    res
      .writeHead(200, { 'content-type': TYPES['.html'] })
      .end(forLinks ? stripHreflessBase(rendered) : rendered);
    return;
  }
  const found = underBase(pathname, siteUrl) ? localFile(dist, stripBase(pathname, siteUrl)) : null;
  const fallbackFile =
    found || !underBase(pathname, siteUrl) || !wantsPage(req, pathname)
      ? ''
      : fallbackFor(options.fallback, stripBase(pathname, siteUrl));
  const fallback = !!fallbackFile;
  const file = fallback ? localFile(dist, `/${fallbackFile}`) : found;
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  const directory =
    !fallback && basename(file) === 'index.html' && !/(^|\/)index(\.html)?$/.test(pathname);
  if (directory && !pathname.endsWith('/')) {
    res
      .writeHead(301, {
        // Collapse leading slashes: `//about/` would be a network-path reference to host "about".
        location: `${pathname.replace(/^\/+/, '/')}/${url.search}`,
        'cache-control': 'no-cache',
      })
      .end();
    return;
  }
  const ext = extname(file).toLowerCase();
  const type =
    ext === '.html' || ext === '.htm'
      ? `text/html; charset=${fileCharset(file)}`
      : (TYPES[ext] ?? 'application/octet-stream');
  const gzip =
    options.gzip &&
    !(forLinks && ext === '.html') &&
    COMPRESSIBLE.test(type) &&
    acceptsGzip(String(req.headers['accept-encoding'] ?? ''));
  const ruleHeaders = options.headers
    .filter(({ match }) => regex(match).test(pathname))
    .map(({ headers }) => headers);
  const headers: Record<string, string> = Object.assign({}, ...ruleHeaders);
  if (gzip) headers['content-encoding'] = 'gzip';
  if (options.gzip && COMPRESSIBLE.test(type)) {
    const name = Object.keys(headers).find((key) => key.toLowerCase() === 'vary') ?? 'vary';
    const tokens = (headers[name] ?? '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
    if (!tokens.some((token) => token.toLowerCase() === 'accept-encoding')) {
      tokens.push('accept-encoding');
    }
    headers[name] = tokens.join(', ');
  }
  const status = fallback ? options.fallbackStatus : 200;
  if (req.method === 'HEAD') {
    res.writeHead(status, { 'content-type': type, ...headers }).end();
    return;
  }
  const fd = openSync(file, 'r');
  try {
    res.writeHead(status, { 'content-type': type, ...headers });
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  const done = (error: Error | null) => {
    if (error) res.destroy();
  };
  if (forLinks && ext === '.html') {
    readFile(fd, 'latin1', (error, html) => {
      closeSync(fd);
      if (error) res.destroy();
      else res.end(Buffer.from(stripHreflessBase(html), 'latin1'));
    });
    return;
  }
  const body = createReadStream(file, { fd });
  if (gzip) pipeline(body, createGzip(), res, done);
  else pipeline(body, res, done);
};

export const serve = (
  dist: string,
  port: number,
  options: ServeOptions,
  siteUrl = '',
  snapshot: Snapshot = () => undefined,
) =>
  new Promise<StaticServer>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        handle(req, res, dist, options, siteUrl, snapshot);
      } catch {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Internal server error');
      }
    });
    server.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'EADDRINUSE'
          ? new UsageError(`port ${port} is in use; pick another with --port`)
          : error,
      ),
    );
    server.listen(port, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((done) => server.close(() => done())),
      }),
    );
  });
