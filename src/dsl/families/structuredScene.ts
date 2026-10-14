import type { SceneConnector, SceneNode } from '../../opencanvas/domain/document/types';
import type { Size2d } from '../../opencanvas/domain/geometry/types';
import type { JsonObject } from '../../opencanvas/domain/document/json';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import { nonVisualAttributes, typedFrom } from '../attributes';
import { attrsToJson } from '../sceneMeta';
import { COLOR_WORDS, isHexColor } from '../vocabulary';
import type { FamilyContext, FamilyScene } from './types';
import { frameInsets, GROUP_INSETS, layoutEdges } from '../layout';
import { measureGroupSize } from '../sizing';
import { type EntityDraft, PARENT_FIRST, type StructuredKind, type StructuredModel } from './structuredModel';

function entitySize(kind: StructuredKind, entity: EntityDraft): Size2d {
  const header = measurePortableText(entity.label, { fontSize: 13, fontWeight: 700, overflow: 'visible' }).width;
  const rowWidths = entity.members.map((member) => measurePortableText(member.text, { fontSize: 11, fontWeight: 500, overflow: 'visible' }).width);
  const width = Math.max(240, header + 64, ...rowWidths.map((value) => value + (kind === 'erd' ? 110 : 40)));
  // 44 header + 10 padding top/bottom + one 18px row per member (and the divider
  // row when both compartments exist). A class splits its rows between
  // attributes and methods, so each compartment needs its own budget.
  if (kind === 'class') {
    const attributes = entity.members.filter((member) => !member.isMethod).length;
    const methods = entity.members.filter((member) => member.isMethod).length;
    const rows = Math.max(attributes + methods, 2 * attributes - 1, 2 * methods, 1);
    const extraRow = entity.divider ? 18 : 0;
    return { width: Math.round(width), height: 44 + 20 + rows * 18 + extraRow };
  }
  return { width: Math.round(width), height: 44 + 20 + Math.max(1, entity.members.length) * 18 };
}

function entityContent(kind: StructuredKind, entity: EntityDraft): JsonObject {
  const typed = typedFrom(entity.attrs);
  const palette = typed.color && !isHexColor(typed.color) ? COLOR_WORDS[typed.color]?.key : undefined;
  const custom = typed.color && isHexColor(typed.color) ? typed.color : undefined;
  const attrs = nonVisualAttributes(typed, 'node');
  const base: JsonObject = {
    label: entity.label,
    ...(custom ? { color: 'custom', customColor: custom } : palette ? { color: palette } : {}),
    ...(typed.fill === 'bold' ? { colorMode: 'filled' } : {}),
    ...(attrs.length ? { attrs: attrsToJson(attrs) } : {}),
  } as JsonObject;
  if (kind === 'erd') {
    return {
      ...base,
      erFields: entity.members.map((member) => ({
        name: member.field!.name,
        dataType: member.field!.dataType,
        ...(member.field!.isPrimaryKey ? { isPrimaryKey: true } : {}),
        ...(member.field!.isForeignKey ? { isForeignKey: true } : {}),
        ...(member.field!.isUnique ? { isUnique: true } : {}),
        ...(member.field!.isNotNull ? { isNotNull: true } : {}),
        ...(member.field!.isNullable ? { isNullable: true } : {}),
      })),
    };
  }
  const attributes = entity.members.filter((member) => !member.isMethod).map((member) => member.text);
  const methods = entity.members.filter((member) => member.isMethod).map((member) => member.text);
  return {
    ...base,
    ...(entity.stereotype ? { classStereotype: entity.stereotype } : {}),
    ...(attributes.length ? { classAttributes: attributes } : {}),
    ...(methods.length ? { classMethods: methods } : {}),
  };
}

