import { MERMAID_NODE_ID_RE, MERMAID_NODE_ID_RE_SOURCE, labelText } from './mermaidParserNodes';

// The node reader lives in `mermaidParserNodes`; importers keep reading it from here.
export { labelText, parseNodeDeclaration, type RawNode } from './mermaidParserNodes';

export const SKIP_PATTERNS = [
  /^%%/,
  /^direction\s/i,
  /^accTitle\s/i,
  /^accDescr\s/i,
];

const LINK_STYLE_RE = /^linkStyle\s+([\d,\s]+)\s+(.+)$/i;
const CLASS_DEF_RE = /^classDef\s+([\w-]+)\s+(.+)$/i;
const STYLE_RE = new RegExp(`^style\\s+(${MERMAID_NODE_ID_RE_SOURCE})\\s+(.+)$`, 'i');
export { CLASS_DEF_RE, STYLE_RE };

export function parseClassAssignmentLine(
  line: string
): { nodeIds: string[]; classNames: string[] } | null {
  const trimmed = line.trim().replace(/;$/, '');
  const match = trimmed.match(/^class\s+(.+?)\s+([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)$/i);
  if (!match) return null;

  const nodeIds = match[1]
    .split(/\s*,\s*/)
    .map((value) => value.trim())
    .filter((value) => MERMAID_NODE_ID_RE.test(value));
  const classNames = match[2]
    .split(/\s*,\s*/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (nodeIds.length === 0 || classNames.length === 0) {
    return null;
  }

  return { nodeIds, classNames };
}

export function parseLinkStyleLine(
  line: string
): { indices: number[]; style: Record<string, string> } | null {
  const match = line.match(LINK_STYLE_RE);
  if (!match) return null;

  const indices = match[1]
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));

  const styleParts = match[2].replace(/;$/, '').split(',');
  const style: Record<string, string> = {};

  for (const part of styleParts) {
    const [key, value] = part.split(':').map((s) => s.trim());
    if (key && value) {
      style[key] = value;
    }
  }

  return { indices, style };
}

/** Quoted newlines become `\n`; the swallowed lines come back as blanks after the line, so line numbers hold. */
export function normalizeMultilineStrings(input: string): string {
  let result = '';
  let inQuote = false;
  let swallowed = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && input[i - 1] !== '\\') {
      inQuote = !inQuote;
    }

    if (!inQuote && char === '\n' && swallowed > 0) {
      result += '\n'.repeat(swallowed + 1);
      swallowed = 0;
    } else if (inQuote && char === '\n') {
      swallowed++;
      result += '\\n';
      let nextIndex = i + 1;
      while (nextIndex < input.length && (input[nextIndex] === ' ' || input[nextIndex] === '\t')) {
        nextIndex++;
      }
      i = nextIndex - 1;
    } else {
      result += char;
    }
  }

  return result;
}

/** Line by line: a pattern that crossed lines let a `%% ----` comment swallow the next statement. */
export function normalizeEdgeLabels(input: string): string {
  return input.split('\n').map((line) => (line.trim().startsWith('%%') ? line : normalizeLineEdgeLabels(line))).join('\n');
}

function normalizeLineEdgeLabels(line: string): string {
  let result = line;
  // Collapse extended arrows: ---> → -->, ====> → ==>, -..-> → -.->
  // Mermaid spec allows any number of repeated chars in the arrow body.
  // `(?<!=)` starts a run only at its first char, so a long `=====` or `-----` is scanned once, not once per char.
  result = result.replace(/(?<!=)={3,}>/g, '==>');
  result = result.replace(/(?<!-)-{3,}>/g, '-->');
  result = result.replace(/-\.{2,}->/g, '-.->');
  result = result.replace(/<-{3,}>/g, '<-->');
  result = result.replace(/<={3,}>/g, '<==>');
  result = result.replace(/<-\.{2,}->/g, '<-.->');
  // Inline-label arrow forms: == text ==> and -- text -->
  result = result.replace(/(?<!=)==(?![>])\s*(.+?)\s*==>/g, ' ==>|$1|');
  result = result.replace(/--(?![>-])\s*(.+?)\s*-->/g, ' -->|$1|');
  result = result.replace(/-\.\s*(.+?)\s*\.->/g, ' -.->|$1|');
  result = result.replace(/--(?![>-])\s*(.+?)\s*---/g, ' ---|$1|');
  return result;
}

// Order matters at each position: longer and marker forms before the plain ones they start with.
export const ARROW_PATTERNS = [
  '~~~',
  'o--o',
  'x--x',
  '<==>',
  '<-.->',
  '<-->',
  '<==',
  '<-.',
  '<--',
  '===>',
  '-.->',
  '--->',
  '-->',
  '===',
  '---o',
  '---x',
  '---',
  '==>',
  '-.-',
  '--o',
  '--x',
  '--',
];

