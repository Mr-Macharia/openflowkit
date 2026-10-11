import { isJsonObject, type JsonObject, type JsonValue } from '../document/json';
import type { SceneNode } from '../document/types';
import type { Point2d } from '../geometry/types';
import { basicNodeOutlinePoints } from './basicNodeOutline';
import { optionalPresentationString, presentationString } from './nodePresentationValues';

/** An activation bar is drawn this wide on its lane; messages on it end on its edge. */
export const SEQUENCE_ACTIVATION_WIDTH = 12;
/** The shortest laid-out bar, in 52 px message rows: 12 px. */
const ACTIVATION_MIN_ROWS = 12 / 52;

interface SequenceActivationRange {
  readonly startOrder: number;
  readonly endOrder: number;
}

interface SequenceFragmentPresentation {
  readonly type: 'alt' | 'loop' | 'opt' | 'par' | 'break' | 'critical';
  readonly condition: string;
  readonly branchKind?: 'start' | 'else' | 'and' | 'option';
}

interface SequenceColorPresentation {
  readonly colorKey: string;
  readonly colorMode: 'subtle' | 'filled';
  readonly customColor?: string;
}

export type SequenceNodePresentation =
  | (SequenceColorPresentation & {
      readonly kind: 'sequence_participant';
      readonly label: string;
      readonly alias?: string;
      readonly participantKind: 'participant' | 'actor';
      /** `[db]` heads draw as a cylinder, `[queue]` as a queue; everything else is a box. */
      readonly head: 'box' | 'cylinder' | 'queue';
      readonly activations: readonly SequenceActivationRange[];
    })
  | {
      readonly kind: 'sequence_note';
      readonly label: string;
      readonly targets: readonly string[];
      readonly position: 'over' | 'left' | 'right';
      readonly order: number;
      readonly fragment?: SequenceFragmentPresentation;
    }
  | (SequenceColorPresentation & {
      readonly kind: 'sequence_fragment';
      readonly fragmentId: string;
      readonly label: string;
      readonly condition?: string;
      readonly order: number;
      /** An `else`/`and` branch: its top edge is the block's dashed divider, not a new box. */
      readonly divider: boolean;
      /** The next branch carries the block on: no bottom edge, the divider below is it. */
      readonly continued: boolean;
    });

/** A participant head's height; the lifeline starts at its bottom. */
export const SEQUENCE_HEAD_HEIGHT = 48;

/**
 * A db or queue head as the canvas and the export both draw it: the cylinder node outline
 * (a queue lies on its side) and the rim that makes it read as one. Local to the head's top-left.
 */
export function sequenceHeadShape(head: 'cylinder' | 'queue', width: number): { readonly outline: readonly Point2d[]; readonly rim: readonly Point2d[] } {
  const along = head === 'queue' ? { width: SEQUENCE_HEAD_HEIGHT, height: width } : { width, height: SEQUENCE_HEAD_HEIGHT };
  const depth = Math.min(12, along.height / 4);
  const rim = Array.from({ length: 13 }, (_, index) => {
    const angle = index * Math.PI / 12;
    return { x: along.width / 2 + Math.cos(angle) * along.width / 2, y: depth + Math.sin(angle) * depth };
  });
  const turn = (points: readonly Point2d[]) => head === 'queue' ? points.map((point) => ({ x: along.height - point.y, y: point.x })) : points;
  return { outline: turn(basicNodeOutlinePoints('cylinder', along)), rim: turn(rim) };
}

const FRAGMENT_TYPES = new Set<SequenceFragmentPresentation['type']>([
  'alt',
  'loop',
  'opt',
  'par',
  'break',
  'critical',
]);
const BRANCH_KINDS = new Set<NonNullable<SequenceFragmentPresentation['branchKind']>>([
  'start',
  'else',
  'and',
  'option',
]);

