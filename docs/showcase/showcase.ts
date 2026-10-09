import { PAGE_EVENT } from '../app-shell';

const base = '/vidimus/showcase/';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Click-to-load: nothing from the embed's host loads until the visitor asks for it.
const startFacades = () => {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-embed]')) {
    if (button.dataset.bound) continue;
    button.dataset.bound = '';
    button.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.src = button.dataset.embed ?? '';
      frame.title = button.dataset.title ?? '';
      frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
      frame.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-popups allow-presentation',
      );
      frame.className = 'showcase-frame';
      button.replaceWith(frame);
      frame.focus();
    });
  }
};

// Rules the markup does not declare: the forms audit infers them by probing, as it would in an
// app validating with Zod or Angular Validators.
const feedbackRules: Record<string, (value: string) => string> = {
  author: (value) => (value.trim() ? '' : 'Enter your name.'),
  rating: (value) => (/^[1-5]$/.test(value) ? '' : 'Rate from 1 to 5.'),
  message: (value) => (value.trim().length >= 20 ? '' : 'Write at least 20 characters.'),
};

const startFeedback = () => {
  for (const form of document.querySelectorAll<HTMLFormElement>('form[data-feedback]')) {
    if (form.dataset.bound) continue;
    form.dataset.bound = '';
    const button = form.querySelector('button');
    const status = form.querySelector('[data-feedback-status]');
    const check = (field: HTMLInputElement | HTMLTextAreaElement) => {
      const message = feedbackRules[field.name]?.(field.value) ?? '';
      field.setAttribute('aria-invalid', String(!!message));
      const error = document.getElementById(field.getAttribute('aria-describedby') ?? '');
      if (error) error.textContent = message;
      return !message;
    };
    form.addEventListener('input', (event) => check(event.target as HTMLInputElement));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fields = [...form.querySelectorAll<HTMLInputElement>('input, textarea')];
      if (!fields.map(check).every(Boolean) || !button || !status) return;
      // One request per press: a double click must not send the feedback twice.
      button.disabled = true;
      try {
        const response = await fetch(`${base}feedback`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        status.textContent = `The site answered ${response.status}: it has no backend, nothing was stored.`;
      } catch {
        status.textContent = 'The site could not be reached.';
      } finally {
        button.disabled = false;
      }
    });
  }
};

interface Result {
  audit: string;
  status: string;
  summary: string;
}

let results: Promise<Result[]> | undefined;
const loadResults = () =>
  (results ??= fetch(`${base}results.json`).then(
    (response) => response.json() as Promise<Result[]>,
  ));

const startResults = async () => {
  for (const body of document.querySelectorAll<HTMLElement>('tbody[data-results]')) {
    if (body.dataset.filled) continue;
    body.dataset.filled = '';
    body.replaceChildren(
      ...(await loadResults()).map(({ audit, status, summary }) => {
        const row = document.createElement('tr');
        for (const text of [audit, status, summary]) {
          const cell = document.createElement('td');
          cell.textContent = text;
          row.append(cell);
        }
        row.children[1]?.classList.add('showcase-status', `is-${status}`);
        return row;
      }),
    );
  }
};

// One formatter, made on first use: toLocaleString builds a new one on every call, on every
// frame, and the first one costs ~80 ms of locale data under Lighthouse's CPU throttling.
let formatter: Intl.NumberFormat | undefined;

const countUp = (element: HTMLElement, to: number) => {
  formatter ??= new Intl.NumberFormat('en');
  if (reducedMotion.matches) {
    element.textContent = formatter.format(to);
    return;
  }
  const start = performance.now();
  const step = (time: number) => {
    const progress = Math.min((time - start) / 1200, 1);
    element.textContent = formatter.format(Math.round(to * (1 - (1 - progress) ** 3)));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

// The numbers come from the same results.json as the table, so they are the last real run.
const startStats = async () => {
  for (const holder of document.querySelectorAll<HTMLElement>('[data-stats]')) {
    if (holder.dataset.filled) continue;
    holder.dataset.filled = '';
    const all = await loadResults();
    const largest = (pattern: RegExp) =>
      Math.max(
        0,
        ...all.flatMap(({ summary }) => [...summary.matchAll(pattern)].map(([, n]) => Number(n))),
      );
    const values: Record<string, number> = {
      pages: largest(/(\d+) pages?\b/g),
      links: largest(/(\d+) links/g),
      audits: all.length,
      passed: all.filter(({ status }) => status === 'passed').length,
    };
    // Count up when the numbers come into view, not while the page is still loading.
    const seen = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      seen.disconnect();
      for (const element of holder.querySelectorAll<HTMLElement>('[data-stat]')) {
        const value = values[element.dataset.stat ?? ''];
        if (value) countUp(element, value);
      }
    });
    seen.observe(holder);
  }
};

