import { FLOW_SPEED } from './PixiFocusOverlay';
import type { PixiRendererHost } from './PixiRendererHost';

export function drawFocus(h: PixiRendererHost): void {
  if (!h.page || !h.focusFrame) {
    h.focusOverlay.clear();
    syncFlow(h);
    return;
  }
  // The SVG map dims to 0.35 opacity, so its veil is 0.65; the storyboard's stays 0.62.
  h.focusOverlay.drawScreen(h.getViewportSize(), h.backgroundColor, h.focusFrame.tone === 'selection' ? 0.65 : 0.62);
  h.focusOverlay.draw(h.page, h.focusFrame, h.camera.zoom, h.backgroundColor);
  syncFlow(h);
}

/** What is focused now, and whether its arrows are marching (false under reduced motion, hidden tabs and mid-move). */
export function getFocusState(h: PixiRendererHost): { nodeIds: readonly string[]; connectorIds: readonly string[]; twoWayIds: readonly string[]; animating: boolean } | null {
  return h.focusFrame
    ? { nodeIds: h.focusFrame.nodeIds, connectorIds: h.focusFrame.connectorIds, twoWayIds: h.focusOverlay.twoWayIds(), animating: h.flowFrame !== null }
    : null;
}

/** One rAF loop, alive only while a Map focus with arrows is on screen, the tab is visible and motion is allowed. */
export function syncFlow(h: PixiRendererHost): void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const want = !h.destroyed && !!h.page && h.focusFrame?.tone === 'selection' && h.focusOverlay.hasFlow()
    && !h.motionActive && !reduced && typeof document !== 'undefined' && !document.hidden;
  if (!want) {
    if (h.flowFrame !== null) { cancelAnimationFrame(h.flowFrame); h.flowFrame = null; h.focusOverlay.drawFlow(0); }
    return;
  }
  if (h.flowFrame !== null) return;
  h.flowStart = performance.now();
  const tick = (now: number): void => {
    if (document.hidden) { h.flowFrame = null; return; }
    h.focusOverlay.drawFlow(((now - h.flowStart) / 1000) * FLOW_SPEED);
    h.renderNow();
    h.flowFrame = requestAnimationFrame(tick);
  };
  h.flowFrame = requestAnimationFrame(tick);
}
