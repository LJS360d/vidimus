import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../core/types.ts';

const YEAR = 366 * 24 * 60 * 60 * 1000;

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt]([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

// RFC 3339 §5.6/§5.7: hours 00-23, minutes 00-59, and the day must exist in its month.
const isRfc3339 = (value: string) => {
  const [, year, month, day] = RFC3339.exec(value) ?? [];
  if (!year) return false;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
};

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
    .filter((contact) => !/^(mailto:|tel:|https:\/\/)/i.test(contact))
    .map((contact) => ({
      message: `security.txt Contact "${contact}" is not a mailto:, tel: or https:// URI`,
      fix: 'Write the contact as a URI, e.g. "mailto:security@example.com" or "https://example.com/security".',
    }));
};

const isUtf8 = (bytes: Buffer) => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

const canonicalFindings = (text: string, canonical: string[]): Finding[] =>
  /^-----BEGIN PGP SIGNED MESSAGE-----/m.test(text) && !canonical.length
    ? [
        {
          message: 'signed security.txt has no Canonical field',
          severity: 'warn',
          fix: 'Add the URL the signed file is served from, e.g. "Canonical: https://example.com/.well-known/security.txt".',
        },
      ]
    : [];

const preferredLanguagesFindings = (languages: string[]): Finding[] =>
  languages.length > 1
    ? [
        {
          message: 'security.txt has more than one Preferred-Languages field',
          fix: 'Keep a single Preferred-Languages line listing all languages, e.g. "Preferred-Languages: en, de".',
        },
      ]
    : [];

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
  if (!isRfc3339(expiry) || Number.isNaN(time)) {
    return [
      {
        message: `security.txt Expires "${expiry}" is not an RFC 3339 date-time`,
        fix: 'Write Expires as an RFC 3339 date-time with a UTC or numeric offset, e.g. "Expires: 2027-01-01T00:00:00Z".',
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
  const bytes = readFileSync(file);
  const text = bytes.toString('utf8');
  const fields = securityTxtFields(text);
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
    ...(isUtf8(bytes)
      ? []
      : [
          {
            message: 'security.txt is not valid UTF-8',
            fix: 'Save security.txt as UTF-8 text, as RFC 9116 §4 requires.',
          },
        ]),
    ...contactFindings(fields.get('contact') ?? []),
    ...expiresFindings(fields.get('expires') ?? [], now),
    ...canonicalFindings(text, fields.get('canonical') ?? []),
    ...preferredLanguagesFindings(fields.get('preferred-languages') ?? []),
  ];
  return problems.map((problem) => ({ ...problem, file }));
};
