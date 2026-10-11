import type { SceneConnector, SceneNode } from '../../opencanvas/domain/document/types';
import { connectorLabelPlate, resolveConnectorLabelStyle } from '../../opencanvas/domain/connectors/labelStyle';
import type { PaletteKey } from '../../opencanvas/domain/nodes/nodePalette';
import { frameInsets } from '../layout';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import type { DslDiagnostic } from '../ast';
import { nonVisualAttributes, readAttributes, typedFrom } from '../attributes';
import { tokenDiagnostic } from '../diagnostics';
import { attrsToJson, dslConnectorMeta, dslFrameRaw, dslNodeMeta, type CanonicalAttribute, type DslFrameScene } from '../sceneMeta';
import { joinTokens, type DslSegment } from '../segments';
import { attributeText, commentLines, nodeName, quote, slugifyDslId } from '../text';
import { COLOR_WORDS, isHexColor, sortAttributes } from '../vocabulary';
import type { Family, FamilyContext, FamilyScene } from './types';
import type { DslToken } from '../tokenize';

// The sequence family: participants, messages, activations, notes and
// control-flow fragments on a pure timeline layout. Strict line order is the
// canonical form (grammar §8.3), so serialization walks the block tree.

const LANE_WIDTH = 168;
const LANE_GAP = 84;
const HEADER = 48;
const ACTOR_EXTRA = 40;
// A two-line label rides above its arrow, so the first row leaves the header that much room.
const MESSAGE_OFFSET = 44;
const MESSAGE_SPACING = 52;
const NOTE_GAP = 12;
// A note starts this far above the line the next message would take.
const NOTE_LIFT = 18;
const LIFELINE_TAIL = 44;
const PADDING = { right: 56, bottom: 16, left: 56 };
const FRAGMENT_INSET = 40;
const LABEL_LIFT = 3;
// Vertical room on the timeline: the space between two stacked things, a block's tag-and-guard band,
// the space under a block's last item, an arrowhead, a self call's loop, a bar's tail under its last message.
const GAP = 8;
const TAG_HEIGHT = 24;
const CLOSE_PAD = 20;
const ARROW_HALF = 4;
const SELF_LOOP_DROP = 32;
const MIN_ABOVE = 12;
const ACTIVATION_TAIL = 12;
// The guard text starts this far right of the first lifeline, which the header tag (left of it) never reaches.
const GUARD_INSET = 10;

const FRAGMENT_COLORS: Readonly<Record<string, PaletteKey>> = {
  loop: 'blue', opt: 'amber', critical: 'red', break: 'red', par: 'emerald', alt: 'violet',
};
const FRAGMENT_KINDS = new Set(['loop', 'alt', 'opt', 'par', 'break', 'critical']);
const BRANCH_OF: Readonly<Record<string, 'alt' | 'par'>> = { else: 'alt', and: 'par' };
const MESSAGE_ARROWS = new Set(['->', '-->', '->>', '-->>']);

const PARTICIPANT_STEREOTYPES = new Set(['db', 'queue', 'icon']);

interface ParticipantDraft {
  id: string;
  label: string;
  kind: 'participant' | 'actor';
  line: number;
  /** Declared by its own statement (or an `id = Label` line), not only by a message. */
  declared: boolean;
  /** Line of the first message that mentions it, if any. */
  firstUseLine: number | null;
  /** `db | queue | icon` stereotype: db and queue draw their head as a cylinder and a queue. */
  stereotype?: string;
  attrs: CanonicalAttribute[];
  activations: Activation[];
  comments: string[];
}

interface Activation {
  order: number;
  activate: boolean;
  /** Source line: the serializer writes it back in place, inside the block it was written in. */
  line: number;
}

interface MessageDraft {
  id: string;
  from: string;
  to: string;
  arrow: '->' | '-->' | '->>' | '-->>';
  label?: string;
  order: number;
  line: number;
  attrs: CanonicalAttribute[];
  comments: string[];
  parent: string | null;
}

interface NoteDraft {
  id: string;
  text: string;
  position: 'over' | 'left' | 'right';
  targets: string[];
  order: number;
  line: number;
  comments: string[];
  parent: string | null;
}

