import { StrictMode, useEffect, useRef, version } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider, useLocation, useNavigate } from 'react-router';
import '../../theme.css';
import { type AppData, type AppPage, enhance, findPage, fullTitle } from '../../app-shell';
import pages from './pages.json';

const data = pages as AppData;
const basename = '/vidimus/react';
const local = (href: string) => href.slice(basename.length) || '/';

const Head = ({ page }: { page: AppPage }) => (
  <>
    <title>{fullTitle(page)}</title>
    <meta name="description" content={page.description} />
    <link rel="canonical" href={page.canonical} />
    <meta property="og:title" content={fullTitle(page)} />
    <meta property="og:description" content={page.description} />
    <meta property="og:url" content={page.canonical} />
  </>
);

const Top = () => (
  <header className="top">
    <Link className="brand" to="/">
      <img src={`${basename}/favicon.svg`} width="24" height="24" alt="" /> vidimus
    </Link>
    <nav className="links" aria-label="Site">
      <Link to="/getting-started">Guide</Link>
      <Link to="/audits/">Audits</Link>
      <a href="https://www.npmjs.com/package/vidimus">npm</a>
      <a href={data.repo}>GitHub</a>
    </nav>
  </header>
);

const Flavors = ({ page }: { page: AppPage }) => (
  <nav className="flavors" aria-label="Docs flavor">
    <span>Same docs, built with</span>
    {page.flavors.map(({ name, href, current }) => (
      <a key={name} href={href} aria-current={current ? 'page' : undefined}>
        {name}
      </a>
    ))}
  </nav>
);

const Sidebar = ({ page }: { page: AppPage }) => (
  <nav className="sidebar" aria-label="Docs">
    {data.nav.map(({ text, items }) => (
      <div key={text}>
        <h2>{text}</h2>
        <ul>
          {items.map((item) => (
            <li key={item.link}>
              <Link
                to={local(item.href)}
                aria-current={item.link === page.docslug ? 'page' : undefined}
              >
                {item.text}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ))}
  </nav>
);

const Foot = () => (
  <footer className="foot">
    <p>
      MIT licensed. Rendered in the browser by React {version} and React Router from one index.html:
      no prerendering.
    </p>
    <p>
      {data.dogfoodNote} <Link to="/flavors">Why</Link>.
    </p>
  </footer>
);

const Content = ({ page }: { page: AppPage }) => {
  const main = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  // Content is keyed by page, so it mounts once per page.
  useEffect(
    () => (main.current ? enhance(main.current, basename, navigate) : undefined),
    [navigate],
  );
  const body = { __html: page.html };
  return (
    <main id="content" ref={main}>
      {page.slug ? (
        <article className="doc">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: HTML generated from the repository's own markdown */}
          <div dangerouslySetInnerHTML={body} />
          <p className="edit">
            <a href={page.edit}>Edit this page on GitHub</a>
          </p>
        </article>
      ) : (
        <>
          <section className="hero">
            <h1>vidimus</h1>
            <p className="tagline">{page.tagline}</p>
            <p>{page.description}</p>
            <p className="actions">
              <Link className="button primary" to="/getting-started">
                Get started
              </Link>
              <Link className="button" to="/audits/">
                Audits
              </Link>
            </p>
          </section>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: HTML generated from the repository's own markdown */}
          <article className="doc home-body" dangerouslySetInnerHTML={body} />
        </>
      )}
    </main>
  );
};

const NotFound = () => (
  <>
    <title>Page not found · vidimus</title>
    <meta name="robots" content="noindex" />
    <Top />
    <div className="layout home">
      <main id="content" className="not-found">
        <article className="doc">
          <h1>Page not found</h1>
          <p>
            No page here. <Link to="/">Back to the docs</Link>.
          </p>
        </article>
      </main>
    </div>
  </>
);

const DocPage = () => {
  const { pathname } = useLocation();
  const page = findPage(data.pages, pathname);
  if (!page) return <NotFound />;
  return (
    <>
      <Head page={page} />
      <a className="skip" href="#content">
        Skip to content
      </a>
      <Top />
      <Flavors page={page} />
      <div className={page.slug ? 'layout' : 'layout home'}>
        {page.slug ? <Sidebar page={page} /> : null}
        <Content key={page.slug} page={page} />
      </div>
      <Foot />
    </>
  );
};

const router = createBrowserRouter([{ path: '*', element: <DocPage /> }], { basename });
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