// The live audit: a few of vidimus's checks, rewritten to run inside the page that is being
// read. What they find is whatever this flavor's page really has, theme and all.

interface Finding {
  message: string;
  details?: string[];
  warn?: boolean;
}

interface Check {
  name: string;
  summary: string;
  log?: string[];
  findings: Finding[];
}

let violations = 0;
document.addEventListener('securitypolicyviolation', () => {
  violations++;
});

const vitals = { lcp: 0, cls: 0 };
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) vitals.lcp = entry.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
    })[])
      if (!entry.hadRecentInput) vitals.cls += entry.value;
  }).observe({ type: 'layout-shift', buffered: true });
} catch {
  // not every browser reports these
}

const kB = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.round(bytes / 1000)} kB`
    : `${Number((bytes / 1_000_000).toFixed(1))} MB`;

const ms = (value: number) => `${Math.round(value)} ms`;

const shortUrl = (href: string) => {
  const url = new URL(href);
  const path = url.origin === location.origin ? url.pathname : `${url.host}${url.pathname}`;
  return path.length > 64 ? `${path.slice(0, 63)}…` : path;
};

const describe = (element: Element) => {
  const [firstClass] = element.getAttribute('class')?.trim().split(/\s+/) ?? [];
  return `<${element.localName}${element.id ? `#${element.id}` : firstClass ? `.${firstClass}` : ''}>`;
};

const rendered = (element: Element) =>
  element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]');

const nameOf = (element: Element) =>
  element.getAttribute('aria-label')?.trim() ||
  (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join('')
    .trim() ||
  element.textContent?.trim() ||
  element.getAttribute('title')?.trim() ||
  [...element.querySelectorAll('img[alt], svg title')]
    .map((inner) => inner.getAttribute('alt') ?? inner.textContent ?? '')
    .join('')
    .trim();

const some = (message: string, elements: Element[]): Finding[] =>
  elements.length
    ? [{ message: `${elements.length} ${message}`, details: elements.slice(0, 3).map(describe) }]
    : [];

const a11y = (): Check => {
  const images = [...document.images].filter(rendered);
  const controls = [...document.querySelectorAll('a[href], button')].filter(rendered);
  const frames = [...document.querySelectorAll<HTMLIFrameElement>('iframe')];
  return {
    name: 'a11y',
    summary: `${images.length} images, ${controls.length} links and buttons, ${frames.length} iframe(s) read`,
    findings: [
      ...(document.documentElement.lang ? [] : [{ message: '<html> has no lang attribute' }]),
      ...some(
        'image(s) without alt text',
        images.filter((image) => !image.hasAttribute('alt')),
      ),
      ...some(
        'link(s) or button(s) without an accessible name',
        controls.filter((control) => !nameOf(control)),
      ),
      ...some(
        'iframe(s) without a title',
        frames.filter((frame) => !frame.title.trim()),
      ),
    ],
  };
};

const seo = (): Check => {
  const title = document.title.trim();
  const description =
    document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
  const canonical = document.querySelector('link[rel="canonical"]');
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(rendered);
  const h1 = headings.filter((heading) => heading.localName === 'h1').length;
  const skips: string[] = [];
  let previous = 0;
  for (const heading of headings) {
    const level = Number(heading.localName[1]);
    if (previous && level > previous + 1)
      skips.push(`h${previous} → h${level} "${heading.textContent?.trim().slice(0, 40)}"`);
    previous = level;
  }
  const findings: Finding[] = [];
  if (!title) findings.push({ message: 'no <title>' });
  else if (title.length > 60)
    findings.push({ message: `title is ${title.length} characters`, warn: true });
  if (!description) findings.push({ message: 'no <meta name="description">' });
  if (!canonical) findings.push({ message: 'no <link rel="canonical">', warn: true });
  if (h1 !== 1) findings.push({ message: `${h1} visible <h1> elements, expected 1`, warn: true });
  if (skips.length)
    findings.push({ message: 'heading level skipped', details: skips.slice(0, 3), warn: true });
  return {
    name: 'seo',
    summary: `"${title}", ${description.length}-character description, ${headings.length} headings`,
    findings,
  };
};

const html = (): Check => {
  const ids = new Map<string, number>();
  for (const element of document.querySelectorAll('[id]'))
    ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
  const duplicates = [...ids].filter(([, count]) => count > 1);
  return {
    name: 'html',
    summary: `${document.getElementsByTagName('*').length} elements, ${ids.size} ids`,
    findings: duplicates.length
      ? [
          {
            message: `${duplicates.length} duplicate id(s)`,
            details: duplicates.slice(0, 3).map(([id, count]) => `#${id} ×${count}`),
          },
        ]
      : [],
  };
};

