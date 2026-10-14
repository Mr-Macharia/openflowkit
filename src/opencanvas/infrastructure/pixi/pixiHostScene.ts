import { isDarkCanvas, numericColorToHex } from '../../domain/color/adaptiveColor';
import { visibleWorldBounds } from '../../domain/camera/camera';
import { recordOpenCanvasCameraPhase } from '../../application/renderer/renderWorkMeasurement';
import type { SceneConnector } from '../../domain/document/types';
import { getDescendantNodeIds, querySceneBounds } from '../../domain/scene/queries';
import { applyTextResolution, currentPixiTextResolution, textResolutionForZoom } from './pixiText';
import { projectSceneViewport, viewportProjectionEquals, type ViewportSceneProjection } from './viewportProjection';
import type { PixiRendererHost } from './PixiRendererHost';
import { drawFocus } from './pixiHostFocus';
import { drawPrecisionGrid } from './pixiHostOverlays';

export function drawDotGrid(h: PixiRendererHost): void {
  h.dotGrid.graphics.visible = h.showDotGrid;
  if (h.showDotGrid) h.dotGrid.draw(h.camera, h.getViewportSize(), isDarkCanvas(numericColorToHex(h.backgroundColor)));
}

export function settleCamera(h: PixiRendererHost): void {
  if (!h.cameraDirty) return;
  h.cameraDirty = false;
  const cameraStartedAt = performance.now();
  const camera = h.camera;
  drawDotGrid(h);
  if (h.motionActive) {
    // Mid-move the camera only moves the world: no projection change (that would rebuild the scene), no label or overlay work.
    h.connectorRenderer.setZoom(camera.zoom);
    const resolution = textResolutionForZoom(camera.zoom, window.devicePixelRatio || 1);
    if (resolution !== currentPixiTextResolution()) { applyTextResolution(h.world, resolution); applyTextResolution(h.focusOverlay.content, resolution); }
    return;
  }
  drawSelection(h);
  h.connectorRenderer.setZoom(camera.zoom);
  const textResolution = textResolutionForZoom(camera.zoom, window.devicePixelRatio || 1);
  if (textResolution !== currentPixiTextResolution()) { applyTextResolution(h.world, textResolution); applyTextResolution(h.focusOverlay.content, textResolution); }
  drawProposalPreview(h);
  drawFocus(h);

  const overlayStartedAt = performance.now();
  drawConnectorEditOverlay(h);
  const overlayEndedAt = performance.now();
  recordOpenCanvasCameraPhase(
    performance,
    'connectorOverlay',
    overlayStartedAt,
    overlayEndedAt
  );

  const projectionStartedAt = performance.now();
  const projectionChanged = refreshViewportProjection(h);
  const projectionEndedAt = performance.now();
  recordOpenCanvasCameraPhase(
    performance,
    'projection',
    projectionStartedAt,
    projectionEndedAt
  );

  if (projectionChanged) {
    const rebuildStartedAt = performance.now();
    rebuildScene(h);
    recordOpenCanvasCameraPhase(performance, 'rebuild', rebuildStartedAt, performance.now());
  } else {
    const labelsStartedAt = performance.now();
    updateLabelVisibility(h);
    recordOpenCanvasCameraPhase(performance, 'labels', labelsStartedAt, performance.now());
  }

  recordOpenCanvasCameraPhase(performance, 'total', cameraStartedAt, performance.now());
}

