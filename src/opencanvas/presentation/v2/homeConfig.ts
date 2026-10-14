import { IconArchive, IconClock, IconStar, IconTemplate } from '@tabler/icons-react';
import type { IconComponent } from '../design-system';
import type { StartKind } from './V2HomeCards';
import type { V2StartIntent } from './v2Document';
import type { HomeSort, HomeView } from './homeLibrary';

// Checked-in pictures of the starter templates (homeTemplates.test.ts keeps them true):
// home never loads the compiler or ELK to show them.
export const TEMPLATE_PICTURES = import.meta.glob<string>('./homeTemplates/*.svg', { query: '?url', import: 'default', eager: true });
export const templatePicture = (name: string, theme: 'light' | 'dark') => TEMPLATE_PICTURES[`./homeTemplates/${name}-${theme}.svg`];
/**
 * A template near the card's shape shows whole; a long strip or a tall flow starts top left at a readable zoom (U4-20:
 * fitted, an 8:1 pipeline was a 10px sliver). Up to 2.2:1 it still fills most of the 16:10 card, readable.
 */
export const templateFit = ({ naturalWidth, naturalHeight }: HTMLImageElement): 'whole' | 'start' => {
  const aspect = naturalWidth / Math.max(1, naturalHeight);
  return aspect >= 0.8 && aspect <= 2.2 ? 'whole' : 'start';
};

export const STARTS: readonly { kind: StartKind; title: string; chip: string; hint: string; text: string; intent?: V2StartIntent }[] = [
  { kind: 'blank', title: 'Blank canvas', chip: 'Blank canvas', hint: 'Draw by hand', text: 'Shapes, arrows and text, by hand.' },
  { kind: 'assistant', title: 'Describe it to AI', chip: 'Ask AI', hint: 'Describe it in words', text: 'Say what you need; review before it lands.', intent: { start: 'assistant' } },
  { kind: 'code', title: 'Paste code or Mermaid', chip: 'From code', hint: 'Mermaid, D2, Structurizr', text: 'Text in, diagram out. D2 and Structurizr too.', intent: { start: 'code' } },
  { kind: 'agent', title: 'Connect your agent', chip: 'Connect agent', hint: 'Claude Code, Cursor', text: 'Claude Code or Cursor draws here over MCP.', intent: { start: 'agent' } },
];
export const NEWS_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
export const VIEWS: readonly { view: HomeView; title: string; icon: IconComponent }[] = [
  { view: 'recents', title: 'Recents', icon: IconClock },
  { view: 'starred', title: 'Starred', icon: IconStar },
  { view: 'templates', title: 'Templates', icon: IconTemplate },
  { view: 'archive', title: 'Archive', icon: IconArchive },
];
export const SORTS: readonly { sort: HomeSort; title: string }[] = [{ sort: 'edited', title: 'Last edited' }, { sort: 'name', title: 'Name' }];

/** Keys meant for a field, a menu's typeahead or a dialog are not page shortcuts. */
export const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
    || target.closest('[role="menu"], [role="dialog"], dialog') !== null);
export const viewLink = (view: HomeView) => ({ search: view === 'recents' ? '' : `?view=${view}` });
export const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;
