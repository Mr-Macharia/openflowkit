import { quote } from '../../dsl/text';
import { DIRECTION_WORDS, attrText, edgeArrow, nodeAttributes, nodeName, nodeRef, parseFieldShorthand } from './mermaidToDslShared';
import type { Converted, FlowEdge, FlowNode } from './mermaidToDslTypes';

export function stateDsl(source: string, nodes: readonly FlowNode[], edges: readonly FlowEdge[], direction: string | undefined, rename: (id: string) => string = (id) => id): Converted {
  const losses: string[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pseudo = (id: string) => id.startsWith('state_start') || id.startsWith('state_end');
  const refOf = (id: string): string => {
    if (pseudo(id)) return '[*]';
    const node = byId.get(id);
    return node ? nodeRef(node) : id;
  };
  const lines: string[] = ['state' + (direction && DIRECTION_WORDS[direction] ? ` ${DIRECTION_WORDS[direction]}` : '')];
  // The parser links composite members through `parentId`, but splits a
  // composite into a `section` node (`Moving_1`) and the plain state of the
  // same label that transitions reference. Fold the section into the state so
  // our DSL writes one `state X { … }` block.
  const canonical = (id: string): string => {
    const node = byId.get(id);
    if (node?.type !== 'section') return id;
    const twin = nodes.find((candidate) => candidate.type !== 'section' && candidate.data?.label === node.data?.label);
    return twin?.id ?? id;
  };
  const insideOf = (id: string): string | undefined => {
    const parent = byId.get(id)?.parentId;
    return parent ? canonical(parent) : undefined;
  };
  const childrenOf = (id: string) => nodes.filter((candidate) => candidate.parentId && canonical(candidate.parentId) === id);
  const composites = new Set(nodes.flatMap((node) => (node.parentId ? [canonical(node.parentId)] : [])));
  const controlWord = (node: FlowNode): string | undefined => {
    const kind = node.data?.stateControlKind;
    return kind === 'fork' || kind === 'join' || kind === 'choice' ? kind : undefined;
  };
  const emitted = new Set<string>();
  const emitNode = (node: FlowNode, indent: string) => {
    if (emitted.has(node.id) || pseudo(node.id)) return;
    emitted.add(node.id);
    const control = controlWord(node);
    const attrs = control ? [control] : nodeAttributes(node);
    if (!composites.has(node.id)) {
      lines.push(`${indent}${nodeName(node)}${attrText(attrs)}`);
      return;
    }
    lines.push(`${indent}state ${nodeName(node)}${attrText(attrs)} {`);
    for (const child of childrenOf(node.id)) emitNode(child, `${indent}  `);
    for (const edge of edges) {
      if (insideOf(edge.source) === node.id && insideOf(edge.target) === node.id) lines.push(`${indent}  ${edgeText(edge)}`);
    }
    lines.push(`${indent}}`);
  };
  const edgeText = (edge: FlowEdge): string => {
    const label = typeof edge.label === 'string' && edge.label ? ` : ${quote(edge.label)}` : '';
    return `${refOf(edge.source)} ${edgeArrow(edge)} ${refOf(edge.target)}${label}`;
  };
  for (const node of nodes) {
    if (node.parentId || pseudo(node.id) || canonical(node.id) !== node.id) continue;
    emitNode(node, '');
  }
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const inside = insideOf(edge.source);
    if (inside && inside === insideOf(edge.target)) continue;
    lines.push(edgeText(edge));
  }
  // The parser drops notes, so they are read from the source: `note right of X : text`, or
  // `note right of X` … `end note` with its lines kept as line breaks. A composite takes one too.
  const sourceLines = source.split('\n');
  for (let index = 0; index < sourceLines.length; index += 1) {
    const start = /^\s*note\s+(?:left|right)\s+of\s+(\S+?)\s*(?::\s*(.*?))?\s*$/i.exec(sourceLines[index]!);
    if (!start) continue;
    let text = start[2];
    if (text === undefined) {
      const body: string[] = [];
      let end = index + 1;
      while (end < sourceLines.length && !/^\s*end\s+note\s*$/i.test(sourceLines[end]!)) body.push(sourceLines[end++]!.trim());
      if (end === sourceLines.length) losses.push(`The note on ${start[1]} has no \`end note\``);
      index = end;
      text = body.join('\n');
    }
    // The note names the Mermaid id; `distinctIds` may have renamed it (`a` → `a-2`).
    if (!byId.has(rename(start[1]!))) losses.push(`Note on unknown state ${start[1]} dropped`);
    else if (text.trim()) lines.push(`note ${refOf(rename(start[1]!))} : ${quote(text.trim())}`);
  }
  return { dsl: `${lines.join('\n')}\n`, losses };
}

