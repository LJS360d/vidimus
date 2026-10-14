import type { Finding } from '../../core/types.ts';
import type { Collected, Seen } from './collect.ts';
import {
  EMBED_FIX,
  FIRST_PARTY_COOKIE_FIX,
  HINT_FIX,
  knownEntry,
  knownService,
  REJECTED_FIX,
  requestFix,
  STORAGE_FIX,
  THIRD_PARTY_COOKIE_FIX,
} from './known.ts';

const STORAGE_LIST_CAP = 10;

const sorted = <T>(map: Map<string, T>) =>
  [...map.entries()].sort(([a], [b]) => a.localeCompare(b));

const whereOf = (where: Set<string>) => [...where].sort();

const hostFindings = (hosts: Collected['hosts'], embeds: Set<string>): Finding[] =>
  sorted(hosts).map(([host, { where, examples }]) => {
    const label = knownService(host);
    const embedded = embeds.has(host);
    return {
      message: `third-party ${embedded ? 'embed from' : 'request to'} ${host}`,
      details: [
        ...(embedded ? ['loaded in an <iframe> on page load'] : []),
        ...(label ? [label] : []),
        ...examples,
      ],
      where: whereOf(where),
      fix: embedded && !knownEntry(host) ? EMBED_FIX : requestFix(host),
    };
  });

const hintFindings = (hints: Map<string, Seen>): Finding[] =>
  sorted(hints).map(([host, { where, examples }]) => {
    const label = knownService(host);
    return {
      message: `third-party resource hint to ${host}`,
      details: [...(label ? [label] : []), ...examples],
      where: whereOf(where),
      severity: 'warn',
      fix: HINT_FIX,
    };
  });

const cookieFindings = (jar: Collected['cookieJar']): Finding[] =>
  sorted(jar).map(([key, { where, firstParty }]) => ({
    message: `cookie ${key}`,
    where: whereOf(where),
    ...(firstParty && { severity: 'warn' as const }),
    fix: firstParty ? FIRST_PARTY_COOKIE_FIX : THIRD_PARTY_COOKIE_FIX,
  }));

const storageFindings = (jar: Collected['storageJar']): Finding[] =>
  sorted(jar).map(([kind, { names, where }]) => {
    const list = [...names].sort();
    const extra = list.length - STORAGE_LIST_CAP;
    return {
      message: `${kind} written on load`,
      details: [...list.slice(0, STORAGE_LIST_CAP), ...(extra > 0 ? [`and ${extra} more`] : [])],
      where: whereOf(where),
      severity: 'warn',
      fix: STORAGE_FIX,
    };
  });

const rejectedFindings = (rejected: Collected['rejected'], selector: string): Finding[] => [
  ...sorted(rejected.hosts).map(([host, { where, examples }]) => ({
    message: `third-party request to ${host} after rejecting consent`,
    details: [...examples],
    where: whereOf(where),
    fix: `Make the reject button (${selector}) stop every request to ${host}: load it only after the visitor accepts.`,
  })),
  ...sorted(rejected.cookies).map(([key, { where }]) => ({
    message: `cookie ${key} still set after rejecting consent`,
    where: whereOf(where),
    fix: REJECTED_FIX,
  })),
  ...sorted(rejected.storage).map(([kind, { where, examples }]) => ({
    message: `${kind} still present after rejecting consent`,
    details: [...examples],
    where: whereOf(where),
    fix: REJECTED_FIX,
  })),
  ...(rejected.missing.size
    ? [
        {
          message: `reject button not found: ${selector}`,
          where: whereOf(rejected.missing),
          severity: 'warn' as const,
          fix: 'Fix privacy.rejectSelector so it matches the reject button of your consent banner on these pages, or clear it to skip the check.',
        },
      ]
    : []),
];

export const privacyFindings = (c: Collected, rejectSelector: string): Finding[] => [
  ...hostFindings(c.hosts, c.embeds),
  ...hintFindings(c.hints),
  ...cookieFindings(c.cookieJar),
  ...storageFindings(c.storageJar),
  ...rejectedFindings(c.rejected, rejectSelector),
  ...c.failed,
];

export const privacySummary = (c: Collected, pages: number) => {
  const failures = c.failed.length ? `, ${c.failed.length} failed to load` : '';
  const { rejected } = c;
  const clean =
    !rejected.hosts.size &&
    !rejected.cookies.size &&
    !rejected.storage.size &&
    !c.hosts.size &&
    !c.hints.size &&
    !c.cookieJar.size &&
    !c.storageJar.size;
  if (clean) return `${pages} pages, no third-party requests, cookies or storage writes${failures}`;
  const storage = c.storageJar.size ? `, ${c.storageJar.size} storage kind(s)` : '';
  const hints = c.hints.size ? `, ${c.hints.size} resource hint host(s)` : '';
  return `${pages} pages, ${c.hosts.size} third-party host(s), ${c.cookieJar.size} cookie(s)${storage}${hints}${failures}`;
};
