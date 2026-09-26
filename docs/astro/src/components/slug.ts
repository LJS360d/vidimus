import { slugOf } from '../../../flavors.ts';

export const sourceOf = (filePath = '') => filePath.replace(/^(?:.*\/)?src\/content\/docs\//, '');

export const slugOfEntry = (filePath?: string) => slugOf(sourceOf(filePath));