const links = async (): Promise<Check> => {
  const pages = new Set<string>();
  const missing = new Set<string>();
  let external = 0;
  let fragments = 0;
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = new URL(anchor.href);
    if (!/^https?:$/.test(url.protocol)) continue;
    if (url.origin !== location.origin) external++;
    else if (url.pathname === location.pathname && url.hash.length > 1) {
      fragments++;
      if (!document.getElementById(decodeURIComponent(url.hash.slice(1)))) missing.add(url.hash);
    } else {
      url.hash = '';
      pages.add(url.href);
    }
  }
  const queue = [...pages];
  const broken: string[] = [];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const response = await fetch(url, { method: 'HEAD' }).catch(() => undefined);
      if (!response?.ok) broken.push(`${response?.status ?? 'no response'} ${shortUrl(url)}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const findings: Finding[] = [];
  if (broken.length)
    findings.push({ message: `${broken.length} broken link(s)`, details: broken.slice(0, 3) });
  if (missing.size)
    findings.push({
      message: `${missing.size} missing #fragment(s)`,
      details: [...missing].slice(0, 3),
    });
  return {
    name: 'links',
    summary: `${pages.size} pages fetched, ${fragments} #fragments resolved, ${external} external links left alone`,
    findings,
  };
};

const resources = () => [
  ...(performance.getEntriesByType('navigation') as PerformanceResourceTiming[]),
  ...(performance.getEntriesByType('resource') as PerformanceResourceTiming[]),
];

