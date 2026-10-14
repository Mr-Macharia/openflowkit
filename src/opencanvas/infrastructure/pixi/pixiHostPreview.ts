import type { Point2d } from '../../domain/geometry/types';
import type { SceneConnector } from '../../domain/document/types';
import type { TransformResult } from '../../domain/transforms/types';
import { projectPageConnectors } from '../../domain/connectors/routeProjection';
import { inspectConnectorSamples } from './PixiConnectorInspection';
import type { PixiRendererHost } from './PixiRendererHost';
import { finishReveal } from './pixiHostReveal';
import { drawConnectorEditOverlay, rebuildScene } from './pixiHostScene';

/** Screen point of the connector's primary label, for the label editor. */
export function getConnectorLabelScreenPoint(h: PixiRendererHost, connectorId: string): Point2d | null {
  // The whole page, so the editor opens where the canvas drew the label: placement depends on its neighbours.
  const projected = h.page?.connectors.some((candidate) => candidate.id === connectorId)
    ? projectPageConnectors(h.page).find((candidate) => candidate.id === connectorId) : null;
  const label = projected?.labels[0];
  return label ? h.worldToScreen(label.point) : null;
}

/** Live route samples: projected against the in-flight transform preview
 * when a drag is active, so tests can observe rerouting mid-gesture. */
export function getLiveConnectorSamples(h: PixiRendererHost, connectorId: string): readonly Point2d[] | null {
  if (!h.page) return null;
  const connector = h.page.connectors.find((candidate) => candidate.id === connectorId);
  if (!connector) return null;
  if (!h.previewResult || h.previewCopy) return inspectConnectorSamples(h.page, connectorId);
  const replacements = new Map(h.previewResult.nodes.map((node) => [node.id, node]));
  const previewPage = {
    ...h.page,
    nodes: h.page.nodes.map((node) => replacements.get(node.id) ?? node),
  };
  return inspectConnectorSamples(previewPage, connectorId);
}

export function setConnectorPreview(h: PixiRendererHost, connector: SceneConnector | null): void {
  if (!h.page) return;
  // While an end or segment is dragged, only the edited line shows; the old path would read as a second connector.
  const previewId = connector?.id ?? null;
  if (previewId !== h.previewConnectorId) {
    h.previewConnectorId = previewId;
    rebuildScene(h, false);
  }
  if (!connector) {
    h.setDropTarget(null);
    drawConnectorEditOverlay(h);
  } else {
    const previewPage = {
      ...h.page,
      connectors: h.page.connectors.map((item) =>
        item.id === connector.id ? connector : item
      ),
    };
    h.connectorEditOverlay.draw(previewPage, [connector], h.camera.zoom, h.activeConnectorHandle);
  }
  h.requestRender();
}

/** The connector being dragged out, routed live like it will be once committed. */
export function setConnectionPreview(h: PixiRendererHost, connector: SceneConnector | null): void {
  if (!connector || !h.page) {
    h.setDropTarget(null);
    h.connectionPreview.container.visible = false;
  } else {
    h.connectionPreview.draw({ ...h.page, connectors: [connector] }, true);
    h.connectionPreview.container.visible = true;
  }
  h.requestRender();
}

export function setTransformPreview(h: PixiRendererHost, result: TransformResult | null, copy: boolean): void {
  // A drag on a shape still building in would leave its reveal copy behind as a ghost: the reveal ends, whole.
  if (result) finishReveal(h, true);
  if (h.livePreview) {
    const started = !h.previewResult && result !== null;
    const ended = h.previewResult !== null && !result;
    const copyChanged = h.previewCopy !== (copy && result !== null);
    h.previewResult = result;
    h.previewCopy = copy && result !== null;
    if (started || ended || copyChanged) rebuildScene(h);
    h.selectionOverlay.graphics.visible = result === null;
    if (!result) {
      if (h.previewFrame !== null) cancelAnimationFrame(h.previewFrame);
      h.previewFrame = null;
      h.livePreview.clear();
      h.requestRender();
    } else if (h.previewFrame === null) {
      h.previewFrame = requestAnimationFrame(() => {
        h.previewFrame = null;
        if (h.page && h.index && h.previewResult) {
          h.livePreview?.draw(h.page, h.index, h.previewResult, h.camera.zoom, h.backgroundColor, !h.previewCopy);
          h.renderNow();
        }
      });
    }
    return;
  }
  if (!result || !h.page) h.transformOverlay.clear();
  else
    h.transformOverlay.draw(
      h.page,
      result.nodes,
      result.bounds,
      h.camera,
      result.snappedX,
      result.snappedY
    );
  h.selectionOverlay.graphics.visible = result === null;
  h.requestRender();
}
