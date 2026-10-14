import type { Pattern } from '../../config/types.ts';
import { matchesAny } from '../../core/util.ts';

type RequestKind = 'ignored' | 'first-party' | 'allowed' | 'third-party';

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export const matchesHost = (host: string, suffix: string) =>
  host === suffix || host.endsWith(`.${suffix}`);

export const firstPartyHostsOf = (...origins: string[]) =>
  new Set(origins.map(hostOf).filter(Boolean));

export const classifyRequest = (
  url: string,
  firstPartyHosts: Set<string>,
  allow: Pattern[],
): RequestKind => {
  if (!/^(https?|wss?):/i.test(url)) return 'ignored';
  if (firstPartyHosts.has(hostOf(url))) return 'first-party';
  if (matchesAny(allow, url)) return 'allowed';
  return 'third-party';
};

export const isFirstPartyCookie = (domain: string, firstPartyHosts: Set<string>) => {
  const bare = domain.replace(/^\./, '');
  return [...firstPartyHosts].some((host) => matchesHost(host, bare));
};