function sanitizeEdgeEndpoint(raw: string): string {
  return raw.trim().replace(/;$/, '').trim();
}

function findArrowInLine(
  line: string
): { arrow: string; index: number } | null {
  let quoteChar: '"' | "'" | null = null;
  let pipeOpen = false;
  let squareDepth = 0;
  let roundDepth = 0;
  let curlyDepth = 0;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const previousChar = line[index - 1];

    if (quoteChar) {
      if (char === quoteChar && previousChar !== '\\') {
        quoteChar = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      continue;
    }

    if (char === '|') {
      pipeOpen = !pipeOpen;
      continue;
    }
    if (pipeOpen) {
      continue;
    }

    if (char === '[') {
      squareDepth += 1;
      continue;
    }
    if (char === ']') {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }
    if (char === '(') {
      roundDepth += 1;
      continue;
    }
    if (char === ')') {
      roundDepth = Math.max(0, roundDepth - 1);
      continue;
    }
    if (char === '{') {
      curlyDepth += 1;
      continue;
    }
    if (char === '}') {
      curlyDepth = Math.max(0, curlyDepth - 1);
      continue;
    }

    if (squareDepth > 0 || roundDepth > 0 || curlyDepth > 0) {
      continue;
    }

    for (const arrow of ARROW_PATTERNS) {
      if (line.startsWith(arrow, index)) {
        return { arrow, index };
      }
    }
  }

  return null;
}

function parseEdgeLabelSegment(
  line: string,
  startIndex: number
): { label: string; nextIndex: number } {
  let index = startIndex;
  while (index < line.length && /\s/.test(line[index])) {
    index += 1;
  }

  if (line[index] !== '|') {
    return { label: '', nextIndex: index };
  }

  let label = '';
  let quoteChar: '"' | "'" | null = null;
  index += 1;

  while (index < line.length) {
    const char = line[index];
    const previousChar = line[index - 1];

    if (quoteChar) {
      if (char === quoteChar && previousChar !== '\\') {
        quoteChar = null;
      } else {
        label += char;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      index += 1;
      continue;
    }

    if (char === '|') {
      return { label: label.trim(), nextIndex: index + 1 };
    }

    label += char;
    index += 1;
  }

  return { label: label.trim(), nextIndex: index };
}

function splitOnUnquotedAmpersand(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoteChar: string | null = null;
  let bracketDepth = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoteChar) {
      if (char === quoteChar && input[i - 1] !== '\\') quoteChar = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quoteChar = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '(' || char === '{') bracketDepth += 1;
    else if (char === ']' || char === ')' || char === '}') bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === '&' && bracketDepth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * A link statement as node groups and the links between them: `a --> b & c --> d` is
 * a→b, a→c, b→d, c→d. `&` splits a group only outside quotes and brackets, so a label
 * like "User & Auth" stays whole.
 */
export function parseEdgeLine(line: string): Array<{
  sourceRaw: string;
  targetRaw: string;
  label: string;
  arrowType: string;
}> {
  const groups: string[][] = [];
  const links: { arrow: string; label: string }[] = [];
  let remaining = line.trim();
  for (let match = findArrowInLine(remaining); match; match = findArrowInLine(remaining)) {
    groups.push(splitOnUnquotedAmpersand(remaining.slice(0, match.index)).map(sanitizeEdgeEndpoint).filter(Boolean));
    const { label, nextIndex } = parseEdgeLabelSegment(remaining, match.index + match.arrow.length);
    links.push({ arrow: match.arrow, label: labelText(label) });
    remaining = remaining.slice(nextIndex);
  }
  groups.push(splitOnUnquotedAmpersand(remaining).map(sanitizeEdgeEndpoint).filter(Boolean));
  // `A -->> B` leaves `> B`: no Mermaid id starts with arrow punctuation, so the line is not an edge.
  if (groups.some((group) => group.some((endpoint) => /^[<>=.~-]/.test(endpoint)))) return [];
  return links.flatMap(({ arrow, label }, index) => groups[index]!.flatMap((sourceRaw) =>
    groups[index + 1]!.map((targetRaw) => ({ sourceRaw, targetRaw, label, arrowType: arrow }))));
}

export function parseStyleString(styleStr: string): Record<string, string> {
  const styles: Record<string, string> = {};
  const parts = styleStr.split(',');

  for (const part of parts) {
    const [key, value] = part.split(':').map((s) => s.trim());
    if (key && value) {
      styles[key] = value.replace(/;$/, '');
    }
  }

  return styles;
}
