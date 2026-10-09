import { execFile, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { promisify } from 'node:util';
import { Marked } from 'marked';
import {
  base,
  canonicalUrl,
  dogfoodNote,
  type FlavorId,
  flavorLinks,
  flavors,
  pageUrl,
  repo,
  site,
  slugOf,
} from '../docs/flavors.ts';

const root = join(import.meta.dirname, '..');
const docs = join(root, 'docs');
const dist = join(docs, 'dist');

type Page = {
  file: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  script: string;
  style: string;
  csp: string;
};
type Engine = Exclude<FlavorId, 'vitepress'>;

const engineDirs = flavors.filter(({ path }) => path).map(({ id }) => id);

const parse = (file: string): Page => {
  const source = readFileSync(join(docs, file), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  const field = (key: string) =>
    new RegExp(`^${key}:\\s*(.*)$`, 'm')
      .exec(match?.[1]?.replaceAll('\r', '') ?? '')?.[1]
      ?.trim()
      .replace(/^(['"])(.*)\1$/, '$2') ?? '';
  return {
    file,
    slug: file === 'home.md' ? '' : slugOf(file),
    title: field('title'),
    description: field('description'),
    script: field('script'),
    style: field('style'),
    csp: field('csp'),
    body: source.slice(match?.[0].length ?? 0).replace(/^(\r?\n)+/, ''),
  };
};

const pages = () =>
  globSync('**/*.md', {
    cwd: docs,
    exclude: (name) =>
      ['node_modules', 'dist', 'public', '.vitepress', ...engineDirs].includes(name),
  })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file !== 'index.md')
    .sort()
    .map(parse);

const resolveLink = (engine: Engine, from: string, href: string) => {
  const [path = '', hash] = href.split('#');
  if (!path) return href;
  const joined = posix.normalize(posix.join(posix.dirname(from), path));
  const slug = path.endsWith('/') ? `${joined.replace(/\/?$/, '/')}` : slugOf(joined);
  return `${pageUrl(engine, slug === './' ? '' : slug)}${hash ? `#${hash}` : ''}`;
};

const rewriteLinks = (engine: Engine, page: Page, markdown: string) =>
  markdown
    .split(/(^```[\s\S]*?^```$)/m)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(
            /\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)\)/gi,
            (_, href: string) => `](${resolveLink(engine, page.file, href)})`,
          ),
    )
    .join('');

const h1Of = (body: string) => /^# (.+)$/m.exec(body)?.[1]?.replaceAll('`', '') ?? '';
const withoutH1 = (body: string) => body.replace(/^# .+\n+/m, '');
const home = { title: 'Pre-publication checks for static sites', tagline: 'We have seen.' };
const describe = (engine: Engine, page: Page) =>
  page.slug
    ? page.description
    : `${page.description} This is the ${flavors.find(({ id }) => id === engine)?.name} build.`;
const editUrl = (page: Page) => `${repo}/edit/main/docs/${page.file}`;
const yaml = (fields: Record<string, unknown>) =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n')}\n---\n`;
const toml = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(toml).join(', ')}]`
    : value && typeof value === 'object'
      ? `{ ${Object.entries(value)
          .map(([key, inner]) => `${key} = ${toml(inner)}`)
          .join(', ')} }`
      : JSON.stringify(value);

const common = (engine: Engine, page: Page) => ({
  docslug: page.slug,
  canonical: canonicalUrl(page.slug),
  edit: editUrl(page),
  flavors: flavorLinks(engine, page.slug),
  ...(page.csp && { csp: page.csp }),
  // The hand-written themes load a page's stylesheet in <head>: linked from the body it holds
  // back the rest of <main>, and on phones the sidebar below it paints first, then jumps.
  ...(page.style && { style: `${base}${page.style}` }),
});

// Pages with a `script` in their frontmatter load it as a module; VitePress does it in its config.
// VitePress adds the base to /showcase/ URLs in raw HTML in its config; the other flavors get it here.
const withScript = (page: Page, markdown: string, styled = false) => {
  const body = (
    styled && page.style
      ? markdown.replace(`<link rel="stylesheet" href="/${page.style}">\n`, '')
      : markdown
  ).replace(/(["\s,])\/showcase\//g, `$1${base}showcase/`);
  return page.script
    ? `${body.trimEnd()}\n\n<script type="module" src="${base}${page.script}"></script>\n`
    : body;
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

// The client-rendered flavors get their pages as HTML in a JSON module, rendered in the browser.
const appPages = (engine: 'react' | 'angular', all: Page[]) =>
  all.map((page) => {
    const seen = new Map<string, number>();
    const marked = new Marked({
      gfm: true,
      renderer: {
        heading({ tokens, depth, text }) {
          const slug = slugify(text.replace(/[`*_[\]]|\]\([^)]*\)/g, ''));
          const count = seen.get(slug) ?? 0;
          seen.set(slug, count + 1);
          const id = count ? `${slug}-${count}` : slug;
          return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
        },
      },
    });
    const body = withScript(page, rewriteLinks(engine, page, page.body));
    return {
      slug: page.slug,
      title: page.slug ? h1Of(page.body) || page.title : home.title,
      description: describe(engine, page),
      tagline: home.tagline,
      html: marked.parse(body, { async: false }),
      ...common(engine, page),
    };
  });

