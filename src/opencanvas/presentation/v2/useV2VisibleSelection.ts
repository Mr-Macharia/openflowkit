import { useEffect } from 'react';
import { replaceSelection, type CanvasSelection } from '../../application/selection/selection';
import type { ScenePage } from '../../domain/document/types';
import { buildNodeStateMap } from '../../domain/scene/nodeState';

/** A hidden shape is never selected: hiding it (or its frame) from Layers, or ⌘A, left handles on nothing that could still be resized. */
export function useV2VisibleSelection(page: ScenePage | null, selection: CanvasSelection, applySelection: (selection: CanvasSelection) => void): void {
  useEffect(() => {
    if (!page || selection.nodeIds.length === 0) return;
    const states = buildNodeStateMap(page);
    const kept = selection.nodeIds.filter((id) => states.get(id)?.visible !== false);
    if (kept.length !== selection.nodeIds.length) applySelection(replaceSelection(kept));
  }, [page, selection, applySelection]);
}
