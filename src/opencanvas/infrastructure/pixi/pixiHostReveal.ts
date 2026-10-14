import type { ScenePage } from '../../domain/document/types';
import { numericColorToHex } from '../../domain/color/adaptiveColor';
import { cullReveal, type RevealPlan } from '../../domain/animation/agentReveal';
import { PixiAgentReveal } from './PixiAgentReveal';
import type { PixiRendererHost } from './PixiRendererHost';
import { rebuildScene } from './pixiHostScene';

/** Agent reveal: an agent's change building in (armReveal). Its shapes draw in the reveal layers, not the scene, until it ends. */
export type ArmedReveal = { readonly make: (before: ScenePage, after: ScenePage) => RevealPlan | null; readonly at: number };
export type RunningReveal = { readonly plan: RevealPlan; readonly nodes: ReadonlySet<string>; readonly connectors: ReadonlySet<string>; readonly t0: number; frame: number };
export type RevealStats = { runs: number; frames: number; groups: number; morphs: number; durationMs: number; cut: number };

export function startArmedReveal(h: PixiRendererHost, before: ScenePage | null, after: ScenePage): boolean {
  const armed = h.revealArmed;
  h.revealArmed = null;
  // Stale (the commit never rendered) or another page: nothing to build in.
  if (!armed || !before || before.id !== after.id || performance.now() - armed.at > 2000 || !h.index || !h.app.renderer) return false;
  // A hidden tab draws no frames, and nobody would see it: the change is simply there when they look.
  if (document.hidden) return false;
  const made = armed.make(before, after);
  // Only what is on screen builds in: the reveal draws its shapes a second time.
  const plan = made && cullReveal(made, h.viewportProjection?.nodeIds ?? null, h.viewportProjection?.connectorIds ?? null);
  if (!plan || plan.groups.length === 0) return false;
  if (!h.revealLayers) {
    h.revealLayers = new PixiAgentReveal(() => h.requestRender(), h.resolveAsset);
    h.world.addChildAt(h.revealLayers.under, h.world.getChildIndex(h.nodeRenderer.graphics));
    h.world.addChildAt(h.revealLayers.over, h.world.getChildIndex(h.selectionOverlay.graphics));
  }
  h.revealLayers.begin(plan.groups, {
    page: after, index: h.index, canvasColor: h.backgroundColor, canvasHex: numericColorToHex(h.backgroundColor),
    advancedConnectors: h.connectorModelEnabled, detail: h.viewportProjection?.detailLevel ?? 'full', zoom: h.camera.zoom,
  });
  h.reveal = {
    plan, t0: performance.now(), frame: 0,
    nodes: new Set(plan.groups.flatMap((group) => group.nodeIds)),
    connectors: new Set(plan.groups.flatMap((group) => group.connectorIds)),
  };
  h.revealStats = {
    ...h.revealStats, runs: h.revealStats.runs + 1, frames: 0, groups: plan.groups.length,
    morphs: plan.groups.filter((group) => group.kind === 'morph').length, durationMs: plan.durationMs,
  };
  return true;
}

export function revealTick(h: PixiRendererHost, now: number): void {
  const reveal = h.reveal;
  if (!reveal || h.destroyed) return;
  const t = now - reveal.t0;
  if (t >= reveal.plan.durationMs) { finishReveal(h, true); return; }
  h.revealLayers?.frame(t, h.viewportProjection?.detailLevel ?? 'full', h.camera.zoom);
  h.revealStats.frames += 1;
  h.renderNow();
  if (h.renderFrame !== null) { cancelAnimationFrame(h.renderFrame); h.renderFrame = null; }
  reveal.frame = requestAnimationFrame(h.revealTick);
}

/** The page draws its own shapes again; `redraw` false when the caller rebuilds the scene itself. */
export function finishReveal(h: PixiRendererHost, redraw: boolean): void {
  const reveal = h.reveal;
  if (!reveal) return;
  cancelAnimationFrame(reveal.frame);
  h.reveal = null;
  if (!redraw) h.revealStats.cut += 1;
  // Scene first, layers after, in one task: no frame shows neither.
  if (redraw) rebuildScene(h, true);
  h.revealLayers?.clear();
  if (redraw) h.renderNow();
}
