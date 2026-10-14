import { visibleWorldBounds } from '../../domain/camera/camera';
import { createBounds2d } from '../../domain/geometry/bounds';
import type { Bounds2d } from '../../domain/geometry/types';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import { basicNodeDecorations } from '../../domain/nodes/basicNodeDecorations';
import type { BasicNodeShape } from '../../domain/nodes/basicNodePresentation';
import { CHROME_ACCENT } from './chrome';
import { drawPixiNodeOutline } from './pixiNodeOutline';
import type { PixiRendererHost } from './PixiRendererHost';
import { getContentBounds } from './pixiHostQueries';

const SELECTION_STROKE = CHROME_ACCENT;
const MARQUEE_FILL = CHROME_ACCENT;

export interface PlacementGhost {
  readonly shape: BasicNodeShape | 'text';
  /** World bounds of the node a click (or the current drag) would create. */
  readonly bounds: Bounds2d;
}

/** Alignment guide lines (world coordinates) shown while a selection moves. */
export function setAlignmentGuides(h: PixiRendererHost, guides: { readonly x: number | null; readonly y: number | null } | null): void {
  h.alignmentGuides.clear();
  h.alignmentGuidesShown = Boolean(guides && (guides.x !== null || guides.y !== null));
  if (h.alignmentGuidesShown && guides) {
    const view = visibleWorldBounds(h.camera, h.getViewportSize());
    const width = 1 / h.camera.zoom;
    if (guides.x !== null) {
      h.alignmentGuides.moveTo(guides.x, view.y).lineTo(guides.x, view.y + view.height);
    }
    if (guides.y !== null) {
      h.alignmentGuides.moveTo(view.x, guides.y).lineTo(view.x + view.width, guides.y);
    }
    h.alignmentGuides.stroke({ color: 0x2563eb, width, alpha: 0.9 });
  }
  h.requestRender();
}

/** The shape a creation tool will drop, drawn under the pointer in world
 * space; null clears. Text ghosts as its box. */
export function setPlacementGhost(h: PixiRendererHost, ghost: PlacementGhost | null): void {
  h.placementGhost.clear();
  if (ghost) {
    const zoom = h.camera.zoom;
    const matrix = { a: 1, b: 0, c: 0, d: 1, tx: ghost.bounds.x, ty: ghost.bounds.y };
    const size = { width: ghost.bounds.width, height: ghost.bounds.height };
    const shape: BasicNodeShape = ghost.shape === 'text' ? 'rectangle' : ghost.shape;
    drawPixiNodeOutline(h.placementGhost, shape, size, matrix);
    h.placementGhost
      .fill({ color: SELECTION_STROKE, alpha: 0.05 })
      .stroke({ color: SELECTION_STROKE, alpha: 0.45, width: 1 / zoom });
    for (const decoration of basicNodeDecorations(shape, size)) {
      const points = decoration.map((point) => applyMatrixToPoint(matrix, point));
      h.placementGhost.poly(points.flatMap((point) => [point.x, point.y]), false)
        .stroke({ color: SELECTION_STROKE, alpha: 0.45, width: 1 / zoom });
    }
  }
  h.requestRender();
}

export function setMarquee(h: PixiRendererHost, screenBounds: Bounds2d | null): void {
  h.marquee.clear();
  if (screenBounds) {
    h.marquee
      .rect(screenBounds.x, screenBounds.y, screenBounds.width, screenBounds.height)
      .fill({ color: MARQUEE_FILL, alpha: 0.08 })
      .stroke({ color: SELECTION_STROKE, alpha: 0.8, width: 1 });
  }
  h.requestRender();
}

export function drawPrecisionGrid(h: PixiRendererHost): void {
  h.precisionGrid.clear();
  if (!h.page) return;
  const raw = h.page.extensions.openCanvasPrecision;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const settings = raw as Record<string, unknown>;
  const gridSize = typeof settings.gridSize === 'number' && Number.isFinite(settings.gridSize)
    ? Math.min(1000, Math.max(1, settings.gridSize)) : 20;
  const bounds = getContentBounds(h) ?? createBounds2d(0, 0, 1000, 1000);
  const left = Math.floor((bounds.x - 500) / gridSize) * gridSize;
  const top = Math.floor((bounds.y - 500) / gridSize) * gridSize;
  const right = bounds.x + bounds.width + 500;
  const bottom = bounds.y + bounds.height + 500;
  if (settings.gridEnabled === true) {
    for (let x = left; x <= right; x += gridSize) h.precisionGrid.moveTo(x, top).lineTo(x, bottom);
    for (let y = top; y <= bottom; y += gridSize) h.precisionGrid.moveTo(left, y).lineTo(right, y);
    h.precisionGrid.stroke({ color: 0xcbd5e1, width: 1, alpha: 0.35 });
  }
  const guides = Array.isArray(settings.guides) ? settings.guides : [];
  for (const guide of guides) {
    if (!guide || typeof guide !== 'object' || Array.isArray(guide)) continue;
    if (guide.axis === 'x' && typeof guide.position === 'number') {
      h.precisionGrid.moveTo(guide.position, top).lineTo(guide.position, bottom);
    } else if (guide.axis === 'y' && typeof guide.position === 'number') {
      h.precisionGrid.moveTo(left, guide.position).lineTo(right, guide.position);
    }
  }
  if (guides.length > 0) h.precisionGrid.stroke({ color: 0x2563eb, width: 1, alpha: 0.8 });
}