export function erDsl(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Converted {
  const lines: string[] = ['erd'];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    lines.push(`${nodeName(node)} {`);
    const fields = (Array.isArray(node.data?.erFields) ? node.data.erFields : []) as ReadonlyArray<Record<string, unknown> | string>;
    for (const rawField of fields) {
      const field: Record<string, unknown> = typeof rawField === 'string' ? parseFieldShorthand(rawField) : rawField;
      const flags = [
        field.isPrimaryKey === true ? 'pk' : '',
        field.isForeignKey === true ? 'fk' : '',
        field.isUnique === true ? 'unique' : '',
        field.isNotNull === true ? 'not-null' : '',
      ].filter(Boolean);
      const name = String(field.name ?? 'field');
      lines.push(`  ${/[\s,]/.test(name) ? `"${name}"` : name} ${String(field.dataType ?? 'text')}${flags.map((flag) => ` ${flag}`).join('')}`);
    }
    lines.push('}');
  }
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const token = typeof edge.data?.erRelation === 'string' ? edge.data.erRelation : '||--||';
    const label = typeof edge.label === 'string' && edge.label ? ` : ${quote(edge.label)}` : '';
    lines.push(`${nodeRef(source)} ${token} ${nodeRef(target)}${label}`);
  }
  return { dsl: `${lines.join('\n')}\n`, losses: [] };
}

export function classDsl(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Converted {
  const losses: string[] = [];
  const lines: string[] = ['class'];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const namespaceOf = (node: FlowNode): readonly string[] => (Array.isArray(node.data?.classNamespace) ? node.data.classNamespace as string[] : []);
  /** Classes at `path` as blocks; each namespace under it opens where its first class is, holding every class that names it. */
  const emitClasses = (path: readonly string[], indent: string): void => {
    const opened = new Set<string>();
    for (const node of nodes) {
      const own = namespaceOf(node);
      if (own.length < path.length || path.some((name, depth) => own[depth] !== name)) continue;
      if (own.length === path.length) {
        const stereotype = typeof node.data?.classStereotype === 'string' && node.data.classStereotype ? [node.data.classStereotype] : [];
        const fill = typeof node.data?.classFill === 'string' ? [node.data.classFill.toLowerCase()] : [];
        lines.push(`${indent}${nodeName(node)}${attrText([...stereotype, ...fill])} {`);
        const attributes = Array.isArray(node.data?.classAttributes) ? node.data.classAttributes as string[] : [];
        const methods = Array.isArray(node.data?.classMethods) ? node.data.classMethods as string[] : [];
        for (const member of attributes) lines.push(`${indent}  ${member}`);
        if (attributes.length && methods.length) lines.push(`${indent}  ---`);
        for (const member of methods) lines.push(`${indent}  ${member}`);
        lines.push(`${indent}}`);
        continue;
      }
      const child = own[path.length]!;
      if (opened.has(child)) continue;
      opened.add(child);
      lines.push(`${indent}group ${quote(child)} {`);
      emitClasses([...path, child], `${indent}  `);
      lines.push(`${indent}}`);
    }
  };
  emitClasses([], '');
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const token = typeof edge.data?.classRelation === 'string' ? edge.data.classRelation : '-->';
    const sourceCardinality = typeof edge.data?.classRelationSourceCardinality === 'string' ? edge.data.classRelationSourceCardinality : undefined;
    const targetCardinality = typeof edge.data?.classRelationTargetCardinality === 'string' ? edge.data.classRelationTargetCardinality : undefined;
    // The authored label only: the parser's display label falls back to the cardinalities or the token.
    const authored = edge.data?.classRelationLabel;
    const label = typeof authored === 'string' && authored ? ` : ${quote(authored)}` : '';
    lines.push(
      `${nodeRef(source)} ${sourceCardinality ? `"${sourceCardinality}" ` : ''}${token} ${targetCardinality ? `"${targetCardinality}" ` : ''}${nodeRef(target)}${label}`,
    );
  }
  return { dsl: `${lines.join('\n')}\n`, losses };
}