interface BranchDraft {
  id: string;
  type: string;
  condition: string;
  /** 0 for the opening branch, 1+ for `else`/`and`. */
  branchIndex: number;
  /** Enclosing branch id (null at top level); siblings share it. */
  parent: string | null;
  startOrder: number;
  endOrder: number;
  line: number;
  /** Line of the `}` (or `} else`) that ends this branch. */
  endLine: number;
  /** The branch this `else`/`and` continues; its frame goes on under a divider. */
  continues: string | null;
  comments: string[];
}

/** The statements that take room on the timeline, in the order they were written. */
type TimelineEvent =
  | { kind: 'message'; index: number }
  | { kind: 'note'; index: number }
  | { kind: 'open'; id: string }
  | { kind: 'close'; id: string }
  | { kind: 'activation'; activation: Activation; participant: string };

interface SeqModel {
  participants: ParticipantDraft[];
  messages: MessageDraft[];
  notes: NoteDraft[];
  branches: BranchDraft[];
  timeline: TimelineEvent[];
  autonumber: boolean;
  reserved: string[];
}

function parseSequence(segments: readonly DslSegment[], context: FamilyContext): SeqModel {
  const participants: ParticipantDraft[] = [];
  const byId = new Map<string, ParticipantDraft>();
  const byLabel = new Map<string, ParticipantDraft>();
  const messages: MessageDraft[] = [];
  const notes: NoteDraft[] = [];
  const branches: BranchDraft[] = [];
  const reserved: string[] = [];
  const timeline: TimelineEvent[] = [];
  const open: BranchDraft[] = [];
  let pendingClose: BranchDraft | null = null;
  const used = new Set<string>();
  let autonumber = false;

  const uniqueId = (wanted: string): string => {
    const base = wanted || 'n';
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return id;
  };
  const fail = (segment: DslSegment, code: DslDiagnostic['code'], message: string, hint?: string): void => {
    context.diagnostics.push(tokenDiagnostic(code, 'warning', segment.tokens[0], message, hint));
  };
  // By id, then by label — never by slug: every CJK or emoji name slugs to `n`.
  const resolve = (name: string): ParticipantDraft | undefined => byId.get(name) ?? byLabel.get(name);
  /** `left = Label` / `Label` → the name and its explicit id. */
  const named = (tokens: readonly DslToken[]): { name: string; id?: string } => {
    const equals = tokens.findIndex((token) => token.value === '=');
    return equals < 0 ? { name: joinTokens(tokens, true) } : { name: joinTokens(tokens.slice(equals + 1), true), id: joinTokens(tokens.slice(0, equals)) };
  };
  const declare = (name: string, line: number, explicit: boolean, explicitId?: string): ParticipantDraft => {
    // `id = Label` names exactly that id (`a-2 = a` is not `A`); a bare name is an id, a label, then a slug.
    const existing = explicitId ? byId.get(explicitId) : resolve(name);
    if (existing) {
      if (explicit) existing.declared = true;
      return existing;
    }
    const id = uniqueId(explicitId ?? slugifyDslId(name));
    const participant: ParticipantDraft = { id, label: name, kind: 'participant', line, declared: explicit, firstUseLine: null, attrs: [], activations: [], comments: [] };
    participants.push(participant);
    byId.set(id, participant);
    if (!byLabel.has(name)) byLabel.set(name, participant);
    return participant;
  };

  for (const segment of segments) {
    const claimed = context.comments.claim(segment.line);
    if (segment.closes) {
      const closing = open.pop();
      if (closing) {
        closing.endOrder = messages.length - 1;
        closing.endLine = segment.line;
        timeline.push({ kind: 'close', id: closing.id });
        pendingClose = closing;
      } else {
        context.diagnostics.push(tokenDiagnostic('W101', 'warning', segment.tokens[0], 'Unexpected block close; line dropped'));
      }
      continue;
    }
    // `} else x {` arrives as a close then an open; only the next statement
    // may continue the block that just closed.
    const justClosed = pendingClose;
    pendingClose = null;
    if (segment.tokens[0]?.kind === 'comment' || segment.tokens.length === 0) continue;
    const keyword = segment.tokens[0]!.value;

    if (keyword === 'participant' || keyword === 'actor') {
      const parsed = readAttributes(segment.tokens.slice(1), context.diagnostics);
      const { name, id: explicitId } = named(parsed.body);
      if (!name) {
        fail(segment, 'W101', `${keyword} needs a name`, `${keyword} Alice`);
        continue;
      }
      const actor = keyword === 'actor' || parsed.attributes.some((attribute) => !attribute.key && (attribute.value === 'actor' || attribute.value === 'person'));
      const stereotype = parsed.attributes.find((attribute) => !attribute.key && PARTICIPANT_STEREOTYPES.has(attribute.value))?.value;
      const participant = declare(name, segment.line, true, explicitId);
      participant.kind = actor ? 'actor' : participant.kind;
      if (stereotype) participant.stereotype = stereotype;
      participant.attrs = parsed.attributes.filter((attribute) => (
        attribute.key || (!(attribute.value === 'actor' || attribute.value === 'person') && !PARTICIPANT_STEREOTYPES.has(attribute.value))
      ));
      participant.comments = claimed;
      continue;
    }
    if (keyword === 'activate' || keyword === 'deactivate') {
      // A target written `id = Label` (how the serializer names it) is that id; a quoted `"a=b"` is a name.
      const target = named(segment.tokens.slice(1));
      const participant = resolve(target.id ?? target.name);
      if (!participant) {
        fail(segment, 'W150', `${keyword} target has no participant`, 'declare it with participant or a message');
        continue;
      }
      const activation = { order: messages.length, activate: keyword === 'activate', line: segment.line };
      participant.activations.push(activation);
      timeline.push({ kind: 'activation', activation, participant: participant.id });
      continue;
    }
    if (keyword === 'note') {
      const rest = segment.tokens.slice(1);
      const colon = rest.findIndex((token) => token.value === ':');
      const head = rest.slice(0, colon);
      const position = head[0]?.value === 'over' ? 'over'
        : head[0]?.value === 'left' && head[1]?.value === 'of' ? 'left'
          : head[0]?.value === 'right' && head[1]?.value === 'of' ? 'right' : undefined;
      if (colon < 0 || !position) {
        fail(segment, 'W101', 'note needs over / left of / right of and `: text`', 'note over A, B : text');
        continue;
      }
      const targets = splitOnCommas(head.slice(position === 'over' ? 1 : 2))
        // A target written `id = Label` (how the serializer names it) is that id.
        .map((tokens) => { const target = named(tokens); return resolve(target.id ?? target.name); })
        .filter((participant): participant is ParticipantDraft => Boolean(participant));
      if (targets.length === 0) {
        fail(segment, 'W150', 'note target is not a participant', 'declare it with participant or a message');
        continue;
      }
      notes.push({
        id: `note-${notes.length + 1}`, text: joinTokens(rest.slice(colon + 1), true), position,
        targets: targets.map((participant) => participant.id), order: messages.length,
        line: segment.line, comments: claimed, parent: open.at(-1)?.id ?? null,
      });
      timeline.push({ kind: 'note', index: notes.length - 1 });
      continue;
    }
    // Mermaid writes `alt x … end`; ours is `alt x { … }`. Said, not guessed: the lines inside still import.
    if ((FRAGMENT_KINDS.has(keyword) || keyword === 'else' || keyword === 'and') && !segment.opens) {
      fail(segment, 'W101', `${keyword} needs a { … } block`, `${keyword} condition { … }`);
      continue;
    }
    if (keyword === 'end' && segment.tokens.length === 1) {
      fail(segment, 'W101', '`end` closes nothing: a block closes with }', '}');
      continue;
    }
    if (FRAGMENT_KINDS.has(keyword)) {
      const parsed = readAttributes(segment.tokens.slice(1), context.diagnostics);
      const branch: BranchDraft = {
        id: uniqueId(`${keyword}-${branches.length + 1}`), type: keyword, condition: joinTokens(parsed.body),
        branchIndex: 0, parent: open.at(-1)?.id ?? null, startOrder: messages.length, endOrder: messages.length - 1,
        line: segment.line, endLine: segment.line, continues: null, comments: claimed,
      };
      branches.push(branch);
      open.push(branch);
      timeline.push({ kind: 'open', id: branch.id });
      continue;
    }
    if (keyword === 'else' || keyword === 'and') {
      // `} else {` continues the block that `}` just closed, wherever it sits; a bare `else {` the open one.
      const current = justClosed ?? open.at(-1);
      if (!current || current.type !== BRANCH_OF[keyword]) {
        fail(segment, 'W101', `${keyword} needs an open ${BRANCH_OF[keyword]} block`, `${BRANCH_OF[keyword]} { … } ${keyword} { … }`);
        continue;
      }
      current.endOrder = messages.length - 1;
      current.endLine = segment.line;
      // The block goes on: the `}` before `else` is a divider, not the block's end.
      const last = timeline.at(-1);
      if (last?.kind === 'close' && last.id === current.id) timeline.pop();
      const parsed = readAttributes(segment.tokens.slice(1), context.diagnostics);
      const branch: BranchDraft = {
        id: uniqueId(`${current.type}-${branches.length + 1}`), type: current.type, condition: joinTokens(parsed.body),
        branchIndex: current.branchIndex + 1, parent: current.parent, startOrder: messages.length,
        endOrder: messages.length - 1, line: segment.line, endLine: segment.line, continues: current.id, comments: claimed,
      };
      branches.push(branch);
      if (open.at(-1) === current) open[open.length - 1] = branch;
      else open.push(branch);
      timeline.push({ kind: 'open', id: branch.id });
      continue;
    }
    if (keyword === 'autonumber') {
      autonumber = true;
      continue;
    }
    if (keyword === 'title' || keyword === 'direction') continue; // document layer owns them
    if (keyword === 'box' || keyword === 'rect' || keyword === 'legend' || keyword === 'align') {
      reserved.push(segment.raw);
      continue;
    }

    const arrowIndex = segment.tokens.findIndex((token) => token.kind === 'arrow' && MESSAGE_ARROWS.has(token.value));
    if (arrowIndex >= 0) {
      const arrow = segment.tokens[arrowIndex]!.value as MessageDraft['arrow'];
      const left = segment.tokens.slice(0, arrowIndex);
      const right = segment.tokens.slice(arrowIndex + 1);
      const colon = right.findIndex((token) => token.value === ':');
      const parsed = readAttributes(colon >= 0 ? right.slice(colon + 1) : [], context.diagnostics);
      const target = colon >= 0 ? right.slice(0, colon) : right;
      if ([...left, ...target].some((token) => (token.kind === 'arrow' && MESSAGE_ARROWS.has(token.value)) || (token.kind === 'punctuation' && token.value === ','))) {
        fail(segment, 'W112', 'One message per line: chains and fans are not read in a sequence; line dropped', 'A -> B, then B -> C');
        continue;
      }
      const sender = named(left);
      const receiver = named(target);
      if (!sender.name || !receiver.name) {
        fail(segment, 'W101', 'Message needs a sender and a receiver', 'A -> B : text');
        continue;
      }
      const from = declare(sender.name, segment.line, false, sender.id);
      const to = declare(receiver.name, segment.line, false, receiver.id);
      if (from.firstUseLine === null) from.firstUseLine = segment.line;
      if (to.firstUseLine === null) to.firstUseLine = segment.line;
      const label = joinTokens(parsed.body, true);
      messages.push({
        id: `msg-${messages.length + 1}`, from: from.id, to: to.id, arrow, order: messages.length,
        ...(label ? { label } : {}), line: segment.line, attrs: parsed.attributes,
        comments: claimed, parent: open.at(-1)?.id ?? null,
      });
      timeline.push({ kind: 'message', index: messages.length - 1 });
      continue;
    }

    // Bare declaration: `api = API Gateway` or `Alice`.
    const parsed = readAttributes(segment.tokens, context.diagnostics);
    const { name: label, id: explicitId } = named(parsed.body);
    if (!label) {
      fail(segment, 'W101', `Unknown sequence statement ${keyword}`, 'participant, message, note, loop/alt/opt/par/break, activate');
      continue;
    }
    const participant = declare(label, segment.line, true, explicitId);
    const stereotype = parsed.attributes.find((attribute) => !attribute.key && PARTICIPANT_STEREOTYPES.has(attribute.value))?.value;
    if (stereotype) participant.stereotype = stereotype;
    participant.attrs.push(...parsed.attributes.filter((attribute) => attribute.key || !PARTICIPANT_STEREOTYPES.has(attribute.value)));
    participant.comments.push(...claimed);
  }
  const endOfText = (segments.at(-1)?.line ?? 0) + 1;
  while (open.length > 0) {
    const branch = open.pop()!;
    branch.endOrder = messages.length - 1;
    branch.endLine = endOfText;
    timeline.push({ kind: 'close', id: branch.id });
    context.diagnostics.push(tokenDiagnostic('W103', 'warning', undefined, `Unclosed ${branch.type} block`, '} inserted'));
  }
  return { participants, messages, notes, branches, timeline, autonumber, reserved };
}

