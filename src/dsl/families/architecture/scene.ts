import type { SceneConnector, SceneNode } from '../../../opencanvas/domain/document/types';
import { createArchIndex } from '../../model/model';
import { boundaryIds, projectRelations, selectViewElements } from '../../model/predicates';
import { ELEMENT_KIND_LABEL, type ArchElement, type ArchModel, type ArchRelation, type ArchView } from '../../model/types';
import { attrsToJson } from '../../sceneMeta';
import { ACTOR_CONTENT_LAYOUT, measureGroupSize, measureNodeSize, WRAP_SIZING_POLICY, wrapPolicyFor } from '../../sizing';

import { COLOR_WORDS, isHexColor, nodeAppearance, SHAPE_WORDS, type DslShapeSpec } from '../../vocabulary';
import { frameInsets, GROUP_INSETS, layoutEdges, type LayoutNodeInput } from '../../layout';
import { AUTO_ICON_SHAPES, PERSON_ICON } from '../../autoIcon';
import type { FamilyContext, FamilyScene } from '../types';
import type { SwatchResolver } from '../../../opencanvas/domain/nodes/nodePalette';
import { LABEL_WRAP_WIDTH } from '../../../opencanvas/domain/connectors/labelStyle';
import { measurePortableText } from '../../../opencanvas/domain/text/measurement';

/**
 * A view + model → scene. Boundaries are containers whose shown children live
 * inside them; every relation projects onto the nearest shown ancestor, so a
 * context view shows `Customer -> Shop` even when the model says
 * `Customer -> Shop.Web`. Geometry comes from the injected layout port.
 */

/** The frame's bottom keeps room for the view key; a boundary's for its kind tag line under the children. */
const FRAME_PADDING = { ...frameInsets(true), bottom: 52 };
const BOUNDARY_PADDING = { ...GROUP_INSETS, bottom: GROUP_INSETS.bottom + 16 };

/** Shape vocabulary per element kind; the tasteful default C4 look. A person is a card with a user icon:
 * the stick-figure silhouette crowds its name and description. `[person]` still asks for the silhouette. */
const KIND_SHAPE: Readonly<Record<string, string>> = {
  person: 'rounded', system: 'rect', external: 'rect', container: 'rounded',
  component: 'component', store: 'cylinder', queue: 'queue', node: 'rounded', instance: 'rounded',
};

/** Default pastel colour per kind; an authored `[color: …]` wins. */
const KIND_COLOR: Readonly<Record<string, string>> = {
  system: 'blue', external: 'gray', person: 'violet', instance: 'gray',
};

function elementShapeWord(element: ArchElement): string {
  const authored = element.attrs?.find((entry) => !entry.key && SHAPE_WORDS[entry.value]);
  return authored?.value ?? KIND_SHAPE[element.kind] ?? 'rounded';
}

function elementColorWord(element: ArchElement): string | undefined {
  return element.color ?? KIND_COLOR[element.kind];
}

/** The palette word the element draws with, and whether the kind chose it (a dark canvas washes those). */
export function elementColorKey(element: ArchElement): { readonly key: string | undefined; readonly fromKind: boolean } {
  const word = elementColorWord(element);
  return { key: word ? paletteKey(word) : undefined, fromKind: !element.color };
}

function paletteKey(word: string): string {
  return COLOR_WORDS[word.toLowerCase()]?.key ?? word;
}

/** The colour keys a card or boundary reads: a palette word, or `custom` with the hex the author wrote. */
export function contentColor(word: string): { readonly color: string; readonly customColor?: string } {
  return isHexColor(word) ? { color: 'custom', customColor: word.toLowerCase() } : { color: paletteKey(word) };
}

function specFor(word: string): DslShapeSpec {
  return SHAPE_WORDS[word] ?? SHAPE_WORDS.rounded!;
}