// Vite turns a JSON import into JSON.parse('…'), which parses much faster than an object
// literal; Angular's build inlines the literal, so it gets the JSON.parse module directly.
const writeApp = (engine: 'react' | 'angular', all: Page[]) => {
  const data = JSON.stringify({
    pages: appPages(engine, all),
    nav: navFor(engine),
    dogfoodNote,
    repo,
  });
  if (engine === 'react') write(join(docs, engine, 'src', 'pages.json'), data);
  else
    write(
      join(docs, engine, 'src', 'pages.ts'),
      `export default JSON.parse(${JSON.stringify(data)});\n`,
    );
};

const navFor = (engine: Engine) =>
  (
    JSON.parse(readFileSync(join(docs, 'nav.json'), 'utf8')) as {
      text: string;
      items: { text: string; link: string }[];
    }[]
  ).map(({ text, items }) => ({
    text,
    items: items.map((item) => ({ ...item, href: pageUrl(engine, item.link) })),
  }));

const write = (file: string, content: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

const clean = (dir: string) => rmSync(dir, { recursive: true, force: true });

const themeCss = () => readFileSync(join(docs, 'theme.css'), 'utf8');

const engines: Record<Engine, (all: Page[]) => void> = {
  astro: (all) => {
    const dir = join(docs, 'astro', 'src', 'content', 'docs');
    clean(dir);
    for (const page of all) {
      const body = withScript(page, rewriteLinks('astro', page, page.body));
      const out = join(dir, page.slug ? page.file : 'index.md');
      if (!page.slug) {
        write(
          out,
          `${yaml({
            title: home.title,
            description: describe('astro', page),
            template: 'splash',
            hero: {
              title: 'vidimus',
              tagline: `${home.tagline} ${page.description}`,
              actions: [
                {
                  text: 'Get started',
                  link: pageUrl('astro', 'getting-started'),
                  icon: 'right-arrow',
                },
                { text: 'Audits', link: pageUrl('astro', 'audits/'), variant: 'minimal' },
              ],
            },
          })}\n${body}`,
        );
      } else {
        write(
          out,
          `${yaml({ title: h1Of(body) || page.title, description: page.description })}\n${withoutH1(body)}`,
        );
      }
    }
  },
  hugo: (all) => {
    const dir = join(docs, 'hugo', 'content');
    clean(dir);
    for (const page of all) {
      const file = page.slug ? page.file.replace(/(^|\/)index\.md$/, '$1_index.md') : '_index.md';
      write(
        join(dir, file),
        `${yaml({ title: page.slug ? page.title : home.title, description: describe('hugo', page), tagline: home.tagline, ...common('hugo', page) })}\n${withScript(page, rewriteLinks('hugo', page, page.body), true)}`,
      );
    }
    write(join(docs, 'hugo', 'data', 'nav.json'), JSON.stringify(navFor('hugo')));
    write(join(docs, 'hugo', 'data', 'site.json'), JSON.stringify({ dogfoodNote }));
    write(join(docs, 'hugo', 'assets', 'css', 'main.css'), themeCss());
  },
  eleventy: (all) => {
    const dir = join(docs, 'eleventy', 'content');
    clean(dir);
    for (const page of all) {
      write(
        join(dir, page.slug ? page.file : 'index.md'),
        `${yaml({ title: page.slug ? page.title : home.title, description: describe('eleventy', page), tagline: home.tagline, layout: page.slug ? 'doc.njk' : 'home.njk', ...common('eleventy', page) })}\n${withScript(page, rewriteLinks('eleventy', page, page.body), true)}`,
      );
    }
    write(join(docs, 'eleventy', 'data', 'nav.json'), JSON.stringify(navFor('eleventy')));
    write(join(docs, 'eleventy', 'data', 'site.json'), JSON.stringify({ dogfoodNote, repo }));
    write(join(docs, 'eleventy', 'static', 'main.css'), themeCss());
  },
  zola: (all) => {
    const dir = join(docs, 'zola', 'content');
    clean(dir);
    for (const page of all) {
      const file = page.slug ? page.file.replace(/(^|\/)index\.md$/, '$1_index.md') : '_index.md';
      const extra = { tagline: home.tagline, dogfood: dogfoodNote, ...common('zola', page) };
      write(
        join(dir, file),
        `+++\ntitle = ${toml(page.slug ? page.title : home.title)}\ndescription = ${toml(describe('zola', page))}\n${file.endsWith('_index.md') ? `template = ${toml(page.slug ? 'section.html' : 'index.html')}\n` : ''}\n[extra]\n${Object.entries(
          extra,
        )
          .map(([key, value]) => `${key} = ${toml(value)}`)
          .join(
            '\n',
          )}\n+++\n\n{% raw %}\n${withScript(page, rewriteLinks('zola', page, page.body), true)}\n{% endraw %}\n`,
      );
    }
    write(join(docs, 'zola', 'nav.json'), JSON.stringify(navFor('zola')));
    write(join(docs, 'zola', 'static', 'main.css'), themeCss());
  },
  mdbook: (all) => {
    const dir = join(docs, 'mdbook', 'src');
    clean(dir);
    for (const page of all) {
      const body = withScript(page, rewriteLinks('mdbook', page, page.body));
      write(
        join(dir, page.slug ? page.file : 'index.md'),
        page.slug ? body : `# vidimus\n\n**${home.tagline}** ${page.description}\n\n${body}`,
      );
    }
    const summary = navFor('mdbook')
      .map(
        ({ text, items }) =>
          `# ${text}\n\n${items
            .map(({ text: label, link }) => {
              const file = link.endsWith('/') ? `${link}index.md` : `${link}.md`;
              return `${link.startsWith('audits/') && link !== 'audits/' ? '  ' : ''}- [${label}](${file})`;
            })
            .join('\n')}`,
      )
      .join('\n\n');
    write(join(dir, 'SUMMARY.md'), `# Summary\n\n[vidimus](index.md)\n\n${summary}\n`);
  },
  react: (all) => writeApp('react', all),
  angular: (all) => {
    writeApp('angular', all);
    write(join(docs, 'angular', 'src', 'theme.css'), themeCss());
  },
};

const showcaseDir = join(docs, 'public', 'showcase');

const SECTION_COLORS = [
  [0.38, 0.65, 0.98],
  [0.2, 0.83, 0.6],
  [0.98, 0.75, 0.14],
  [0.96, 0.45, 0.71],
  [0.75, 0.75, 0.8],
];

// The docs as a graph: a node per page, coloured by nav section, an edge per link between pages.
const pageGraph = (all: Page[]) => {
  const groups = (
    JSON.parse(readFileSync(join(docs, 'nav.json'), 'utf8')) as { items: { link: string }[] }[]
  ).map(({ items }) => items.map(({ link }) => link));
  const sectionOf = (slug: string) => {
    const index = groups.findIndex((links) => links.includes(slug));
    return index === -1 ? groups.length : index;
  };
  const nodes = [...all].sort((a, b) => sectionOf(a.slug) - sectionOf(b.slug));
  const index = new Map(nodes.map((page, position) => [page.slug, position]));
  const edges = new Set<string>();
  for (const page of nodes) {
    for (const [, href = ''] of page.body.matchAll(/\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s#]+)/gi)) {
      const joined = posix.normalize(posix.join(posix.dirname(page.file), href));
      const slug = href.endsWith('/') ? joined.replace(/\/?$/, '/') : slugOf(joined);
      const target = index.get(slug === './' ? '' : slug);
      const from = index.get(page.slug);
      if (target !== undefined && from !== undefined && target !== from)
        edges.add([Math.min(from, target), Math.max(from, target)].join(','));
    }
  }
  // Points spread evenly on a sphere, in nav order, so each section forms a band.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const positions = nodes.map((_, i) => {
    const y = 1 - (2 * (i + 0.5)) / nodes.length;
    const radius = Math.sqrt(1 - y * y);
    return [Math.cos(golden * i) * radius, y, Math.sin(golden * i) * radius] as const;
  });
  const colors = nodes.map((page) => SECTION_COLORS[sectionOf(page.slug)] ?? [1, 1, 1]);
  return { positions, colors, edges: [...edges].map((edge) => edge.split(',').map(Number)) };
};