function order(value: JsonValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function color(node: SceneNode, fallback: string): SequenceColorPresentation {
  const customColor = optionalPresentationString(node.content.customColor);
  return {
    colorKey: presentationString(node.content.color, fallback),
    colorMode: node.content.colorMode === 'filled' ? 'filled' : 'subtle',
    ...(customColor ? { customColor } : {}),
  };
}

function activationRanges(value: JsonValue | undefined): readonly SequenceActivationRange[] {
  if (!Array.isArray(value)) return [];
  const events = value
    .filter(
      (event): event is JsonObject =>
        Boolean(event) && typeof event === 'object' && !Array.isArray(event)
    )
    .filter((event) => typeof event.order === 'number' && typeof event.activate === 'boolean')
    // A row (notes above it take room) places the bar; the order is what the text says.
    .map((event) => {
      const laid = typeof event.row === 'number' && Number.isFinite(event.row);
      return { order: laid ? Math.max(0, event.row as number) : order(event.order), activate: event.activate as boolean, laid };
    })
    .sort((left, right) => left.order - right.order);
  const open: number[] = [];
  const ranges: SequenceActivationRange[] = [];
  for (const event of events) {
    if (event.activate) {
      open.push(event.order);
      continue;
    }
    const startOrder = open.pop();
    // A laid-out row is where `deactivate` was written: the bar ends there, never shorter than 12 px.
    // A bare order only says "before message n", so that bar spans at least one row.
    if (startOrder !== undefined) {
      ranges.push({ startOrder, endOrder: Math.max(startOrder + (event.laid ? ACTIVATION_MIN_ROWS : 1), event.order) });
    }
  }
  for (const startOrder of open) ranges.push({ startOrder, endOrder: startOrder + 1 });
  return ranges.sort((left, right) => left.startOrder - right.startOrder);
}

function fragment(value: JsonValue | undefined): SequenceFragmentPresentation | undefined {
  if (!isJsonObject(value)) return undefined;
  const type = value.type;
  if (
    typeof type !== 'string' ||
    !FRAGMENT_TYPES.has(type as SequenceFragmentPresentation['type'])
  ) {
    return undefined;
  }
  const branchKind = value.branchKind;
  return {
    type: type as SequenceFragmentPresentation['type'],
    condition: presentationString(value.condition, ''),
    ...(typeof branchKind === 'string' &&
    BRANCH_KINDS.has(branchKind as NonNullable<SequenceFragmentPresentation['branchKind']>)
      ? { branchKind: branchKind as NonNullable<SequenceFragmentPresentation['branchKind']> }
      : {}),
  };
}

function noteTargets(content: JsonObject): readonly string[] {
  const targets = Array.isArray(content.seqNoteTargets)
    ? content.seqNoteTargets.filter(
        (target): target is string => typeof target === 'string' && target.length > 0
      )
    : [];
  const target = optionalPresentationString(content.seqNoteTarget);
  return targets.length > 0 ? [...new Set(targets)] : target ? [target] : [];
}

export function resolveSequenceNodePresentation(node: SceneNode): SequenceNodePresentation | null {
  if (node.kind === 'sequence_participant') {
    const alias = optionalPresentationString(node.content.seqParticipantAlias);
    return {
      kind: 'sequence_participant',
      label: presentationString(node.content.label, 'Participant'),
      ...(alias ? { alias } : {}),
      participantKind: node.content.seqParticipantKind === 'actor' ? 'actor' : 'participant',
      head: node.content.seqStereotype === 'db' ? 'cylinder' : node.content.seqStereotype === 'queue' ? 'queue' : 'box',
      activations: activationRanges(node.content.seqActivations),
      ...color(node, 'slate'),
    };
  }
  if (node.kind === 'sequence_note') {
    const position = node.content.seqNotePosition;
    const fragmentPresentation = fragment(node.content.seqFragment);
    return {
      kind: 'sequence_note',
      label: presentationString(node.content.label, 'Note'),
      targets: noteTargets(node.content),
      position: position === 'left' || position === 'right' ? position : 'over',
      order: order(node.content.seqMessageOrder),
      ...(fragmentPresentation ? { fragment: fragmentPresentation } : {}),
    };
  }
  const fragmentId = optionalPresentationString(node.content.seqFragmentId);
  if (node.kind !== 'annotation' || !fragmentId) return null;
  const condition = optionalPresentationString(node.content.subLabel);
  return {
    kind: 'sequence_fragment',
    fragmentId,
    label: presentationString(node.content.label, 'FRAGMENT'),
    ...(condition ? { condition } : {}),
    order: order(node.content.seqMessageOrder),
    divider: node.content.seqFragmentDivider === true,
    continued: node.content.seqFragmentContinued === true,
    ...color(node, 'violet'),
  };
}
