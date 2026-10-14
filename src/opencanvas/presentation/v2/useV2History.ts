import type { useDocumentSession } from '../../application/session/useDocumentSession';
import { drawingSourceOf } from '../../application/map/pinPage';
import type { DocumentCommand } from '../../domain/commands/types';
import { pageOfCommand } from '../../domain/commands/pageTouch';
import type { ScenePage } from '../../domain/document/types';
import type { ToastItem } from '../design-system';
import type { useV2MapMode } from './map/useV2MapMode';

interface HistoryInput {
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly page: ScenePage | null;
  readonly setActivePageId: (pageId: string | null) => void;
  readonly showDrawing: (pageId: string) => void;
  readonly setAnnouncement: (message: string) => void;
  readonly pushToast: (toast: ToastItem) => void;
}

/** Undo and redo that follow the page they change, and say what they did where the map shows nothing. */
export function useV2History({ session, map, page, setActivePageId, showDrawing, setAnnouncement, pushToast }: HistoryInput) {
  // Undo and redo show the page they change: a step on a page that is not on screen (a drawing, from its map) would
  // otherwise happen out of sight. A drawing is shown the way its map's Canvas shows it (camera kept).
  const followStep = (step: { readonly command: DocumentCommand } | undefined, gone: 'insert-page' | 'remove-page') => {
    // A step that takes its page away (undoing an insert, redoing a remove), also inside a batch, has nothing to show.
    const removes = (command: DocumentCommand): boolean => command.kind === 'batch' ? command.commands.some(removes) : command.kind === gone;
    const target = step && !removes(step.command) ? pageOfCommand(step.command) : null;
    const document = session.document;
    if (!target || !page || target === page.id || !document?.pages.some((candidate) => candidate.id === target)) return false;
    const drawing = document.pages.find((candidate) => candidate.id === target);
    if (map.active && drawing && drawingSourceOf(drawing) === page.id) showDrawing(target);
    else setActivePageId(target);
    return true;
  };
  // In Map nothing on screen changes for a step the map does not show: one toast says what happened (redo replaces undo's).
  const sayStep = (verb: 'Undid' | 'Redid', command: DocumentCommand | undefined) => {
    if (!command) return;
    const page = command.kind === 'insert-page' || command.kind === 'remove-page' ? command.page.name : null;
    const gone = (verb === 'Undid') === (command.kind === 'insert-page');
    const title = page ? `${gone ? 'Removed' : 'Restored'} the page “${page}”` : `${verb} ${command.label.toLowerCase()}`;
    setAnnouncement(title);
    pushToast({ id: 'map-history', tone: 'info', title });
  };
  const undo = () => {
    const step = session.session?.history.past.at(-1);
    const followed = followStep(step, 'insert-page');
    session.undo();
    if (step && map.active && !followed) sayStep('Undid', step.command);
  };
  const redo = () => {
    const step = session.session?.history.future[0];
    const followed = followStep(step, 'remove-page');
    session.redo();
    if (step && map.active && !followed) sayStep('Redid', step.command);
  };
  return { undo, redo };
}