export async function compileArchitectureView(
  model: ArchModel,
  view: ArchView,
  context: FamilyContext,
): Promise<FamilyScene> {
  const index = createArchIndex(model);
  const selection = selectViewElements(index, view);
  const boundaries = boundaryIds(index, selection.shown);
  const projected = projectRelations(index, selection.shown);

  const shownParent = (elementId: string): string | null => {
    const element = index.byId.get(elementId);
    for (let parent = element?.parent ?? null; parent; parent = index.byId.get(parent)?.parent ?? null) {
      if (boundaries.has(parent)) return parent;
    }
    return null;
  };

  const boundaryNodes: SceneNode[] = [];
  const sceneNodes: SceneNode[] = [];
  let zIndex = 1;
  for (const element of index.model.elements) {
    if (!selection.shown.has(element.id)) continue;
    const parentId = shownParent(element.id);
    if (boundaries.has(element.id)) {
      boundaryNodes.push(boundaryNode(element, parentId, zIndex++, context));
      continue;
    }
    sceneNodes.push(elementNode(element, parentId, zIndex++, context));
  }

  const connectors: SceneConnector[] = projected.map((projection) =>
    relationConnector(projection.relation, projection.from, projection.to, projection.implied, projection.merged));

  const layoutNodes: LayoutNodeInput[] = [
    ...boundaryNodes.map((node) => ({
      id: node.id, parentId: node.parentId, size: node.size,
      minSize: measureGroupSize(String(node.content.label ?? ''), false),
    } satisfies LayoutNodeInput)),
    ...sceneNodes.map((node) => ({ id: node.id, parentId: node.parentId, size: node.size } satisfies LayoutNodeInput)),
  ];
  const laid = await context.layout({
    nodes: layoutNodes,
    edges: layoutEdges(connectors),
    direction: view.direction ?? context.direction,
    rootPadding: FRAME_PADDING,
    groupPadding: BOUNDARY_PADDING,
  }, context.signal);

  const position = (node: SceneNode): SceneNode => ({
    ...node,
    ...(laid.sizes[node.id] ? { size: laid.sizes[node.id]! } : {}),
    transform: { ...node.transform, translation: laid.positions[node.id] ?? { x: 0, y: 0 } },
  });

  return {
    nodes: [...boundaryNodes, ...sceneNodes].map(position),
    connectors,
    size: laid.root.width > 0 && laid.root.height > 0 ? laid.root : { width: 640, height: 420 },
    meta: {
      viewTitle: view.name,
      // Only the kinds of line this view draws: a legend line describing nothing is noise.
      ...(legend(projected) ? { viewKey: legend(projected) } : {}),
      arch: { model: model as unknown as Record<string, unknown>, view: view.id },
      ...(selection.unsupported.length ? { archUnsupported: selection.unsupported.map((rule) => rule.raw ?? '') } : {}),
    },
  };
}

function legend(projected: readonly { readonly implied: boolean }[]): string {
  return [
    projected.some((projection) => !projection.implied) ? 'Solid: direct relationship' : '',
    projected.some((projection) => projection.implied) ? 'Dashed: goes through other parts' : '',
  ].filter(Boolean).join(' · ');
}

