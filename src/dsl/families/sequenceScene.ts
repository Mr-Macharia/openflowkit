import type { SceneConnector, SceneNode } from '../../opencanvas/domain/document/types';
import { connectorLabelPlate, resolveConnectorLabelStyle } from '../../opencanvas/domain/connectors/labelStyle';
import { frameInsets } from '../layout';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import { nonVisualAttributes, typedFrom } from '../attributes';
import { attrsToJson } from '../sceneMeta';
import { COLOR_WORDS, isHexColor } from '../vocabulary';
import type { FamilyContext, FamilyScene } from './types';
import {
  ACTIVATION_TAIL,
  ACTOR_EXTRA,
  ARROW_HALF,
  type Activation,
  CLOSE_PAD,
  FRAGMENT_COLORS,
  FRAGMENT_INSET,
  GAP,
  GUARD_INSET,
  HEADER,
  LABEL_LIFT,
  LANE_GAP,
  LANE_WIDTH,
  LIFELINE_TAIL,
  MESSAGE_OFFSET,
  MESSAGE_SPACING,
  MIN_ABOVE,
  type MessageDraft,
  NOTE_GAP,
  NOTE_LIFT,
  PADDING,
  SELF_LOOP_DROP,
  type SeqModel,
  TAG_HEIGHT,
} from './sequenceModel';

function textWidth(text: string, fontSize: number, extra: number): number {
  return Math.round(measurePortableText(text, { fontSize, fontWeight: 600, overflow: 'visible' }).width) + extra;
}