const pad4 = (buffer: Buffer, fill: number) =>
  Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);

const writeGlb = (file: string, { positions, colors, edges }: ReturnType<typeof pageGraph>) => {
  const floats = (rows: readonly (readonly number[])[]) =>
    Buffer.from(new Float32Array(rows.flat()).buffer);
  const position = floats(positions);
  const color = floats(colors);
  const indices = pad4(Buffer.from(new Uint16Array(edges.flat()).buffer), 0);
  const axis = (i: number, pick: (...values: number[]) => number) =>
    pick(...positions.map((point) => point[i] ?? 0));
  const json = {
    asset: { version: '2.0', generator: 'vidimus docs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'pages' }],
    meshes: [
      {
        name: 'page graph',
        primitives: [
          { attributes: { POSITION: 0, COLOR_0: 1 }, mode: 0 },
          { attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, mode: 1 },
        ],
      },
    ],
    buffers: [{ byteLength: position.length + color.length + indices.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: position.length, target: 34962 },
      { buffer: 0, byteOffset: position.length, byteLength: color.length, target: 34962 },
      {
        buffer: 0,
        byteOffset: position.length + color.length,
        byteLength: edges.length * 4,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length,
        type: 'VEC3',
        min: [0, 1, 2].map((i) => axis(i, Math.min)),
        max: [0, 1, 2].map((i) => axis(i, Math.max)),
      },
      { bufferView: 1, componentType: 5126, count: colors.length, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: edges.length * 2, type: 'SCALAR' },
    ],
  };
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = Buffer.concat([position, color, indices]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (data: Buffer, type: number) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, data]);
  };
  write(file, '');
  writeFileSync(
    file,
    Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942)]),
  );
};

