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
import {
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

type Page = { file: string; slug: string; title: string; description: string; body: string };
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
});

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
      const body = rewriteLinks('astro', page, page.body);
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
        `${yaml({ title: page.slug ? page.title : home.title, description: describe('hugo', page), tagline: home.tagline, ...common('hugo', page) })}\n${rewriteLinks('hugo', page, page.body)}`,
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
        `${yaml({ title: page.slug ? page.title : home.title, description: describe('eleventy', page), tagline: home.tagline, layout: page.slug ? 'doc.njk' : 'home.njk', ...common('eleventy', page) })}\n${rewriteLinks('eleventy', page, page.body)}`,
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
          .join('\n')}\n+++\n\n{% raw %}\n${rewriteLinks('zola', page, page.body)}\n{% endraw %}\n`,
      );
    }
    write(join(docs, 'zola', 'nav.json'), JSON.stringify(navFor('zola')));
    write(join(docs, 'zola', 'static', 'main.css'), themeCss());
  },
  mdbook: (all) => {
    const dir = join(docs, 'mdbook', 'src');
    clean(dir);
    for (const page of all) {
      const body = rewriteLinks('mdbook', page, page.body);
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
  // VitePress empties docs/dist, so it goes first; the others each write their own subfolder.
  await run('pnpm', ['exec', 'vitepress', 'build', 'docs']);
  await Promise.all([
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

const commands: Record<string, () => unknown> = {
  sync,
  build,
};

const command = commands[process.argv[2] ?? ''];
if (!command) {
  console.error(`usage: node scripts/docs.ts ${Object.keys(commands).join('|')}`);
  process.exit(2);
}
await command();
