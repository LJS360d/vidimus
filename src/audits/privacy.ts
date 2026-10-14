import type { Audit } from '../core/types.ts';
import { inParallel, onePagePerTemplate, pathOf } from '../core/util.ts';
import { newCollected, visitPage } from './privacy/collect.ts';
import { privacyFindings, privacySummary } from './privacy/findings.ts';
import { firstPartyHostsOf } from './privacy/hosts.ts';

export const privacy: Audit = {
  name: 'privacy',
  description: 'no third-party requests or cookies on page load',
  requires: 'server',
  async run({ config, origin, pageUrls, launchBrowser }) {
    const { exclude, sample, allLocales, concurrency, rejectSelector } = config.privacy;
    const urls = onePagePerTemplate(
      pageUrls({ exclude, allLocales: allLocales || config.allLocales }),
      sample,
      origin,
    );
    const firstParty = firstPartyHostsOf(origin, config.siteUrl);
    const collected = newCollected();
    const browser = await launchBrowser();
    try {
      await inParallel(concurrency, urls, (url) =>
        visitPage(browser, config, firstParty, collected, url, pathOf(url, origin)),
      );
    } finally {
      await browser.close();
    }
    return {
      summary: privacySummary(collected, urls.length),
      findings: privacyFindings(collected, rejectSelector),
    };
  },
};
