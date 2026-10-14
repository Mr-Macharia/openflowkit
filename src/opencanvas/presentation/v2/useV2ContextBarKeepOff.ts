import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import type { ScenePage } from '../../domain/document/types';
import type { CanvasCamera } from '../../domain/camera/types';
import { worldToScreen } from '../../domain/camera/camera';
import { projectPageConnectors } from '../../domain/connectors/routeProjection';
import { connectorLabelPlate, resolveConnectorLabelStyle } from '../../domain/connectors/labelStyle';
import { semanticDetailLevel } from '../../infrastructure/pixi/viewportProjection';

interface ContextBarKeepOffInput {
  readonly page: ScenePage;
  readonly camera: CanvasCamera;
  readonly sectionRef: RefObject<HTMLElement | null>;
  readonly contextAnchor: DOMRect | null;
  readonly selectionIds: readonly string[];
  readonly selectedConnectorId: string | null;
}

/** What the context bar keeps off: the label plates of the selection's connectors (screen space); and focus goes back to the canvas when the bar goes. */
export function useV2ContextBarKeepOff({ page, camera, sectionRef, contextAnchor, selectionIds, selectedConnectorId }: ContextBarKeepOffInput): readonly DOMRect[] {
  // The bar can hold focus when it disappears (Escape clears the selection).
  // Focus would fall to body and every shortcut would go dead; hand it back.
  const barVisible = Boolean(contextAnchor) || Boolean(selectedConnectorId);
  const barRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const bar = sectionRef.current
      ?.querySelector<HTMLElement>('[data-context-bar]') ?? null;
    const previous = barRef.current;
    barRef.current = bar;
    if (bar || !previous) return;
    // The bar just went away. If it held focus, that focus is now on body or
    // on a detached button: hand the keyboard back to the canvas.
    const active = document.activeElement;
    const focusSurvived = Boolean(active && active !== document.body && active.isConnected
      && !previous.contains(active));
    if (focusSurvived) return;
    sectionRef.current?.focus({ preventScroll: true });
  }, [barVisible, sectionRef]);
  // The page's connectors as drawn, only while a selection has a bar to place; the camera does not change them.
  const hasBar = contextAnchor !== null && selectionIds.length > 0;
  const pageProjection = useMemo(() => (hasBar ? projectPageConnectors(page) : []), [hasBar, page]);
  // Label plates of the connectors touching the selection, in screen space: the bar keeps off them.
  return useMemo(() => {
    // Below full detail the canvas draws no connector labels, so there is nothing to keep off.
    if (!contextAnchor || selectionIds.length === 0 || semanticDetailLevel(camera.zoom) !== 'full') return [];
    const selected = new Set(selectionIds);
    const touching = new Map(page.connectors.filter((connector) => connector.labels.length > 0
      && (selected.has(connector.source.nodeId ?? '') || selected.has(connector.target.nodeId ?? '')))
      .map((connector) => [connector.id, connector]));
    // The whole page: a label sits where it does because of its neighbours, so a subset would put it elsewhere.
    return pageProjection.filter((projected) => touching.has(projected.id)).flatMap((projected) => {
      const style = resolveConnectorLabelStyle(touching.get(projected.id)!);
      return projected.labels.map(({ text, point }) => {
        const plate = connectorLabelPlate(text, style, point);
        const from = worldToScreen(camera, { x: plate.x, y: plate.y });
        const to = worldToScreen(camera, { x: plate.x + plate.width, y: plate.y + plate.height });
        return new DOMRect(from.x, from.y, to.x - from.x, to.y - from.y);
      });
    });
  }, [contextAnchor, selectionIds, pageProjection, page, camera]);
}
