import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, extname } from 'node:path';
import { pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { VidimusConfig } from '../config/types.ts';
import { UsageError } from './errors.ts';
import { localFile } from './html.ts';
import { regex, stripBase } from './util.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
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
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/x-exr',
  '.map': 'application/json; charset=utf-8',
};

const COMPRESSIBLE = /text|json|xml|svg|manifest|wasm/;

const wantsPage = (req: IncomingMessage, pathname: string) =>
  !extname(pathname) || /text\/html/.test(String(req.headers.accept ?? ''));

export interface StaticServer {
  port: number;
  close: () => Promise<void>;
}

const handle = (
  req: IncomingMessage,
  res: ServerResponse,
  dist: string,
  options: VidimusConfig['server'],
  siteUrl: string,
) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const found = localFile(dist, pathname) ?? localFile(dist, stripBase(pathname, siteUrl));
  const fallback = !found && !!options.fallback && wantsPage(req, pathname);
  const file = fallback ? localFile(dist, `/${options.fallback}`) : found;
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  const directory =
    !fallback && basename(file) === 'index.html' && !/(^|\/)index(\.html)?$/.test(pathname);
  if (directory && !pathname.endsWith('/')) {
    res.writeHead(301, { location: `${pathname}/${url.search}` }).end();
    return;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const gzip =
    options.gzip &&
    COMPRESSIBLE.test(type) &&
    /gzip/.test(String(req.headers['accept-encoding'] ?? ''));
  const ruleHeaders = options.headers
    .filter(({ match }) => regex(match).test(pathname))
    .map(({ headers }) => headers);
  res.writeHead(fallback ? options.fallbackStatus : 200, {
    'content-type': type,
    ...Object.assign({}, ...ruleHeaders),
    ...(gzip && { 'content-encoding': 'gzip', vary: 'accept-encoding' }),
  });
  const done = (error: Error | null) => {
    if (error) res.destroy();
  };
  if (gzip) pipeline(createReadStream(file), createGzip(), res, done);
  else pipeline(createReadStream(file), res, done);
};

export const serve = (dist: string, port: number, options: VidimusConfig['server'], siteUrl = '') =>
  new Promise<StaticServer>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        handle(req, res, dist, options, siteUrl);
      } catch {
        if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('Bad request');
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
