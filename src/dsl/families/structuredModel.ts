import { isErRelationToken } from '../../opencanvas/domain/connectors/presentation';
import type { CanonicalAttribute } from '../sceneMeta';
import { joinTokens } from '../segments';
import { isBareWords, quoted } from '../text';
import type { DslToken } from '../tokenize';

export type StructuredKind = 'erd' | 'class';

/** Child-to-parent relations; the parent goes first in layout. */
export const PARENT_FIRST = new Set(['--|>', '..|>']);
const CLASS_TOKENS = ['<|--', '--|>', '<|..', '..|>', '*--', '--*', 'o--', '--o', '..>', '<..', '<--', '-->', '<-->', '..', '--'] as const;
const ER_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries({
  '1:1': '||--||', '1:1..': '||..||', '1:n': '||--o{', 'n:1': '}o--||', 'n:m': '}o--o{', '1:n..': '||..o{', 'n:m..': '}o..o{',
  'one or one': '||--||', 'one or many': '||--o{', 'many or one': '}o--||', 'many or many': '}o--o{',
  'one to one': '||--||', 'one to many': '||--o{', 'many to one': '}o--||', 'many to many': '}o--o{',
}).map(([key, value]) => [key.replace(/\s+/g, ''), value]));
/** `customer 1:N invoice : owns` and `A one or many B` — cardinality words instead of glyphs. */
export function findCardinalityAlias(tokens: readonly DslToken[]): { before: DslToken[]; after: DslToken[]; token: string; label?: string } | null {
  for (let start = 1; start < tokens.length; start += 1) {
    for (let take = 1; take <= 4 && start + take <= tokens.length; take += 1) {
      const key = tokens.slice(start, start + take).map((token) => token.value).join('').toLowerCase();
      const token = ER_ALIASES[key];
      if (!token) continue;
      const before = tokens.slice(0, start);
      const rest = tokens.slice(start + take);
      const colon = rest.findIndex((entry) => entry.value === ':');
      const after = colon >= 0 ? rest.slice(0, colon) : rest;
      if (before.length === 0 || after.length === 0) return null;
      return { before, after, token, ...(colon >= 0 ? { label: joinTokens(rest.slice(colon + 1)) } : {}) };
    }
  }
  return null;
}
const ER_FLAGS: Readonly<Record<string, keyof ErFlags>> = {
  pk: 'isPrimaryKey', primary: 'isPrimaryKey', key: 'isPrimaryKey',
  fk: 'isForeignKey', foreign: 'isForeignKey',
  unique: 'isUnique', uq: 'isUnique',
  nullable: 'isNullable', null: 'isNullable', nn: 'isNotNull', 'not-null': 'isNotNull',
};
export const CLASS_STEREOTYPES = new Set(['interface', 'abstract', 'enum', 'class', 'entity']);

interface ErFlags { isPrimaryKey?: boolean; isForeignKey?: boolean; isUnique?: boolean; isNullable?: boolean; isNotNull?: boolean }

interface MemberDraft {
  /** Canonical row text, exactly as re-emitted. */
  text: string;
  /** ERD: structured field for the renderer. */
  field?: { name: string; dataType: string } & ErFlags;
  /** Class: `true` when the member holds a `(` (rendered in the methods compartment). */
  isMethod?: boolean;
  line: number;
}

export interface EntityDraft {
  id: string;
  label: string;
  line: number;
  members: MemberDraft[];
  attrs: CanonicalAttribute[];
  comments: string[];
  stereotype?: string;
  /** Class only: the source carried a `---` divider. */
  divider?: boolean;
  /** The group whose block declared it; null at the top level. */
  parentId: string | null;
}

/** `group Name { … }`: a box around the entities (and groups) declared inside it. */
export interface GroupDraft {
  id: string;
  label: string;
  parentId: string | null;
  line: number;
  attrs: CanonicalAttribute[];
  comments: string[];
}

export interface RelationDraft {
  id: string;
  from: string;
  to: string;
  token: string;
  label?: string;
  sourceCardinality?: string;
  targetCardinality?: string;
  line: number;
  attrs: CanonicalAttribute[];
  comments: string[];
}

export interface StructuredModel {
  entities: EntityDraft[];
  groups: GroupDraft[];
  relations: RelationDraft[];
  reserved: string[];
  dividers: Array<{ entity: string; line: number }>;
}

// Relation pieces start with structural punctuation; a bare `*` or `o` is a
// multiplicity marker, not part of the arrow. A quoted string is always a name.
export const isRelationPiece = (token: DslToken): boolean => token.kind === 'arrow' || (token.kind !== 'string' && /^[-<>|{}]/.test(token.value));
export const BARE_MULTIPLICITY = /^(?:\d+|\*)$/;
/**
 * `"1"`, `*`, `"one"` — UML multiplicity beside a relation arrow (any quoted text, a bare
 * number or `*`), read only while a name remains on that side: a lone `"store"` is the entity.
 */
