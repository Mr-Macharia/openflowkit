import type { DslDiagnostic } from '../ast';
import { readAttributes } from '../attributes';
import { tokenDiagnostic } from '../diagnostics';
import { joinTokens, type DslSegment } from '../segments';
import { slugifyDslId } from '../text';
import type { FamilyContext } from './types';
import type { DslToken } from '../tokenize';
import {
  BRANCH_OF,
  type BranchDraft,
  FRAGMENT_KINDS,
  MESSAGE_ARROWS,
  type MessageDraft,
  type NoteDraft,
  PARTICIPANT_STEREOTYPES,
  type ParticipantDraft,
  type SeqModel,
  type TimelineEvent,
} from './sequenceModel';

export function parseSequence(segments: readonly DslSegment[], context: FamilyContext): SeqModel {
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
