import type { SceneConnector, SceneNode } from '../../../opencanvas/domain/document/types';
import type { Point2d } from '../../../opencanvas/domain/geometry/types';
import type { DslReference, DslStatement } from '../../ast';
import { diagnostic } from '../../diagnostics';
import { canonicalizeAttributes, nonVisualAttributes, typedFrom } from '../../attributes';
import { AUTO_ICON_SHAPES, PERSON_ICON } from '../../autoIcon';
import type { FamilyContext, FamilyScene } from '../types';
import { attrsToJson, type CanonicalAttribute } from '../../sceneMeta';
import { ACTOR_CONTENT_LAYOUT, ICON_ROW_LAYOUT, measureGroupSize, measureNodeSize, wrapPolicyFor } from '../../sizing';
import { labelKey, slugifyDslId } from '../../text';
import { frameInsets, GROUP_INSETS, layoutEdges, type LayoutNodeInput } from '../../layout';
import { COLOR_WORDS, DIRECTIONS, SHAPE_WORDS, attributeSlot, canonicalShapeWord, isHexColor, nodeAppearance } from '../../vocabulary';
import {
  type Box,
  NOTE_GAP,
  applyAlignDirectives,
  endpoint,
  holdChildren,
  iconProvider,
  iconResource,
  isLossyShape,
  loopReach,
  marker,
  noteSlots,
  separateLanes,
  withLoopRoom,
  worldOrigin,
} from './sceneLayout';
import { type EdgeDraft, type GraphInput, type GroupDraft, type NodeDraft, RESERVED_SHAPE } from './sceneDrafts';

