import type { SceneConnector, SceneNode } from '../../opencanvas/domain/document/types';
import { dslConnectorMeta, dslFrameRaw, dslNodeMeta, type CanonicalAttribute, type DslFrameScene } from '../sceneMeta';
import { attributeText, commentLines, nodeName, quote, slugifyDslId } from '../text';
import { COLOR_WORDS, sortAttributes } from '../vocabulary';
import type { Activation } from './sequenceModel';
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
export function sequenceText(scene: DslFrameScene): string[] {
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
