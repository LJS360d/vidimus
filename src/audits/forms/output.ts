import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../../core/types.ts';
import { findingsFor } from './findings.ts';
import { reportHtml } from './report.ts';
import type { Exercised } from './types.ts';

const slug = (id: string) => id.replace(/[^\w.~-]+/g, '_');
const fileOf = (id: string) => `${slug(id)}.json`;

const withoutShots = (key: string, value: unknown) =>
  key === 'shot' || key === 'before' ? undefined : value;

export const writeReports = (
  out: string,
  exercised: Exercised[],
  failed: Finding[],
  origin: string,
) => {
  for (const form of exercised)
    writeFileSync(join(out, fileOf(form.id)), `${JSON.stringify(form, withoutShots, 2)}\n`);
  writeFileSync(
    join(out, 'index.json'),
    `${JSON.stringify(
      exercised.map(({ id, fingerprint, pages, cases }) => ({
        id,
        fingerprint,
        pages,
        cases: cases.length,
        file: fileOf(id),
      })),
      null,
      2,
    )}\n`,
  );
  const perForm = exercised.map((form) => findingsFor(form, origin));
  writeFileSync(
    join(out, 'index.html'),
    reportHtml(
      exercised.map((form, i) => ({ ...form, findings: perForm[i] ?? [] })),
      failed,
      origin,
    ),
  );
  return perForm.flat();
};