export function rebuildScene(h: PixiRendererHost, redrawNodes = true): void {
  if (!h.page || !h.index) return;
  const index = h.index;
  drawPrecisionGrid(h);
  // Preview nodes and everything under them draw in the live preview layer.
  const excluded = new Set(h.previewCopy ? [] : h.previewResult?.nodes.flatMap((node) =>
    [node.id, ...getDescendantNodeIds(index, node.id)]));
  const renderedNodeIds = excluded.size
    ? new Set(h.page.nodes.filter((node) => !excluded.has(node.id)
      && (!h.viewportProjection?.nodeIds || h.viewportProjection.nodeIds.has(node.id))).map((node) => node.id))
    : h.viewportProjection?.nodeIds ?? null;
  const projected = h.viewportProjection?.connectorIds ?? null;
  const renderedConnectorIds = excluded.size || h.previewConnectorId
    ? new Set(h.page.connectors.filter((edge) => !excluded.has(edge.source.nodeId ?? '')
      && !excluded.has(edge.target.nodeId ?? '') && edge.id !== h.previewConnectorId
      && (excluded.size > 0 || !projected || projected.has(edge.id))).map((edge) => edge.id))
    : projected;
  const detailLevel = h.viewportProjection?.detailLevel ?? 'full';
  // Agent reveal: the change's shapes draw in the reveal layers until it ends.
  const reveal = h.reveal;
  const nodeIds = reveal ? new Set([...(renderedNodeIds ?? h.page.nodes.map((node) => node.id))].filter((id) => !reveal.nodes.has(id))) : renderedNodeIds;
  const connectorIds = reveal
    ? new Set([...(renderedConnectorIds ?? h.page.connectors.map((edge) => edge.id))].filter((id) => !reveal.connectors.has(id))) : renderedConnectorIds;
  h.connectorRenderer.draw(h.page, h.connectorModelEnabled, connectorIds, numericColorToHex(h.backgroundColor));
  if (redrawNodes) {
    h.containerRenderer.draw(h.page, index, nodeIds, h.backgroundColor);
    h.nodeRenderer.draw(h.page, index, nodeIds, detailLevel, h.backgroundColor);
  }
  updateLabelVisibility(h);
  drawSelection(h);
  drawProposalPreview(h);
  drawFocus(h);
  h.requestRender();
}

export function drawProposalPreview(h: PixiRendererHost): void {
  if (h.proposalFrame && h.page) h.proposalPreview.draw(h.page, h.proposalFrame, h.camera.zoom, h.backgroundColor);
  else h.proposalPreview.clear();
}

export function drawSelection(h: PixiRendererHost): void {
  if (!h.index) return;
  h.selectionOverlay.draw(
    h.index,
    h.selectedNodeIds,
    h.primaryNodeId,
    h.camera.zoom,
    h.hoveredNodeId ? { nodeId: h.hoveredNodeId, side: h.hoveredSide } : null,
    h.dropTargetId,
    h.hoveredConnectorId && !h.selectedConnectorIds.includes(h.hoveredConnectorId)
      ? h.getLiveConnectorSamples(h.hoveredConnectorId) : null,
    h.editable
  );
}

function getSelectedConnectors(h: PixiRendererHost): readonly SceneConnector[] {
  const selected = new Set(h.selectedConnectorIds);
  return h.page?.connectors.filter((connector) => selected.has(connector.id)
    && connector.metadata.hidden !== true && connector.metadata.locked !== true) ?? [];
}

export function getSelectedConnector(h: PixiRendererHost): SceneConnector | null {
  const connectors = getSelectedConnectors(h);
  return connectors.length === 1 ? connectors[0]! : null;
}

export function drawConnectorEditOverlay(h: PixiRendererHost): void {
  const connectors = getSelectedConnectors(h);
  if (!h.page || connectors.length === 0 || !h.editable) {
    h.connectorEditOverlay.clear();
    return;
  }
  h.connectorEditOverlay.draw(h.page, connectors, h.camera.zoom, h.activeConnectorHandle);
}

export function updateLabelVisibility(h: PixiRendererHost): void {
  if (!h.index || !h.app.renderer) return;
  // Overview draws no labels; otherwise each label shows while it is readable on screen (labelReadable).
  if (h.viewportProjection?.detailLevel === 'overview') {
    h.nodeRenderer.setLabelVisibility(null, h.camera.zoom);
    h.containerRenderer.setLabelVisibility(null, h.camera.zoom);
    return;
  }
  const visibleIds = new Set(
    querySceneBounds(h.index, visibleWorldBounds(h.camera, h.getViewportSize()), {
      kinds: new Set(['node', 'container']),
    }).map((object) => object.id)
  );
  h.nodeRenderer.setLabelVisibility(visibleIds, h.camera.zoom);
  h.containerRenderer.setLabelVisibility(visibleIds, h.camera.zoom);
}

export function createViewportProjection(h: PixiRendererHost): ViewportSceneProjection | null {
  if (!h.index) return null;
  return projectSceneViewport(h.index, h.camera, h.getViewportSize(), {
    retainedNodeIds: h.selectedNodeIds,
  });
}

export function refreshViewportProjection(h: PixiRendererHost): boolean {
  const next = createViewportProjection(h);
  if (!next || viewportProjectionEquals(h.viewportProjection, next)) return false;
  h.viewportProjection = next;
  return true;
}
