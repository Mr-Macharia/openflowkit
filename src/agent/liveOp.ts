// Run one op against the live editor session: the rules every live transport shares (the MCP bridge, WebMCP).
// Registry lookup, the page the op lands on, the person's selection, the read-only refusal, one commit (one undo
// step) and the camera reveal live here once, so no transport can drift from another.
import { commandTouchedRoots } from '../opencanvas/application/ai/proposalSession';
import type { DocumentCommand } from '../opencanvas/domain/commands/types';
import type { SceneDocumentV1 } from '../opencanvas/domain/document/types';
import type { OpCapabilities } from './ops/types';
import { pageHolding, resolveAgentOpCommand } from './runAction';

export interface LiveAgentSession {
  readonly document: SceneDocumentV1 | null;
  /** The page the editor shows. */
  readonly pageId: string | null;
  /** Capabilities the browser can honour (compile, syntax, icons, export, camera). */
  readonly capabilities: OpCapabilities;
  /** Commits as one undo step; false when the session refused it (a locked page), so nothing landed. */
  readonly commit: (command: DocumentCommand) => boolean | void;
  /** A document the reader cannot edit (a shared link, a repo map): an agent's change is refused, and told so. */
  readonly readOnly?: boolean;
  /** A page that stays as it is (a repo document's map page): a change addressed to it is refused, whichever page the reader is on. */
  readonly lockedPageId?: string | null;
  /** Node and connector ids the person has selected now, so an agent can act on "the box I selected" (get_document). */
  readonly selectedIds?: () => readonly string[];
  /** After an agent edit on the page in view, with the top-level nodes it added or changed (to bring them into view). */
  readonly onApplied?: (nodeIds: readonly string[]) => void;
}

export const READ_ONLY_REFUSAL = 'This document is read-only, so the editor did not apply the change.';

export interface LiveOpResult {
  readonly output: unknown;
  /** The command committed (its label is the undo label), or null for a read. */
  readonly command: DocumentCommand | null;
}

/** Why a cancelled call stopped: the reason it was aborted with, when that is an Error. */
function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('The call was cancelled.');
}

/**
 * Throws with a message meant for the agent; commits at most one command. `current` is read at the start (document,
 * page, selection) and again once the op has resolved (lock, commit): an op that compiles can outlive a change to either.
 */
export async function runLiveAgentOp(current: () => LiveAgentSession, name: string, input: unknown, requestedPageId?: string, signal?: AbortSignal): Promise<LiveOpResult> {
  stopIfAborted(signal);
  // The registry loads with the first call, so an editor no agent talks to never downloads it.
  const { findAgentOp } = await import('./ops');
  const op = findAgentOp(name);
  if (!op) throw new RangeError(`Unknown op "${name}".`);
  const session = current();
  const { document, capabilities } = session;
  if (!document) throw new Error('The editor has no document open.');
  // The page the op will run on (a named frame's own page), so the read-only check and the camera agree with it.
  const pageId = pageHolding({ document, pageId: requestedPageId ?? session.pageId ?? document.pages[0]?.id ?? '', capabilities }, input);
  const selection = { pageId: session.pageId, ids: session.selectedIds?.() ?? [] };
  const outcome = await resolveAgentOpCommand(op, input, { document, pageId, capabilities, selection });
  if (!outcome.command) return { output: outcome.output, command: null };
  stopIfAborted(signal);
  const now = current();
  if (now.readOnly || (now.lockedPageId ?? null) === pageId) throw new Error(READ_ONLY_REFUSAL);
  if (now.commit(outcome.command) === false) throw new Error(READ_ONLY_REFUSAL);
  // Only an edit on the page in view moves the camera, so only that one pays for the diff.
  if (pageId === now.pageId && now.onApplied) {
    const touched = commandTouchedRoots(document, outcome.command, pageId);
    if (touched.length) now.onApplied(touched);
  }
  return { output: outcome.output, command: outcome.command };
}
