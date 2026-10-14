import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../core/types.ts';

const YEAR = 366 * 24 * 60 * 60 * 1000;

const EXAMPLE =
  'Contact: mailto:security@example.com and Expires: <a date less than a year away, e.g. 2027-01-01T00:00:00Z>';

export const securityTxtFields = (text: string) => {
  const fields = new Map<string, string[]>();
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('-----BEGIN PGP SIGNATURE')) break;
    const line = raw.trim();
    const colon = line.indexOf(':');
    if (!line || line.startsWith('#') || colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    fields.set(name, [...(fields.get(name) ?? []), line.slice(colon + 1).trim()]);
  }
  return fields;
};

const contactFindings = (contacts: string[]): Finding[] => {
  if (!contacts.length) {
    return [
      {
        message: 'security.txt has no Contact field',
        fix: 'Add a line like "Contact: mailto:security@example.com" or "Contact: https://example.com/security".',
      },
    ];
  }
  return contacts
    .filter((contact) => /^http:/i.test(contact) || !/^[a-z][a-z\d+.-]*:/i.test(contact))
    .map((contact) => ({
      message: `security.txt Contact "${contact}" is not a mailto:, tel: or https:// URI`,
      fix: 'Write the contact as a URI, e.g. "mailto:security@example.com" or "https://example.com/security".',
    }));
};

const expiresFindings = (expires: string[], now: number): Finding[] => {
  const [expiry] = expires;
  if (expiry === undefined) {
    return [
      {
        message: 'security.txt has no Expires field',
        fix: `Add a line like "Expires: ${new Date(now + YEAR / 2).toISOString().slice(0, 10)}T00:00:00Z".`,
      },
    ];
  }
  if (expires.length > 1) {
    return [
      {
        message: 'security.txt has more than one Expires field',
        fix: 'Keep a single Expires line.',
      },
    ];
  }
  const time = Date.parse(expiry);
  if (Number.isNaN(time)) {
    return [
      {
        message: `security.txt Expires "${expiry}" is not a date`,
        fix: 'Write Expires as an ISO 8601 date and time, e.g. "Expires: 2027-01-01T00:00:00Z".',
      },
    ];
  }
  if (time <= now) {
    return [
      {
        message: `security.txt expired on ${expiry}`,
        fix: 'Review the file and move Expires to a date less than a year away.',
      },
    ];
  }
  if (time - now > YEAR) {
    return [
      {
        message: `security.txt Expires ${expiry} is more than a year away`,
        severity: 'warn',
        fix: 'Set Expires less than a year ahead so the file is reviewed at least yearly.',
      },
    ];
  }
  return [];
};

export const securityTxtFindings = (dist: string, now: number): Finding[] => {
  const wellKnown = join(dist, '.well-known', 'security.txt');
  const legacy = join(dist, 'security.txt');
  const file = [wellKnown, legacy].find((candidate) => existsSync(candidate));
  if (!file) {
    return [
      {
        message: 'no /.well-known/security.txt',
        severity: 'warn',
        fix: `Add .well-known/security.txt to the folder copied to the build as is (usually public/) with ${EXAMPLE}, or set security.securityTxt to false.`,
      },
    ];
  }
  const fields = securityTxtFields(readFileSync(file, 'utf8'));
  const problems: Finding[] = [
    ...(file === legacy
      ? [
          {
            message: 'security.txt is not under /.well-known/',
            severity: 'warn' as const,
            fix: 'Move security.txt to .well-known/security.txt; the root location is only a legacy fallback.',
          },
        ]
      : []),
    ...contactFindings(fields.get('contact') ?? []),
    ...expiresFindings(fields.get('expires') ?? [], now),
  ];
  return problems.map((problem) => ({ ...problem, file }));
};