export function materialize(model: SeqModel, context: FamilyContext): FamilyScene {
  // Node translations stay frame-relative (the scene composes the parent
  // transform); only connector waypoints are page coordinates.
  const laneWidth = new Map(model.participants.map((participant) => [
    participant.id, Math.max(LANE_WIDTH, textWidth(participant.label, 12, 40)),
  ]));
  const labelStyle = resolveConnectorLabelStyle({ appearance: {} } as SceneConnector);
  const laneX = new Map<string, number>();
  let cursor = PADDING.left;
  for (const participant of model.participants) {
    laneX.set(participant.id, cursor);
    cursor += laneWidth.get(participant.id)! + LANE_GAP;
  }
  const lanesRight = model.participants.length > 0 ? cursor - LANE_GAP : PADDING.left + LANE_WIDTH;
  // A titled frame starts its content below the header band and its gap; an actor's figure takes the
  // top, other participants the ACTOR_EXTRA below it. Untitled, the content starts at the frame's edge.
  const hasActor = model.participants.some((participant) => participant.kind === 'actor');
  const top = context.title ? frameInsets(true).top - (hasActor ? 0 : ACTOR_EXTRA) : 0;
  const headerBottom = top + ACTOR_EXTRA + HEADER;
  const firstLine = headerBottom + MESSAGE_OFFSET;
  const rowAt = (y: number) => (y - firstLine) / MESSAGE_SPACING;
  const noteSizes = new Map(model.notes.map((note) => {
    const width = Math.max(180, textWidth(note.text, 11, 44));
    const height = Math.max(56, Math.round(measurePortableText(note.text, { fontSize: 11, fontWeight: 500, maxWidth: width - 24, overflow: 'wrap' }).height) + 40);
    return [note.id, { width, height }] as const;
  }));
  const labelLift = (text: string) => connectorLabelPlate(text, labelStyle, { x: 0, y: 0 }).height / 2 + LABEL_LIFT;
  /** Room a message takes above its line: the label plate that rides there (a self call's label sits on its loop). */
  const above = (message: MessageDraft) => message.label && message.from !== message.to ? labelLift(message.label) * 2 : MIN_ABOVE;
  const branchById = new Map(model.branches.map((branch) => [branch.id, branch]));

  // One walk down the timeline in the order the text was written: each message, note, block edge
  // and activation takes the next free room, so nothing written later lands on something earlier.
  const lineOf = new Map<number, number>();
  const noteTop = new Map<string, number>();
  const spans = new Map<string, { top: number; bottom: number }>();
  const activationY = new Map<Activation, number>();
  /** Bars opened since the last message: they start on the next message's line. */
  let pending: Array<{ activation: Activation; participant: string }> = [];
  let next = firstLine; // the earliest line the next message may take
  let floor = headerBottom; // the lowest pixel anything takes so far
  let lastLine: number | null = null;
  for (const event of model.timeline) {
    if (event.kind === 'message') {
      const message = model.messages[event.index]!;
      const line = Math.max(next, floor + GAP + above(message));
      lineOf.set(event.index, line);
      for (const { activation } of pending) activationY.set(activation, line);
      pending = [];
      floor = line + (message.from === message.to ? SELF_LOOP_DROP : ARROW_HALF);
      next = line + MESSAGE_SPACING;
      lastLine = line;
    } else if (event.kind === 'note') {
      const note = model.notes[event.index]!;
      const y = Math.max(next - NOTE_LIFT, floor + GAP);
      noteTop.set(note.id, y);
      floor = y + noteSizes.get(note.id)!.height;
      next = floor + NOTE_GAP + NOTE_LIFT;
    } else if (event.kind === 'open') {
      // A header (or an `else` divider) sits under whatever came before; its tag and guard take a band.
      const y = floor + GAP;
      const continues = branchById.get(event.id)!.continues;
      if (continues) spans.get(continues)!.bottom = y;
      spans.set(event.id, { top: y, bottom: y + TAG_HEIGHT });
      floor = y + TAG_HEIGHT;
    } else if (event.kind === 'close') {
      const span = spans.get(event.id)!;
      span.bottom = floor + CLOSE_PAD;
      floor = span.bottom;
    } else if (event.activation.activate) {
      pending.push(event);
    } else {
      // A bar ends where its `deactivate` is written: under the last message, or under the block it closes after.
      const y = Math.max(floor, lastLine === null ? floor : lastLine + ACTIVATION_TAIL);
      for (const open of pending) if (open.participant === event.participant) activationY.set(open.activation, y);
      pending = pending.filter((open) => open.participant !== event.participant);
      activationY.set(event.activation, y);
    }
  }
  for (const { activation } of pending) activationY.set(activation, next);
  const lifelineBottom = Math.max(next, floor + GAP) + LIFELINE_TAIL;
  const scene = (x: number, y: number) => ({ x, y });
  const nodes: SceneNode[] = [];
  const connectors: SceneConnector[] = [];

  // The guard text starts right of the first lifeline and stops short of the second, so no lifeline runs through it.
  const guardBox = (fragmentX: number) => {
    const [first, second] = model.participants;
    const start = first ? laneX.get(first.id)! + laneWidth.get(first.id)! / 2 + GUARD_INSET : PADDING.left;
    const end = second ? laneX.get(second.id)! + laneWidth.get(second.id)! / 2 - GUARD_INSET : start + 200;
    return { x: start - fragmentX, width: end - start };
  };

  // Fragments first: their fills paint behind the participants (draw order).
  // A branch the next (`else`, `and`) continues ends where that one's dashed divider begins: one frame.
  const continued = new Set(model.branches.map((branch) => branch.continues));
  for (const branch of model.branches) {
    const span = spans.get(branch.id)!;
    const topLeft = scene(PADDING.left - FRAGMENT_INSET, span.top);
    nodes.push({
      id: branch.id, kind: 'annotation', parentId: null, layerId: 'default', zIndex: 0,
      transform: { translation: topLeft, rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: { width: Math.max(220, lanesRight - PADDING.left + FRAGMENT_INSET + 30), height: span.bottom - span.top },
      content: {
        seqFragmentId: branch.id,
        label: branch.branchIndex === 0 ? branch.type.toUpperCase() : branch.type === 'par' ? 'AND' : 'ELSE',
        ...(branch.condition ? { subLabel: branch.condition, seqGuard: guardBox(topLeft.x) } : {}),
        color: FRAGMENT_COLORS[branch.type] ?? 'violet',
        seqMessageOrder: branch.startOrder,
        ...(branch.continues ? { seqFragmentDivider: true } : {}),
        ...(continued.has(branch.id) ? { seqFragmentContinued: true } : {}),
      },
      appearance: {}, ports: [],
      metadata: {
        dsl: {
          id: branch.id, line: branch.line, seqBranch: true, seqFragmentType: branch.type,
          seqFragmentBranch: branch.branchIndex, seqFragmentParent: branch.parent,
          seqFragmentStart: branch.startOrder, seqFragmentEnd: branch.endOrder, seqFragmentEndLine: branch.endLine,
          ...(branch.comments.length ? { comments: branch.comments } : {}),
        },
      },
      extensions: {},
    });
  }

  for (const participant of model.participants) {
    const actor = participant.kind === 'actor';
    const typed = typedFrom(participant.attrs);
    const palette = typed.color && !isHexColor(typed.color) ? COLOR_WORDS[typed.color]?.key : undefined;
    const custom = typed.color && isHexColor(typed.color) ? typed.color : undefined;
    const attrs = nonVisualAttributes(typed, 'node');
    nodes.push({
      id: participant.id, kind: 'sequence_participant', parentId: null, layerId: 'default', zIndex: 1,
      transform: { translation: scene(laneX.get(participant.id)!, top + (actor ? 0 : ACTOR_EXTRA)), rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: { width: laneWidth.get(participant.id)!, height: lifelineBottom - top - (actor ? 0 : ACTOR_EXTRA) },
      content: {
        label: participant.label,
        seqParticipantKind: participant.kind,
        ...(participant.stereotype ? { seqStereotype: participant.stereotype } : {}),
        // Rows always ride along: the renderer ends a bar on its `deactivate` row only when it has one.
        ...(participant.activations.length ? { seqActivations: participant.activations.map((activation) => (
          { ...activation, row: rowAt(activationY.get(activation)!) })) } : {}),
        ...(custom ? { color: 'custom', customColor: custom } : palette ? { color: palette } : {}),
      },
      appearance: {}, ports: [],
      metadata: {
        dsl: {
          id: participant.id, line: participant.line, seqParticipant: true,
          seqDeclared: participant.declared,
          ...(participant.stereotype ? { seqStereotype: participant.stereotype } : {}),
          ...(participant.firstUseLine !== null ? { seqFirstUseLine: participant.firstUseLine } : {}),
          ...(attrs.length ? { attrs: attrsToJson(attrs) } : {}),
          ...(participant.comments.length ? { comments: participant.comments } : {}),
        },
      },
      extensions: {},
    });
  }

  for (const message of model.messages) {
    const attrs = nonVisualAttributes(typedFrom(message.attrs), 'edge');
    const self = message.from === message.to;
    connectors.push({
      id: message.id,
      source: { nodeId: message.from, portId: null, anchor: null, point: null },
      target: { nodeId: message.to, portId: null, anchor: null, point: null },
      route: { kind: 'direct', ownership: 'automatic' }, waypoints: [],
      // A label rides on top of its arrow, so its plate never hides the line or the lifelines it crosses.
      labels: message.label ? [{ id: `${message.id}-label`, text: message.label, pathRatio: 0.5, offset: self ? { x: 0, y: 0 } : { x: 0, y: -labelLift(message.label) }, metadata: {} }] : [],
      // `[head: cross]` is the one visual a message keeps: the lost message of UML, Mermaid's `-x`.
      appearance: message.attrs.some((attribute) => attribute.key === 'head' && attribute.value.toLowerCase() === 'cross') ? { markerEnd: 'cross' } : {},
      semantics: {
        seqMessageKind: self ? 'self' : message.arrow === '-->' || message.arrow === '-->>' ? 'return' : message.arrow === '->>' ? 'async' : 'sync',
        seqMessageOrder: message.order,
        ...(rowAt(lineOf.get(message.order)!) === message.order ? {} : { seqMessageRow: rowAt(lineOf.get(message.order)!) }),
      },
      metadata: {
        dsl: {
          line: message.line, seqArrow: message.arrow,
          ...(attrs.length ? { attrs: attrsToJson(attrs) } : {}),
          ...(message.comments.length ? { comments: message.comments } : {}),
        },
      },
      extensions: {},
    });
  }

  for (const note of model.notes) {
    const { width, height } = noteSizes.get(note.id)!;
    const firstLane = laneX.get(note.targets[0]!) ?? PADDING.left;
    const lastLane = laneX.get(note.targets.at(-1)!) ?? firstLane;
    const x = note.position === 'over'
      ? (firstLane + lastLane + laneWidth.get(note.targets[0]!)!) / 2 - width / 2
      : note.position === 'left'
        ? firstLane - width - 32
        : firstLane + laneWidth.get(note.targets[0]!)! + 32;
    nodes.push({
      id: note.id, kind: 'sequence_note', parentId: null, layerId: 'default', zIndex: 2,
      transform: { translation: scene(x, noteTop.get(note.id)!), rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: { width, height },
      content: { label: note.text, seqNotePosition: note.position, seqNoteTargets: [...note.targets], seqMessageOrder: note.order },
      appearance: {}, ports: [],
      metadata: { dsl: { id: note.id, line: note.line, seqNote: true, ...(note.comments.length ? { comments: note.comments } : {}) } },
      extensions: {},
    });
  }

  const width = Math.max(lanesRight, ...nodes.map((node) => node.transform.translation.x + node.size.width)) + PADDING.right;
  const height = Math.max(lifelineBottom + PADDING.bottom, ...nodes.map((node) => node.transform.translation.y + node.size.height + 24));
  return {
    nodes,
    connectors,
    size: { width, height },
    meta: {
      ...(model.autonumber ? { seqAutonumber: true } : {}),
      ...(model.reserved.length ? { reserved: model.reserved } : {}),
    },
  };
}
