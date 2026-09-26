import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { createGzip } from 'node:zlib';
import type { VidimusConfig } from '../config/types.ts';
import { localFile, stripBase } from './html.ts';

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
};

const COMPRESSIBLE = /text|json|xml|svg|manifest/;

export interface StaticServer {
  close: () => Promise<void>;
}

export const serve = (dist: string, port: number, options: VidimusConfig['server'], siteUrl = '') =>
  new Promise<StaticServer>((resolve, reject) => {
    const server = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const file = localFile(dist, pathname) ?? localFile(dist, stripBase(pathname, siteUrl));
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      const gzip =
        options.gzip &&
        COMPRESSIBLE.test(type) &&
        /gzip/.test(String(req.headers['accept-encoding'] ?? ''));
      const ruleHeaders = options.headers
        .filter(({ match }) => new RegExp(match).test(pathname))
        .map(({ headers }) => headers);
      res.writeHead(200, {
        'content-type': type,
        ...Object.assign({}, ...ruleHeaders),
        ...(gzip && { 'content-encoding': 'gzip', vary: 'accept-encoding' }),
      });
      const body = createReadStream(file);
      (gzip ? body.pipe(createGzip()) : body).pipe(res);
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({ close: () => new Promise((done) => server.close(() => done())) }),
    );
  });