export async function materialize(kind: StructuredKind, model: StructuredModel, context: FamilyContext): Promise<FamilyScene> {
  const nodes: SceneNode[] = [];
  const connectors: SceneConnector[] = [];
  const sizes = new Map(model.entities.map((entity) => [entity.id, entitySize(kind, entity)]));

  const groupNodes: SceneNode[] = model.groups.map((group, index) => {
    const typed = typedFrom(group.attrs);
    const palette = typed.color && !isHexColor(typed.color) ? COLOR_WORDS[typed.color]?.key : undefined;
    const custom = typed.color && isHexColor(typed.color) ? typed.color : undefined;
    const attrs = nonVisualAttributes(typed, 'node');
    return {
      id: group.id, kind: 'frame', parentId: group.parentId, layerId: 'default', zIndex: index,
      transform: { translation: { ...context.origin }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: { width: 240, height: 160 },
      content: {
        label: group.label,
        ...(custom ? { color: 'custom', customColor: custom } : palette ? { color: palette } : {}),
        ...(typed.fill === 'bold' ? { colorMode: 'filled' } : {}),
      },
      appearance: {}, ports: [],
      metadata: {
        dsl: {
          id: group.id, line: group.line,
          ...(attrs.length ? { attrs: attrsToJson(attrs) } : {}),
          ...(group.comments.length ? { comments: group.comments } : {}),
        },
      },
      extensions: {},
    };
  });

  for (const entity of model.entities) {
    nodes.push({
      id: entity.id, kind: kind === 'erd' ? 'er_entity' : 'class', parentId: entity.parentId, layerId: 'default', zIndex: model.groups.length + 1,
      transform: { translation: { ...context.origin }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: sizes.get(entity.id)!,
      content: entityContent(kind, entity),
      appearance: {}, ports: [],
      metadata: {
        dsl: {
          id: entity.id, line: entity.line,
          ...(entity.comments.length ? { comments: entity.comments } : {}),
          ...(entity.divider ? { structuredDivider: true } : {}),
        },
      },
      extensions: {},
    });
  }

  model.relations.forEach((relation, relationIndex) => {
    connectors.push({
      id: `rel:${relation.from}->${relation.to}:${relationIndex + 1}`,
      source: { nodeId: relation.from, portId: null, anchor: null, point: null },
      target: { nodeId: relation.to, portId: null, anchor: null, point: null },
      route: { kind: 'orthogonal', ownership: 'automatic' }, waypoints: [],
      labels: relation.label ? [{ id: `rel-label-${relationIndex + 1}`, text: relation.label, pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {} }] : [],
      appearance: {},
      semantics: kind === 'erd' ? { erRelation: relation.token } : { classRelation: relation.token },
      metadata: {
        dsl: {
          line: relation.line,
          structuredRelation: relation.token,
          ...(relation.sourceCardinality ? { sourceCardinality: relation.sourceCardinality } : {}),
          ...(relation.targetCardinality ? { targetCardinality: relation.targetCardinality } : {}),
          ...(relation.comments.length ? { comments: relation.comments } : {}),
        },
      },
      extensions: {},
    });
  });

  const laid = await context.layout({
    nodes: [
      ...groupNodes.map((group, index) => ({
        id: group.id, parentId: group.parentId, size: group.size, minSize: measureGroupSize(model.groups[index]!.label, false),
      })),
      ...nodes.map((node) => ({ id: node.id, parentId: node.parentId, size: node.size })),
    ],
    // UML reads top-down from the parent: an inheritance or realisation edge (child --|> parent) is laid out reversed.
    edges: layoutEdges(connectors).map((edge, index) => (PARENT_FIRST.has(String(connectors[index]!.semantics.classRelation))
      ? { ...edge, sourceId: edge.targetId, targetId: edge.sourceId } : edge)),
    direction: context.direction,
    rootPadding: frameInsets(Boolean(context.title)),
    groupPadding: GROUP_INSETS,
  }, context.signal);
  const positioned = [...groupNodes, ...nodes].map((node) => ({
    ...node,
    ...(laid.sizes[node.id] && groupNodes.includes(node) ? { size: laid.sizes[node.id]! } : {}),
    transform: { ...node.transform, translation: laid.positions[node.id] ?? { x: 0, y: 0 } },
  }));
  return {
    nodes: positioned,
    connectors,
    size: laid.root.width > 0 ? laid.root : { width: 480, height: 360 },
    meta: model.reserved.length ? { reserved: model.reserved } : {},
  };
}

