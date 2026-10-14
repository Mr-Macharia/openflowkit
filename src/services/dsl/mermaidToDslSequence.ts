import { quote, slugifyDslId } from '../../dsl/text';
import { attrText, numberData } from './mermaidToDslShared';
import type { Converted, FlowEdge, FlowEdgeData, FlowNode } from './mermaidToDslTypes';

export function sequenceDsl(source: string, nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Converted {
  const losses: string[] = [];
  const participants = nodes.filter((node) => node.type === 'sequence_participant');
  const notes = nodes.filter((node) => node.type === 'sequence_note');
  const byId = new Map(participants.map((node) => [node.id, node]));
  /** Declaration form: `id = Label` when the label slug is not the id. */
  const participantDecl = (participant: FlowNode): string => {
    const id = slugifyDslId(participant.id) || 'n';
    const label = participant.data?.label ?? participant.id;
    return slugifyDslId(label) === id ? quote(label) : `${id} = ${quote(label)}`;
  };
  /** Reference form: the id when it was declared with one, else the label. */
  const participantRef = (id: string): string => {
    const participant = byId.get(id);
    if (!participant) return id;
    const label = participant.data?.label ?? id;
    const slug = slugifyDslId(label);
    return slug === (slugifyDslId(id) || 'n') ? quote(label) : (slugifyDslId(id) || 'n');
  };
  const lines: string[] = ['sequence'];
  if (/^\s*autonumber\b/m.test(source)) {
    lines.push('autonumber');
    losses.push('autonumber is kept in the code, but the canvas does not draw message numbers yet');
  }
  for (const participant of participants) {
    const attrs: string[] = [];
    if (participant.data?.seqParticipantKind === 'actor') attrs.push('actor');
    if (participant.data?.seqParticipantStereotype) attrs.push(participant.data.seqParticipantStereotype);
    const mermaidType = participant.data?.seqParticipantMermaidType;
    if (mermaidType) losses.push(`Participant ${participant.id}: the ${mermaidType} icon is drawn as a plain participant`);
    const alias = participant.data?.seqParticipantAlias;
    if (typeof alias === 'string' && alias && alias !== participant.data?.label) losses.push(`Participant alias "${alias}" folded into the label`);
    lines.push(`participant ${participantDecl(participant)}${attrText(attrs)}`);
  }
  const arrowOf = (kind: string | undefined, self: boolean): string => {
    if (self) return '->';
    if (kind === 'return') return '-->';
    if (kind === 'async') return '->>';
    return '->';
  };
  // Messages, notes and activations interleave by source order. The parser
  // stamps notes and activations with the index of the message that follows
  // them, so at equal order they come first.
  type Event =
    | { order: number; rank: 0; text: string; fragment: FlowEdgeData['seqFragment'] | null }
    | { order: number; rank: 1; text: string; fragment: FlowEdgeData['seqFragment'] | null };
  const events: Event[] = [];
  for (const participant of participants) {
    const activations = (participant.data as { seqActivations?: Array<{ order: number; activate: boolean }> } | undefined)?.seqActivations ?? [];
    for (const activation of activations) {
      events.push({ order: activation.order, rank: 0, text: `${activation.activate ? 'activate' : 'deactivate'} ${participantRef(participant.id)}`, fragment: null });
    }
  }
  for (const note of notes) {
    const targets = Array.isArray(note.data?.seqNoteTargets) && note.data.seqNoteTargets.length > 0
      ? note.data.seqNoteTargets
      : note.data?.seqNoteTarget ? [note.data.seqNoteTarget] : [];
    const position = note.data?.seqNotePosition === 'left' || note.data?.seqNotePosition === 'right' ? `${note.data.seqNotePosition} of` : 'over';
    events.push({
      order: numberData(note.data?.seqMessageOrder), rank: 0,
      text: `note ${position} ${targets.map((id: string) => participantRef(id)).join(', ')} : ${quote(String(note.data?.label ?? ''))}`,
      fragment: note.data?.seqFragment ?? null,
    });
  }
  for (const message of edges) {
    const label = typeof message.label === 'string' && message.label ? ` : ${quote(message.label)}` : ' : ';
    const self = message.source === message.target;
    events.push({
      order: numberData(message.data?.seqMessageOrder), rank: 1,
      text: `${participantRef(message.source)} ${arrowOf(message.data?.seqMessageKind, self)} ${participantRef(message.target)}${label}${message.data?.head === 'cross' ? ' [head: cross]' : ''}`,
      fragment: message.data?.seqFragment ?? null,
    });
  }
  events.sort((a, b) => a.order - b.order || a.rank - b.rank);
  // The DSL continues only `alt` with `else`: a `critical` with `option` branches becomes alt/else.
  const optioned = [...edges.map((edge) => edge.data?.seqFragment), ...notes.map((note) => note.data?.seqFragment)]
    .some((fragment) => fragment?.type === 'critical' && fragment.branchKind === 'option');
  if (optioned) losses.push('critical/option is drawn as alt/else');
  const kindOf = (type: string) => (type === 'critical' && optioned ? 'alt' : type);
  // The parser tags each event with its innermost fragment branch only, so
  // one block is open at a time: a `start` branch opens a new block, any other
  // branch kind continues the open one with `else`/`and`.
  let open: { type: string; branch: string; condition: string } | null = null;
  for (const event of events) {
    const fragment = event.fragment?.type ? event.fragment : null;
    if (fragment) {
      const type = kindOf(fragment.type!);
      const branch = fragment.branchKind ?? 'start';
      const condition = fragment.condition ?? '';
      const same = open && open.type === type && open.branch === branch && open.condition === condition;
      if (!same) {
        if (open && branch !== 'start' && open.type === type) {
          lines.push(`} ${type === 'par' ? 'and' : 'else'}${condition ? ` ${condition}` : ''} {`);
        } else {
          if (open) lines.push('}');
          lines.push(`${type}${condition ? ` ${condition}` : ''} {`);
        }
        open = { type, branch, condition };
      }
    } else if (open) {
      lines.push('}');
      open = null;
    }
    lines.push(`${open ? '  ' : ''}${event.text}`);
  }
  if (open) lines.push('}');
  if (fragmentDepth(source) > 1) losses.push('Nested sequence fragments are flattened to their innermost block');
  return { dsl: `${lines.join('\n')}\n`, losses };
}

/** Deepest `loop/alt/opt/par/break/critical … end` nesting in the source. */
export function fragmentDepth(source: string): number {
  let depth = 0;
  let deepest = 0;
  for (const line of source.split('\n')) {
    if (/^\s*(?:loop|alt|opt|par|break|critical|rect)\b/i.test(line)) deepest = Math.max(deepest, ++depth);
    else if (/^\s*end\s*$/i.test(line)) depth = Math.max(0, depth - 1);
  }
  return deepest;
}
