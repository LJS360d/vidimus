import type { VidimusConfig } from '../../config/types.ts';
import type { Finding, PageSource } from '../../core/types.ts';
import type { ImageSize } from '../image-size.ts';

export type Report = (finding: Finding, where?: string) => void;

export interface Env {
  pages: PageSource[];
  dist: string;
  siteUrl: string;
  options: VidimusConfig['assets'];
  measure: (file: string) => ImageSize | undefined;
}
