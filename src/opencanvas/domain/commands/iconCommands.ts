import type { DocumentCommand, InsertNodeCommand } from './types';
import type { ScenePage } from '../document/types';
import type { Point2d } from '../geometry/types';
import { buildNodeStateMap } from '../scene/nodeState';
import { resolveArchitectureNodePresentation, type IconCardPlacement } from '../nodes/architectureNodePresentation';
import { iconCardSize } from '../nodes/iconCardLayout';
import { createIconNode, resizedAroundCentre, withIcon, withIconPlacement, type IconChoice } from '../nodes/iconNode';
import { adoptOnInsert } from '../transforms/containment';

/** Swap the icon on every unlocked selected node as one undo step. */
export function buildSetIconCommand(page: ScenePage, ids: readonly string[], icon: IconChoice): DocumentCommand | null {
  const selected = new Set(ids);
  const states = buildNodeStateMap(page);
  const commands: DocumentCommand[] = page.nodes
    .filter((node) => selected.has(node.id) && !states.get(node.id)?.locked)
    .map((before) => ({ kind: 'set-node', id: `icon:${before.id}`, label: 'Change icon', pageId: page.id, before, after: withIcon(before, icon) }));
  return commands.length ? { kind: 'batch', id: 'set-icon', label: 'Change icon', commands } : null;
}

/**
 * Put the icon above the caption (a tile) or left of the text (a row card) on every unlocked selected icon card, as
 * one undo step. Each card takes the size its text hugs in the new layout, around the centre it had. Null when
 * nothing changes.
 */
export function buildSetIconPlacementCommand(page: ScenePage, ids: readonly string[], placement: IconCardPlacement): DocumentCommand | null {
  const selected = new Set(ids);
  const states = buildNodeStateMap(page);
  const commands: DocumentCommand[] = [];
  for (const before of page.nodes) {
    const card = resolveArchitectureNodePresentation(before);
    if (!selected.has(before.id) || states.get(before.id)?.locked || card?.display !== 'provider-icon' || card.iconPlacement === placement) continue;
    const placed = { ...before, content: withIconPlacement(before.content, placement) };
    const after = resizedAroundCentre(placed, iconCardSize(placed));
    commands.push({ kind: 'set-node', id: `icon-placement:${before.id}`, label: 'Icon placement', pageId: page.id, before, after });
  }
  return commands.length ? { kind: 'batch', id: 'set-icon-placement', label: 'Icon placement', commands } : null;
}

export function buildInsertIconCommand(page: ScenePage, options: { readonly id: string; readonly at: Point2d; readonly icon: IconChoice }): InsertNodeCommand {
  const node = adoptOnInsert(page, createIconNode(page, options));
  return { kind: 'insert-node', id: `create-node:${node.id}`, label: `Add ${options.icon.label}`, pageId: page.id, index: page.nodes.length, node };
}
