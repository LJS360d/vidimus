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

export interface StateCookie {
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
  };
  render: NavigateOptions & {
    mode: RenderMode;
    include: Pattern[];
    concurrency: number;
  };
  audits: string[];
  severity: Record<string, AuditSeverity>;
  strict: boolean;
  ignore: IgnoreRule[];
  baseline: {
    file: string;
    update: boolean;
  };
  plugins: Audit[];
  reporters: (string | Reporter)[];
  /** Reports always written to `outDir` next to the reporters: `json`, `junit`. */
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
    settle: number;
    exclude: Pattern[];
    sample: Pattern[];
    skip: string[];
    maxCases: number;
    values: Record<string, string>;
    allowRequests: Pattern[];
    stub: 'abort' | 'ok';
    allowRemote: boolean;
    outDir: string;
  };
  a11y: {
    standard: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
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
    settleTimeout: number;
    protocolTimeout: number;
    updateBaseline: boolean;
  };
  lighthouse: {
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
    concurrency: number;
    timeout: number;
  };
  html: {
    exclude: Pattern[];
    extends: string[];
    rules: Record<string, unknown>;
  };
  budget: {
    exclude: Pattern[];
    html: number;
    css: number;
    js: number;
    image: number;
    page: number;
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
