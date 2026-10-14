const AUDIT_FIXES: Record<string, string> = {
  'uses-responsive-images': 'serve images at the size they are displayed (srcset/sizes)',
  'unused-javascript': 'remove or code-split JavaScript that the page does not run',
  'render-blocking-resources': 'defer or inline render-blocking CSS and scripts',
  'font-display': 'add font-display: swap to @font-face rules',
  'uses-text-compression': 'enable gzip or brotli compression for text responses',
  'meta-description': 'add a <meta name="description"> to the page',
  'image-alt': 'add alt text to every <img>',
};

const LOAD_CAUSES: Record<string, string> = {
  ERRORED_DOCUMENT_REQUEST: 'the page answered with an error status (4xx/5xx); make it return 200',
  FAILED_DOCUMENT_REQUEST: 'the page request failed; check that the server is reachable',
  NO_FCP: 'the page painted nothing; make sure it renders visible content',
};

export const scoreFix = (report: string, category: string) =>
  `Open ${report} and fix the audits listed first, or lower lighthouse.thresholds.${category} if the target is too strict.`;

export const auditFix = (ids: string[], report: string, category: string) => {
  const specific = ids.flatMap((id) => (AUDIT_FIXES[id] ? [`${id}: ${AUDIT_FIXES[id]}`] : []));
  return specific.length
    ? `${specific.join('; ')}. See ${report}, or add the audit id to lighthouse.ignoreAudits.`
    : scoreFix(report, category);
};

export const assertedFix = (id: string, report: string) => {
  const hint = AUDIT_FIXES[id];
  return `${hint ? `${id}: ${hint}. See ${report}` : `Open ${report} and fix ${id}`}, or set lighthouse.audits.${id} to 'off'.`;
};

export const loadFailureFix = (path: string, listed: boolean, code = '') => {
  const cause = LOAD_CAUSES[code];
  return `${cause ? `${cause[0]?.toUpperCase()}${cause.slice(1)}. ` : ''}Check that ${path} loads in a browser without errors, or ${listed ? 'remove it from lighthouse.urls' : 'add it to lighthouse.exclude'}.`;
};