function splitOnCommas(tokens: readonly DslToken[]): DslToken[][] {
  const parts: DslToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind === 'punctuation' && token.value === ',') parts.push([]);
    else parts.at(-1)!.push(token);
  }
  return parts;
}

function textWidth(text: string, fontSize: number, extra: number): number {
  return Math.round(measurePortableText(text, { fontSize, fontWeight: 600, overflow: 'visible' }).width) + extra;
}

function materialize(model: SeqModel, context: FamilyContext): FamilyScene {
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

/* ---------------------------------------------------------------- serialization */

interface SceneBranch {
  node: SceneNode;
  id: string;
  type: string;
  branchIndex: number;
  parent: string | null;
  start: number;
  end: number;
  line: number;
  endLine: number | null;
}

/** Strict line order is the canonical form; blocks re-open around their messages. */
function sequenceText(scene: DslFrameScene): string[] {
  const raw = dslFrameRaw(scene.frame);
  const participants = scene.nodes.filter((node) => node.kind === 'sequence_participant');
  const notes = scene.nodes.filter((node) => node.kind === 'sequence_note');
  const byId = new Map(participants.map((node) => [node.id, node]));
  const messages = [...scene.connectors];
  const branches: SceneBranch[] = scene.nodes
    .filter((node) => node.kind === 'annotation' && (node.metadata.dsl as { seqBranch?: boolean })?.seqBranch)
    .map((node) => {
      const meta = node.metadata.dsl as Record<string, unknown>;
      return {
        node, id: node.id,
        type: typeof meta.seqFragmentType === 'string' ? meta.seqFragmentType : 'alt',
        branchIndex: typeof meta.seqFragmentBranch === 'number' ? meta.seqFragmentBranch : 0,
        parent: typeof meta.seqFragmentParent === 'string' ? meta.seqFragmentParent : null,
        start: typeof meta.seqFragmentStart === 'number' ? meta.seqFragmentStart : 0,
        end: typeof meta.seqFragmentEnd === 'number' ? meta.seqFragmentEnd : -1,
        line: Number(meta.line ?? 0),
        endLine: typeof meta.seqFragmentEndLine === 'number' ? meta.seqFragmentEndLine : null,
      };
    })
    .sort((a, b) => a.line - b.line);
  const orderOf = (connector: SceneConnector) => typeof connector.semantics.seqMessageOrder === 'number' ? connector.semantics.seqMessageOrder : 0;
  /**
   * Innermost branch an item was written in: by its source line when both have one (a note or a
   * `deactivate` after a block's last message stays in that block), else by message order.
   */
  const ownerOf = (order: number, line: number): string | null => {
    let best: SceneBranch | null = null;
    for (const branch of branches) {
      const inside = branch.endLine !== null && line !== Number.MAX_SAFE_INTEGER
        ? line > branch.line && line < branch.endLine
        : order >= branch.start && order <= branch.end;
      if (!inside) continue;
      if (!best || branch.line >= best.line) best = branch;
    }
    return best?.id ?? null;
  };
  const heads = branches.filter((branch) => branch.branchIndex === 0);
  const lineOfOrder = new Map(messages.map((message) => [orderOf(message), dslConnectorMeta(message).line]));
  /** Branches after `head` that continue the same block (else/and), scoped by line. */
  const continuationsOf = (head: SceneBranch): SceneBranch[] => {
    const nextHeadLine = heads
      .filter((candidate) => candidate.parent === head.parent && candidate.type === head.type && candidate.line > head.line)
      .reduce((minimum, candidate) => Math.min(minimum, candidate.line), Number.POSITIVE_INFINITY);
    return branches
      .filter((candidate) => candidate.parent === head.parent && candidate.type === head.type
        && candidate.branchIndex > head.branchIndex && candidate.line > head.line && candidate.line < nextHeadLine)
      .sort((a, b) => a.branchIndex - b.branchIndex);
  };

  const participantLine = (node: SceneNode): string[] => {
    const meta = dslNodeMeta(node);
    const attrs: CanonicalAttribute[] = [];
    if (node.content.seqParticipantKind === 'actor') attrs.push({ value: 'actor' });
    const stereotype = (node.metadata.dsl as { seqStereotype?: string }).seqStereotype;
    if (typeof stereotype === 'string' && stereotype) attrs.push({ value: stereotype });
    const kept = (node.metadata.dsl as { attrs?: CanonicalAttribute[] }).attrs;
    if (Array.isArray(kept)) attrs.push(...kept);
    const word = colorWordOf(node);
    if (word) attrs.push({ value: word });
    return [...commentLines(meta.comments, ''), `participant ${nodeName(node)}${attributeText(sortAttributes(attrs))}`];
  };
  const messageLine = (connector: SceneConnector): string[] => {
    const from = connector.source.nodeId ? byId.get(connector.source.nodeId) : undefined;
    const to = connector.target.nodeId ? byId.get(connector.target.nodeId) : undefined;
    if (!from || !to) return [];
    const meta = dslConnectorMeta(connector);
    const arrow = (connector.metadata.dsl as { seqArrow?: string }).seqArrow ?? '->';
    const label = connector.labels[0]?.text;
    const attrs = [...(meta.attrs ?? []), ...(connector.appearance.markerEnd === 'cross' ? [{ key: 'head', value: 'cross' }] : [])];
    return [...commentLines(meta.comments, ''), `${nodeName(from)} ${arrow} ${nodeName(to)}${label ? ` : ${quote(label)}` : ''}${attributeText(sortAttributes(attrs))}`];
  };
  const noteLine = (node: SceneNode): string[] => {
    const meta = dslNodeMeta(node);
    const targets = Array.isArray(node.content.seqNoteTargets) ? node.content.seqNoteTargets as string[] : [];
    const position = node.content.seqNotePosition === 'left' || node.content.seqNotePosition === 'right' ? node.content.seqNotePosition : 'over';
    const names = targets.map((id) => { const target = byId.get(id); return target ? nodeName(target) : quote(id); });
    return [...commentLines(meta.comments, ''), `note ${position === 'over' ? 'over' : `${position} of`} ${names.join(', ')} : ${quote(String(node.content.label ?? ''))}`];
  };

  /** A declared participant keeps its lane order; auto-declared ones ride their messages. */
  const needsDeclaration = (node: SceneNode): boolean => {
    const meta = dslNodeMeta(node);
    if (node.content.seqParticipantKind === 'actor') return true;
    if (typeof (node.metadata.dsl as { seqStereotype?: string }).seqStereotype === 'string') return true;
    if (meta.name !== undefined || slugifyDslId(nodeLabelOf(node)) !== node.id) return true;
    if ((node.metadata.dsl as { attrs?: unknown }).attrs) return true;
    if (colorWordOf(node)) return true;
    const firstUseLine = (node.metadata.dsl as { seqFirstUseLine?: number }).seqFirstUseLine;
    if (firstUseLine === undefined) return true;
    return (node.metadata.dsl as { seqDeclared?: boolean }).seqDeclared === true && meta.line <= firstUseLine;
  };

  const emitBlock = (head: SceneBranch, indent: string): string[] => {
    const out: string[] = [...commentLines(dslNodeMeta(head.node).comments, indent)];
    const group = [head, ...continuationsOf(head)];
    group.forEach((branch, index) => {
      const condition = conditionOf(branch);
      const opener = index === 0 ? branch.type : branch.type === 'par' ? 'and' : 'else';
      out.push(`${indent}${index === 0 ? '' : '} '}${opener}${condition ? ` ${condition}` : ''} {`);
      out.push(...emitChildren(branch.id, `${indent}  `));
    });
    out.push(`${indent}}`);
    return out;
  };
  function emitChildren(parent: string | null, indent: string): string[] {
    type Item = { line: number; rank: number; lines: string[] };
    const items: Item[] = [];
    if (parent === null) {
      for (const participant of participants) {
        if (!needsDeclaration(participant)) continue;
        items.push({ line: dslNodeMeta(participant).line, rank: 0, lines: participantLine(participant).map((text) => `${indent}${text}`) });
      }
    }
    for (const message of messages) {
      const line = dslConnectorMeta(message).line;
      if (ownerOf(orderOf(message), line) !== parent) continue;
      items.push({ line, rank: 1, lines: messageLine(message).map((text) => `${indent}${text}`) });
    }
    for (const note of notes) {
      const order = typeof note.content.seqMessageOrder === 'number' ? note.content.seqMessageOrder : 0;
      const line = dslNodeMeta(note).line;
      if (ownerOf(order, line) !== parent) continue;
      items.push({ line, rank: 2, lines: noteLine(note).map((text) => `${indent}${text}`) });
    }
    for (const participant of participants) {
      for (const activation of activationsOf(participant, lineOfOrder)) {
        if (ownerOf(activation.order, activation.line) !== parent) continue;
        items.push({ line: activation.line, rank: 1, lines: [`${indent}${activation.activate ? 'activate' : 'deactivate'} ${nodeName(participant)}`] });
      }
    }
    for (const branch of heads) {
      if (branch.parent !== parent) continue;
      items.push({ line: branch.line, rank: 3, lines: emitBlock(branch, indent) });
    }
    return items.sort((a, b) => a.line - b.line || a.rank - b.rank).flatMap((item) => item.lines);
  }

  const lines: string[] = [];
  if (raw.seqAutonumber === true) lines.push('autonumber');
  lines.push(...emitChildren(null, ''));
  const reserved = Array.isArray(raw.reserved) ? raw.reserved.filter((item): item is string => typeof item === 'string') : [];
  lines.push(...reserved);
  return lines;
}

const aboveLine = (line: number | undefined) => (line === undefined || line === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : line - 0.5);

/** A bar saved without its source line (older documents) is written just above the message it precedes. */
function activationsOf(node: SceneNode, lineOfOrder: ReadonlyMap<number, number>): Activation[] {
  const value = node.content.seqActivations;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry)
    && typeof entry.order === 'number' && typeof entry.activate === 'boolean'
    ? [{
      order: entry.order, activate: entry.activate,
      line: typeof entry.line === 'number' ? entry.line : aboveLine(lineOfOrder.get(entry.order)),
    }] : []));
}

function conditionOf(branch: SceneBranch): string {
  return typeof branch.node.content.subLabel === 'string' ? branch.node.content.subLabel : '';
}

function nodeLabelOf(node: SceneNode): string {
  return typeof node.content.label === 'string' && node.content.label.length > 0 ? node.content.label : node.id;
}

function colorWordOf(node: SceneNode): string | undefined {
  const color = node.content.color;
  if (typeof color !== 'string' || color === 'slate') return undefined;
  return Object.keys(COLOR_WORDS).find((candidate) => COLOR_WORDS[candidate]!.key === color);
}

export const sequenceFamily: Family = {
  name: 'sequence',
  async compile(segments, context) {
    return materialize(parseSequence(segments, context), context);
  },
  serialize: sequenceText,
};
