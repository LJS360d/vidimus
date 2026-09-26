export const site = 'https://ljs360d.github.io/vidimus';
export const base = '/vidimus/';
export const repo = 'https://github.com/LJS360d/vidimus';

export const flavors = [
  { id: 'vitepress', name: 'VitePress', path: '', style: 'clean' },
  { id: 'astro', name: 'Starlight', path: 'astro/', style: 'dir' },
  { id: 'hugo', name: 'Hugo', path: 'hugo/', style: 'dir' },
  { id: 'eleventy', name: 'Eleventy', path: 'eleventy/', style: 'dir' },
  { id: 'zola', name: 'Zola', path: 'zola/', style: 'dir' },
  { id: 'mdbook', name: 'mdBook', path: 'mdbook/', style: 'html' },
] as const;

export type FlavorId = (typeof flavors)[number]['id'];

export const slugOf = (file: string) => file.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1');

const tail = (style: string, slug: string) => {
  if (!slug) return '';
  if (style === 'clean') return slug;
  if (style === 'dir') return slug.endsWith('/') ? slug : `${slug}/`;
  return slug.endsWith('/') ? `${slug}index.html` : `${slug}.html`;
};

export const pageUrl = (id: FlavorId, slug: string) => {
  const flavor = flavors.find((candidate) => candidate.id === id) ?? flavors[0];
  return `${base}${flavor.path}${tail(flavor.style, slug)}`;
};

export const flavorLinks = (current: FlavorId, slug: string) =>
  flavors.map(({ id, name }) => ({ name, href: pageUrl(id, slug), current: id === current }));

export const canonicalUrl = (slug: string) => `${site}/${slug}`;

const names = flavors.map(({ name }) => name);
export const dogfoodNote = `These docs are deliberately built ${flavors.length} times, with ${names
  .slice(0, -1)
  .join(', ')} and ${names.at(-1)}, from the same markdown, and audited by vidimus as one site.`;
