import { LEGACY_ENTITY_NAMES, NAMED_ENTITIES } from './entity-table.ts';

const LEGACY = new Set<string>(LEGACY_ENTITY_NAMES);
// Only legacy names match without a semicolon, so a prefix longer than the longest one never
// matches: capping the scan keeps a long alphanumeric run after `&` linear, not quadratic.
const LONGEST_LEGACY = Math.max(...LEGACY_ENTITY_NAMES.map((name) => name.length));

const WINDOWS_1252: Record<number, number> = {
  128: 0x20ac,
  130: 0x201a,
  131: 0x0192,
  132: 0x201e,
  133: 0x2026,
  134: 0x2020,
  135: 0x2021,
  136: 0x02c6,
  137: 0x2030,
  138: 0x0160,
  139: 0x2039,
  140: 0x0152,
  142: 0x017d,
  145: 0x2018,
  146: 0x2019,
  147: 0x201c,
  148: 0x201d,
  149: 0x2022,
  150: 0x2013,
  151: 0x2014,
  152: 0x02dc,
  153: 0x2122,
  154: 0x0161,
  155: 0x203a,
  156: 0x0153,
  158: 0x017e,
  159: 0x0178,
};

const numericCodePoint = (point: number) => {
  if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return 0xfffd;
  return WINDOWS_1252[point] ?? point;
};

const namedEntity = (name: string, semicolon: boolean, next: string, inAttribute: boolean) => {
  if (semicolon && Object.hasOwn(NAMED_ENTITIES, name)) return NAMED_ENTITIES[name];
  for (let length = Math.min(name.length, LONGEST_LEGACY); length > 0; length--) {
    const prefix = name.slice(0, length);
    const value = NAMED_ENTITIES[prefix];
    if (!LEGACY.has(prefix) || value === undefined) continue;
    const following = length < name.length ? name.charAt(length) : semicolon ? ';' : next;
    if (inAttribute && /[=a-z\d]/i.test(following)) return undefined;
    return value + name.slice(length) + (semicolon ? ';' : '');
  }
  return undefined;
};

export const decodeEntities = (text: string, inAttribute = false) =>
  text.replace(
    // A numeric reference without its `;` still decodes (a parse error, not a literal).
    /&(?:(#x[\da-f]+|#\d+);?|([a-z][a-z\d]*)(;?))/gi,
    (
      entity,
      numeric: string | undefined,
      name: string | undefined,
      semicolon: string | undefined,
      offset: number,
      source: string,
    ) => {
      if (numeric !== undefined) {
        const point =
          numeric[1]?.toLowerCase() === 'x'
            ? Number.parseInt(numeric.slice(2), 16)
            : Number(numeric.slice(1));
        return String.fromCodePoint(numericCodePoint(point));
      }
      return (
        namedEntity(
          name ?? '',
          semicolon === ';',
          source[offset + entity.length] ?? '',
          inAttribute,
        ) ?? entity
      );
    },
  );
