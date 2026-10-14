import { existsSync, readFileSync } from 'node:fs';
import type { Finding } from '../core/types.ts';

type Rule = { allow: boolean; path: string };
type Groups = Map<string, Rule[]>;

export interface Robots {
  sitemaps: string[];
  blocked: string[];
  groups: Groups;
}

const FULL_BLOCKS = new Set(['/', '/*', '/*$']);

const isGooglebot = (agent: string) => agent === 'googlebot' || agent.startsWith('googlebot-');

export const robotsRules = (text: string): Robots => {
  const sitemaps: string[] = [];
  const blocked = new Set<string>();
  const groups: Groups = new Map();
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (key === 'sitemap') {
      sitemaps.push(value);
    } else if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value);
    } else {
      inRules = true;
      if (key === 'disallow' && FULL_BLOCKS.has(value)) {
        for (const agent of agents) blocked.add(agent);
      }
      if ((key === 'allow' || key === 'disallow') && value) {
        for (const agent of agents) {
          const name = agent.toLowerCase();
          groups.set(name, [...(groups.get(name) ?? []), { allow: key === 'allow', path: value }]);
        }
      }
    }
  }
  return { sitemaps, blocked: [...blocked], groups };
};

const ruleRegExp = (path: string) => {
  const source = path
    .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\$$/, '$$');
  return new RegExp(`^${source}`);
};

export const disallowedBy = (groups: Groups) => {
  const rules =
    groups.get('googlebot') ??
    [...groups].find(([agent]) => agent.startsWith('googlebot-'))?.[1] ??
    groups.get('*') ??
    [];
  const compiled = rules.map((rule) => ({ rule, test: ruleRegExp(rule.path) }));
  return (path: string) => {
    let best: { allow: boolean; length: number } | undefined;
    for (const { rule, test } of compiled) {
      if (!test.test(path)) continue;
      const length = rule.path.length;
      if (!best || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
    return best !== undefined && !best.allow;
  };
};

export const robotsDirectives = (value: string) => {
  const found: string[] = [];
  let scoped = false;
  for (const token of value.split(',')) {
    const match = /^\s*([a-z0-9_-]+)\s*:(.*)$/i.exec(token);
    let directive = token;
    if (match && !/^unavailable_after$/i.test(match[1] ?? '')) {
      scoped = !isGooglebot((match[1] ?? '').toLowerCase());
      directive = match[2] ?? '';
    }
    if (!scoped) found.push(directive.trim().toLowerCase());
  }
  return found;
};

export const readRobots = (file: string) =>
  existsSync(file) ? robotsRules(readFileSync(file, 'utf8')) : undefined;

export const robotsFindings = (
  robots: Robots | undefined,
  indexable: { path: string }[],
  file: string,
): Finding[] => {
  if (!robots) {
    return [
      {
        message: 'no robots.txt',
        severity: 'warn',
        fix: 'Add a robots.txt to the build output with a User-agent and Sitemap line, or turn seo.robots off.',
      },
    ];
  }
  const disallowed = disallowedBy(robots.groups);
  return [
    ...robots.blocked.map(
      (agent): Finding => ({
        message: `robots.txt disallows everything for User-agent: ${agent}`,
        ...(agent === '*' ? {} : { severity: 'warn' as const }),
        file,
        fix: `Remove the full "Disallow" rule (/ or /*) from the User-agent: ${agent} group in robots.txt so crawlers can index the site.`,
      }),
    ),
    ...indexable
      .filter(({ path }) => disallowed(path))
      .map(
        ({ path }): Finding => ({
          message: 'indexable page disallowed by robots.txt',
          severity: 'warn',
          where: [path],
          file,
          fix: 'Remove the matching Disallow rule from robots.txt, or add robots noindex and drop the page from the sitemap if it should stay out of search.',
        }),
      ),
    ...(robots.sitemaps.length
      ? []
      : [
          {
            message: 'robots.txt has no Sitemap line',
            severity: 'warn' as const,
            file,
            fix: 'Add a line like "Sitemap: https://example.com/sitemap.xml" to robots.txt.',
          },
        ]),
  ];
};
