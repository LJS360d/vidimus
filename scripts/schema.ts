import { readFileSync, writeFileSync } from 'node:fs';
import { createGenerator } from 'ts-json-schema-generator';

type Schema = Record<string, unknown>;

const PARTIAL_DEFINITIONS = new Set(['Range', 'MotionOptions']);
const DROPPED_DEFINITIONS = new Set(['VidimusConfig', 'Audit', 'Reporter', 'RunInfo']);

const loosen = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(loosen);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'required')
      .map(([key, value]) => [key, loosen(value)]),
  );
};

const generated = createGenerator({
  path: 'src/config/types.ts',
  tsconfig: 'tsconfig.json',
  type: 'VidimusConfig',
  functions: 'hide',
  skipTypeCheck: true,
  additionalProperties: false,
}).createSchema('VidimusConfig');

const definitions = generated.definitions as Record<string, Schema>;
const { plugins: _plugins, ...properties } = (loosen(definitions.VidimusConfig) as Schema)
  .properties as Schema;

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'vidimus config',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    ...properties,
    reporters: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
  definitions: Object.fromEntries(
    Object.entries(definitions)
      .filter(([name]) => !DROPPED_DEFINITIONS.has(name))
      .map(([name, definition]) => [
        name,
        PARTIAL_DEFINITIONS.has(name) ? loosen(definition) : definition,
      ]),
  ),
};

const FILE = 'schema.json';
const content = `${JSON.stringify(schema, null, 2)}\n`;

if (process.argv.includes('--check')) {
  if (readFileSync(FILE, 'utf8') !== content) {
    console.error(`${FILE} is out of date. Run: pnpm run schema`);
    process.exitCode = 1;
  }
} else {
  writeFileSync(FILE, content);
}
