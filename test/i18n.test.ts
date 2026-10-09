import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

describe('i18n key comparison', () => {
  it('ignores plural suffixes and compares array items', async () => {
    const cwd = fixture({
      'locales/en.json': JSON.stringify({
        item_one: 'item',
        item_other: 'items',
        tags: ['a', 'b', 'c'],
      }),
      'locales/ru.json': JSON.stringify({
        item_one: 'a',
        item_few: 'b',
        item_many: 'c',
        tags: ['x', 'y'],
      }),
      'vidimus.config.json': JSON.stringify({
        locales: ['en', 'ru'],
        defaultLocale: 'en',
        i18n: { files: 'locales/{locale}.json' },
      }),
    });
    const { results } = await run({ cwd, env: {}, audits: ['i18n'], reporters: [] });
    const findings = results[0]?.findings ?? [];
    assert.deepEqual(
      findings.map(({ message }) => message),
      ['ru: 1 missing key(s)'],
    );
    assert.deepEqual(findings[0]?.details, ['tags.2']);
    assert.ok(findings[0]?.fix);
  });

  it('warns on placeholder mismatches against the reference locale', async () => {
    const cwd = fixture({
      'locales/en.json': JSON.stringify({
        hi: 'Hi {name}',
        bye: 'Bye {{name}}',
        n_one: '{count, plural, one {# item} other {# items}}',
        n_other: '{count, plural, one {# item} other {# items}}',
        ok: 'Fine {a}',
      }),
      'locales/ru.json': JSON.stringify({
        hi: 'Salut',
        bye: 'Au revoir {{name}} {{extra}}',
        n_few: '{total, plural, other {#}}',
        ok: 'Bien {a}',
      }),
      'vidimus.config.json': JSON.stringify({
        locales: ['en', 'ru'],
        defaultLocale: 'en',
        i18n: { files: 'locales/{locale}.json' },
      }),
    });
    const { results } = await run({ cwd, env: {}, audits: ['i18n'], reporters: [] });
    const finding = results[0]?.findings.find(({ message }) => message.includes('placeholder'));
    assert.equal(finding?.severity, 'warn');
    assert.deepEqual(finding?.details, ['hi', 'bye', 'n_few']);
    assert.ok(finding?.fix);
  });
});

describe('i18n PO files', () => {
  it('reads gettext PO files, skipping header and fuzzy entries', async () => {
    const po = (extra: string) =>
      `msgid ""\nmsgstr ""\n"Language: x\\n"\n\nmsgid "hello"\nmsgstr "Hi"\n\n${extra}`;
    const cwd = fixture({
      'locales/en.po': po('msgid "bye"\nmsgstr "Bye"\n'),
      'locales/it.po': po('#, fuzzy\nmsgid "bye"\nmsgstr "Ciao"\n'),
      'vidimus.config.json': JSON.stringify({
        locales: ['en', 'it'],
        defaultLocale: 'en',
        i18n: { files: 'locales/{locale}.po' },
      }),
    });
    const { results } = await run({ cwd, env: {}, audits: ['i18n'], reporters: [] });
    const findings = results[0]?.findings ?? [];
    assert.deepEqual(
      findings.map(({ message }) => message),
      ['it: 1 missing key(s)'],
    );
    assert.deepEqual(findings[0]?.details, ['bye']);
  });
});
