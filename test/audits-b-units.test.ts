import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { uniqueForms } from '../src/audits/forms/discover.ts';
import type { FormInfo } from '../src/audits/forms/probe.ts';
import type { Found } from '../src/audits/forms/types.ts';
import type { Change } from '../src/audits/shots/compare.ts';
import { changeFindings, missingBaselineFinding } from '../src/audits/shots/findings.ts';
import { groupFindings, memo } from '../src/audits/util.ts';

const form = (index: number): FormInfo => ({ index }) as FormInfo;
const found = (path: string, index: number, fingerprint: string, id: string): Found => ({
  url: `http://x${path}`,
  path,
  form: form(index),
  id,
  fingerprint,
});

describe('uniqueForms', () => {
  it('merges the same form across pages and keeps look-alikes on one page apart', () => {
    const list = uniqueForms([
      found('/b', 0, 'f1', 'newsletter'),
      found('/a', 0, 'f1', 'newsletter'),
      found('/a', 1, 'f1', 'newsletter'),
      found('/a', 2, 'f2', 'search'),
    ]);
    assert.deepEqual(
      list.map(({ id, pages, nth }) => ({ id, pages, nth })),
      [
        { id: 'newsletter', pages: ['/a', '/b'], nth: 0 },
        { id: 'newsletter~2', pages: ['/a'], nth: 1 },
        { id: 'search', pages: ['/a'], nth: 0 },
      ],
    );
  });
});

describe('groupFindings and memo', () => {
  it('merges locations per key and omits empty where', () => {
    const groups = groupFindings();
    groups.add({ message: 'm', fix: 'f' }, '/a', { key: 'k' });
    groups.add({ message: 'm', fix: 'f' }, '/b', { key: 'k' });
    groups.add({ message: 'global', fix: 'f' }, undefined, { key: 'g' });
    assert.deepEqual(groups.values(), [
      { message: 'm', fix: 'f', where: ['/a', '/b'] },
      { message: 'global', fix: 'f' },
    ]);
  });

  it('computes once per file', () => {
    let calls = 0;
    const size = memo((file) => {
      calls++;
      return file.length;
    });
    assert.equal(size('abc'), 3);
    assert.equal(size('abc'), 3);
    assert.equal(calls, 1);
  });
});

describe('shots findings', () => {
  const change = (over: Partial<Change>): Change => ({
    name: 'p@1x1',
    ratio: 0.001,
    percent: '0.10',
    changed: 5,
    maxDiff: 0.01,
    maxDiffPixels: 0,
    ...over,
  });

  it('keeps changes within the limits out and reports size changes', () => {
    assert.deepEqual(changeFindings([change({})], '.v'), []);
    const [size, over] = changeFindings(
      [
        change({ sizeChange: '1x1 -> 1x2' }),
        change({
          name: 'q@1x1',
          ratio: 0.5,
          percent: '50.00',
          changed: 50,
          region: 'x=0..1, y=0..1',
        }),
      ],
      '.v',
    );
    assert.match(size?.message ?? '', /size changed 1x1 -> 1x2/);
    assert.match(over?.message ?? '', /50.00% changed \(50 px\) > 1.00%/);
    assert.ok(over?.details?.includes('changed region x=0..1, y=0..1'));
  });

  it('says nothing was compared when every shot lacks a baseline', () => {
    assert.match(missingBaselineFinding(['a', 'b'], 2, '.b').message, /nothing was compared/);
    const some = missingBaselineFinding(['a'], 2, '.b');
    assert.equal(some.severity, 'warn');
    assert.deepEqual(some.details, ['a.png']);
  });
});
