import type { ElementKind } from '../../dsl/model/types';
import { DIRECTIONS } from '../../dsl/vocabulary';
import {
  KIND_BY_WORD, STRUCTURIZR_TYPES, type Declaration, type RulePart, type StStatement, type StToken,
} from './structurizrTypes';

/** Reads `workspace "Name" "Description" { }` / bare `model` / `views` headers. */
export function readStatements(text: string): StStatement[] {
  const roots: StStatement[] = [];
  const stack: StStatement[][] = [roots];
  let pending: StToken[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const flush = (opens: boolean): void => {
    if (pending.length === 0) return;
    const statement: StStatement = { tokens: pending, children: [], line: pending[0]!.line };
    stack.at(-1)!.push(statement);
    pending = [];
    if (opens) stack.push(statement.children);
  };
  let inComment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    let offset = 0;
    while (offset < line.length) {
      if (inComment) {
        const end = line.indexOf('*/', offset);
        if (end === -1) break;
        inComment = false;
        offset = end + 2;
        continue;
      }
      const char = line[offset]!;
      if (/\s/.test(char) || char === ',') {
        offset += 1;
        continue;
      }
      if (line.startsWith('/*', offset)) {
        inComment = true;
        offset += 2;
        continue;
      }
      if (line.startsWith('//', offset)) break;
      if (char === '#' && !/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/.test(line.slice(offset))) break;
      if (char === '"') {
        let value = '';
        let next = offset + 1;
        while (next < line.length && line[next] !== '"') {
          if (line[next] === '\\' && next + 1 < line.length) {
            value += line[next + 1] === 'n' ? '\n' : line[next + 1]!;
            next += 2;
            continue;
          }
          value += line[next]!;
          next += 1;
        }
        pending.push({ kind: 'string', value, line: index + 1 });
        offset = next + 1;
        continue;
      }
      if (char === '{') {
        if (pending.length > 0) flush(true);
        else {
          const previous = stack.at(-1)!.at(-1);
          if (previous) stack.push(previous.children);
        }
        offset += 1;
        continue;
      }
      if (char === '}') {
        flush(false);
        if (stack.length > 1) stack.pop();
        offset += 1;
        continue;
      }
      if (line.startsWith('->', offset)) {
        pending.push({ kind: 'word', value: '->', line: index + 1 });
        offset += 2;
        continue;
      }
      let end = offset;
      while (end < line.length) {
        const next = line[end]!;
        if (/\s/.test(next) || next === '{' || next === '}' || next === '"' || next === ',') break;
        if (line.startsWith('->', end)) break;
        end += 1;
      }
      if (end === offset) {
        offset += 1;
        continue;
      }
      pending.push({ kind: 'word', value: line.slice(offset, end), line: index + 1 });
      offset = end;
    }
    flush(false);
  }
  return roots;
}

export const VIEW_KEYWORDS: ReadonlySet<string> = new Set([
  'include', 'exclude', 'autolayout', 'title', 'description', 'animation', 'default', 'properties', 'perspectives',
]);
export const STYLE_KEYWORDS: ReadonlySet<string> = new Set([
  'shape', 'icon', 'width', 'height', 'background', 'color', 'colour', 'stroke', 'strokewidth', 'fontsize', 'border',
  'opacity', 'metadata', 'description', 'properties',
]);

/**
 * Structurizr statements may share a line (`include * exclude email autoLayout lr`): a statement that
 * starts with one of `keywords` ends where the next bare keyword begins. Quoted words never split.
 * Child blocks belong to the last piece.
 */
export function splitOnKeywords(statement: StStatement, keywords: ReadonlySet<string>): StStatement[] {
  if (!keywords.has(statement.tokens[0]?.value.toLowerCase() ?? '')) return [statement];
  const pieces: StStatement[] = [];
  let tokens: StToken[] = [];
  for (const token of statement.tokens) {
    if (tokens.length > 0 && token.kind === 'word' && keywords.has(token.value.toLowerCase())) {
      pieces.push({ tokens, children: [], line: tokens[0]!.line });
      tokens = [];
    }
    tokens.push(token);
  }
  pieces.push({ tokens, children: statement.children, line: tokens[0]!.line });
  return pieces;
}