export function boundaryNode(element: ArchElement, parentId: string | null, zIndex: number, context: Pick<FamilyContext, 'origin'>): SceneNode {
  const color = elementColorWord(element);
  return {
    id: element.id, kind: 'frame', parentId, layerId: 'default', zIndex,
    transform: { translation: { ...context.origin }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    size: { width: 240, height: 160 },
    content: { label: element.name, subLabel: `[${ELEMENT_KIND_LABEL[element.kind]}]`, ...(color ? contentColor(color) : {}) },
    appearance: {}, ports: [],
    metadata: {
      model: {
        elementId: element.id,
        ...(element.tags.length ? { tags: element.tags } : {}),
        ...(element.desc ? { desc: element.desc } : {}),
      },
    },
    extensions: {},
  };
}

export type ElementContext = Pick<FamilyContext, 'origin' | 'swatch' | 'resolveIcon' | 'inferIcon' | 'measureLabel'>;

/**
 * How an element draws with no icon — the node a compile gives it under
 * `icon: none`. Canvas edits that take an icon off use it, so the card turns
 * back into exactly the shape the text would produce.
 */
export function plainElementNode(element: ArchElement, swatch: SwatchResolver): SceneNode {
  return elementNode({ ...element, icon: 'none' }, null, 0, { origin: { x: 0, y: 0 }, swatch });
}

export function elementNode(element: ArchElement, parentId: string | null, zIndex: number, context: ElementContext): SceneNode {
  const shapeWord = elementShapeWord(element);
  const spec = specFor(shapeWord);
  // `icon: none` opts out; a boundary keeps its C4 shape. A person with no better match is a user.
  const inferred = !element.icon && context.inferIcon && AUTO_ICON_SHAPES.has(shapeWord)
    ? context.inferIcon(element.name, element.tech) ?? (element.kind === 'person' ? PERSON_ICON : undefined)
    : undefined;
  const autoIcon = inferred ?? (!element.icon && shapeWord === 'person' ? PERSON_ICON : undefined);
  const authoredIcon = element.icon === 'none' ? undefined : element.icon ?? autoIcon;
  const resolvedIcon = authoredIcon && context.resolveIcon ? context.resolveIcon(authoredIcon) : null;
  const isIconCard = Boolean(authoredIcon && (!context.resolveIcon || resolvedIcon));
  const label = element.name;
  const subLabel = `[${ELEMENT_KIND_LABEL[element.kind]}${element.tech ? ` · ${element.tech}` : ''}]${element.desc ? `\n${element.desc}` : ''}`;
  const kind = isIconCard ? 'architecture' : spec.kind;
  const wraps = !isIconCard && Boolean(element.desc);
  const measure = { kind, label, ...(subLabel ? { subLabel } : {}), hasIcon: isIconCard, c4Card: true as const, spec, ...(wraps ? { overflow: 'wrap' as const } : {}) };
  const measured = measureNodeSize(measure);
  const custom = context.measureLabel?.(label, kind);
  const size = {width: Math.max(measured.width, custom?.width ?? 0, isIconCard ? 240 : 0), height: Math.max(measured.height, custom?.height ?? 0, isIconCard ? 152 : 0)};
  // A description wraps inside its box on the canvas and in exports (the node is sized for it); a long name wraps too.
  const wrapPolicy = wraps ? WRAP_SIZING_POLICY : wrapPolicyFor(measure, size);
  const color = elementColorWord(element);
  const fill = element.attrs?.some((entry) => entry.value === 'bold') ? 'bold' as const
    : element.attrs?.some((entry) => entry.value === 'outline') ? 'outline' as const : 'pastel' as const;
  const sticky = kind === 'sticky';
  return {
    id: element.id, kind, parentId, layerId: 'default', zIndex,
    transform: { translation: { ...context.origin }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    size,
    content: {
      label,
      ...(!isIconCard && !sticky && spec.shape ? { shape: spec.shape } : {}),
      ...(spec.shape === 'actor' ? { contentLayout: ACTOR_CONTENT_LAYOUT } : {}),
      ...(subLabel ? { subLabel } : {}),
      ...(wrapPolicy ? { sizingPolicy: wrapPolicy } : {}),
      // Architecture cards and containers resolve their palette from content keys.
      ...(isIconCard && color ? { ...contentColor(color), ...(fill === 'bold' ? { colorMode: 'filled' } : {}) } : {}),
      // The colour came from the kind, not the author: a dark canvas washes it like an unset one.
      ...(isIconCard && !element.color && color && fill !== 'bold' ? { archKindColor: paletteKey(color) } : {}),
      ...(isIconCard && authoredIcon ? {
        icon: authoredIcon,
        archProvider: iconProvider(authoredIcon), archProviderLabel: ELEMENT_KIND_LABEL[element.kind], archResourceType: element.tech ?? '',
        ...(element.desc ? {archEnvironment: element.desc} : {}),
        ...(resolvedIcon ? { archIconPackId: resolvedIcon.packId, archIconShapeId: resolvedIcon.shapeId } : {}),
        assetPresentation: 'card',
      } : {}),
    },
    appearance: isIconCard || sticky
      ? {}
      : {
        ...nodeAppearance(color, fill, false, context.swatch),
        ...(spec.shape === 'actor' ? { textVerticalAlign: 'bottom', textPadding: 10 } : {}),
      },
    ports: [],
    metadata: {
      model: {
        elementId: element.id,
        ...(element.tags.length ? { tags: element.tags } : {}),
        ...(element.desc ? { desc: element.desc } : {}),
        ...(element.links.length ? { links: element.links } : {}),
        ...(element.instanceOf ? { instanceOf: element.instanceOf } : {}),
      },
      ...(element.attrs?.length || autoIcon ? {
        dsl: { ...(element.attrs?.length ? { attrs: attrsToJson(element.attrs) } : {}), ...(autoIcon ? { autoIcon } : {}) },
      } : {}),
    },
    extensions: {},
  };
}

/**
 * The connector a relation becomes on a view, between the shown endpoints
 * (`from`/`to` may be ancestors of the relation's own ends). The model-aware
 * commands reuse it so a relation drawn later looks exactly like a compiled one.
 */
export function relationConnector(relation: ArchRelation, from: string, to: string, implied: boolean, merged = 1): SceneConnector {
  const label = merged > 1 ? `${merged} relationships` : relationLabel(relation.label, relation.tech);
  const id = relation.from === from && relation.to === to ? relation.id : `${relation.id}@${from}->${to}`;
  return {
    id,
    source: endpoint(from), target: endpoint(to),
    route: { kind: 'orthogonal', ownership: 'automatic' }, waypoints: [],
    labels: label ? [{ id: `${id}:label`, text: label, pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {} }] : [],
    appearance: { markerEnd: 'arrow', ...(implied ? { dashPattern: 'dashed' } : {}) },
    semantics: {},
    metadata: {
      model: { relationId: relation.id, ...(implied ? { implied: true } : {}), ...(relation.tags.length ? { tags: relation.tags } : {}) },
      ...(relation.line !== undefined ? { dsl: { line: relation.line } } : {}),
    },
    extensions: {},
  };
}

function relationLabel(label: string | undefined, tech: string | undefined): string | undefined {
  if (label && tech) {
    // A label that must wrap breaks before the bracket, not inside it (`[ISO / 8583]` stays whole).
    const joined = `${label} [${tech}]`;
    const wraps = measurePortableText(joined, { fontSize: 12, fontWeight: 500, overflow: 'visible' }).width > LABEL_WRAP_WIDTH;
    return wraps && /\s/.test(tech) ? `${label}\n[${tech}]` : joined;
  }
  if (label) return label;
  if (tech) return `[${tech}]`;
  return undefined;
}

function endpoint(nodeId: string): SceneConnector['source'] {
  return { nodeId, portId: null, anchor: null, point: null };
}

function iconProvider(icon: string): string {
  const [provider] = icon.split(/[/:-]/);
  return provider || 'custom';
}
