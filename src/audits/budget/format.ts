export type Kind = 'html' | 'css' | 'js' | 'page';

export interface Asset {
  url: string;
  file: string;
  size: number;
}

export const BUDGET_FIXES: Record<Kind, string> = {
  html: 'Move inline scripts, styles and SVG sprites into cached files or paginate long content, or raise budget.html.',
  css: 'Remove unused CSS (e.g. with PurgeCSS), split per-page styles out of the largest files above, or raise budget.css.',
  js: 'Split or lazy-load the largest scripts listed above, drop unused dependencies, or raise budget.js.',
  page: 'Shrink the largest files listed above (images first), lazy-load below-the-fold media, or raise budget.page.',
};

export const formatBytes = (bytes: number, digits = 0) =>
  bytes < 1000
    ? `${bytes} B`
    : bytes < 999_500
      ? `${(bytes / 1000).toFixed(digits)} kB`
      : `${(bytes / 1_000_000).toFixed(Math.max(digits, 1))} MB`;

export const formatExceeded = (size: number, limit: number) => {
  let digits = 0;
  while (formatBytes(size, digits) === formatBytes(limit, digits)) digits++;
  return [formatBytes(size, digits), formatBytes(limit, digits)] as const;
};

export const topFiles = (assets: Asset[]) =>
  [...assets]
    .sort((a, b) => b.size - a.size)
    .slice(0, 3)
    .map(({ url, size }) => `${formatBytes(size)} ${url}`);

export const sum = (assets: Asset[]) => assets.reduce((total, { size }) => total + size, 0);
