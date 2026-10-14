import type { Page } from '../../core/peer-types.ts';
import { alternatesFor, casesFor } from './cases.ts';
import { fill, layerInvalid, observe, scan, settled } from './page.ts';
import type { FieldInfo, Value } from './probe.ts';

const ROUNDS = 3;

// Find a baseline the form really accepts. Ticking boxes and picking options can reveal more
// fields, and undeclared rules can reject the generated values: fill, try alternatives for
// rejected fields, rescan, repeat. `known` collects the alternatives that worked.
export const findBaseline = async (
  page: Page,
  index: number,
  initial: FieldInfo[],
  configured: Record<string, string>,
  known: Record<string, Value>,
) => {
  let fields = initial;
  for (let round = 0; round < ROUNDS; round++) {
    await fill(page, index, casesFor(fields, configured, known).baseline);
    await settled(page);
    let states = await observe(page, index);
    for (const field of fields.filter((f) => f.usable && !(f.key in known))) {
      if (!layerInvalid(states[field.key])) continue;
      for (const value of alternatesFor(field)) {
        await fill(page, index, { [field.key]: value });
        await settled(page);
        states = await observe(page, index);
        if (layerInvalid(states[field.key])) continue;
        known[field.key] = value;
        break;
      }
    }
    const rescanned = (await scan(page))[index]?.fields ?? fields;
    const keys = new Set(fields.map((f) => f.key));
    const added = rescanned.filter((f) => !keys.has(f.key) && f.usable);
    if (!added.length) break;
    fields = [...fields, ...added];
  }
  return fields;
};
