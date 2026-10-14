import { slugifyDslId } from '../../dsl/text';
import { canonicalColorWord, isHexColor } from '../../dsl/vocabulary';
import { plain, type Item, type Op } from './d2Reader';

// ---------- model ----------

export interface D2Node {
  readonly path: string;
  readonly key: string;
  readonly parent: string | null;
  label?: string;
  shape?: string;
  color?: string;
  icon?: string;
  link?: string;
  width?: string;
  height?: string;
  shadow?: boolean;
  rows: { name: string; type: string; constraints: string[] }[];
  readonly line: number;
}

export interface D2Edge {
  from: string;
  to: string;
  readonly op: Op;
  label?: string;
  dashed?: boolean;
  thick?: boolean;
  flow?: boolean;
  head?: string;
  tail?: string;
  readonly line: number;
}

const RESERVED = new Set([
  'shape', 'label', 'icon', 'link', 'tooltip', 'near', 'width', 'height', 'style', 'class', 'classes', 'vars',
  'direction', 'constraint', 'source-arrowhead', 'target-arrowhead', 'layers', 'scenarios', 'steps', 'top',
  'left', 'grid-rows', 'grid-columns', 'grid-gap', 'vertical-gap', 'horizontal-gap', 'filled', 'tall',
]);

const SHAPES: Readonly<Record<string, string | null>> = {
  rectangle: '', square: '', page: 'doc', document: 'doc', parallelogram: 'parallelogram', cylinder: 'cylinder',
  stored_data: 'cylinder', queue: 'queue', package: 'component', person: 'person', 'c4-person': 'person',
  diamond: 'diamond', oval: 'ellipse', circle: 'circle', hexagon: 'hexagon', cloud: 'cloud', callout: 'note',
  image: '', step: null, text: null, code: null, class: null,
};

const ICON_HOSTS = /^https?:\/\/icons\.(?:terrastruct\.com|d2lang\.com)\/(aws|azure|gcp|dev|tech)(?:%2F|\/)(.+)$/i;

const HEADS: Readonly<Record<string, string>> = { arrow: 'arrow', triangle: 'arrow', circle: 'circle', none: 'none' };

export class Converter {
  readonly nodes = new Map<string, D2Node>();
  readonly edges: D2Edge[] = [];
  private readonly classes = new Map<string, readonly Item[]>();
  private readonly losses = new Map<string, number>();
  /** Sequence-diagram groups: top-level boxes whose lines name the diagram's actors. */
  readonly groups = new Set<string>();
  direction?: string;
  sequence = false;

  loss(line: number, message: string): void {
    if (!this.losses.has(message)) this.losses.set(message, line);
  }

  lossList(): { message: string; line: number }[] {
    return [...this.losses].map(([message, line]) => ({ message, line }));
  }

  /** `_` climbs out of the scope; everything else is relative to it. */
  /** Null when `_` climbs above the diagram. */
  private resolve(scope: readonly string[], segments: readonly string[]): string[] | null {
    const path = [...scope];
    for (const segment of segments) {
      if (segment !== '_') path.push(plain(segment));
      else if (path.pop() === undefined) return null;
    }
    return path;
  }

  private ensure(path: readonly string[], line: number): D2Node | null {
    if (path.length === 0) return null;
    let parent: string | null = null;
    let node: D2Node | null = null;
    for (let depth = 1; depth <= path.length; depth++) {
      const key = path.slice(0, depth).join('.');
      node = this.nodes.get(key) ?? null;
      if (!node) {
        node = { path: key, key: path[depth - 1]!, parent, rows: [], line };
        this.nodes.set(key, node);
      }
      parent = key;
    }
    return node;
  }

  walk(items: readonly Item[], scope: readonly string[]): void {
    for (const item of items) {
      if (item.ops.length > 0) this.connection(item, scope);
      else this.statement(item, scope);
    }
  }

  private connection(item: Item, scope: readonly string[]): void {
    if (item.paths.some((path) => path.some((segment) => segment.includes('*')))) {
      this.loss(item.line, 'glob connections dropped');
      return;
    }
    const resolved = item.paths.map((path) => this.resolve(scope, path));
    if (resolved.some((end) => !end || end.length === 0)) {
      this.loss(item.line, '`_` above the diagram; connection dropped');
      return;
    }
    const ends = resolved as string[][];
    for (const end of ends) this.ensure(end, item.line);
    for (let index = 0; index < item.ops.length; index++) {
      const edge: D2Edge = { from: ends[index]!.join('.'), to: ends[index + 1]!.join('.'), op: item.ops[index]!, line: item.line };
      if (item.value) edge.label = item.value.startsWith('\uE000') ? markdownLabel(item.value) : item.value.trim();
      if (item.block) this.edgeBlock(edge, item.block);
      this.edges.push(edge);
    }
  }

