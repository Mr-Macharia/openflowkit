import { Container, Graphics } from 'pixi.js';
import type { ScenePage } from '../../domain/document/types';
import { isBackdropNode } from '../../domain/nodes/containerNodePresentation';
import type { SceneIndex } from '../../domain/scene/types';
import { revealStateAt, type RevealGroup } from '../../domain/animation/agentReveal';
import type { SemanticDetailLevel } from './viewportProjection';
import { PixiConnectorRenderer } from './PixiConnectorRenderer';
import { PixiContainerRenderer } from './PixiContainerRenderer';
import { PixiNodeRenderer } from './PixiNodeRenderer';

// View-only layers for an agent's change building in (domain/animation/agentReveal). The host leaves the change's shapes
// out of its own drawing for the length of the reveal; each group is drawn here once, into its own layer, and a frame
// only sets the layers' opacity, place, scale and line mask. Backdrops (containers) and lines go under the page's
// shapes, as the scene paints them; the rest over. The layers are destroyed when the reveal ends.

interface Paint {
  readonly page: ScenePage;
  readonly index: SceneIndex;
  readonly canvasColor: number;
  readonly canvasHex: string;
  readonly advancedConnectors: boolean;
  readonly detail: SemanticDetailLevel;
  readonly zoom: number;
}

class Slot {
  readonly view = new Container();
  private readonly nodes: PixiNodeRenderer | null = null;
  private readonly containers: PixiContainerRenderer | null = null;
  private readonly connectors: PixiConnectorRenderer | null = null;
  private readonly mask: Graphics | null = null;
  private readonly ids: ReadonlySet<string>;

  constructor(readonly group: RevealGroup, paint: Paint, onMediaReady: () => void, resolveAsset?: (assetId: string) => Promise<string | null>) {
    const { page, index, canvasColor } = paint;
    this.ids = new Set(group.nodeIds);
    const backdrops = new Set(group.nodeIds.filter((id) => { const node = index.nodesById.get(id); return !!node && isBackdropNode(node); }));
    const plain = new Set(group.nodeIds.filter((id) => !backdrops.has(id)));
    if (backdrops.size) {
      this.containers = new PixiContainerRenderer();
      this.containers.draw(page, index, backdrops, canvasColor);
      this.view.addChild(this.containers.graphics);
    }
    if (group.connectorIds.length) {
      this.connectors = new PixiConnectorRenderer();
      this.connectors.setZoom(paint.zoom);
      // ponytail: a label is placed among this group's arrows only (exact placement among all is a projection per line, O(n²) on a big page) — it may settle a few px when the page draws it.
      this.connectors.draw(page, paint.advancedConnectors, new Set(group.connectorIds), paint.canvasHex);
      this.view.addChild(this.connectors.container);
    }
    if (plain.size) {
      this.nodes = new PixiNodeRenderer(onMediaReady, resolveAsset);
      this.nodes.draw(page, index, plain, paint.detail, canvasColor);
      this.view.addChild(this.nodes.backdrop, this.nodes.graphics, this.nodes.media, this.nodes.labels);
    }
    if (this.containers) this.view.addChild(this.containers.labels);
    if (group.kind === 'line') {
      this.mask = new Graphics();
      this.view.addChild(this.mask);
      this.view.mask = this.mask;
    }
    this.view.pivot.set(group.pivot.x, group.pivot.y);
    this.labels(paint.detail, paint.zoom);
  }

  /** Labels show as the page's do: while readable at this zoom, none in the overview. */
  labels(detail: SemanticDetailLevel, zoom: number): void {
    const shown = detail === 'overview' ? null : this.ids;
    this.nodes?.setLabelVisibility(shown, zoom);
    this.containers?.setLabelVisibility(shown, zoom);
    this.connectors?.setZoom(zoom);
  }

  apply(tMs: number): void {
    const state = revealStateAt(this.group, tMs);
    this.view.alpha = state.opacity;
    this.view.visible = state.opacity > 0.001;
    this.view.position.set(state.x, state.y);
    this.view.scale.set(state.scaleX, state.scaleY);
    if (!this.mask) return;
    this.mask.clear();
    // The mask lives in the slot (pivot-relative): the pivot is the line's source end.
    if (state.radius === null) { this.view.mask = null; this.mask.visible = false; return; }
    this.mask.circle(this.group.pivot.x, this.group.pivot.y, Math.max(0.01, state.radius)).fill(0xffffff);
  }

  destroy(): void {
    this.view.mask = null;
    this.view.destroy({ children: true });
  }
}

export class PixiAgentReveal {
  /** Under the page's shapes (over its connectors): containers and lines. */
  readonly under = new Container();
  /** Over the page's shapes: the new shapes. */
  readonly over = new Container();
  private slots: Slot[] = [];

  constructor(private readonly onMediaReady: () => void, private readonly resolveAsset?: (assetId: string) => Promise<string | null>) {}

  begin(groups: readonly RevealGroup[], paint: Paint): void {
    this.clear();
    for (const group of groups) {
      const slot = new Slot(group, paint, this.onMediaReady, this.resolveAsset);
      const under = group.kind === 'line' || (group.nodeIds.length > 0 && group.nodeIds.every((id) => {
        const node = paint.index.nodesById.get(id);
        return !!node && isBackdropNode(node);
      }));
      (under ? this.under : this.over).addChild(slot.view);
      this.slots.push(slot);
    }
  }

  frame(tMs: number, detail: SemanticDetailLevel, zoom: number): void {
    for (const slot of this.slots) {
      slot.labels(detail, zoom);
      slot.apply(tMs);
    }
  }

  clear(): void {
    for (const slot of this.slots) slot.destroy();
    this.slots = [];
  }
}
