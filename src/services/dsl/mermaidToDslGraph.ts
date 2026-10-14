import { quote } from '../../dsl/text';
import { DIRECTION_WORDS, attrText, edgeLine, nodeAttributes, nodeName, numberData } from './mermaidToDslShared';
import type { Converted, FlowEdge, FlowNode } from './mermaidToDslTypes';

export function flowchartDsl(nodes: readonly FlowNode[], edges: readonly FlowEdge[], direction: string | undefined): Converted {
  const losses: string[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Mermaid draws no icons from labels, so neither does its import.
  const lines: string[] = ['flowchart' + (direction && DIRECTION_WORDS[direction] ? ` ${DIRECTION_WORDS[direction]}` : ''), 'icons: off'];
  const inside = (id: string, sectionId: string): boolean => {
    for (let node = byId.get(id); node; node = node.parentId ? byId.get(node.parentId) : undefined) {
      if (node.parentId === sectionId) return true;
    }
    return false;
  };
  // Mermaid ignores a subgraph's direction once any link crosses its border.
  const sectionDirection = (section: FlowNode): string | undefined => {
    const word = DIRECTION_WORDS[(section.data as { sectionMermaidDirection?: string } | undefined)?.sectionMermaidDirection ?? ''];
    const crossed = edges.some((edge) => inside(edge.source, section.id) !== inside(edge.target, section.id));
    return word && !crossed ? word : undefined;
  };
  const emitted = new Set<string>();
  const emitNode = (node: FlowNode, indent: string) => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    const isSection = node.type === 'section';
    // `subgraph one [Group One]`: edges say `one`, so the group keeps that id; a title-only subgraph has no id to keep.
    const name = isSection && !(node.data as { sectionMermaidId?: string } | undefined)?.sectionMermaidId ? quote(node.data?.label ?? node.id) : nodeName(node);
    const attributes = isSection ? [...nodeAttributes(node), ...[sectionDirection(node)].filter((word): word is string => Boolean(word))] : nodeAttributes(node);
    lines.push(`${indent}${isSection ? 'group ' : ''}${name}${attrText(attributes)}${isSection ? ' {' : ''}`);
    if (isSection) {
      for (const child of nodes.filter((candidate) => candidate.parentId === node.id)) emitNode(child, `${indent}  `);
      lines.push(`${indent}}`);
    }
  };
  // Source order: the layout keeps declaration order the way Mermaid's does.
  for (const node of nodes) if (!node.parentId) emitNode(node, '');
  for (const edge of edges) {
    const line = edgeLine(edge, byId, losses);
    if (line) lines.push(line);
  }
  return { dsl: `${lines.join('\n')}\n`, losses };
}

/**
 * Mermaid `architecture-beta`: groups nest, services keep their icon (`pack:name`
 * → `pack/name`), junctions become small circles. Edge sides ride on `from:`/`to:`.
 */
