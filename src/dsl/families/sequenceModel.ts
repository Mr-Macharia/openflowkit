import type { PaletteKey } from '../../opencanvas/domain/nodes/nodePalette';
import type { CanonicalAttribute } from '../sceneMeta';

export const LANE_WIDTH = 168;
export const LANE_GAP = 84;
export const HEADER = 48;
export const ACTOR_EXTRA = 40;
// A two-line label rides above its arrow, so the first row leaves the header that much room.
export const MESSAGE_OFFSET = 44;
export const MESSAGE_SPACING = 52;
export const NOTE_GAP = 12;
// A note starts this far above the line the next message would take.
export const NOTE_LIFT = 18;
export const LIFELINE_TAIL = 44;
export const PADDING = { right: 56, bottom: 16, left: 56 };
export const FRAGMENT_INSET = 40;
export const LABEL_LIFT = 3;
// Vertical room on the timeline: the space between two stacked things, a block's tag-and-guard band,
// the space under a block's last item, an arrowhead, a self call's loop, a bar's tail under its last message.
export const GAP = 8;
export const TAG_HEIGHT = 24;
export const CLOSE_PAD = 20;
export const ARROW_HALF = 4;
export const SELF_LOOP_DROP = 32;
export const MIN_ABOVE = 12;
export const ACTIVATION_TAIL = 12;
// The guard text starts this far right of the first lifeline, which the header tag (left of it) never reaches.
export const GUARD_INSET = 10;

export const FRAGMENT_COLORS: Readonly<Record<string, PaletteKey>> = {
  loop: 'blue', opt: 'amber', critical: 'red', break: 'red', par: 'emerald', alt: 'violet',
};
export const FRAGMENT_KINDS = new Set(['loop', 'alt', 'opt', 'par', 'break', 'critical']);
export const BRANCH_OF: Readonly<Record<string, 'alt' | 'par'>> = { else: 'alt', and: 'par' };
export const MESSAGE_ARROWS = new Set(['->', '-->', '->>', '-->>']);

export const PARTICIPANT_STEREOTYPES = new Set(['db', 'queue', 'icon']);

export interface ParticipantDraft {
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

export interface Activation {
  order: number;
  activate: boolean;
  /** Source line: the serializer writes it back in place, inside the block it was written in. */
  line: number;
}

export interface MessageDraft {
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

export interface NoteDraft {
  id: string;
  text: string;
  position: 'over' | 'left' | 'right';
  targets: string[];
  order: number;
  line: number;
  comments: string[];
  parent: string | null;
}

export interface BranchDraft {
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
export type TimelineEvent =
  | { kind: 'message'; index: number }
  | { kind: 'note'; index: number }
  | { kind: 'open'; id: string }
  | { kind: 'close'; id: string }
  | { kind: 'activation'; activation: Activation; participant: string };

export interface SeqModel {
  participants: ParticipantDraft[];
  messages: MessageDraft[];
  notes: NoteDraft[];
  branches: BranchDraft[];
  timeline: TimelineEvent[];
  autonumber: boolean;
  reserved: string[];
}

