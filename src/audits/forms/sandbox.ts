import type { Page } from '../../core/peer-types.ts';
import { matchesAny } from '../../core/util.ts';

export interface Captured {
  method: string;
  url: string;
  type: string;
  navigation: boolean;
  body?: unknown;
}

// GET requests for these only ever read; everything else may change server state.
const STATIC = new Set([
  'script',
  'stylesheet',
  'image',
  'font',
  'media',
  'texttrack',
  'manifest',
  'other',
]);

export const parseBody = (contentType: string, data: string | undefined): unknown => {
  if (data === undefined || data === '') return undefined;
  // fetch(url, { body: JSON.stringify(x) }) is sent as text/plain, so sniff the body too.
  if (/json/i.test(contentType) || /^\s*[[{]/.test(data)) {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  if (/x-www-form-urlencoded/i.test(contentType))
    return Object.fromEntries(new URLSearchParams(data));
  if (/multipart/i.test(contentType))
    return Object.fromEntries(
      [
        ...data.matchAll(
          /name="([^"]+)"(?:; filename="([^"]*)")?\r?\n(?:[^\r\n]+\r?\n)*\r?\n([^\r]*)/g,
        ),
      ].map(([, name = '', file, value]) => [name, file === undefined ? value : `<file ${file}>`]),
    );
  return data.slice(0, 2000);
};

// Lets the page load like a normal visit, then, once armed, lets nothing through that could
// reach a server with side effects: every non-static request is recorded and aborted (or
// answered with a stub). Fail closed: anything not explicitly allowed is blocked.
export const sandbox = async (page: Page, allow: string[], stub: 'abort' | 'ok') => {
  let armed = false;
  let captured: Captured[] = [];
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const url = request.url();
    const method = request.method();
    const type = request.resourceType();
    const navigation = request.isNavigationRequest();
    const reading = method === 'GET' && STATIC.has(type);
    // Before arming this is a plain page load: documents (incl. iframes) and SPA data GETs.
    const loading =
      !armed && method === 'GET' && (navigation || type === 'xhr' || type === 'fetch');
    if (reading || loading || matchesAny(allow, url)) {
      request.continue().catch(() => {});
      return;
    }
    // A GET without a query string, same-origin or from an embed, carries no field value: the
    // page reading its own data (a lazy model, map tiles), not the form sending. Stopped, not
    // recorded.
    const target = new URL(url);
    const own =
      method === 'GET' &&
      !navigation &&
      !target.search &&
      (target.origin === new URL(page.url()).origin || request.frame() !== page.mainFrame());
    if (!own)
      captured.push({
        method,
        url,
        type,
        navigation,
        body: parseBody(request.headers()['content-type'] ?? '', request.postData()),
      });
    // 204 keeps the page where it is; an aborted navigation would load Chrome's error page.
    const answer = navigation
      ? request.respond({ status: 204 })
      : stub === 'ok'
        ? request.respond({ status: 200, contentType: 'application/json', body: '{}' })
        : request.abort('blockedbyclient');
    answer.catch(() => {});
  });
  return {
    arm: (on: boolean) => {
      armed = on;
    },
    pending: () => captured.length,
    take: () => {
      const out = captured;
      captured = [];
      return out;
    },
  };
};