export function architectureDsl(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Converted {
  const losses: string[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const kindOf = (node: FlowNode) => node.data?.archResourceType ?? 'service';
  const lines: string[] = ['architecture'];
  const title = nodes.map((node) => node.data?.archTitle).find((value) => typeof value === 'string' && value);
  if (title) lines.push(`title: ${quote(title)}`);
  const childrenOf = (id: string | undefined) => nodes.filter((node) => (node.parentId ?? undefined) === id);
  const attributesFor = (node: FlowNode): string[] => {
    const attrs: string[] = [];
    if (kindOf(node) === 'junction') attrs.push('circle');
    const provider = node.data?.archProvider;
    if (typeof provider === 'string' && provider && provider !== 'custom' && provider !== 'group') {
      attrs.push(`icon: ${provider.replace(':', '/')}`);
    }
    return attrs;
  };
  // `group a in b` / `group b in a` is legal text; emitted once, it cannot loop.
  const emitted = new Set<string>();
  const emit = (node: FlowNode, indent: string) => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    const group = kindOf(node) === 'group';
    lines.push(`${indent}${group ? 'group ' : ''}${nodeName(node)}${attrText(attributesFor(node))}${group ? ' {' : ''}`);
    if (!group) return;
    for (const child of childrenOf(node.id)) emit(child, `${indent}  `);
    lines.push(`${indent}}`);
  };
  for (const node of childrenOf(undefined)) emit(node, '');
  for (const node of nodes) emit(node, '');
  for (const edge of edges) {
    const line = edgeLine(edge, byId, losses);
    if (line) lines.push(line);
  }
  return { dsl: `${lines.join('\n')}\n`, losses };
}

export const MINDMAP_SHAPES: Readonly<Record<string, string>> = {
  square: 'rect', rounded: 'rounded', 'double-circle': 'circle', stadium: 'ellipse', hexagon: 'hexagon', subroutine: 'component',
};

export function mindmapDsl(nodes: readonly FlowNode[]): Converted {
  const lines: string[] = ['mindmap'];
  const losses: string[] = ['Mindmap icons and classes are dropped'];
  const root = nodes.find((node) => numberData(node.data?.mindmapDepth) === 0) ?? nodes[0];
  if (!root) return { dsl: 'mindmap\n', losses: [] };
  const text = (node: FlowNode): string => {
    const label = String(node.data?.label ?? '');
    const wrapper = node.data?.mindmapWrapper;
    const shape = wrapper ? MINDMAP_SHAPES[wrapper] : undefined;
    if (wrapper && !shape) losses.push(`Mindmap "${label}": the ${wrapper} shape is drawn as plain text`);
    if (node.data?.mindmapUnmappedShape) losses.push(`Mindmap "${label}": the ${node.data.mindmapUnmappedShape} shape is drawn as plain text`);
    return `${quote(label)}${shape ? ` [${shape}]` : ''}`;
  };
  lines.push(`central: ${text(root)}`);
  const depthOf = (node: FlowNode) => numberData(node.data?.mindmapDepth);
  const parentOf = (node: FlowNode) => typeof node.data?.mindmapParentId === 'string' ? node.data.mindmapParentId : null;
  const childrenOf = (id: string) => nodes.filter((node) => parentOf(node) === id);
  const walk = (node: FlowNode) => {
    for (const child of childrenOf(node.id)) {
      const depth = depthOf(child);
      lines.push(`${' '.repeat(Math.max(0, (depth - 1) * 2))}- ${text(child)}`);
      walk(child);
    }
  };
  walk(root);
  return { dsl: `${lines.join('\n')}\n`, losses };
}

/** Mermaid gitGraph has no app-side parser; the five statements map one-to-one. */
export function gitgraphDsl(source: string): Converted {
  const lines: string[] = ['gitgraph'];
  const losses: string[] = [];
  const lossLines: number[] = [];
  for (const [index, rawLine] of source.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%') || /^gitGraph/i.test(line)) continue;
    const commit = /^commit(?:\s+id:\s*("[^"]*"|\S+))?(.*)$/i.exec(line);
    if (commit) {
      const attrs: string[] = [];
      const tag = /tag:\s*("[^"]*"|\S+)/i.exec(line);
      if (tag) attrs.push(`tag: ${tag[1]!.replace(/^"|"$/g, '')}`);
      const type = /type:\s*(NORMAL|REVERSE|HIGHLIGHT)/i.exec(line)?.[1]?.toLowerCase();
      if (type === 'reverse') attrs.push('revert');
      if (type === 'highlight') attrs.push('highlight');
      const message = commit[1] ? commit[1].replace(/^"|"$/g, '') : '';
      lines.push(`commit${message ? ` ${quote(message)}` : ''}${attrText(attrs)}`);
      continue;
    }
    const branch = /^branch\s+(\S+)/i.exec(line);
    if (branch) {
      lines.push(`branch ${branch[1]}`);
      continue;
    }
    const checkout = /^(?:checkout|switch)\s+(\S+)/i.exec(line);
    if (checkout) {
      lines.push(`checkout ${checkout[1]}`);
      continue;
    }
    const merge = /^merge\s+(\S+)(.*)$/i.exec(line);
    if (merge) {
      const attrs: string[] = [];
      const tag = /tag:\s*("[^"]*"|\S+)/i.exec(line);
      if (tag) attrs.push(`tag: ${tag[1]!.replace(/^"|"$/g, '')}`);
      const id = /id:\s*("[^"]*"|\S+)/i.exec(line);
      if (id) attrs.push(`label: ${id[1]!.replace(/^"|"$/g, '')}`);
      lines.push(`merge ${merge[1]}${attrText(attrs)}`);
      continue;
    }
    const cherry = /^cherry-pick\s+id:\s*("[^"]*"|\S+)/i.exec(line);
    if (cherry) {
      lines.push(`cherry-pick ${cherry[1]!.replace(/^"|"$/g, '')}`);
      continue;
    }
    losses.push(`Unsupported gitGraph line: ${line}`);
    lossLines.push(index + 1);
  }
  return { dsl: `${lines.join('\n')}\n`, losses, lossLines };
}