export function cardinalityOf(side: readonly DslToken[], token: DslToken | undefined): string | undefined {
  if (side.length < 2 || !token) return undefined;
  return token.kind === 'string' || BARE_MULTIPLICITY.test(token.value) ? token.value : undefined;
}
/** `A, B --> C` and `A --> B --> C`: one relation per line (W112). A comma inside `Map<K,V>` is the name's. */
export function isChainOrFan(sides: readonly (readonly DslToken[])[]): boolean {
  return sides.some((side) => {
    let generic = 0;
    return side.some((token) => {
      if (token.kind === 'string') return false;
      if (token.kind === 'word') generic += (token.value.match(/</g)?.length ?? 0) - (token.value.match(/>/g)?.length ?? 0);
      return (token.value === ',' && generic <= 0) || isRelationPiece(token);
    });
  });
}
export const isDivider = (tokens: readonly DslToken[]): boolean => tokens.length > 0 && tokens.every((token) => /^-+$/.test(token.value));

export function parseErRow(tokens: readonly DslToken[], at: { line: number }): MemberDraft | undefined {
  const words = tokens.filter((token) => token.kind !== 'comment');
  if (words.length === 0) return undefined;
  const name = joinTokens([words[0]!]);
  const dataType = words[1] ? joinTokens([words[1]!]) : 'text';
  const flags: ErFlags = {};
  const rest = words.slice(2).map((token) => token.value.toLowerCase());
  rest.forEach((word, index) => {
    // SQL's two-word `not null` is one flag; its `null` must not read as nullable.
    if (word === 'not' && rest[index + 1] === 'null') flags.isNotNull = true;
    else if (word === 'null' && rest[index - 1] === 'not') return;
    else if (ER_FLAGS[word]) flags[ER_FLAGS[word]] = true;
  });
  const text = erRowText(name, dataType, flags);
  return { text, field: { name, dataType, ...flags }, line: at.line };
}

/** A row cell is one token: a value the lexer would split or read as syntax is quoted. */
function erCell(value: string): string {
  return isBareWords(value) && !value.includes(' ') ? value : quoted(value);
}

export function erRowText(name: string, dataType: string, flags: ErFlags): string {
  return `${erCell(name)} ${erCell(dataType)}${
    ['isPrimaryKey', 'isForeignKey', 'isUnique', 'isNotNull', 'isNullable']
      .map((key) => flags[key as keyof ErFlags] ? ` ${ER_FLAG_WORDS[key as keyof ErFlags]}` : '').join('')}`;
}

const ER_FLAG_WORDS: Readonly<Record<keyof ErFlags, string>> = {
  isPrimaryKey: 'pk', isForeignKey: 'fk', isUnique: 'unique', isNotNull: 'not-null', isNullable: 'nullable',
};

export function parseClassMember(tokens: readonly DslToken[], at: { line: number }): MemberDraft | undefined {
  const text = classMemberText(joinTokens(tokens.filter((token) => token.kind !== 'comment')));
  if (!text) return undefined;
  return { text, isMethod: text.includes('('), line: at.line };
}

/** `+id : int` → `+id: int`, `+go( ) : void` → `+go(): void` (grammar §8.6). */
function classMemberText(value: string): string {
  return value
    .replace(/^([+\-#~])\s+/, '$1')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s*\[\s*/g, '[')
    .replace(/\s*\]/g, ']')
    .trim();
}

/** Reversed relation forms: canonical token + whether the endpoints swap (grammar §8.6). */
const REVERSED_RELATIONS: Readonly<Record<string, string>> = {
  '<|--': '--|>', '<|..': '..|>', '<..': '..>', '<--': '-->', '--*': '*--', '--o': 'o--',
};

export function canonicalRelationToken(kind: StructuredKind, raw: string): string | undefined {
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  if (kind === 'erd') {
    // ERD has no arrow vocabulary: any plain arrow is an uncarded relation line.
    if (compact === '->' || compact === '-->' || compact === '<-' || compact === '<--') return '--';
  } else if (compact === '->') {
    return '-->';
  }
  if (kind === 'erd') {
    const candidate = ER_ALIASES[compact] ?? compact;
    return candidate === '--' || isErRelationToken(candidate) ? candidate : undefined;
  }
  // Reversed forms are canonicalized by swapping endpoints, not kept verbatim.
  const reversed = REVERSED_RELATIONS[compact];
  if (reversed) return `reverse:${reversed}`;
  return (CLASS_TOKENS as readonly string[]).includes(compact) ? compact : undefined;
}