/** Structurizr's own identifier derivation: "Spring PetClinic" → `springPetClinic`. */
export function derivedSid(name: string): string {
  return name.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((word, index) => (index === 0
      ? word.charAt(0).toLowerCase() + word.slice(1)
      : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('') || 'element';
}

export function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function splitTags(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

export function readDeclaration(tokens: readonly StToken[]): Declaration | null {
  let index = 0;
  let sid: string | undefined;
  if (tokens[1]?.value === '=' && tokens[0]?.kind === 'word') {
    sid = tokens[0]!.value;
    index = 2;
  }
  const kindWord = tokens[index]?.value.toLowerCase() ?? '';
  const kind = KIND_BY_WORD[kindWord];
  if (!kind) return null;
  index += 1;
  let name = '';
  if (tokens[index]?.kind === 'string') {
    name = tokens[index]!.value;
    index += 1;
  } else {
    const nameWords: string[] = [];
    while (index < tokens.length && tokens[index]!.kind === 'word') {
      nameWords.push(tokens[index]!.value);
      index += 1;
    }
    name = nameWords.join(' ');
  }
  if (!name) return null;
  const strings: string[] = [];
  for (; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'string') strings.push(token.value);
  }
  return { ...(sid ? { sid } : {}), kind, kindWord, name, strings };
}

/** Reads `<[from] -> to> [description] [technology] [tags]`; null when there is no arrow. */
export function readRelation(tokens: readonly StToken[]): { from: string | null; to: string; strings: string[] } | null {
  const head = tokens[1]?.value === '=' ? tokens.slice(2) : tokens;
  const arrow = head.findIndex((token) => token.value === '->');
  if (arrow < 0) return null;
  const left = head.slice(0, arrow);
  const from = left.length > 0 ? left.map((token) => token.value).join(' ') : null;
  const right = head.slice(arrow + 1);
  let to = '';
  const strings: string[] = [];
  if (right[0]?.kind === 'string') {
    to = right[0]!.value;
    for (let index = 1; index < right.length; index += 1) if (right[index]!.kind === 'string') strings.push(right[index]!.value);
  } else {
    const toWords: string[] = [];
    for (const token of right) {
      if (token.kind === 'string') {
        strings.push(token.value);
        continue;
      }
      if (strings.length === 0) toWords.push(token.value);
    }
    to = toWords.join(' ');
  }
  return to ? { from, to, strings } : null;
}

/** Person/softwareSystem carry `description, tags`; the rest `description, technology, tags`. */
export function positional(strings: readonly string[], kind: ElementKind): { desc?: string; tech?: string; tags: string[] } {
  const [first, second, third] = strings;
  const desc = first ? { desc: first } : {};
  if ((kind === 'person' || kind === 'system') && third === undefined) {
    return { ...desc, tags: splitTags(second) };
  }
  return { ...desc, ...(second ? { tech: second } : {}), tags: splitTags(third) };
}

export function isSafeWord(value: string): boolean {
  return /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*$/.test(value)
    && !(value.toLowerCase() in DIRECTIONS)
    && value.toLowerCase() !== 'of'
    && value.toLowerCase() !== 'in';
}

export function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function tagPredicate(value: string): string {
  return `tag is ${/\s|^(and|or)$/i.test(value) ? quoted(value) : `@${value}`}`;
}

export function classifyRuleAtom(atom: string): RulePart[] | null {
  const text = atom.trim();
  if (!text) return null;
  if (text === '*') return [{ kind: 'all' }];
  const type = /^element\.type==(.+)$/i.exec(text);
  if (type) {
    const kind = STRUCTURIZR_TYPES[type[1]!.trim().toLowerCase()];
    return kind ? [{ kind: 'where-kind', value: kind }] : null;
  }
  const tag = /^element\.tag==(.+)$/i.exec(text);
  if (tag) {
    const value = tag[1]!.trim().replace(/^["']|["']$/g, '').replace(/^@/, '').toLowerCase();
    return value ? [{ kind: 'where-tag', value }] : null;
  }
  const pair = /^->(.+)->$/.exec(text);
  if (pair) return [
    { kind: 'predecessors', ref: pair[1]!.trim() },
    { kind: 'successors', ref: pair[1]!.trim() },
  ];
  const incoming = /^->(.+)$/.exec(text);
  if (incoming) return [{ kind: 'predecessors', ref: incoming[1]!.trim() }];
  const outgoing = /^(.+)->$/.exec(text);
  if (outgoing) return [{ kind: 'successors', ref: outgoing[1]!.trim() }];
  const relation = /^(.+)->(.+)$/.exec(text);
  if (relation && relation[1]!.trim() !== '*' && relation[2]!.trim() !== '*') {
    return [{ kind: 'pair', from: relation[1]!.trim(), to: relation[2]!.trim() }];
  }
  if (/[=!()]/.test(text)) return null;
  const refs = text.split(/\s+/).filter(Boolean);
  return refs.length > 0 ? refs.map((ref) => (ref === '*' ? { kind: 'all' as const } : { kind: 'ref' as const, ref })) : null;
}