const privacy = (): Check => {
  const hosts = new Map<string, number>();
  const all = resources();
  for (const { name } of all) {
    const { host, protocol } = new URL(name);
    if (/^https?:$/.test(protocol) && host !== location.host)
      hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  const cookies = document.cookie ? document.cookie.split(';').length : 0;
  return {
    name: 'privacy',
    summary: `${all.length} requests, ${hosts.size} third-party host(s), ${cookies} cookie(s)`,
    findings: [
      ...[...hosts].map(([host, count]) => ({
        message: `third-party request to ${host}`,
        details: [`${count} request(s) since the page loaded`],
      })),
      ...(cookies ? [{ message: `${cookies} cookie(s) readable from script`, warn: true }] : []),
    ],
  };
};

const budget = (): Check => {
  const files = resources()
    .map(({ name, transferSize, encodedBodySize }) => ({
      name,
      bytes: transferSize || encodedBodySize,
    }))
    .filter(({ bytes }) => bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const total = files.reduce((sum, { bytes }) => sum + bytes, 0);
  return {
    name: 'budget',
    summary: `${files.length} files, ${kB(total)} total`,
    log: files
      .slice(0, 3)
      .map(({ name, bytes }) => `  ${kB(bytes).padStart(7)}  ${shortUrl(name)}`),
    findings: total > 2_000_000 ? [{ message: `page ${kB(total)} total > 2 MB budget` }] : [],
  };
};

const csp = (): Check => {
  const policy = document
    .querySelector('meta[http-equiv="Content-Security-Policy" i]')
    ?.getAttribute('content');
  const inline = [...document.querySelectorAll<HTMLScriptElement>('script:not([src])')].filter(
    ({ type }) => !type || /module|javascript/.test(type),
  ).length;
  const directives = policy?.split(';').filter((part) => part.trim()).length ?? 0;
  return {
    name: 'csp',
    summary: `${policy ? `<meta> policy, ${directives} directives` : 'no <meta> policy in this flavor'}, ${inline} inline script(s), ${violations} violation(s)`,
    findings: violations
      ? [{ message: `${violations} CSP violation(s) since the page loaded` }]
      : [],
  };
};

const r12s = (): Check => {
  const width = document.documentElement.clientWidth;
  const contained = (element: Element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (getComputedStyle(parent).overflowX !== 'visible') return true;
    return false;
  };
  // The page only scrolls sideways if something sticks out, so look for culprits only then.
  const wide =
    document.documentElement.scrollWidth > width
      ? [...document.body.querySelectorAll('*')].filter(
          (element) => element.getBoundingClientRect().right > width + 1 && !contained(element),
        )
      : [];
  return {
    name: 'r12s',
    summary: `${width}px viewport, ${document.documentElement.scrollWidth}px of page`,
    findings: some('element(s) wider than the viewport', wide),
  };
};

const vital = (): Check => {
  const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  const findings: Finding[] = [];
  if (vitals.lcp > 2500) findings.push({ message: `LCP ${ms(vitals.lcp)} > 2500 ms`, warn: true });
  if (vitals.cls > 0.1)
    findings.push({ message: `CLS ${vitals.cls.toFixed(3)} > 0.1`, warn: true });
  return {
    name: 'vitals',
    summary: [
      navigation && `TTFB ${ms(navigation.responseStart)}`,
      navigation && `DOM ready ${ms(navigation.domContentLoadedEventEnd)}`,
      `LCP ${vitals.lcp ? ms(vitals.lcp) : 'n/a'}`,
      `CLS ${vitals.cls.toFixed(3)}`,
    ]
      .filter(Boolean)
      .join(', '),
    findings,
  };
};

type Tone = 'ok' | 'warn' | 'fail' | 'dim' | 'bold' | 'cyan' | 'cmd';

const STATUS = {
  passed: ['ok', '✔'],
  warned: ['warn', '⚠'],
  failed: ['fail', '✖'],
} as const;

const runLive = async (button: HTMLButtonElement, output: HTMLElement, status: HTMLElement) => {
  button.disabled = true;
  status.textContent = 'Running…';
  output.replaceChildren();
  const print = async (...parts: [Tone | '', string][]) => {
    for (const [tone, text] of parts) {
      const span = document.createElement('span');
      if (tone) span.className = `t-${tone}`;
      span.textContent = text;
      output.append(span);
    }
    output.append('\n');
    output.scrollTop = output.scrollHeight;
    await new Promise((done) => setTimeout(done, reducedMotion.matches ? 0 : 35));
  };
  const started = performance.now();
  await print(['cmd', '$ '], ['', `vidimus --live ${location.pathname}`]);
  await print(['dim', `vidimus: auditing ${location.origin} from inside this very page`]);
  const statuses: (keyof typeof STATUS)[] = [];
  for (const run of [a11y, seo, html, links, privacy, budget, csp, r12s, vital]) {
    const before = performance.now();
    const check = await run();
    const took = performance.now() - before;
    await print();
    await print(['bold', `─── ${check.name} ${'─'.repeat(Math.max(0, 40 - check.name.length))}`]);
    for (const line of check.log ?? []) await print(['dim', line]);
    for (const { message, details, warn } of check.findings) {
      await print([warn ? 'warn' : 'fail', warn ? '⚠ ' : '✖ '], ['', message]);
      for (const detail of details ?? []) await print(['dim', `    ${detail}`]);
    }
    const result = check.findings.some(({ warn }) => !warn)
      ? 'failed'
      : check.findings.length
        ? 'warned'
        : 'passed';
    statuses.push(result);
    const [tone, symbol] = STATUS[result];
    await print(
      [tone, `${symbol} `],
      ['', `${check.name}: ${check.summary} `],
      ['dim', `(${ms(took)})`],
    );
  }
  const passed = statuses.filter((result) => result === 'passed').length;
  const failed = statuses.includes('failed');
  const summary = `${passed}/${statuses.length} passed in ${ms(performance.now() - started)}`;
  await print();
  await print([
    failed ? 'fail' : passed === statuses.length ? 'ok' : 'warn',
    `vidimus: ${summary}`,
  ]);
  status.textContent = summary;
  button.textContent = 'Run it again';
  button.disabled = false;
};

const startLive = () => {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-live-audit]')) {
    if (button.dataset.bound) continue;
    button.dataset.bound = '';
    const holder = button.closest('.showcase-live');
    const output = holder?.querySelector<HTMLElement>('[data-live-output]');
    const status = holder?.querySelector<HTMLElement>('[data-live-status]');
    if (!output || !status) continue;
    button.addEventListener('click', () => void runLive(button, output, status));
  }
};

const start = () => {
  const scene = document.getElementById('showcase-scene');
  // three.js is 500 kB of script: fetch and run it only when the scene is about to be seen,
  // not while the page is still loading.
  if (scene && !scene.dataset.watched) {
    scene.dataset.watched = '';
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        near.disconnect();
        void import('./scene.ts').then(({ startScene }) => startScene(scene));
      },
      { rootMargin: '200px' },
    );
    near.observe(scene);
  }
  startFacades();
  startFeedback();
  startLive();
  void startStats();
  void startResults();
};

start();
document.addEventListener(PAGE_EVENT, start);
