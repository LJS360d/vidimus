import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  pages: { path: string; file: string }[];
  examples: string[];
}

const MAX_EXAMPLES = 3;

const baseConfig = (root: string, extendsPresets: string[]): ConfigData => {
  const file = join(root, '.htmlvalidate.json');
  if (!existsSync(file)) return { extends: extendsPresets };
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return isPlainObject(parsed) ? parsed : {};
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

const toFinding = ({ message, pages, examples }: Group): Finding => {
  const where = [...new Set(pages.map(({ path }) => path))];
  return {
    message: `${message.ruleId}: ${message.message}`,
    where,
    details: [...examples, ...(message.ruleUrl ? [message.ruleUrl] : [])],
    fix: fixFor(message),
    ...(where.length === 1 && pages[0] ? { file: pages[0].file } : {}),
    ...(message.severity === 1 ? { severity: 'warn' as const } : {}),
  };
};

export const html: Audit = {
  name: 'html',
  description: 'html-validate finds no HTML errors',
  requires: 'dist',
  async run({ config, root, renderedPages, importPeer }) {
    const { exclude, extends: extendsPresets, rules } = config.html;
    const pages = (await renderedPages(config.exclude)).filter(
      ({ path }) => !matchesAny(exclude, path),
    );
    if (pages.length === 0) return { status: 'skipped', summary: 'no built HTML pages' };

    const { HtmlValidate, StaticConfigLoader } =
      await importPeer<HtmlValidatePeer>('html-validate');
    const validator = new HtmlValidate(
      new StaticConfigLoader(withRules(baseConfig(root, extendsPresets), rules)),
    );
    const groups = new Map<string, Group>();

    for (const page of pages) {
      const report = await validator.validateString(page.html, page.file);
      for (const message of report.results.flatMap(({ messages }) => messages)) {
        const key = `${message.ruleId}\n${message.message}`;
        const group = groups.get(key) ?? { message, pages: [], examples: [] };
        group.pages.push({ path: page.path, file: page.file });
        if (group.examples.length < MAX_EXAMPLES) group.examples.push(location(page.path, message));
        groups.set(key, group);
      }
    }

    const findings = [...groups.values()].map(toFinding);
    return {
      summary: findings.length
        ? `${pages.length} pages, ${findings.length} distinct problem(s)`
        : `${pages.length} pages, valid`,
      findings,
    };
  },
};