// The same graph from the front, for browsers without WebGL.
const posterSvg = ({ positions, colors, edges }: ReturnType<typeof pageGraph>) => {
  const [width, height] = [800, 450];
  const at = ([x, y]: readonly number[]) =>
    [width / 2 + (x ?? 0) * 170, height / 2 - (y ?? 0) * 170].map((v) => v.toFixed(1));
  const hex = (rgb: readonly number[]) =>
    `#${rgb
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  const lines = edges.map(([a = 0, b = 0]) => {
    const [x1, y1] = at(positions[a] ?? []);
    const [x2, y2] = at(positions[b] ?? []);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  });
  const dots = positions.map((point, i) => {
    const [cx, cy] = at(point);
    return `<circle cx="${cx}" cy="${cy}" r="6" fill="${hex(colors[i] ?? [1, 1, 1])}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#0f172a"/><g stroke="#94a3b8" stroke-opacity="0.35">${lines.join('')}</g>${dots.join('')}</svg>\n`;
};

const showcaseAssets = async (all: Page[]) => {
  const { default: sharp } = await import('sharp');
  mkdirSync(showcaseDir, { recursive: true });
  const graph = pageGraph(all);
  writeGlb(join(showcaseDir, 'graph.glb'), graph);
  write(join(showcaseDir, 'poster.svg'), posterSvg(graph));
  for (const file of [
    'showcase.css',
    'results.json',
    'media/clip.webm',
    'media/clip.vtt',
    'media/clip-poster.webp',
  ])
    copyFileSync(join(docs, 'showcase', file), join(showcaseDir, posix.basename(file)));
  const media = (file: string) => join(docs, 'showcase', 'media', file);
  // Every image in AVIF, WebP and JPEG at each width; `crop` is the art-directed narrow version.
  const variants = (
    name: string,
    source: string,
    widths: number[],
    crop?: { left: number; top: number; width: number; height: number },
  ) =>
    widths.flatMap((width) => {
      const image = () => (crop ? sharp(source).extract(crop) : sharp(source)).resize(width);
      return [
        image()
          .avif({ quality: 50 })
          .toFile(join(showcaseDir, `${name}-${width}.avif`)),
        image()
          .webp({ quality: 70 })
          .toFile(join(showcaseDir, `${name}-${width}.webp`)),
        image()
          .jpeg({ quality: 75, mozjpeg: true })
          .toFile(join(showcaseDir, `${name}-${width}.jpg`)),
      ];
    });
  await Promise.all([
    ...variants('owl', media('owl.jpg'), [480, 960]),
    ...variants('tiger', media('tiger.jpg'), [640, 1024]),
    ...variants('tiger-crop', media('tiger.jpg'), [480], {
      left: 180,
      top: 520,
      width: 740,
      height: 740,
    }),
    sharp(media('zoo.jpg'))
      .resize(480, 270, { fit: 'cover' })
      .webp({ quality: 80 })
      .toFile(join(showcaseDir, 'zoo.webp')),
    sharp(join(docs, 'public', 'og.png'))
      .resize(960, 540, { fit: 'cover' })
      .webp({ quality: 70 })
      .toFile(join(showcaseDir, 'facade.webp')),
  ]);
};

const sync = () => {
  const all = pages();
  for (const engine of Object.values(engines)) engine(all);
  console.log(`synced ${all.length} pages to ${engineDirs.join(', ')}`);
  return all;
};

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

const injectMdbook = (all: Page[]) => {
  const out = join(dist, 'mdbook');
  const bySlug = new Map(all.map((page) => [page.slug, page]));
  rmSync(join(out, '404.html'), { force: true });
  for (const file of globSync('**/*.html', { cwd: out })) {
    const path = join(out, file);
    if (!statSync(path).isFile()) continue;
    const slug = slugOf(
      file
        .split('\\')
        .join('/')
        .replace(/\.html$/, ''),
    );
    const page = bySlug.get(slug);
    if (!page) continue;
    const bar = `<nav class="flavors" aria-label="Docs flavor"><span>Same docs, built with</span>${flavorLinks(
      'mdbook',
      slug,
    )
      .map(
        ({ name, href, current }) =>
          `<a href="${href}"${current ? ' aria-current="page"' : ''}>${name}</a>`,
      )
      .join('')}</nav>`;
    const note = `<p class="dogfood">${escapeHtml(dogfoodNote)} <a href="${pageUrl('mdbook', 'flavors')}">Why</a>.</p>`;
    const html = readFileSync(path, 'utf8')
      .replace(
        /<meta name="description" content="[^"]*">/,
        `<meta name="description" content="${escapeHtml(describe('mdbook', page))}">`,
      )
      .replace(
        '</head>',
        `${[
          `<link rel="canonical" href="${canonicalUrl(slug)}">`,
          `<meta property="og:url" content="${canonicalUrl(slug)}">`,
          `<meta property="og:title" content="${escapeHtml(page.slug ? h1Of(page.body) || page.title : home.title)}">`,
          `<meta property="og:image" content="${site}/og.png">`,
          '<meta name="twitter:card" content="summary_large_image">',
        ].join('\n')}\n</head>`,
      )
      .replace(/<h1 class="menu-title">([\s\S]*?)<\/h1>/, '<p class="menu-title">$1</p>')
      .replace(/<iframe (?![^>]*title=)/g, '<iframe title="Table of contents" ')
      .replace(
        '<input type="search" id="mdbook-searchbar"',
        '<input type="search" aria-label="Search" id="mdbook-searchbar"',
      )
      .replace(/<main>/, `<main>\n${bar}`)
      .replace(/<\/main>/, `${note}\n</main>`);
    writeFileSync(path, html);
  }
};

const execFileAsync = promisify(execFile);

const run = async (command: string, args: string[], cwd = root) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    throw new Error(`${command} ${args.join(' ')} failed`, { cause: error });
  }
};

const nativeTools = { hugo: 'version', zola: '--version', mdbook: '--version' };

const requireTools = () => {
  const missing = Object.entries(nativeTools)
    .filter(([tool, arg]) => spawnSync(tool, [arg], { stdio: 'ignore' }).status !== 0)
    .map(([tool]) => tool);
  if (missing.length) {
    console.error(
      `missing ${missing.join(', ')}: run \`mise install\` to get the versions pinned in mise.toml`,
    );
    process.exit(1);
  }
};

