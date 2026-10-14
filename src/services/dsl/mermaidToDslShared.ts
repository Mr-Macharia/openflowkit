import type { DslDiagnostic } from '../../dsl/ast';
import { quote, quoted, slugifyDslId } from '../../dsl/text';
import type { FlowEdge, FlowNode } from './mermaidToDslTypes';

export const SHAPE_WORDS: Readonly<Record<string, string>> = {
  rectangle: 'rect', rounded: 'rounded', capsule: 'rounded', circle: 'circle', ellipse: 'ellipse',
  diamond: 'diamond', hexagon: 'hexagon', parallelogram: 'parallelogram', cylinder: 'cylinder',
  cloud: 'cloud', document: 'doc', queue: 'queue', database: 'cylinder', actor: 'person',
};

export const DIRECTION_WORDS: Readonly<Record<string, string>> = { TB: 'down', TD: 'down', LR: 'right', RL: 'left', BT: 'up' };

/** DSL-canonical reference: slug ids, `id = Label` only when the slug differs. */
export function nodeName(node: FlowNode): string {
  const id = slugifyDslId(node.id) || 'n';
  const label = node.data?.label ?? node.id;
  if (!label) return id;
  return slugifyDslId(label) === id ? quote(label) : `${id} = ${quote(label)}`;
}

export function shapeAttribute(node: FlowNode): string | undefined {
  if (node.data?.mermaidSubroutine) return 'component';
  const shape = typeof node.data?.shape === 'string' ? SHAPE_WORDS[node.data.shape] : undefined;
  return shape && shape !== 'rect' ? shape : undefined;
}

export function styleColor(node: FlowNode): string | undefined {
  const background = node.style?.backgroundColor;
  return typeof background === 'string' && background.startsWith('#') ? background.toLowerCase() : undefined;
}

export function nodeAttributes(node: FlowNode): string[] {
  const attrs: string[] = [];
  const shape = shapeAttribute(node);
  if (shape) attrs.push(shape);
  const color = styleColor(node);
  if (color) attrs.push(color);
  const subLabel = typeof node.data?.subLabel === 'string' && node.data.subLabel ? node.data.subLabel : undefined;
  if (subLabel) attrs.push(`desc: ${quote(subLabel)}`);
  if (node.data?.link) attrs.push(`link: ${quoted(node.data.link)}`);
  return attrs;
}

export function attrText(attributes: readonly string[]): string {
  return attributes.length ? ` [${attributes.join(', ')}]` : '';
}

export function edgeArrow(edge: FlowEdge): string {
  const dashed = typeof edge.style?.strokeDasharray === 'string' && edge.style.strokeDasharray.length > 0;
  const both = Boolean(edge.markerStart);
  if (!edge.markerEnd && !both) return '--';
  if (both) return dashed ? '<-->' : '<->';
  return dashed ? '-->' : '->';
}

export const SIDE_WORDS: Readonly<Record<string, string>> = { L: 'left', R: 'right', T: 'top', B: 'bottom' };

export function edgeAttributes(edge: FlowEdge): string[] {
  const attrs: string[] = [];
  const stroke = typeof edge.style?.stroke === 'string' ? edge.style.stroke : '';
  const linkStroke = edge.data?.linkStroke ?? '';
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(linkStroke)) attrs.push(linkStroke.toLowerCase());
  if (typeof edge.style?.strokeWidth === 'number' && edge.style.strokeWidth > 2) attrs.push('thick');
  if (stroke === 'transparent') attrs.push('invisible');
  if (edge.data?.animate) attrs.push('flow');
  if (edge.data?.head) attrs.push(`head: ${edge.data.head}`);
  if (edge.data?.tail) attrs.push(`tail: ${edge.data.tail}`);
  // Mermaid architecture pins each end to a side (`a:L -- R:b`); the DSL says `from:`/`to:`.
  const from = SIDE_WORDS[String(edge.data?.archSourceSide ?? '').toUpperCase()];
  const to = SIDE_WORDS[String(edge.data?.archTargetSide ?? '').toUpperCase()];
  if (from) attrs.push(`from: ${from}`);
  if (to) attrs.push(`to: ${to}`);
  return attrs;
}

/** Reference form: the id when one was declared, else the label. */
export function nodeRef(node: FlowNode): string {
  const id = slugifyDslId(node.id) || 'n';
  const label = node.data?.label ?? node.id;
  return !label || slugifyDslId(label) === id ? quote(label || id) : id;
}

export function edgeLine(edge: FlowEdge, nodes: ReadonlyMap<string, FlowNode>, losses: string[]): string | undefined {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) return undefined;
  const label = typeof edge.label === 'string' && edge.label ? ` : ${quote(edge.label)}` : '';
  if (edge.markerStart && edge.markerEnd) losses.push(`Arrow "${edge.label ?? ''}" has heads on both ends; kept as <->`);
  return `${nodeRef(source)} ${edgeArrow(edge)} ${nodeRef(target)}${label}${attrText(edgeAttributes(edge))}`;
}

/** Legacy ER fields arrive as `"name: type FLAGS"` strings. */
export function parseFieldShorthand(value: string): Record<string, unknown> {
  const [name = 'field', ...rest] = value.split(':').map((part) => part.trim());
  const [dataType = 'text', ...flags] = rest.join(':').split(/\s+/).filter(Boolean);
  const lower = flags.map((flag) => flag.toLowerCase());
  return {
    name, dataType,
    isPrimaryKey: lower.includes('pk') || lower.includes('primary'),
    isForeignKey: lower.includes('fk') || lower.includes('foreign'),
    isUnique: lower.includes('unique') || lower.includes('uk'),
    isNotNull: lower.includes('notnull') || lower.includes('nn'),
  };
}

export function numberData(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function lossDiagnostic(line: number, message: string): DslDiagnostic {
  return { code: 'W180', severity: 'warning', line, col: 1, endCol: 1, message, source: 'parse' };
}

/** `classDef hot fill:#f96,stroke:#333` / `style a …`: every property but `fill` has no DSL form. */
export function styleLosses(text: string): Array<{ line: number; message: string }> {
  return text.split('\n').flatMap((line, index) => {
    const match = /^\s*(classDef|style)\s+(\S+)\s+(.+)$/.exec(line);
    const dropped = match ? match[3]!.split(',').map((part) => part.split(':')[0]!.trim()).filter((key) => key && key !== 'fill') : [];
    return dropped.length ? [{ line: index + 1, message: `${match![1]} ${match![2]}: ${dropped.join(', ')} not kept (only fill converts)` }] : [];
  });
}
