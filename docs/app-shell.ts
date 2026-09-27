// Shared by the React and Angular flavors: the page HTML is set with innerHTML, so links, page
// scripts and #fragments need the help a server-rendered page gets from the browser for free.

export interface AppPage {
  slug: string;
  title: string;
  description: string;
  tagline: string;
  html: string;
  canonical: string;
  edit: string;
  docslug: string;
  flavors: { name: string; href: string; current: boolean }[];
}

export interface AppData {
  pages: AppPage[];
  nav: { text: string; items: { text: string; link: string; href: string }[] }[];
  dogfoodNote: string;
  repo: string;
}

export const PAGE_EVENT = 'vidimus:page';

export const findPage = (pages: AppPage[], path: string) => {
  // GitHub Pages also serves the route copies under their file names: /cli.html, /audits/index.html.
  const slug = path
    .replace(/^\//, '')
    .replace(/(^|\/)index\.html$/, '$1')
    .replace(/\.html$/, '');
  return pages.find((page) => page.slug === slug || page.slug === `${slug}/`);
};

export const fullTitle = (page: AppPage) =>
  page.slug ? `${page.title} · vidimus` : `vidimus · ${page.title}`;

const loaded = new Set<string>();

export const enhance = (main: HTMLElement, basename: string, navigate: (path: string) => void) => {
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest('a');
    if (!link || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(`${basename}/`)) return;
    if (url.pathname === location.pathname && url.hash) return;
    event.preventDefault();
    navigate(`${url.pathname.slice(basename.length)}${url.search}${url.hash}`);
  };
  main.addEventListener('click', onClick);

  // Module scripts run once per URL; later visits hear the page event instead.
  for (const script of main.querySelectorAll<HTMLScriptElement>('script[src]')) {
    if (loaded.has(script.src)) continue;
    loaded.add(script.src);
    const copy = document.createElement('script');
    copy.type = script.type;
    copy.src = script.src;
    document.body.append(copy);
  }
  document.dispatchEvent(new CustomEvent(PAGE_EVENT));

  if (location.hash)
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  else window.scrollTo(0, 0);
  return () => main.removeEventListener('click', onClick);
};
