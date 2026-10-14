import type { MotionFrame } from '../../application/map/motionFrame';
import { PixiMapMotion } from './PixiMapMotion';
import type { PixiRendererHost } from './PixiRendererHost';
import { finishReveal } from './pixiHostReveal';
import { syncFlow } from './pixiHostFocus';

// Short on purpose: arrows must be fully back <= 200 ms after a move ends, even when a frame takes a while.
const ARROW_FADE_MS = 100;

/**
 * One frame of Map mode's open/close move. The host's own boxes and arrows are hidden and `frame` is drawn instead,
 * from its interpolated rects. View only: the page and the index stay the target's, so a click during the move lands
 * on the target layout. The selection outline is hidden for the move (it would sit at the target while the boxes travel).
 */
export function drawMotionFrame(h: PixiRendererHost, frame: MotionFrame): void {
  // An agent's change still building in would draw its own copy of the shapes over the move: it ends, whole.
  finishReveal(h, true);
  if (h.destroyed || !h.page || !h.index || !h.app.renderer) return;
  if (!h.motion) {
    h.motion = new PixiMapMotion(() => h.requestRender(), h.resolveAsset);
    h.world.addChildAt(h.motion.container, h.world.getChildIndex(h.selectionOverlay.graphics));
  }
  if (!h.motionActive) {
    h.motionActive = true;
    h.motionRenderMs = [];
    setSceneRenderable(h, false);
    syncFlow(h);
  }
  stopArrowFade(h);
  h.connectorRenderer.container.renderable = false;
  h.motion.draw(frame, h.page, h.index, h.backgroundColor);
  // Rendered now, in the same tick as the camera: icons are placed at once from cached textures, and the boxes and
  // the camera of one frame reach the screen together.
  const startedAt = performance.now();
  h.renderNow();
  h.motionRenderMs.push(performance.now() - startedAt);
  if (h.renderFrame !== null) { cancelAnimationFrame(h.renderFrame); h.renderFrame = null; }
}

/** The move is over: the host's own (target) boxes show again and, when it ran to its end, the arrows fade in. */
export function endMotion(h: PixiRendererHost, fadeArrows: boolean): void {
  if (!h.motionActive) return;
  h.motionActive = false;
  setSceneRenderable(h, true);
  // Held back during the move: the viewport projection, labels and selection settle once, now.
  h.cameraDirty = true;
  if (!fadeArrows) {
    stopArrowFade(h);
    h.motion?.clear();
    h.requestRender();
    return;
  }
  // A fade drawn at a few frames a second is a stall, not a fade: when the move's own frames were slow, the arrows
  // come back with the first render after it (the one that has to rasterize everything anyway).
  const slow = (h.motionRenderMs.at(-1) ?? 0) > ARROW_FADE_MS / 2;
  h.arrowAlpha = 0;
  h.connectorRenderer.container.alpha = 0;
  const startedAt = performance.now();
  const step = (now: number): void => {
    h.arrowAlpha = slow ? 1 : Math.min(1, Math.max(0, now - startedAt) / ARROW_FADE_MS);
    h.connectorRenderer.container.alpha = h.arrowAlpha;
    h.renderNow();
    // The motion layers go after the first render that also draws the host's own boxes, so the labels it made share
    // the textures the layers rasterized instead of making them again.
    if (h.motion?.container.visible) h.motion.clear();
    h.arrowFade = h.arrowAlpha < 1 ? requestAnimationFrame(step) : null;
  };
  h.arrowFade = requestAnimationFrame(step);
  if (h.arrowFadeDeadline !== null) clearTimeout(h.arrowFadeDeadline);
  h.arrowFadeDeadline = setTimeout(() => {
    if (h.arrowFade === null) return;
    stopArrowFade(h);
    h.requestRender();
  }, ARROW_FADE_MS * 3);
}

/** Whether a move is on screen, how visible the arrows are (0 during the move, ramping to 1 after), and whether they are still coming back. */
export function getMotionState(h: PixiRendererHost): { fading: boolean; active: boolean; arrowAlpha: number; renderMs: { p50: number; p95: number } } {
  const sorted = [...h.motionRenderMs].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return { fading: h.arrowFade !== null, active: h.motionActive, arrowAlpha: h.motionActive ? 0 : h.arrowAlpha, renderMs: { p50: at(0.5), p95: at(0.95) } };
}

export function stopArrowFade(h: PixiRendererHost): void {
  if (h.arrowFade !== null) cancelAnimationFrame(h.arrowFade);
  if (h.arrowFadeDeadline !== null) clearTimeout(h.arrowFadeDeadline);
  h.arrowFade = null;
  h.arrowFadeDeadline = null;
  h.arrowAlpha = 1;
  h.connectorRenderer.container.alpha = 1;
}

/** Hides or shows what setPage draws (boxes, titles, arrows, selection) without touching what `visible` means to their owners. */
function setSceneRenderable(h: PixiRendererHost, shown: boolean): void {
  for (const part of [h.containerRenderer.graphics, h.containerRenderer.labels, h.nodeRenderer.backdrop, h.nodeRenderer.graphics,
    h.nodeRenderer.media, h.nodeRenderer.labels, h.connectorRenderer.container, h.selectionOverlay.graphics,
    h.focusOverlay.veil, h.focusOverlay.content]) {
    part.renderable = shown;
  }
}