  /**
   * After the walk, when every shape is known: `objects.disk` on a `sql_table` names a
   * column, so the connection relates the tables and the column becomes a row.
   */
  finishTables(): void {
    const tableOf = (path: string, line: number): string => {
      const segments = path.split('.');
      for (let depth = 1; depth < segments.length; depth++) {
        const table = segments.slice(0, depth).join('.');
        if (this.nodes.get(table)?.shape === 'sql_table') {
          this.loss(line, 'column-level connections drawn table to table');
          return table;
        }
      }
      return path;
    };
    for (const edge of this.edges) {
      edge.from = tableOf(edge.from, edge.line);
      edge.to = tableOf(edge.to, edge.line);
    }
    for (const node of [...this.nodes.values()]) {
      const table = node.parent ? this.nodes.get(node.parent) : undefined;
      if (table?.shape !== 'sql_table') continue;
      if (!table.rows.some((row) => row.name === node.key)) table.rows.push({ name: node.key, type: '', constraints: [] });
      this.nodes.delete(node.path);
    }
  }

  /** In a sequence diagram, a top-level box holding messages or notes is a group of the same actors. */
  private isSequenceGroup(path: readonly string[], node: D2Node, block: readonly Item[]): boolean {
    return this.sequence && path.length === 1 && node.shape !== 'sequence_diagram'
      && block.some((child) => child.ops.length > 0 || !RESERVED.has((child.paths[0]?.[0] ?? '').toLowerCase()));
  }

  private edgeBlock(edge: D2Edge, block: readonly Item[]): void {
    for (const entry of block) {
      const [first, ...rest] = entry.paths[0] ?? [];
      const key = [first, ...rest].join('.');
      if (key === 'label') edge.label = entry.value ?? edge.label;
      else if (key === 'style.stroke-dash') edge.dashed = Number(entry.value) > 0;
      else if (key === 'style.animated') edge.flow = entry.value === 'true';
      else if (key === 'style.stroke-width') edge.thick = Number(entry.value) >= 3;
      else if (key === 'style' && entry.block) this.edgeBlock(edge, entry.block.map((child) => ({ ...child, paths: [['style', ...child.paths[0]!]] })));
      else if (first === 'source-arrowhead' || first === 'target-arrowhead') {
        const shape = rest[0] === 'shape' ? entry.value : entry.block?.find((child) => child.paths[0]?.[0] === 'shape')?.value;
        const head = shape ? HEADS[shape] : undefined;
        if (shape && head) {
          if (first === 'source-arrowhead') edge.tail = head;
          else edge.head = head;
        } else if (shape) this.loss(entry.line, `arrowhead shape ${shape} dropped`);
        if (entry.value && rest.length === 0) this.loss(entry.line, 'arrowhead labels dropped');
        if (rest[0] === 'label' || entry.block?.some((child) => child.paths[0]?.[0] === 'label')) this.loss(entry.line, 'arrowhead labels dropped');
      } else this.loss(entry.line, `connection ${key} dropped`);
    }
  }

  private statement(item: Item, scope: readonly string[]): void {
    const segments = item.paths[0]!;
    if (segments.some((segment) => segment.includes('*'))) {
      this.loss(item.line, 'globs dropped');
      return;
    }
    if (/^\(.*\)\[\d+\]$/.test(segments[0] ?? '') || segments[0]?.startsWith('(')) {
      this.loss(item.line, 'connection references dropped');
      return;
    }
    const field = segments.findIndex((segment) => RESERVED.has(segment.toLowerCase()));
    const resolved = this.resolve(scope, field === -1 ? segments : segments.slice(0, field));
    if (!resolved) {
      this.loss(item.line, '`_` above the diagram; statement dropped');
      return;
    }
    if (field === -1) {
      const path = resolved;
      const node = this.ensure(path, item.line)!;
      const parent = node.parent ? this.nodes.get(node.parent) : undefined;
      if (parent?.shape === 'sql_table') {
        this.nodes.delete(node.path);
        parent.rows.push({ name: node.key, type: item.value ?? '', constraints: this.constraints(item.block) });
        return;
      }
      if (item.value !== undefined) {
        node.label = item.value.startsWith('\uE000') ? markdownLabel(item.value) : item.value;
        if (item.value.startsWith('\uE000')) this.loss(item.line, 'markdown and code labels flattened to their first line');
      }
      if (item.block) {
        // A shape decides how the block reads (rows of a table), so it is read first.
        const shape = item.block.find((child) => child.paths[0]?.length === 1 && child.paths[0][0] === 'shape');
        if (shape) this.field(node, ['shape'], shape, path);
        const rest = item.block.filter((child) => child !== shape);
        if (this.isSequenceGroup(path, node, rest)) {
          this.groups.add(node.path);
          this.loss(item.line, `sequence group "${node.label?.trim() || node.key}" flattened`);
          this.walk(rest, []);
        } else this.walk(rest, path);
      }
      return;
    }
    const target = resolved;
    const node = target.length ? this.ensure(target, item.line) : null;
    this.field(node, segments.slice(field), item, target);
  }

