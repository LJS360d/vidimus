import type { Audit } from '../core/types.ts';
import { a11y } from './a11y.ts';
import { assets } from './assets.ts';
import { budget } from './budget.ts';
import { csp } from './csp.ts';
import { forms } from './forms/index.ts';
import { html } from './html.ts';
import { i18n } from './i18n.ts';
import { lighthouse } from './lighthouse.ts';
import { links } from './links.ts';
import { privacy } from './privacy.ts';
import { r12s } from './r12s.ts';
import { security } from './security.ts';
import { seo } from './seo.ts';
import { shots } from './shots.ts';

export const builtinAudits: Audit[] = [
  i18n,
  csp,
  a11y,
  links,
  r12s,
  seo,
  security,
  html,
  budget,
  assets,
  privacy,
  forms,
  shots,
  lighthouse,
];
