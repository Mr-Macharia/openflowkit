// A small XML reader for imported diagram files (draw.io). No DOMParser, so it
// runs the same in a worker, in Node and in tests. It reads elements,
// attributes and text; comments, processing instructions and DOCTYPE are skipped.
// ponytail: no namespaces or DTD entities — enough for mxfile; add them if a format needs them.

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  readonly text: string;
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** `&amp;` `&#10;` `&#x41;` → their characters; an unknown entity stays as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) attributes[match[1]!] = decodeEntities(match[2] ?? match[3] ?? '');
  return attributes;
}

interface Building {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

/** The document's root element, or an error saying where reading stopped. */
export function parseXml(source: string): { readonly root: XmlElement } | { readonly error: string } {
  const stack: Building[] = [{ name: '', attributes: {}, children: [], text: '' }];
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf('<', at);
    const textEnd = open === -1 ? source.length : open;
    if (textEnd > at) stack[stack.length - 1]!.text += decodeEntities(source.slice(at, textEnd));
    if (open === -1) break;
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end === -1) return { error: 'A comment is never closed' };
      at = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end === -1) return { error: 'A CDATA section is never closed' };
      stack[stack.length - 1]!.text += source.slice(open + 9, end);
      at = end + 3;
      continue;
    }
    if (source[open + 1] === '?' || source[open + 1] === '!') {
      const end = source.indexOf('>', open);
      if (end === -1) return { error: 'A declaration is never closed' };
      at = end + 1;
      continue;
    }
    const close = findTagEnd(source, open);
    if (close === -1) return { error: 'A tag is never closed' };
    const tag = source.slice(open + 1, close);
    at = close + 1;
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      const element = stack.pop();
      if (!element || stack.length === 0 || element.name !== name) return { error: `</${name}> closes nothing open` };
      stack[stack.length - 1]!.children.push(element);
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const name = /^[^\s/>]+/.exec(body)?.[0];
    if (!name) return { error: 'A tag has no name' };
    const element: Building = { name, attributes: readAttributes(body.slice(name.length)), children: [], text: '' };
    if (selfClosing) stack[stack.length - 1]!.children.push(element);
    else stack.push(element);
  }
  if (stack.length !== 1) return { error: `<${stack[stack.length - 1]!.name}> is never closed` };
  const root = stack[0]!.children[0];
  return root ? { root } : { error: 'There is no XML element in it' };
}

/** Where the tag opened at `open` ends: its `>`, skipping any `>` inside a quoted attribute value. */
function findTagEnd(source: string, open: number): number {
  let quote: string | null = null;
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  return -1;
}
