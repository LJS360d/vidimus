const LATIN1 = [
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg',
  'macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14',
  'frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave',
  'Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde',
  'Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute',
  'acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute',
  'icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave',
  'uacute ucirc uuml yacute thorn yuml',
]
  .join(' ')
  .split(' ');

const ENTITIES: Record<string, string> = {
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCodePoint(0xa0 + i)])),
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  OElig: 'Œ',
  oelig: 'œ',
  Scaron: 'Š',
  scaron: 'š',
  Yuml: 'Ÿ',
  fnof: 'ƒ',
  circ: 'ˆ',
  tilde: '˜',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  lrm: '\u200e',
  rlm: '\u200f',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  bull: '•',
  hellip: '…',
  permil: '‰',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  euro: '€',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  minus: '−',
  infin: '∞',
  ne: '≠',
  le: '≤',
  ge: '≥',
  hearts: '♥',
};

export const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]*);/gi, (entity, code: string) => {
    if (code[0] !== '#') {
      const name = Object.hasOwn(ENTITIES, code) ? code : code.toLowerCase();
      return (Object.hasOwn(ENTITIES, name) && ENTITIES[name]) || entity;
    }
    const point =
      code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
