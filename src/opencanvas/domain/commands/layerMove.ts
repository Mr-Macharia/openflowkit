import type { BatchDocumentCommand, SetNodeCommand } from './types';
import type { SceneNode, ScenePage } from '../document/types';
import { isBackdropNode, resolveContainerNodePresentation } from '../nodes/containerNodePresentation';
import { frameInsets } from '../../../dsl/layout';
import { buildNodeStateMap } from '../scene/nodeState';
import { buildNodeWorldMatrices } from '../scene/worldGeometry';
import { dropTargetFilter, withParentInPlace } from '../transforms/containment';
import { placedElementId } from '../../../dsl/model/model';

/** Layers order, front to back as the canvas paints: shapes over containers, then z. */
export function layerFrontFirst(left: SceneNode, right: SceneNode): number {
  return Number(isBackdropNode(left)) - Number(isBackdropNode(right)) || right.zIndex - left.zIndex;
}

/** Where a dragged Layers row lands: under `parentId` (null: the page), at `index` among its other children, front first. */
export interface LayerDrop {
  readonly parentId: string | null;
  readonly index: number;
}

function parentOf(node: SceneNode, byId: ReadonlyMap<string, SceneNode>): string | null {
  return node.parentId && byId.has(node.parentId) ? node.parentId : null;
}

/**
 * Whether a row may be dropped under `parentId`. Reordering among its own siblings needs only a shown, unlocked node.
 * A new parent follows the canvas drop: into a container `dropTargetFilter` allows (never a group, a generated diagram,
 * a C4 view, nor anything hidden or locked), never into itself; group members, model placements and C4 view frames stay put.
 */
export function layerDropAllowed(page: ScenePage, nodeId: string, parentId: string | null): boolean {
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  const node = byId.get(nodeId);
  const state = buildNodeStateMap(page).get(nodeId);
  if (!node || !state?.visible || state.locked) return false;
  const current = parentOf(node, byId);
  if (parentId === current) return true;
  const dsl = node.metadata.dsl;
  if (placedElementId(node) !== null || (dsl && typeof dsl === 'object' && 'arch' in dsl)) return false;
  if (current && byId.get(current)!.kind === 'group') return false;
  if (parentId === null) return true;
  const target = byId.get(parentId);
  if (!target || !dropTargetFilter(page)(target)) return false;
  for (let at: SceneNode | undefined = target, hops = 0; at && hops <= page.nodes.length; at = byId.get(at.parentId ?? ''), hops += 1) {
    if (at.id === nodeId) return false;
  }
  return true;
}

/**
 * A Layers drag as one undo step: the node joins `drop.parentId` where it stands on the canvas (as a canvas drop does),
 * or inside it when it stands outside, and takes the z between its new neighbours in its paint band. Null when refused or when nothing would change.
 */
export function buildLayerMoveCommand(page: ScenePage, nodeId: string, drop: LayerDrop): BatchDocumentCommand | null {
  if (!layerDropAllowed(page, nodeId, drop.parentId)) return null;
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  const node = byId.get(nodeId)!;
  const placed = parentOf(node, byId) === drop.parentId ? node
    : insideParent(withParentInPlace(node, drop.parentId, buildNodeWorldMatrices(page)), drop.parentId ? byId.get(drop.parentId)! : null);
  // Containers always paint under shapes: the node lands among the siblings in its own band.
  const backdrop = isBackdropNode(node);
  const siblings = page.nodes.filter((other) => other.id !== nodeId && parentOf(other, byId) === drop.parentId).sort(layerFrontFirst);
  const band = siblings.filter((other) => isBackdropNode(other) === backdrop);
  const ahead = siblings.slice(0, Math.max(0, drop.index)).filter((other) => isBackdropNode(other) === backdrop).length;
  // Back to front, as z counts, everything but the node: it goes just above the band sibling behind the drop line,
  // else just below the one ahead of it; with neither (an empty container) it keeps its place.
  const paint = page.nodes.map((other, index) => ({ other, index })).filter(({ other }) => other.id !== nodeId)
    .sort((left, right) => left.other.zIndex - right.other.zIndex || left.index - right.index).map(({ other }) => other);
  const stays = paint.filter((other) =>
    other.zIndex < node.zIndex || (other.zIndex === node.zIndex && page.nodes.indexOf(other) < page.nodes.indexOf(node))).length;
  const behind = band[ahead];
  const inFront = band[ahead - 1];
  const at = behind ? paint.indexOf(behind) + 1 : inFront ? paint.indexOf(inFront) : stays;
  const low = paint[at - 1]?.zIndex;
  const high = paint[at]?.zIndex;
  const zAt = new Map<string, number>();
  if (at === stays) zAt.set(nodeId, node.zIndex);
  else if (high === undefined) zAt.set(nodeId, low! + 1);
  else if (low === undefined) zAt.set(nodeId, high - 1);
  else if (high - low >= 2) zAt.set(nodeId, low + 1);
  // No room between the neighbours: renumber the page, order kept.
  else [...paint.slice(0, at), node, ...paint.slice(at)].forEach((other, index) => zAt.set(other.id, index));
  const commands: SetNodeCommand[] = [];
  for (const other of page.nodes) {
    const base = other.id === nodeId ? placed : other;
    const zIndex = zAt.get(other.id) ?? other.zIndex;
    if (base === other && zIndex === other.zIndex) continue;
    commands.push({ kind: 'set-node', id: `layer-move:${other.id}`, label: 'Move layer', pageId: page.id, before: other, after: { ...base, zIndex } });
  }
  return commands.length ? { kind: 'batch', id: `layer-move:${nodeId}`, label: 'Move layer', commands } : null;
}

/**
 * A shape that joined `parent` where it stands keeps that place when its centre is in the parent's content area (what a
 * canvas drop leaves); otherwise it moves to the content's top-left, below the title band. A child outside its parent
 * is a state the canvas never makes, and its next drag would silently take it out again.
 * ponytail: top-left even over other children, and an oversized shape overhangs — no free-spot search or container growth.
 */
function insideParent(node: SceneNode, parent: SceneNode | null): SceneNode {
  const presentation = parent && resolveContainerNodePresentation(parent);
  if (!parent || !presentation) return node;
  const inset = frameInsets(presentation.header);
  const { x, y } = node.transform.translation;
  const centre = { x: x + (node.size.width * node.transform.scale.x) / 2, y: y + (node.size.height * node.transform.scale.y) / 2 };
  const inside = centre.x >= inset.left && centre.x <= parent.size.width - inset.right
    && centre.y >= inset.top && centre.y <= parent.size.height - inset.bottom;
  return inside ? node : { ...node, transform: { ...node.transform, translation: { x: inset.left, y: inset.top } } };
}

/**
 * Whether the node already paints in front of (or behind) everything in its band: then Bring forward / to front
 * (or Send backward / to back) would change nothing on screen. Containers and shapes are separate bands.
 */
export function layerPaintEdges(page: ScenePage, nodeId: string): { readonly front: boolean; readonly back: boolean } {
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { front: true, back: true };
  const band = page.nodes.map((other, index) => ({ other, index })).filter(({ other }) => isBackdropNode(other) === isBackdropNode(node))
    .sort((left, right) => left.other.zIndex - right.other.zIndex || left.index - right.index);
  return { front: band.at(-1)?.other === node, back: band[0]?.other === node };
}
