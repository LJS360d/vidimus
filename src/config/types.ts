import type { Audit } from '../core/types.ts';
import type { Reporter } from '../reporters/types.ts';

export type Pattern = string;

export interface ViewportSize {
  width: number;
  height?: number;
}

export interface FallbackRule {
  match: Pattern;
  file: string;
}

export interface HeaderRule {
  match: Pattern;
  headers: Record<string, string>;
}

export type AuditSeverity = 'error' | 'warn' | 'off';

export interface IgnoreRule {
  audit?: string;
  message?: Pattern;
  where?: Pattern;
}

export interface Range {
  min: number;
  max: number;
}

export interface MotionOptions {
  interval: number;
  stableFrames: number;
  maxFrames: number;
}

export type RouteDiscovery = 'off' | 'sitemap' | 'crawl';

export type RenderMode = 'off' | 'auto' | 'on';

export type SiteFileCheck = 'off' | 'auto' | 'on';

export interface NavigateOptions {
  waitFor: string | number;
  timeout: number;
}

interface StateCookie {
  name: string;
  value: string;
  /** Defaults to the audited origin. */
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** State seeded into every page a browser audit opens, before any page script runs. */
export interface BrowserState {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: StateCookie[];
  /** JavaScript source evaluated on every new document, before the page's own scripts. */
  script: string;
}

export interface VidimusConfig {
  root: string;
  distDir: string;
  outDir: string;
  port: number;
  origin: string;
  siteUrl: string;
  exclude: Pattern[];
  locales: string[];
  defaultLocale: string;
  allLocales: boolean;
  routes: {
    paths: string[];
    discover: RouteDiscovery;
    limit: number;
    /** With `discover: 'crawl'` and rendering on, also follow hash-router links (`#/about`, `#!/docs`) as routes of the page they were found on; plain anchors such as `#top` are ignored. */
    hash: boolean;
  };
  render: NavigateOptions & {
    mode: RenderMode;
    include: Pattern[];
    concurrency: number;
  };
  audits: string[];
  severity: Record<string, AuditSeverity>;
  strict: boolean;
  /** Milliseconds the whole run may take; `0` means no limit. */
  timeout: number;
  /** Milliseconds each audit may take; `0` means no limit. */
  auditTimeout: number;
  ignore: IgnoreRule[];
  baseline: {
    file: string;
    update: boolean;
    /** Also match accepted findings by their page list (`where`), so the same finding on other pages is new. */
    matchWhere: boolean;
  };
  plugins: Audit[];
  reporters: (string | Reporter)[];
  /** Reports always written to `outDir` next to the reporters: `json`, `junit`, `sarif`, `html`. */
  reports: string[];
  browser: {
    args: string[];
    executablePath: string;
    state: BrowserState;
  };
  server: {
    command: string;
    startTimeout: number;
    gzip: boolean;
    headers: HeaderRule[];
    fallback: string | FallbackRule[];
    fallbackStatus: 200 | 404;
  };
  i18n: {
    files: string;
  };
  csp: {
    exclude: Pattern[];
    sandbox: boolean;
  };
  r12s: {
    viewports: number[];
    minTarget: number;
    minFont: number;
    concurrency: number;
    timeout: number;
    exclude: Pattern[];
    sample: Pattern[];
  };
  forms: {
    concurrency: number;
    timeout: number;
    /** Longest a single probe case (fill, submit, wait for the outcome) may run, in ms, before it is abandoned and reported as a finding. `0` means no limit. */
    caseTimeout: number;
    settle: number;
    exclude: Pattern[];
    sample: Pattern[];
    skip: string[];
    maxCases: number;
    values: Record<string, string>;
    allowRequests: Pattern[];
    /** URL patterns whose requests are still stopped but left out of the recorded requests, so analytics beacons do not count as the form sending. */
    ignoreRequests: Pattern[];
    stub: 'abort' | 'ok';
    allowRemote: boolean;
    outDir: string;
  };
  a11y: {
    standard: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
    /** pa11y runner: `htmlcs` (HTML_CodeSniffer) or `axe` (axe-core). */
    runner: 'htmlcs' | 'axe';
    /** Report pa11y warnings as `warn` findings (notices are never reported). */
    includeWarnings: boolean;
    timeout: number;
    concurrency: number;
    exclude: Pattern[];
    sample: Pattern[];
    hideElements: string;
    ignore: string[];
  };
  shots: {
    outDir: string;
    baselineDir: string;
    viewports: (number | ViewportSize)[];
    /** Colour schemes to capture each page and viewport in, emulated with `prefers-color-scheme`. `light` keeps the plain screenshot names; `dark` adds a `.dark` suffix (`index@1280x800.dark.png`). */
    colorSchemes: ('light' | 'dark')[];
    exclude: Pattern[];
    sample: Pattern[];
    allLocales: boolean;
    motion: MotionOptions | false;
    mask: string[];
    maskEmbeds: boolean;
    freeze: boolean;
    concurrency: number;
    tolerance: number;
    maxDiff: number;
    /** Ignore anti-aliased pixels: a changed pixel on a soft edge, such as a glyph or a diagonal line, that a neighbouring pixel explains does not count. Off by default, so every pixel above `tolerance` counts. */
    antialiasing: boolean;
    /** Own `tolerance` or `maxDiff` for some screenshots: a rule applies when its `match` pattern matches the page path and its `viewport` equals the screenshot width, either may be left out. The first matching rule wins; other screenshots use the global values. */
    overrides: { match?: Pattern; viewport?: number; tolerance?: number; maxDiff?: number }[];
    settleTimeout: number;
    protocolTimeout: number;
    updateBaseline: boolean;
  };
  lighthouse: {
    /** `desktop` uses Lighthouse's desktop form factor, emulation and throttling; `mobile` is its default. */
    preset: 'mobile' | 'desktop';
    /** Runs per page; each category score is the median of them. */
    runs: number;
    outDir: string;
    exclude: Pattern[];
    sample: Pattern[];
    all: boolean;
    urls: string[];
    thresholds: Record<string, number>;
    overrides: { match: Pattern; thresholds: Record<string, number> }[];
  };
  links: {
    skip: Pattern[];
    concurrency: number;
    timeout: number;
    checkExternal: boolean;
    retry: boolean;
    /** Verify that `#fragment` links match an id on the target page. */
    checkFragments: boolean;
    /** Also check URLs referenced from CSS (`url(...)`). */
    checkCss: boolean;
    /** Report links that redirect, as warnings. */
    warnRedirects: boolean;
    notFound: {
      selector: string;
      text: Pattern;
    };
  };
  seo: {
    exclude: Pattern[];
    allowNoindex: Pattern[];
    titleLength: Range;
    descriptionLength: Range;
    canonical: boolean;
    h1: boolean;
    sitemap: boolean;
    robots: boolean;
    orphans: boolean;
  };
  security: {
    file: string;
    exclude: Pattern[];
    require: Record<string, Pattern | false>;
    clickjacking: boolean;
    unsafeInline: boolean;
    mixedContent: boolean;
    sri: boolean;
    securityTxt: boolean;
  };
  privacy: {
    allow: Pattern[];
    exclude: Pattern[];
    sample: Pattern[];
    allLocales: boolean;
    cookies: boolean;
    wait: number;
    /** CSS selector of the consent banner's reject button. When set, the audit clicks it and reports cookies, storage and third-party requests that remain after rejection. Empty disables the check. */
    rejectSelector: string;
    concurrency: number;
    timeout: number;
  };
  html: {
    exclude: Pattern[];
    extends: string[];
    rules: Record<string, unknown>;
  };
  budget: {
    /** How text files (HTML, CSS, JS, SVG, JSON) are compressed before measuring. A `.br` or `.gz` file next to an asset in the build is used instead, by its size on disk. */
    compression: 'gzip' | 'brotli' | 'none';
    exclude: Pattern[];
    html: number;
    css: number;
    js: number;
    image: number;
    page: number;
    /** Max network requests a rendered page makes (needs `render.mode`). `0` turns it off. */
    requests: number;
    /** Max requests a rendered page makes to origins other than the site's (needs `render.mode`). `0` turns it off. */
    thirdParty: number;
    /** Limit overrides per page: keys are patterns matched against the page path, values replace `html`, `css`, `js`, `image`, `page`, `requests` or `thirdParty` for matching pages. The first matching key wins; other pages use the global limits. */
    routes: Record<
      string,
      Partial<Record<'html' | 'css' | 'js' | 'image' | 'page' | 'requests' | 'thirdParty', number>>
    >;
    legacyImage: number;
    dimensions: boolean;
  };
  assets: {
    exclude: Pattern[];
    favicon: boolean;
    manifest: boolean;
    openGraph: boolean;
    ogImage: { width: number; height: number };
    notFound: boolean;
    adsTxt: SiteFileCheck;
    changePassword: SiteFileCheck;
    appleAppSiteAssociation: SiteFileCheck;
    assetLinks: SiteFileCheck;
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? T[K] extends false
        ? T[K]
        : DeepPartial<T[K]>
      : T[K];
};

export type UserConfig = DeepPartial<VidimusConfig>;

export interface ConfigEnv {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type ConfigInput = UserConfig | ((env: ConfigEnv) => UserConfig | Promise<UserConfig>);
