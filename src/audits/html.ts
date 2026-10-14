import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPageCache } from '../core/cache.ts';
import { UsageError } from '../core/errors.ts';
import { type BuiltPage, tags } from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';
import { isPlainObject, matchesAny } from '../core/util.ts';

interface HtmlValidateMessage {
  ruleId: string;
  ruleUrl?: string;
  severity: number;
  message: string;
  line: number;
  column: number;
  selector: string | null;
}

interface HtmlValidateReport {
  results: { messages: HtmlValidateMessage[] }[];
}

type ConfigData = Record<string, unknown>;

interface HtmlValidatePeer {
  HtmlValidate: new (
    loader: unknown,
  ) => {
    validateString: (source: string, filename: string) => Promise<HtmlValidateReport>;
  };
  StaticConfigLoader: new (config: ConfigData) => unknown;
}

interface Group {
  message: HtmlValidateMessage;
  pages: { path: string; file: string; line?: number }[];
  examples: string[];
}

const MAX_EXAMPLES = 3;

const CONFIG_FILES = [
  '.htmlvalidate.json',
  '.htmlvalidate.js',
  '.htmlvalidate.cjs',
  '.htmlvalidate.mjs',
];

const baseConfig = async (root: string, extendsPresets: string[]): Promise<ConfigData> => {
  const name = CONFIG_FILES.find((candidate) => existsSync(join(root, candidate)));
  if (!name) return { extends: extendsPresets };
  const file = join(root, name);
  let loaded: unknown;
  try {
    if (name.endsWith('.json')) loaded = JSON.parse(readFileSync(file, 'utf8'));
    else {
      const mod = (await import(pathToFileURL(file).href)) as {
        default?: unknown;
      };
      loaded = mod.default ?? mod;
    }
  } catch (error) {
    throw new UsageError(`${file}: ${(error as Error).message}`);
  }
  if (!isPlainObject(loaded)) throw new UsageError(`${file}: must contain a config object`);
  return loaded;
};

const withRules = (base: ConfigData, rules: Record<string, unknown>): ConfigData => ({
  ...base,
  root: true,
  rules: { ...(isPlainObject(base.rules) ? base.rules : {}), ...rules },
});

const location = (path: string, message: HtmlValidateMessage) =>
  `${path}:${message.line}:${message.column}${message.selector ? ` ${message.selector}` : ''}`;

const RULE_FIXES: Record<string, string> = {
  'no-dup-id': 'Give each element a unique id (rename or remove the duplicate)',
  'close-order':
    'Close elements in the reverse order they were opened, e.g. <div><span></span></div>',
  'element-permitted-content':
    'Move the element into a parent that allows it (e.g. no <div> inside <p> or <a> inside <a>)',
  'element-permitted-order':
    'Reorder the children as the parent requires (e.g. <caption> first in <table>)',
  'attribute-allowed-values': 'Change the attribute to one of the values the rule allows',
  'no-deprecated-attr': 'Replace the deprecated attribute with CSS or its modern equivalent',
  'element-required-attributes': 'Add the attribute named in the message to the element',
  'void-style': 'Write void elements in the configured style, e.g. <br> instead of <br/>',
  'no-implicit-close': 'Close the element explicitly before its parent or next sibling',
  'no-raw-characters': 'Escape the character as an entity, e.g. &amp; for & and &lt; for <',
  'wcag/h37': 'Add an alt attribute to the <img> (alt="" if it is purely decorative)',
};

const fixFor = ({ ruleId, ruleUrl }: HtmlValidateMessage) => {
  const off = `set html.rules["${ruleId}"] to "off" if it is intended.`;
  const specific = RULE_FIXES[ruleId];
  if (specific) return `${specific}, or ${off}`;
  return ruleUrl
    ? `Fix the markup as described at ${ruleUrl}, or ${off}`
    : `Fix the markup as the message describes, or ${off}`;
};

const documentsOf = (page: BuiltPage) => [
  { source: page.html, label: page.path },
  ...(page.html.includes('srcdoc') ? tags(page.html, 'iframe') : []).flatMap(({ attrs }) =>
    attrs.srcdoc ? [{ source: attrs.srcdoc, label: `${page.path} <iframe srcdoc>` }] : [],
  ),
];

const toFinding = ({ message, pages, examples }: Group, rendered: boolean): Finding => {
  const where = [...new Set(pages.map(({ path }) => path))];
  return {
    message: `${message.ruleId}: ${message.message}`,
    where,
    details: [
      ...(rendered ? ['validated the rendered DOM, locations refer to its serialisation'] : []),
      ...examples,
      ...(message.ruleUrl ? [message.ruleUrl] : []),
    ],
    fix: fixFor(message),
    ...(where.length === 1 && pages[0]
      ? { file: pages[0].file, ...(rendered || !pages[0].line ? {} : { line: pages[0].line }) }
      : {}),
    ...(message.severity === 1 ? { severity: 'warn' as const } : {}),
  };
};

export const html: Audit = {
  name: 'html',
  description: 'html-validate finds no HTML errors',
  requires: 'dist',
  async run({ config, root, builtPages, renderedPages, importPeer }) {
    const { exclude, extends: extendsPresets, rules } = config.html;
    const rendered = config.html.source === 'rendered';
    const pages = (
      rendered ? await renderedPages(config.exclude) : builtPages(config.exclude)
    ).filter(({ path }) => !matchesAny(exclude, path));
    if (pages.length === 0) return { status: 'skipped', summary: 'no built HTML pages' };

    const { HtmlValidate, StaticConfigLoader } =
      await importPeer<HtmlValidatePeer>('html-validate');
    const base = await baseConfig(root, extendsPresets);
    const validator = new HtmlValidate(new StaticConfigLoader(withRules(base, rules)));
    const cache = createPageCache(config, 'html', { base, rules, extendsPresets });
    const groups = new Map<string, Group>();

    for (const page of pages) {
      const documents = documentsOf(page);
      for (const { source, label } of documents) {
        let messages = cache.get<HtmlValidateMessage[]>(source);
        if (!messages) {
          const report = await validator.validateString(source, page.file);
          messages = report.results.flatMap((result) => result.messages);
          cache.set(source, messages);
        }
        for (const message of messages) {
          const key = `${message.ruleId}\n${message.message}`;
          const group = groups.get(key) ?? { message, pages: [], examples: [] };
          group.pages.push({
            path: page.path,
            file: page.file,
            ...(label === page.path ? { line: message.line } : {}),
          });
          if (group.examples.length < MAX_EXAMPLES) group.examples.push(location(label, message));
          groups.set(key, group);
        }
      }
    }

    const findings = [...groups.values()].map((group) => toFinding(group, rendered));
    return {
      summary: findings.length
        ? `${pages.length} pages, ${findings.length} distinct problem(s)`
        : `${pages.length} pages, valid`,
      findings,
    };
  },
};