const build = async () => {
  requireTools();
  const all = sync();
  clean(dist);
  await showcaseAssets(all);
  await run('pnpm', ['exec', 'vite', 'build', '--config', 'docs/showcase/vite.config.ts']);
  // VitePress empties docs/dist, so it goes first; the others each write their own subfolder.
  await run('pnpm', ['exec', 'vitepress', 'build', 'docs']);
  await Promise.all([
    run('pnpm', ['exec', 'vite', 'build', '--config', 'docs/react/vite.config.ts']),
    run('pnpm', ['exec', 'ng', 'build'], join(docs, 'angular')),
    run('pnpm', ['exec', 'astro', 'build', '--root', 'docs/astro']),
    run('hugo', ['--source', 'docs/hugo', '--destination', '../dist/hugo', '--quiet']),
    run('pnpm', ['exec', 'eleventy', '--quiet'], join(docs, 'eleventy')),
    run('zola', ['build', '--output-dir', '../dist/zola', '--force'], join(docs, 'zola')),
    run('mdbook', ['build', '--dest-dir', '../dist/mdbook'], join(docs, 'mdbook')),
  ]);
  injectMdbook(all);
  rmSync(join(dist, 'zola', '404.html'), { force: true });
  for (const asset of ['favicon.svg', 'apple-touch-icon.png'])
    for (const engine of engineDirs)
      copyFileSync(join(docs, 'public', asset), join(dist, engine, asset));
};

// GitHub Pages has no rewrites: before deploying, give every route of the client-rendered
// flavors a copy of the app's index.html, where Pages looks for it. The audit runs before this,
// on one index.html per app, as a host with rewrites would serve it.
const pagesCopies = () => {
  const all = pages().filter(({ slug }) => slug);
  for (const id of ['react', 'angular'] as const) {
    const index = join(dist, id, 'index.html');
    for (const { slug } of all) {
      const file = join(dist, id, slug.endsWith('/') ? `${slug}index.html` : `${slug}.html`);
      mkdirSync(dirname(file), { recursive: true });
      copyFileSync(index, file);
    }
  }
  console.log(`copied index.html to ${all.length} routes in react and angular`);
};

const commands: Record<string, () => unknown> = {
  sync,
  build,
  'pages-copies': pagesCopies,
};

const command = commands[process.argv[2] ?? ''];
if (!command) {
  console.error(`usage: node scripts/docs.ts ${Object.keys(commands).join('|')}`);
  process.exit(2);
}
await command();
