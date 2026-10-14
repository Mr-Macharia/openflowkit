import type { SceneNode } from '../../opencanvas/domain/document/types';
import { nonVisualAttributes, typedFrom } from '../attributes';
import { dslConnectorMeta, dslFrameRaw, dslNodeMeta, type CanonicalAttribute, type DslFrameScene } from '../sceneMeta';
import { attributeText, commentLines, nodeName, nodeReference, quote, quoted, slugifyDslId } from '../text';
import { COLOR_WORDS, sortAttributes } from '../vocabulary';
import { BARE_MULTIPLICITY, type StructuredKind, erRowText } from './structuredModel';

export function structuredText(kind: StructuredKind, scene: DslFrameScene): string[] {
  const raw = dslFrameRaw(scene.frame);
  const entities = scene.nodes.filter((node) => node.kind === (kind === 'erd' ? 'er_entity' : 'class'));
  const byId = new Map(entities.map((node) => [node.id, node]));
  const groups = scene.groups ?? [];
  const groupIds = new Set(groups.map((group) => group.id));
  /** The group a node sits in, or null at the top level (the frame is not a group). */
  const groupOf = (node: SceneNode): string | null => (node.parentId && groupIds.has(node.parentId) ? node.parentId : null);
  const lines: string[] = [];
  const colourAttrs = (node: SceneNode, typed: ReturnType<typeof typedFrom>): CanonicalAttribute[] => {
    const attrs = [...nonVisualAttributes(typed, 'node')];
    const word = colorWordOf(node);
    if (word) attrs.push({ value: word });
    if (node.content.colorMode === 'filled') attrs.push({ value: 'bold' });
    return attrs;
  };
  const emitEntity = (entity: SceneNode, indent: string): void => {
    const meta = dslNodeMeta(entity);
    const attrs: CanonicalAttribute[] = [];
    const stereotype = entity.content.classStereotype;
    if (typeof stereotype === 'string' && stereotype) attrs.push({ value: stereotype });
    attrs.push(...colourAttrs(entity, typedFrom(meta.attrs ?? [])));
    lines.push(...commentLines(meta.comments, indent), `${indent}${nodeName(entity)}${attributeText(sortAttributes(attrs))} {`);
    const members = kind === 'erd'
      ? (Array.isArray(entity.content.erFields) ? entity.content.erFields as Array<Record<string, unknown>> : []).map(erFieldText)
      : classMemberTexts(entity);
    for (const member of members) lines.push(`${indent}  ${member}`);
    lines.push(`${indent}}`);
  };
  // Source order decides: a group and the entities beside it come out in the order they were written.
  const emitIn = (parent: string | null, indent: string): void => {
    const items = [
      ...entities.filter((entity) => groupOf(entity) === parent).map((node) => ({ node, group: false })),
      ...groups.filter((group) => groupOf(group) === parent).map((node) => ({ node, group: true })),
    ].sort((a, b) => dslNodeMeta(a.node).line - dslNodeMeta(b.node).line);
    for (const { node, group } of items) {
      if (!group) { emitEntity(node, indent); continue; }
      const meta = dslNodeMeta(node);
      lines.push(...commentLines(meta.comments, indent),
        `${indent}group ${nodeName(node)}${attributeText(sortAttributes(colourAttrs(node, typedFrom(meta.attrs ?? []))))} {`);
      emitIn(node.id, `${indent}  `);
      lines.push(`${indent}}`);
    }
  };
  emitIn(null, '');
  // A relation names its ends by name when the id is the name's slug, else by id: it has no `id = Name` form.
  // A bare number or `*` beside the arrow would read as a multiplicity: `"Phase 1" --> B`.
  const ref = (node: SceneNode): string => {
    const name = slugifyDslId(nodeReference(node)) === node.id ? nodeReference(node) : node.id;
    return name.split(' ').some((word) => BARE_MULTIPLICITY.test(word)) ? quoted(name) : quote(name);
  };
  for (const connector of scene.connectors) {
    const meta = dslConnectorMeta(connector);
    const from = connector.source.nodeId ? byId.get(connector.source.nodeId) : undefined;
    const to = connector.target.nodeId ? byId.get(connector.target.nodeId) : undefined;
    if (!from || !to) continue;
    const token = typeof (connector.metadata.dsl as { structuredRelation?: string }).structuredRelation === 'string'
      ? (connector.metadata.dsl as { structuredRelation: string }).structuredRelation
      : typeof connector.semantics.erRelation === 'string' ? connector.semantics.erRelation
        : typeof connector.semantics.classRelation === 'string' ? connector.semantics.classRelation : '--';
    const sourceCardinality = (connector.metadata.dsl as { sourceCardinality?: string }).sourceCardinality;
    const targetCardinality = (connector.metadata.dsl as { targetCardinality?: string }).targetCardinality;
    const label = connector.labels[0]?.text;
    lines.push(
      ...commentLines(meta.comments, ''),
      `${ref(from)} ${sourceCardinality ? `${quoted(sourceCardinality)} ` : ''}${token} ${targetCardinality ? `${quoted(targetCardinality)} ` : ''}${ref(to)}${label ? ` : ${quote(label)}` : ''}`,
    );
  }
  const reserved = Array.isArray(raw.reserved) ? raw.reserved.filter((item): item is string => typeof item === 'string') : [];
  lines.push(...reserved);
  return lines;
}

function erFieldText(field: Record<string, unknown>): string {
  return erRowText(
    typeof field.name === 'string' ? field.name : '',
    typeof field.dataType === 'string' ? field.dataType : 'text',
    {
      ...(field.isPrimaryKey === true ? { isPrimaryKey: true } : {}),
      ...(field.isForeignKey === true ? { isForeignKey: true } : {}),
      ...(field.isUnique === true ? { isUnique: true } : {}),
      ...(field.isNotNull === true ? { isNotNull: true } : {}),
      ...(field.isNullable === true ? { isNullable: true } : {}),
    },
  );
}

function classMemberTexts(entity: SceneNode): string[] {
  const attributes = Array.isArray(entity.content.classAttributes) ? entity.content.classAttributes as string[] : [];
  const methods = Array.isArray(entity.content.classMethods) ? entity.content.classMethods as string[] : [];
  const both = attributes.length > 0 && methods.length > 0;
  return [...attributes, ...(both ? ['---'] : []), ...methods];
}

function colorWordOf(node: SceneNode): string | undefined {
  const color = node.content.color;
  if (typeof color !== 'string' || color === 'slate') return undefined;
  return Object.keys(COLOR_WORDS).find((candidate) => COLOR_WORDS[candidate]!.key === color);
}

