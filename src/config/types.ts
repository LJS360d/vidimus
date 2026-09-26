import type { Audit } from '../core/types.ts';
import type { Reporter } from '../reporters/types.ts';

export type Pattern = string;

export interface ViewportSize {
  width: number;
  height?: number;
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
  browser: {
    args: string[];
    executablePath: string;
  };
  server: {
    gzip: boolean;
    headers: HeaderRule[];
  };
  i18n: {
    files: string;
  };
  csp: {
    exclude: Pattern[];
  };
  r12s: {
    viewports: number[];
    minTarget: number;
    minFont: number;
    concurrency: number;
    timeout: number;
    exclude: Pattern[];
  };
  a11y: {
    standard: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
    timeout: number;
    concurrency: number;
    exclude: Pattern[];
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
  };
  links: {
    skip: Pattern[];
    concurrency: number;
    timeout: number;
    checkExternal: boolean;
    retry: boolean;
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