/** The graph family engine: flowchart, architecture and state share every line of it. */
export async function compileGraph(input: GraphInput, context: FamilyContext): Promise<FamilyScene> {
  const { diagnostics, origin } = context;
  const used = new Set<string>();
  const uniqueId = (wanted: string) => {
    const base = wanted || 'n';
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return id;
  };


  const groups: GroupDraft[] = [];
  const nodes: NodeDraft[] = [];
  const edges: EdgeDraft[] = [];
  const reserved: string[] = [];
  const alignLines: string[] = [];
  const notes: Array<{ line: number; target: string; text: string }> = [];
  const byExplicitId = new Map<string, NodeDraft>();
  const byName = new Map<string, NodeDraft>();
  /** Nodes whose written id W120 slugified, by the id as written (`Ledger DB`, `a.b`, `数据库`). */
  const byWrittenId = new Map<string, NodeDraft>();
  const slugged = new Set<NodeDraft>();

  const mergeAttributes = (target: CanonicalAttribute[], extra: CanonicalAttribute[]) => {
    for (const entry of extra) {
      if (!target.some((candidate) => attributeSlot(candidate) === attributeSlot(entry))) target.push(entry);
    }
  };

  const declare = (
    reference: DslReference, parentId: string | null, line: number,
    reservedKind: string | undefined, at: { line: number; col: number; endCol: number }, warnOnMove = false,
  ): NodeDraft => {
    // `id = Label` names exactly one node: that id, declared or derived — never another node
    // that shares the label (`api-2 = API` is the second API). A slugified written id names the
    // node written with it, not one its slug collides with (`数据库` and `缓存` both slug to `n`).
    // A bare word is an explicit id written bare, then a label, then a slugified written id.
    const byId = byExplicitId.get(reference.id ?? '');
    const existing = reference.writtenId ? byWrittenId.get(reference.writtenId)
      : reference.id ? (byId && !slugged.has(byId) ? byId : undefined)
        : byExplicitId.get(reference.label) ?? byName.get(labelKey(reference.label)) ?? byWrittenId.get(reference.label);
    if (existing) {
      mergeAttributes(existing.entries, canonicalizeAttributes(reference.attributes, diagnostics));
      if (warnOnMove && parentId !== null && existing.parentId !== null && existing.parentId !== parentId) {
        diagnostics.push(diagnostic(at, 'W121', 'warning', `${existing.name} is already inside another group; membership unchanged`));
      }
      return existing;
    }
    const id = uniqueId(reference.id ?? slugifyDslId(reference.label));
    const entries = canonicalizeAttributes(reference.attributes, diagnostics);
    const draft: NodeDraft = {
      id, name: reference.label, parentId, line, entries,
      ...(reservedKind ? { reservedKind } : {}), comments: [],
    };
    nodes.push(draft);
    byExplicitId.set(id, draft);
    // W120 promised the slug: the id as written still names this node.
    if (reference.writtenId) {
      byWrittenId.set(reference.writtenId, draft);
      slugged.add(draft);
    }
    // A bare label means the first node that carries it.
    if (!byName.has(labelKey(reference.label))) byName.set(labelKey(reference.label), draft);
    return draft;
  };

  // An edge end that names a group ends on the group's frame (grammar §4): its label or
  // explicit id wherever the group opens, its derived id once it has opened. A node
  // statement with that name wins; an edge alone never implies a box shadowing a group.
  const groupKeys = new Set<string>();
  const nodeKeys = new Set<string>();
  const scan = (statements: readonly DslStatement[]) => {
    for (const statement of statements) {
      if (statement.kind === 'group') {
        groupKeys.add(statement.group.label);
        if (statement.group.id) groupKeys.add(statement.group.id);
        scan(statement.statements);
      } else if (statement.kind === 'node') {
        nodeKeys.add(statement.node.label);
        if (statement.node.id) nodeKeys.add(statement.node.id);
        if (statement.node.writtenId) nodeKeys.add(statement.node.writtenId);
      } else if (statement.kind === 'reserved' && statement.statements) scan(statement.statements);
    }
  };
  scan(input.statements);
  const groupIdByKey = new Map<string, string>();
  const groupEnds: Array<{ edge: EdgeDraft; end: 'sourceId' | 'targetId'; key: string; attributes: CanonicalAttribute[] }> = [];
  const groupKeyOf = (reference: DslReference): string | undefined => {
    const key = reference.id ?? reference.label;
    if (nodeKeys.has(key)) return undefined;
    return groupKeys.has(key) || (groupIdByKey.has(key) && !byExplicitId.has(key)) ? key : undefined;
  };

  const walk = (statements: readonly DslStatement[], parentId: string | null) => {
    for (const statement of statements) {
      const claimed = context.comments.claim(statement.line);
      if (statement.kind === 'group') {
        const id = uniqueId(statement.group.id ?? slugifyDslId(statement.group.label));
        groups.push({
          id, label: statement.group.label, parentId, line: statement.line,
          entries: canonicalizeAttributes(statement.group.attributes, diagnostics),
          ...(statement.reservedKind ? { reservedKind: statement.reservedKind } : {}), comments: claimed,
        });
        for (const key of [statement.group.label, statement.group.id, id]) {
          if (key && !groupIdByKey.has(key)) groupIdByKey.set(key, id);
        }
        walk(statement.statements, id);
      } else if (statement.kind === 'node') {
        const draft = declare(statement.node, parentId, statement.line, statement.reservedKind, statement, true);
        if (draft.line === statement.line) draft.comments.push(...claimed);
      } else if (statement.kind === 'edge') {
        const entries = canonicalizeAttributes(statement.attributes, diagnostics);
        const fromGroup = groupKeyOf(statement.from);
        const toGroup = groupKeyOf(statement.to);
        const from = fromGroup ? '' : declare(statement.from, parentId, statement.line, undefined, statement).id;
        const to = toGroup ? '' : declare(statement.to, parentId, statement.line, undefined, statement).id;
        const label = typedFrom(entries).label ?? statement.label;
        const edge: EdgeDraft = {
          sourceId: from, targetId: to, arrow: statement.arrow,
          ...(label ? { label } : {}), line: statement.line, entries, comments: claimed,
        };
        edges.push(edge);
        // The group may open after this line; its id is known once the walk is done.
        if (fromGroup) groupEnds.push({ edge, end: 'sourceId', key: fromGroup, attributes: canonicalizeAttributes(statement.from.attributes, diagnostics) });
        if (toGroup) groupEnds.push({ edge, end: 'targetId', key: toGroup, attributes: canonicalizeAttributes(statement.to.attributes, diagnostics) });
      } else if (statement.kind === 'directive') {
        if (statement.name === 'note') notes.push({ line: statement.line, target: '', text: statement.value });
        else if (statement.name === 'align') alignLines.push(statement.raw);
        else reserved.push(statement.raw);
      } else {
        reserved.push(statement.raw);
        if (statement.statements) walk(statement.statements, parentId);
      }
    }
  };
  walk(input.statements, null);
  for (const { edge, end, key, attributes } of groupEnds) {
    edge[end] = groupIdByKey.get(key)!;
    const group = groups.find((candidate) => candidate.id === edge[end])!;
    mergeAttributes(group.entries, attributes);
  }

  const groupsById = new Map(groups.map((group) => [group.id, group]));

  const groupNodes: SceneNode[] = groups.map((group, index) => {
    const groupTyped = typedFrom(group.entries);
    const palette = groupTyped.color ? COLOR_WORDS[groupTyped.color]?.key : undefined;
    const custom = groupTyped.color && isHexColor(groupTyped.color) ? groupTyped.color : undefined;
    return {
      id: group.id, kind: 'frame', parentId: group.parentId, layerId: 'default', zIndex: index + 1,
      transform: { translation: { ...origin }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: { width: 240, height: 160 },
      content: {
        label: group.label,
        ...(custom ? { color: 'custom', customColor: custom } : palette ? { color: palette } : {}),
        ...(groupTyped.fill === 'bold' ? { colorMode: 'filled' } : {}),
      },
      appearance: {}, ports: [],
      metadata: {
        dsl: {
          id: group.id, line: group.line,
          ...(group.reservedKind ? { kind: group.reservedKind } : {}),
          ...(nonVisualAttributes(groupTyped, 'node').length ? { attrs: attrsToJson(nonVisualAttributes(groupTyped, 'node')) } : {}),
          ...(group.comments.length ? { comments: group.comments } : {}),
        },
      },
      extensions: {},
    };
  });

  const noteDrafts: Array<{ id: string; targetId: string; text: string; line: number }> = [];
  const sceneNodes: SceneNode[] = nodes.map((node, index) => {
    const typed = typedFrom(node.entries);
    const canonicalWord = canonicalShapeWord(typed.shape ?? RESERVED_SHAPE[node.reservedKind ?? ''] ?? 'rect') ?? 'rect';
    const spec = SHAPE_WORDS[canonicalWord]!;
    const label = typed.label ?? node.name;
    const desc = typed.entries.find((entry) => entry.key === 'desc')?.value;
    // `icon: none` opts a node out; otherwise a box-like node may take the icon its label names.
    const authoredIcon = typed.icon === 'none' ? undefined : typed.icon;
    const inferred = !typed.icon && AUTO_ICON_SHAPES.has(canonicalWord) && context.inferIcon
      ? context.inferIcon(label, typed.entries.find((entry) => entry.key === 'tech')?.value) ?? undefined
      : undefined;
    const autoIcon = inferred ?? (!typed.icon && canonicalWord === 'person' ? PERSON_ICON : undefined);
    const icon = authoredIcon ?? autoIcon;
    const resolvedIcon = icon && context.resolveIcon ? context.resolveIcon(icon) : null;
    if (authoredIcon && context.resolveIcon && !resolvedIcon) {
      diagnostics.push(diagnostic({ line: node.line, col: 1, endCol: 1 }, 'W132', 'warning', `Unknown icon ${authoredIcon}; plain node used`));
    }
    const isIconCard = Boolean(icon && (!context.resolveIcon || resolvedIcon));
    const kind = isIconCard ? 'architecture' : spec.kind;
    // A person card measures like any icon card; the silhouette's tall minimum would lift it off its row.
    const measureSpec = isIconCard && canonicalWord === 'person' ? SHAPE_WORDS.rect! : spec;
    const iconRow = typed.iconpos === 'left' && isIconCard;
    if (typed.iconpos === 'left' && !isIconCard) {
      diagnostics.push(diagnostic({ line: node.line, col: 1, endCol: 1 }, 'W131', 'warning', 'iconpos needs an icon to place; ignored'));
    }
    const measure = {
      kind, label, ...(desc ? { subLabel: desc } : {}), hasIcon: isIconCard, ...(iconRow ? { iconPlacement: 'left' as const } : {}), spec: measureSpec,
      ...(typed.width !== undefined ? { width: typed.width } : {}),
      ...(typed.height !== undefined ? { height: typed.height } : {}),
    };
    const size = context.measureLabel ? context.measureLabel(label, kind) : measureNodeSize(measure);
    // Text wider than the box can be wraps inside it; the renderer wraps by the policy, so say so.
    const wrapPolicy = context.measureLabel ? null : wrapPolicyFor(measure, size);
    const palette = typed.color && !isHexColor(typed.color) ? COLOR_WORDS[typed.color]?.key : undefined;
    const custom = typed.color && isHexColor(typed.color) ? typed.color : undefined;
    const lossyShape = isLossyShape(canonicalWord, kind);
    const sticky = kind === 'sticky';
    return {
      id: node.id, kind, parentId: node.parentId, layerId: 'default', zIndex: groups.length + index + 1,
      transform: { translation: { ...origin }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      size,
      content: {
        label,
        ...(!isIconCard && !sticky && spec.shape ? { shape: spec.shape } : {}),
        // A person keeps its actor layout; `iconpos: left` only moves the icon.
        ...(spec.shape === 'actor' ? { contentLayout: iconRow ? { ...ACTOR_CONTENT_LAYOUT, iconPlacement: 'left' } : ACTOR_CONTENT_LAYOUT } : iconRow ? { contentLayout: ICON_ROW_LAYOUT } : {}),
        ...(desc ? { subLabel: desc } : {}),
        ...(wrapPolicy ? { sizingPolicy: wrapPolicy } : {}),
        ...(sticky ? { color: palette ?? 'yellow' } : {}),
        // Architecture cards and containers resolve their palette from content keys.
        ...(isIconCard ? {
          ...(custom ? { color: 'custom', customColor: custom } : palette ? { color: palette } : {}),
          ...(typed.fill === 'bold' ? { colorMode: 'filled' } : {}),
        } : {}),
        ...(isIconCard && icon ? {
          icon, archProvider: iconProvider(icon), archResourceType: iconResource(icon),
          ...(resolvedIcon ? { archIconPackId: resolvedIcon.packId, archIconShapeId: resolvedIcon.shapeId } : {}),
          assetPresentation: 'icon',
        } : {}),
        ...(node.reservedKind ? { modelKind: node.reservedKind } : {}),
      },
      appearance: isIconCard || sticky
        ? {}
        : { ...nodeAppearance(typed.color, typed.fill, typed.flags.has('shadow'), context.swatch), ...(spec.shape === 'actor' ? { textVerticalAlign: 'bottom', textPadding: 10 } : {}) },
      ports: [],
      metadata: {
        dsl: {
          id: node.id, line: node.line,
          ...(label !== node.name ? { name: node.name } : {}),
          // An icon card has no shape of its own; remember the authored one.
          ...(lossyShape || (isIconCard && canonicalWord !== 'rect') ? { shape: canonicalWord } : {}),
          ...(typed.color ? { color: typed.color } : {}),
          ...(typed.fill !== 'pastel' ? { fill: typed.fill } : {}),
          ...(typed.icon ? { icon: typed.icon } : {}),
          ...(autoIcon ? { autoIcon } : {}),
          ...(node.reservedKind ? { kind: node.reservedKind } : {}),
          ...(nonVisualAttributes(typed, 'node').length ? { attrs: attrsToJson(nonVisualAttributes(typed, 'node')) } : {}),
          ...(node.comments.length ? { comments: node.comments } : {}),
        },
      },
      extensions: {},
    };
  });

  for (const note of notes) {
    const separator = note.text.indexOf(':');
    if (separator < 0) continue;
    const targetName = note.text.slice(0, separator).trim();
    const noteText = note.text.slice(separator + 1).trim();
    const matches = (node: SceneNode) => node.id === slugifyDslId(targetName) || node.content.label === targetName || (node.metadata.dsl as { name?: string }).name === targetName;
    // A note may sit on a group (a composite state) as well as on a node.
    const target = sceneNodes.find(matches) ?? groupNodes.find(matches);
    if (!target) {
      diagnostics.push(diagnostic({ line: note.line, col: 1, endCol: 1 }, 'W101', 'warning', `note target ${targetName} was not found; note dropped`));
      continue;
    }
    const id = uniqueId(`${target.id}-note`);
    noteDrafts.push({ id, targetId: target.id, text: noteText, line: note.line });
    sceneNodes.push({
      id, kind: 'sticky', parentId: target.parentId, layerId: 'default', zIndex: 0,
      transform: { translation: { x: 0, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: measureNodeSize({ kind: 'sticky', label: noteText, hasIcon: false, spec: SHAPE_WORDS.note! }),
      content: { label: noteText, subLabel: '', color: 'yellow' }, appearance: {}, ports: [],
      metadata: { dsl: { id, line: note.line, noteFor: target.id } }, extensions: {},
    });
  }

  const duplicates = new Map<string, number>();
  const pairTotals = new Map<string, number>();
  for (const edge of edges) {
    const pair = `${edge.sourceId}->${edge.targetId}`;
    pairTotals.set(pair, (pairTotals.get(pair) ?? 0) + 1);
  }
  const connectors: SceneConnector[] = edges.map((edge) => {
    const pair = `${edge.sourceId}->${edge.targetId}`;
    const occurrence = (duplicates.get(pair) ?? 0) + 1;
    duplicates.set(pair, occurrence);
    const total = pairTotals.get(pair) ?? 1;
    const typed = typedFrom(edge.entries);
    // `--` means a bare line, unless the author named a marker on it:
    // `A -- B [head: diamond]` is a line with a diamond at the target.
    const anchored = (key: 'head' | 'tail', value: string): string =>
      edge.arrow === '--' && !edge.entries.some((entry) => entry.key === key) ? 'none' : value;
    const head = anchored('head', typed.head);
    const tail = anchored('tail', typed.tail);
    const dashed = edge.arrow === '-->' || edge.arrow === '<-->' || typed.flags.has('dashed');
    const tailArrow = edge.arrow === '<->' || edge.arrow === '<-->' || tail === 'arrow';
    return {
      id: `edge:${pair}:${occurrence}`,
      source: endpoint(edge.sourceId, typed.from),
      target: endpoint(edge.targetId, typed.to),
      route: { kind: 'orthogonal', ownership: 'automatic' }, waypoints: [],
      labels: edge.label ? [{ id: `${pair}:${occurrence}:label`, text: edge.label, pathRatio: occurrence / (total + 1), offset: { x: 0, y: 0 }, metadata: {} }] : [],
      appearance: {
        ...(dashed ? { dashPattern: 'dashed' } : {}),
        ...(tailArrow ? { markerStart: marker(tail) } : {}),
        ...(head !== 'none' ? { markerEnd: marker(head) } : {}),
        ...(typed.flags.has('thick') ? { strokeWidth: 2.5 } : {}),
        ...(typed.flags.has('invisible') ? { opacity: 0 } : {}),
      },
      semantics: {},
      metadata: {
        dsl: {
          line: edge.line,
          ...(nonVisualAttributes(typed, 'edge').length ? { attrs: attrsToJson(nonVisualAttributes(typed, 'edge')) } : {}),
          ...(edge.comments.length ? { comments: edge.comments } : {}),
        },
      },
      extensions: {},
    };
  });

  // ponytail: `rank:` round-trips but constrains no layout. `group [direction]` reaches the layout port: the
  // deterministic layout honours it, ELK does not (INCLUDE_CHILDREN lays the whole tree in the root's direction)
  // — lay such a group out on its own (SEPARATE_CHILDREN) when a family needs it.
  const noteIds = new Set(noteDrafts.map(({ id }) => id));
  // ponytail: a group's notes sit beside its box without the layout reserving room; node notes get a slot.
  const noteRoom = noteSlots(noteDrafts.filter((draft) => sceneNodes.some((node) => node.id === draft.targetId)), sceneNodes);
  const loopRoom = loopReach(edges);
  const layoutNodes: LayoutNodeInput[] = [
    ...groupNodes.map((group) => {
      const draft = groupsById.get(group.id)!;
      const hint = draft.entries.find((entry) => !entry.key && DIRECTIONS[entry.value]);
      return {
        id: group.id, parentId: group.parentId, size: group.size,
        minSize: measureGroupSize(draft.label, false),
        ...(hint ? { direction: DIRECTIONS[hint.value]! } : {}),
      } satisfies LayoutNodeInput;
    }),
    // Notes are not laid out; their target reserves their room.
    ...sceneNodes.filter(({ id }) => !noteIds.has(id)).map((node) => ({
      id: node.id, parentId: node.parentId, size: withLoopRoom(noteRoom.get(node.id)?.box ?? node.size, loopRoom.get(node.id)),
    } satisfies LayoutNodeInput)),
  ];
  const rootPadding = frameInsets(Boolean(context.title));
  const laid = await context.layout({
    nodes: layoutNodes,
    edges: layoutEdges(connectors),
    direction: context.direction,
    rootPadding,
    groupPadding: GROUP_INSETS,
  }, context.signal);

  const positionOf = new Map<string, Point2d>(Object.entries(laid.positions));
  for (const [id, slot] of noteRoom) {
    const at = positionOf.get(id);
    if (at) positionOf.set(id, { x: at.x, y: at.y + slot.dy });
  }
  for (const node of sceneNodes) {
    const pin = typedFrom(nodes.find((candidate) => candidate.id === node.id)?.entries ?? []).pin;
    // ponytail: pins are applied after layout, so ELK reserves the unpinned slot — fine for a hint the canvas never writes.
    if (pin) positionOf.set(node.id, pin);
  }
  // Align before notes are placed, so a note follows its node; then every group still holds what moved.
  const laidOut = sceneNodes.filter(({ id }) => !noteIds.has(id));
  const sizedGroups = groupNodes.map((group) => ({ ...group, size: laid.sizes[group.id] ?? group.size }));
  applyAlignDirectives(alignLines, positionOf, laidOut, sizedGroups);
  const positionedGroups = holdChildren(sizedGroups, laidOut, positionOf).map((group) => ({
    ...group,
    transform: { ...group.transform, translation: positionOf.get(group.id) ?? { x: 0, y: 0 } },
  }));
  const noteTextByTarget = new Map<string, string[]>();
  const stackedBelow = new Map<string, number>();
  for (const note of noteDrafts) {
    const target = sceneNodes.find((node) => node.id === note.targetId) ?? positionedGroups.find((group) => group.id === note.targetId);
    if (!target) continue;
    const noteNode = sceneNodes.find((node) => node.id === note.id);
    const targetPosition = positionOf.get(target.id) ?? { x: 0, y: 0 };
    const offset = stackedBelow.get(target.id) ?? 0;
    if (noteNode) {
      positionOf.set(note.id, { x: targetPosition.x + target.size.width + NOTE_GAP, y: targetPosition.y - (noteRoom.get(target.id)?.dy ?? 0) + offset });
      stackedBelow.set(target.id, offset + noteNode.size.height + NOTE_GAP / 2);
    }
    noteTextByTarget.set(note.targetId, [...(noteTextByTarget.get(note.targetId) ?? []), note.text]);
  }
  const positionedNodes = sceneNodes.map((node) => ({
    ...node,
    ...(noteTextByTarget.has(node.id) ? {
      metadata: {
        ...node.metadata,
        dsl: { ...(node.metadata.dsl as Record<string, unknown>), notes: noteTextByTarget.get(node.id) },
      },
    } : {}),
    transform: { ...node.transform, translation: positionOf.get(node.id) ?? { x: 0, y: 0 } },
  }));

  const groupsWithNotes = positionedGroups.map((group) => (noteTextByTarget.has(group.id)
    ? { ...group, metadata: { ...group.metadata, dsl: { ...(group.metadata.dsl as Record<string, unknown>), notes: noteTextByTarget.get(group.id) } } }
    : group));

  const boxes = new Map<string, Box>();
  for (const group of positionedGroups) boxes.set(group.id, { parentId: group.parentId, at: group.transform.translation, size: group.size });
  for (const node of positionedNodes) boxes.set(node.id, { parentId: node.parentId, at: node.transform.translation, size: node.size });

  // ponytail: the layout reserves no room beside a group, so its note can still overlap what sits to its right; the frame at least holds it.
  const noted = noteDrafts.filter(({ targetId }) => groupsById.has(targetId)).reduce((frame, { id }) => {
    const note = boxes.get(id)!;
    const origin = worldOrigin(boxes, id)!;
    return {
      width: Math.max(frame.width, origin.x + note.size.width + rootPadding.right),
      height: Math.max(frame.height, origin.y + note.size.height + rootPadding.bottom),
    };
  }, laid.root.width > 0 && laid.root.height > 0 ? laid.root : { width: 640, height: 420 });
  // `align` and `pin` move nodes after layout: the frame still holds every top-level node and group.
  const size = [...positionedGroups, ...positionedNodes].filter((node) => node.parentId === null).reduce((frame, node) => ({
    width: Math.max(frame.width, node.transform.translation.x + node.size.width + rootPadding.right),
    height: Math.max(frame.height, node.transform.translation.y + node.size.height + rootPadding.bottom),
  }), noted);

  return {
    // Containers first keeps the deterministic order the editor hashes.
    nodes: [...groupsWithNotes, ...positionedNodes],
    connectors: separateLanes(connectors, boxes),
    size,
    meta: {
      ...(alignLines.length ? { align: alignLines } : {}),
      ...(reserved.length ? { reserved } : {}),
    },
  };
}
