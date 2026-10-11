import { inferIcon } from '../autoIcon';
import type { ArchElement, ElementKind } from '../model/types';
import type { MapLook } from './scene';
import type { MapModel, MapNode } from './types';

// A repo map drawn with the C4 renderers: every box becomes a stand-in architecture element so the
// editor's own cards, colours and open frames apply, and `tags` replaces the C4 kind word on the card
// with a plain repo word ("Folder"). The card says the box's technology (what discovery found it runs,
// else the language most of its lines are in), with that technology's icon, and its size as a note.

/** What a reader calls each kind of box: the editor's cards, its box panel and the CLI viewer all say these. */
export const MAP_KIND_WORDS: Readonly<Record<MapNode['kind'], string>> = { part: 'Module', folder: 'Folder', file: 'File', group: 'Group', external: 'Outside service', more: 'More' };

// The stand-in C4 kind picks the card's colour: a module is blue, invented boxes and outside services are gray, the
// rest white. A kind's colour (unlike one the author chose) follows a dark canvas, so every closed box does.
const KIND: Record<MapNode['kind'], { element: ElementKind; icon: string }> = {
  part: { element: 'system', icon: 'tabler/box' },
  folder: { element: 'container', icon: 'tabler/folder' },
  file: { element: 'container', icon: 'tabler/file-code' },
  group: { element: 'external', icon: 'tabler/stack-2' },
  external: { element: 'external', icon: 'tabler/cloud' },
  more: { element: 'external', icon: 'tabler/dots' },
};

/** The languages the map reads sources in (facts.ts CODE), by extension. */
const LANGUAGE: Readonly<Record<string, string>> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', swift: 'Swift',
  php: 'PHP', cs: 'C#', scala: 'Scala', clj: 'Clojure', ex: 'Elixir', exs: 'Elixir',
};

/** facts.ts writes a discovered unit's description as `kind · tech`: the tech is what that part runs. */
const UNIT_DESC = /^(?:system|container|store|queue|external) · (.+)$/;

const OUTSIDE = 'root#outside'; // build.ts: the group that holds the externals
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// Invented groups hold no file count of their own (build.ts leaves 0): their files are their descendants'.
const filesIn = (model: MapModel, node: MapNode): number => node.files || node.children.reduce((n, id) => n + filesIn(model, model.nodes[id]), 0);

// Outside services a crowded group folds into a more box still count.
const externalsIn = (model: MapModel, node: MapNode): number =>
  node.children.reduce((n, id) => n + (model.nodes[id].kind === 'external' ? 1 : externalsIn(model, model.nodes[id])), 0);

const languageOf = (path: string): string | undefined => LANGUAGE[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];

/** The language most of a box's lines are in (each file counts at least one line, so unread files still vote). */
function mainLanguage(model: MapModel, node: MapNode): string | undefined {
  if (node.kind === 'file') return languageOf(node.path ?? node.id);
  const lines = new Map<string, number>();
  const walk = (at: MapNode): void => {
    if (at.kind === 'file') {
      const lang = languageOf(at.path ?? at.id);
      if (lang) lines.set(lang, (lines.get(lang) ?? 0) + Math.max(1, at.loc));
    }
    at.children.forEach((id) => walk(model.nodes[id]));
  };
  walk(node);
  return [...lines].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
}

function techOf(model: MapModel, node: MapNode): string | undefined {
  const found = !node.ai && node.desc ? UNIT_DESC.exec(node.desc)?.[1] : undefined;
  // A more box is a bucket of leftovers: the language most of them share would read as the box's own.
  return found ?? (node.kind === 'external' || node.kind === 'more' ? undefined : mainLanguage(model, node));
}

/** The quiet line under the name: how big the box is (never "0 files"). */
function noteOf(model: MapModel, node: MapNode): string | undefined {
  if (node.kind === 'file') return count(node.loc, 'line');
  if (node.kind === 'more') return node.desc;
  if (node.kind === 'external') return node.ai ? node.desc : undefined;
  if (node.id === OUTSIDE) return count(externalsIn(model, node), 'service');
  const files = filesIn(model, node);
  return files > 0 ? count(files, 'file') : undefined;
}

export function repoLook(model: MapModel, base: Omit<MapLook, 'arch' | 'tags'>): MapLook {
  const elements: ArchElement[] = [];
  const tags = new Map<string, string>();
  // Only the host's resolver decides whether an icon draws; a technology icon it cannot draw falls back to the kind's.
  const draws = (icon: string | null): icon is string => !!icon && (!base.resolveIcon || !!base.resolveIcon(icon));
  for (const node of Object.values(model.nodes)) {
    if (node.id === model.root) continue;
    const { element, icon: plain } = KIND[node.kind];
    const tech = techOf(model, node);
    // A part or a service may be named for what it is ("redis", "worker"); a folder or file name says nothing reliable.
    const named = node.kind === 'part' || node.kind === 'external' ? inferIcon(node.name, tech) : tech ? inferIcon('', tech) : null;
    const icon = draws(named) ? named : draws(plain) ? plain : 'none';
    const note = noteOf(model, node);
    elements.push({
      id: node.id, kind: element, name: node.name, parent: node.parent === model.root ? null : node.parent,
      tags: [], links: [], icon, ...(tech ? { tech } : {}), ...(note ? { desc: note } : {}),
    });
    tags.set(node.id, node.id === OUTSIDE ? 'Group' : MAP_KIND_WORDS[node.kind]);
  }
  // The icons are chosen here: the host's inference would name a card's kind with the C4 word.
  const { inferIcon: _inferIcon, ...plain } = base;
  return { ...plain, arch: { elements, relations: [], views: [], flows: [] }, tags };
}