  private constraints(block: readonly Item[] | undefined): string[] {
    const constraint = block?.find((child) => child.paths[0]?.[0] === 'constraint')?.value ?? '';
    return constraint.replace(/[[\]]/g, '').split(/[;,\s]+/).filter(Boolean);
  }

  private field(node: D2Node | null, keyPath: readonly string[], item: Item, scope: readonly string[]): void {
    const key = keyPath.join('.').toLowerCase();
    const value = item.value?.startsWith('\uE000') ? markdownLabel(item.value) : item.value;
    if (item.value?.startsWith('\uE000')) this.loss(item.line, 'markdown and code labels flattened to their first line');
    if (!node) {
      if (key === 'direction' && value) this.direction = value;
      else if (key === 'shape' && value === 'sequence_diagram') this.sequence = true;
      else if (key === 'classes' && item.block) for (const entry of item.block) this.classes.set(entry.paths[0]!.map(plain).join('.'), entry.block ?? []);
      else if (key === 'vars' || key === 'layers' || key === 'scenarios' || key === 'steps') this.loss(item.line, `${key} dropped`);
      else if (key.startsWith('style')) this.loss(item.line, 'diagram style dropped');
      else this.loss(item.line, `${key} dropped`);
      return;
    }
    if (key === 'label') node.label = value ?? node.label;
    else if (key === 'shape' && value) this.shape(node, value, item.line);
    else if (key === 'icon' && value) this.icon(node, value, item.line);
    else if (key === 'link' && value) node.link = value;
    else if (key === 'width' && value) node.width = value;
    else if (key === 'height' && value) node.height = value;
    else if (key === 'class' && value) {
      for (const name of value.replace(/[[\]]/g, '').split(/[;,]/).map((part) => part.trim()).filter(Boolean)) {
        const definition = this.classes.get(name);
        if (definition) this.walk(definition, scope);
        else this.loss(item.line, `class ${name} not defined; dropped`);
      }
    } else if (key === 'style' && item.block) {
      for (const child of item.block) this.field(node, ['style', ...child.paths[0]!], child, scope);
    } else if (key === 'style.fill' && value) {
      const color = isHexColor(value) ? value.toLowerCase() : canonicalColorWord(value);
      if (color) node.color = color;
      else if (value !== 'transparent') this.loss(item.line, `fill ${value} has no palette colour; dropped`);
    } else if (key === 'style.shadow') node.shadow = value === 'true';
    else if (key === 'direction') this.loss(item.line, 'container direction dropped');
    else this.loss(item.line, `${key.startsWith('style.') ? key : keyPath[0]} dropped`);
  }

  private shape(node: D2Node, value: string, line: number): void {
    if (value === 'sql_table') { node.shape = 'sql_table'; return; }
    if (value === 'sequence_diagram') {
      node.shape = 'sequence_diagram';
      this.loss(line, 'a nested sequence diagram is drawn as a group');
      return;
    }
    const mapped = SHAPES[value];
    if (mapped === undefined || mapped === null) this.loss(line, `shape ${value} drawn as a box`);
    else node.shape = mapped || undefined;
  }

  private icon(node: D2Node, url: string, line: number): void {
    const match = ICON_HOSTS.exec(url);
    if (!match) {
      this.loss(line, 'icon URLs outside the cloud packs dropped');
      return;
    }
    const provider = match[1]!.toLowerCase() === 'dev' ? 'tech' : match[1]!.toLowerCase();
    const file = decodeURIComponent(match[2]!).split('/').at(-1)!.replace(/\.\w+$/, '')
      .replace(/^(?:AWS|Amazon|Azure|Google|GCP)[-\s]+/i, '');
    node.icon = `${provider}/${slugifyDslId(file)}`;
  }
}

function markdownLabel(raw: string): string {
  const line = raw.slice(1).split('\n').map((text) => text.replace(/^[\s#>*-]+/, '').replace(/[*_`]/g, '').trim()).find(Boolean);
  return line ?? '';
}
