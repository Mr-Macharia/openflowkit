

// ---------- reading ----------

export type Op = '->' | '<-' | '<->' | '--';

export interface Item {
  /** One or more key paths; several when the statement is a connection chain. */
  readonly paths: readonly (readonly string[])[];
  readonly ops: readonly Op[];
  readonly value?: string;
  readonly block?: readonly Item[];
  readonly line: number;
}

/** Marks a quoted key segment: `"label"` is a name, never the `label` keyword. */
const QUOTED = '\uE001';
export const plain = (segment: string) => segment.replace(QUOTED, '');

const MAX_DEPTH = 200;

export class Reader {
  private index = 0;
  private depth = 0;
  line = 1;
  /** What the reader had to guess at, reported as losses. */
  readonly problems: { line: number; message: string }[] = [];

  constructor(private readonly text: string) {}

  private peek(offset = 0): string {
    return this.text[this.index + offset] ?? '';
  }

  private skipSpace(newlines: boolean): void {
    for (;;) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\r') this.index++;
      else if (char === '\\' && this.peek(1) === '\n') { this.index += 2; this.line++; }
      else if (newlines && (char === '\n' || char === ';')) { if (char === '\n') this.line++; this.index++; }
      else if (char === '#') { while (this.peek() && this.peek() !== '\n') this.index++; }
      else return;
    }
  }

  private arrowAt(): Op | null {
    const rest = this.text.slice(this.index, this.index + 3);
    if (rest.startsWith('<->')) return '<->';
    if (rest.startsWith('->')) return '->';
    if (rest.startsWith('<-')) return '<-';
    if (rest.startsWith('--')) return '--';
    return null;
  }

  private quoted(): string {
    const close = this.peek();
    this.index++;
    let value = '';
    while (this.peek() && this.peek() !== close) {
      if (this.peek() === '\\' && this.peek(1)) {
        value += this.peek(1) === 'n' ? '\n' : this.peek(1);
        this.index += 2;
        continue;
      }
      if (this.peek() === '\n') {
        // An unclosed quote ends with its line; the rest of the file stays readable.
        this.problems.push({ line: this.line, message: 'unclosed quote ended at the end of its line' });
        return value;
      }
      value += this.peek();
      this.index++;
    }
    this.index++;
    return value;
  }

  /** A key path: dot-separated segments, unquoted ones may hold spaces (`im a parent.child`). */
  private path(): string[] {
    const segments: string[] = [];
    let current = '';
    for (;;) {
      this.skipSpace(false);
      const char = this.peek();
      // A quote opens a string only at the start of a segment: `Bob's laptop` is a name.
      if ((char === '"' || char === "'") && current.trim() === '') { current = QUOTED + this.quoted(); continue; }
      if (!char || ':{};\n#}'.includes(char) || this.arrowAt()) break;
      if (char === '.') { segments.push(current.trim()); current = ''; this.index++; continue; }
      current += char;
      this.index++;
      // Keep inner spaces, drop the trailing ones before a delimiter.
      while (this.peek() === ' ' || this.peek() === '\t') {
        const after = this.text.slice(this.index).match(/^[ \t]+(.)/)?.[1] ?? '';
        if (!after || ':{};\n#.'.includes(after) || this.text.slice(this.index).trimStart().match(/^(<->|->|<-|--)/)) break;
        current += this.peek();
        this.index++;
      }
    }
    if (current.trim() || segments.length) segments.push(current.trim());
    return segments;
  }

  /** A value: quoted, a `|md … |` block string, or the rest of the statement. */
  private value(): string {
    this.skipSpace(false);
    const char = this.peek();
    if (char === '"' || char === "'") return this.quoted();
    if (char === '|') {
      const pipes = /^\|+/.exec(this.text.slice(this.index))![0];
      const open = /^\|+[^\s|]*/.exec(this.text.slice(this.index))![0];
      this.index += open.length;
      const end = this.text.indexOf(pipes, this.index);
      const body = end === -1 ? this.text.slice(this.index) : this.text.slice(this.index, end);
      this.line += (body.match(/\n/g) ?? []).length;
      this.index = end === -1 ? this.text.length : end + pipes.length;
      // A private-use mark tags block strings (`|md … |`) so the converter can flatten them.
      return `\uE000${body}`;
    }
    let value = '';
    while (this.peek() && !'{};\n'.includes(this.peek()) && !(this.peek() === '#' && /\s$/.test(value))) {
      if (this.peek() === '\\' && this.peek(1) === 'n') { value += '\n'; this.index += 2; continue; }
      value += this.peek();
      this.index++;
    }
    return value.trim();
  }

  private skipBlock(): void {
    for (let depth = 1; this.peek() && depth > 0; this.index++) {
      if (this.peek() === '{') depth++;
      else if (this.peek() === '}') depth--;
      else if (this.peek() === '\n') this.line++;
    }
  }

  items(): Item[] {
    const items: Item[] = [];
    for (;;) {
      this.skipSpace(true);
      const char = this.peek();
      if (!char) return items;
      if (char === '}') { this.index++; return items; }
      const line = this.line;
      if (char === '(') {
        // `(a -> b)[0].style.stroke: red` styles an existing connection; read it whole, report it.
        const end = this.text.indexOf('\n', this.index);
        const raw = this.text.slice(this.index, end === -1 ? this.text.length : end);
        this.index = end === -1 ? this.text.length : end;
        if (raw.trimEnd().endsWith('{')) this.skipBlock();
        items.push({ paths: [[raw]], ops: [], line });
        continue;
      }
      const paths = [this.path()];
      const ops: Op[] = [];
      for (;;) {
        this.skipSpace(false);
        const op = this.arrowAt();
        if (!op) break;
        this.index += op.length;
        ops.push(op);
        paths.push(this.path());
      }
      let value: string | undefined;
      this.skipSpace(false);
      if (this.peek() === ':') {
        this.index++;
        value = this.value();
        this.skipSpace(false);
      }
      let block: Item[] | undefined;
      if (this.peek() === '{') {
        this.index++;
        if (++this.depth > MAX_DEPTH) throw new RangeError(`Nested more than ${MAX_DEPTH} levels deep`);
        block = this.items();
        this.depth--;
      }
      if (paths[0]!.length === 0 && !value && !block) {
        // Not a statement we can read; skip the rest of the line.
        while (this.peek() && this.peek() !== '\n') this.index++;
        continue;
      }
      items.push({ paths, ops, line, ...(value !== undefined ? { value } : {}), ...(block ? { block } : {}) });
    }
  }
}
