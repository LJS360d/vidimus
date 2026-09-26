import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadFailureFix as a11yLoadFix, issueFix, techniqueUrl } from '../src/audits/a11y.ts';
import { loadFailureFix as lighthouseLoadFix, scoreFix } from '../src/audits/lighthouse.ts';
import { brokenLinkFix } from '../src/audits/links.ts';
import { defectFix } from '../src/audits/r12s.ts';
import { changedShotFix } from '../src/audits/shots.ts';

const techniques = 'https://www.w3.org/WAI/WCAG21/Techniques';

describe('a11y fixes', () => {
  it('links pa11y codes to their WCAG technique', () => {
    assert.equal(
      techniqueUrl('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail'),
      `${techniques}/general/G18`,
    );
    assert.equal(
      techniqueUrl('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'),
      `${techniques}/html/H37`,
    );
    assert.equal(
      techniqueUrl('WCAG2AA.Principle1.Guideline1_3.1_3_1.F68'),
      `${techniques}/failures/F68`,
    );
    assert.equal(
      techniqueUrl('WCAG2AA.Principle4.Guideline4_1.4_1_2.ARIA6'),
      `${techniques}/aria/ARIA6`,
    );
    assert.equal(
      techniqueUrl('WCAG2AA.Principle1.Guideline1_3.1_3_1.H44,H65'),
      `${techniques}/html/H44`,
    );
    assert.equal(techniqueUrl('WCAG2AA.Principle1'), undefined);
  });

  it('points at the technique or a11y.ignore', () => {
    assert.equal(
      issueFix('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail'),
      `Apply ${techniques}/general/G18 to the element listed, or add the code to a11y.ignore if it is a false positive.`,
    );
    assert.match(issueFix('custom-rule'), /^Fix the element listed, .*a11y\.ignore/);
    assert.match(a11yLoadFix(60_000), /a11y\.timeout \(now 60000ms\).*a11y\.exclude/);
  });
});

describe('links fixes', () => {
  it('depends on the status', () => {
    assert.match(brokenLinkFix(404), /^Fix or remove the link.*links\.skip/);
    assert.equal(brokenLinkFix(410), brokenLinkFix(404));
    assert.match(brokenLinkFix(403), /blocks bots.*links\.skip/);
    for (const status of [500, 503, undefined, 0]) {
      assert.match(brokenLinkFix(status), /links\.timeout.*links\.retry.*links\.skip/);
    }
  });
});

describe('r12s fixes', () => {
  const fix = (rule: string, detail = '') => defectFix({ rule, detail }, 24, 12);

  it('gives one per rule', () => {
    assert.match(fix('overflow'), /widest element.*max-width:100%.*overflow-wrap:anywhere/);
    assert.match(fix('target-size'), /at least 24x24px/);
    assert.match(fix('font-size'), /at least 12px/);
    assert.match(
      fix('viewport', 'no viewport meta: the page renders at desktop width on phones'),
      /<meta name="viewport" content="width=device-width, initial-scale=1">/,
    );
    assert.match(
      fix('viewport', 'pinch zoom is disabled: "user-scalable=no"'),
      /user-scalable=no.*maximum-scale/,
    );
  });
});

describe('shots and lighthouse fixes', () => {
  it('point at the written reports', () => {
    assert.equal(
      changedShotFix('.vidimus/shots/diff.html'),
      'Open .vidimus/shots/diff.html to review; if the change is intended, run vidimus shots --update-baseline.',
    );
    assert.match(
      scoreFix('.vidimus/lighthouse/index.html', 'seo'),
      /^Open \.vidimus\/lighthouse\/index\.html .*lighthouse\.thresholds\.seo/,
    );
    assert.match(lighthouseLoadFix('/about/', false), /\/about\/.*lighthouse\.exclude/);
    assert.match(lighthouseLoadFix('/about/', true), /lighthouse\.urls/);
  });
});
