import {
  afterRenderEffect,
  Component,
  computed,
  DOCUMENT,
  type ElementRef,
  inject,
  provideZonelessChangeDetection,
  signal,
  VERSION,
  viewChild,
} from '@angular/core';
import { bootstrapApplication, DomSanitizer, Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, provideRouter, Router, RouterLink } from '@angular/router';
import { type AppData, type AppPage, enhance, findPage, fullTitle } from '../../app-shell';
import pages from './pages';

const data = pages as AppData;
const basename = '/vidimus/angular';

@Component({ selector: 'vidimus-empty', template: '' })
class Empty {}

@Component({
  selector: 'vidimus-docs',
  imports: [RouterLink],
  template: `
    @if (page(); as page) {
      <a class="skip" href="#content">Skip to content</a>
      <header class="top">
        <a class="brand" routerLink="/"><img [src]="icon" width="24" height="24" alt=""> vidimus</a>
        <nav class="links" aria-label="Site">
          <a routerLink="/getting-started">Guide</a>
          <a routerLink="/audits/">Audits</a>
          <a href="https://www.npmjs.com/package/vidimus">npm</a>
          <a [href]="data.repo">GitHub</a>
        </nav>
      </header>
      <nav class="flavors" aria-label="Docs flavor">
        <span>Same docs, built with</span>
        @for (flavor of page.flavors; track flavor.name) {
          <a [href]="flavor.href" [attr.aria-current]="flavor.current ? 'page' : null">{{ flavor.name }}</a>
        }
      </nav>
      <div class="layout" [class.home]="!page.slug">
        @if (page.slug) {
          <nav class="sidebar" aria-label="Docs">
            @for (group of data.nav; track group.text) {
              <div>
                <h2>{{ group.text }}</h2>
                <ul>
                  @for (item of group.items; track item.link) {
                    <li>
                      <a [routerLink]="local(item.href)" [attr.aria-current]="item.link === page.docslug ? 'page' : null">{{ item.text }}</a>
                    </li>
                  }
                </ul>
              </div>
            }
          </nav>
        }
        <main id="content" #main>
          @if (page.slug) {
            <article class="doc">
              <div [innerHTML]="html()"></div>
              <p class="edit"><a [href]="page.edit">Edit this page on GitHub</a></p>
            </article>
          } @else {
            <section class="hero">
              <h1>vidimus</h1>
              <p class="tagline">{{ page.tagline }}</p>
              <p>{{ page.description }}</p>
              <p class="actions">
                <a class="button primary" routerLink="/getting-started">Get started</a>
                <a class="button" routerLink="/audits/">Audits</a>
              </p>
            </section>
            <article class="doc home-body" [innerHTML]="html()"></article>
          }
        </main>
      </div>
      <footer class="foot">
        <p>MIT licensed. Rendered in the browser by Angular {{ version }} with the Angular router, zoneless, from one index.html: no prerendering.</p>
        <p>{{ data.dogfoodNote }} <a routerLink="/flavors">Why</a>.</p>
      </footer>
    } @else {
      <header class="top">
        <a class="brand" routerLink="/"><img [src]="icon" width="24" height="24" alt=""> vidimus</a>
      </header>
      <div class="layout home">
        <main id="content" class="not-found">
          <article class="doc">
            <h1>Page not found</h1>
            <p>No page here. <a routerLink="/">Back to the docs</a>.</p>
          </article>
        </main>
      </div>
    }
  `,
})
class Docs {
  protected readonly data = data;
  protected readonly icon = `${basename}/favicon.svg`;
  protected readonly version = VERSION.full;
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly path = signal(this.pathOf(this.router.url));
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');
  protected readonly page = computed(() => findPage(data.pages, this.path()));
  // The page HTML is generated from the repository's own markdown at build time.
  protected readonly html = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.page()?.html ?? ''),
  );

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.path.set(this.pathOf(event.urlAfterRedirects));
    });
    afterRenderEffect((onCleanup) => {
      const page = this.page();
      this.head(page);
      const main = this.main()?.nativeElement;
      if (!page || !main) return;
      onCleanup(enhance(main, basename, (path) => void this.router.navigateByUrl(path)));
    });
  }

  protected local(href: string) {
    return href.slice(basename.length) || '/';
  }

  private pathOf(url: string) {
    return new URL(url, 'http://localhost').pathname;
  }

  private head(page: AppPage | undefined) {
    if (!page) {
      this.title.setTitle('Page not found · vidimus');
      this.meta.updateTag({ name: 'robots', content: 'noindex' });
      return;
    }
    this.meta.removeTag('name="robots"');
    this.title.setTitle(fullTitle(page));
    this.meta.updateTag({ name: 'description', content: page.description });
    this.meta.updateTag({ property: 'og:title', content: fullTitle(page) });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ property: 'og:url', content: page.canonical });
    let canonical = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = this.document.createElement('link');
      canonical.rel = 'canonical';
      this.document.head.append(canonical);
    }
    canonical.href = page.canonical;
  }
}

bootstrapApplication(Docs, {
  providers: [provideZonelessChangeDetection(), provideRouter([{ path: '**', component: Empty }])],
}).catch((error: unknown) => console.error(error));
