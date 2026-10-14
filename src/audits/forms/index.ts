import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { UsageError } from '../../core/errors.ts';
import type { Audit, Finding } from '../../core/types.ts';
import { inParallel, onePagePerTemplate } from '../../core/util.ts';
import { findForms, uniqueForms } from './discover.ts';
import { exerciseForm } from './exercise.ts';
import { writeReports } from './output.ts';
import type { Exercised } from './types.ts';

const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\])$/;
// 1x1 transparent PNG: accepted by image/* inputs and harmless everywhere else.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const outDirOf = (root: string, outRoot: string, name: string) => {
  const out = resolvePath(outRoot, name);
  const rel = relative(outRoot, out);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || out === root)
    throw new UsageError(
      `forms.outDir "${name}" resolves to ${out}, which is not a folder inside ${outRoot}, so nothing is cleared. Set forms.outDir to a subfolder such as "forms".`,
    );
  return out;
};

const summaryOf = (
  exercised: Exercised[],
  failed: Finding[],
  findings: Finding[],
  pages: number,
) => {
  const caseCount = exercised.reduce((sum, form) => sum + form.cases.length, 0);
  const pagesWithForms = new Set(exercised.flatMap((form) => form.pages)).size;
  const failures = failed.length ? `, ${failed.length} page(s)/form(s) failed` : '';
  const body = exercised.length
    ? `${exercised.length} form(s) on ${pagesWithForms} of ${pages} page(s), ${caseCount} cases${findings.length ? '' : ', no findings'}`
    : `${pages} page(s), no forms`;
  return `${body}${failures}`;
};

export const forms: Audit = {
  name: 'forms',
  description: 'fill every form with valid and invalid values, sandboxed submits',
  requires: 'server',
  async run({ config, origin, resolve, pageUrls, launchBrowser, log }) {
    const options = config.forms;
    if (!LOOPBACK.test(new URL(origin).hostname) && !options.allowRemote)
      return {
        status: 'skipped',
        summary: `not pressing submit buttons on ${origin}: set forms.allowRemote to audit a remote site`,
      };
    const urls = onePagePerTemplate(pageUrls({ exclude: options.exclude }), options.sample, origin);
    const out = outDirOf(config.root, resolve(config.root, config.outDir), options.outDir);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const scratch = mkdtempSync(join(tmpdir(), 'vidimus-forms-'));
    const upload = join(scratch, 'vidimus.png');
    writeFileSync(upload, PNG);

    const browser = await launchBrowser();
    const exercised: Exercised[] = [];
    const failed: Finding[] = [];
    try {
      const scanned = await findForms(browser, config, origin, urls);
      failed.push(...scanned.failed);
      const env = { browser, config, origin, upload, failed };
      await inParallel(options.concurrency, uniqueForms(scanned.found), async (unique) => {
        const done = await exerciseForm(env, unique);
        if (done) exercised.push(done);
      });
    } finally {
      await browser.close();
      rmSync(scratch, { recursive: true, force: true });
    }

    exercised.sort((a, b) => a.id.localeCompare(b.id));
    log(`forms: wrote ${exercised.length} report(s) to ${out}, open ${join(out, 'index.html')}`);
    const findings = [...writeReports(out, exercised, failed, origin), ...failed];
    return { summary: summaryOf(exercised, failed, findings, urls.length), findings };
  },
};
