import { architectureCardLayout } from '../../domain/nodes/architectureCardLayout';
import { Container, Graphics } from 'pixi.js';
import { loadProviderShapePreview } from '@/services/shapeLibrary/providerCatalog';
import { createBounds2d } from '../../domain/geometry/bounds';
import type { SceneNode } from '../../domain/document/types';
import type { Matrix2d } from '../../domain/geometry/types';
import { resolveNodeStyle, type NodeStyle } from '../../domain/nodes/nodeStyle';
import { nodeLabelBounds } from '../../domain/nodes/nodeLabelBounds';
import { SUBLABEL_FONT } from '../../domain/text/measurement';
import {
  projectArchitectureNodeVisual,
  type PixiArchitectureNodeVisual,
} from './architectureNodeVisual';
import { isSvgUrl, PixiMediaLayer } from './PixiMediaLayer';
import { inkMonochromeSvg, monochromeIconInk, svgDataUrl, svgFromDataUrl } from '../../domain/nodes/iconInk';
import { architectureIconBounds, iconCardChrome, iconCardLayout } from '../../domain/nodes/iconCardLayout';
import type { PixiNodeDebugRecord, PixiMediaState } from './pixiNodeDebug';
import { drawPixiLocalRect, drawPixiNodeOutline } from './pixiNodeOutline';
import { pixiPaintColor } from './pixiColor';
import { applyPixiNodeMatrix } from './pixiNodeTransform';
import { decoratePixiText, markTitle } from './pixiText';
import type { PixiTextPool } from './pixiTextPool';

interface PixiArchitectureNodeDrawResult {
  readonly label: Container;
  readonly debug: PixiNodeDebugRecord;
}

function iconSourceLabel(visual: PixiArchitectureNodeVisual): string {
  return visual.presentation.icon.kind;
}

function mediaState(visual: PixiArchitectureNodeVisual): PixiMediaState {
  if (visual.presentation.icon.kind === 'provider' || visual.presentation.icon.kind === 'url') {
    return 'loading';
  }
  return visual.presentation.icon.kind === 'asset' ? 'missing' : 'none';
}

/** A one-colour dark SVG icon redrawn in `ink` (as the export does); anything else, or a failed read, as authored. */
async function inkedIconUrl(url: string, ink: string): Promise<string> {
  if (!isSvgUrl(url)) return url;
  const svg = svgFromDataUrl(url) ?? await fetch(url).then((response) => (response.ok ? response.text() : null), () => null);
  const inked = svg ? inkMonochromeSvg(svg, ink) : null;
  return inked ? svgDataUrl(inked) : url;
}

function iconBounds(visual: PixiArchitectureNodeVisual, node: SceneNode) {
  return architectureIconBounds(node, visual.presentation.display);
}

export class PixiArchitectureNodeRenderer {
  private readonly mediaLayer: PixiMediaLayer;

  constructor(private readonly texts: PixiTextPool, onMediaReady: (nodeId: string) => void) {
    this.mediaLayer = new PixiMediaLayer(onMediaReady);
  }

  get media(): Container {
    return this.mediaLayer.container;
  }

  beginDraw(): number {
    return this.mediaLayer.beginDraw();
  }

  drawNode(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics,
    generation: number,
    canvasColor: string,
    finalWidth?: number
  ): PixiArchitectureNodeDrawResult | null {
    const visual = projectArchitectureNodeVisual(node);
    if (!visual) return null;
    const style = resolveNodeStyle(node, canvasColor);
    const bounds = iconBounds(visual, node);
    this.drawChrome(node, matrix, graphics, visual, bounds, style);
    const label = this.createLabel(node, visual, style, finalWidth);
    applyPixiNodeMatrix(label, matrix);
    this.loadIcon(node.id, generation, matrix, bounds, visual, monochromeIconInk(visual.presentation.display, style, canvasColor));
    return {
      label,
      debug: {
        id: node.id,
        kind: visual.presentation.kind,
        shape: visual.presentation.display,
        fill: visual.fill,
        stroke: visual.stroke,
        mediaState: this.mediaLayer.isLoaded(node.id) ? 'loaded' : mediaState(visual),
        provider: visual.presentation.provider,
        iconSource: iconSourceLabel(visual),
      },
    };
  }

  private drawChrome(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics,
    visual: PixiArchitectureNodeVisual,
    bounds: ReturnType<typeof createBounds2d>,
    style: NodeStyle
  ): void {
    const fill = pixiPaintColor(style.fill, visual.fill);
    const stroke = pixiPaintColor(style.stroke, visual.stroke);
    if (visual.presentation.display === 'architecture-card') {
      drawPixiNodeOutline(graphics, 'rounded', node.size, matrix, undefined, style.cornerRadius);
      graphics.fill(fill);
      if (style.strokeWidth > 0) graphics.stroke({ ...stroke, width: style.strokeWidth });
      drawPixiLocalRect(graphics, createBounds2d(10, 8, Math.max(0, node.size.width - 20), 26), matrix, 7);
      if (!style.subTextColor) {
        graphics.fill({ color: visual.iconFill });
        return;
      }
      // On a dark-canvas wash the header takes the card's own hue; the icon (dark ink) keeps a light tile.
      graphics.fill({ color: stroke.color, alpha: 0.3 });
      drawPixiLocalRect(graphics, bounds, matrix, 6);
      graphics.fill({ color: visual.iconFill });
      return;
    }
    // A row card (icon left of its text) is one rounded card with the art bare on it.
    if (visual.presentation.iconPlacement === 'left') {
      drawPixiNodeOutline(graphics, 'rounded', node.size, matrix, undefined, style.cornerRadius);
      graphics.fill(fill);
      if (style.strokeWidth > 0) graphics.stroke({ ...stroke, width: style.strokeWidth });
      return;
    }
    // Icon tiles: the style paints the 72px plate; the label sits on the canvas below.
    drawPixiLocalRect(graphics, iconCardChrome(node), matrix, style.cornerRadius);
    graphics.fill(fill);
    if (style.strokeWidth > 0) graphics.stroke({ ...stroke, width: style.strokeWidth });
    drawPixiLocalRect(graphics, bounds, matrix, 8);
    graphics.stroke({ color: visual.iconStroke, width: 1 });
  }

  private createLabel(node: SceneNode, visual: PixiArchitectureNodeVisual, style: NodeStyle, finalWidth?: number): Container {
    const content = new Container();
    const { presentation } = visual;
    const ink = pixiPaintColor(style.textColor, visual.text).color;
    // `finalWidth`: the width a moving box ends with (Map mode); text wraps to it all the way, so labels keep their pooled Texts.
    const grown = finalWidth === undefined ? 0 : finalWidth - node.size.width;
    if (presentation.display === 'architecture-card') {
      const wrap = Math.max(1, nodeLabelBounds(node).width + grown - style.textPadding * 2);
      const layout = architectureCardLayout(grown === 0 ? node : { ...node, size: { ...node.size, width: finalWidth! } }, style);
      const subInk = style.subTextColor ? pixiPaintColor(style.subTextColor, visual.subText).color : visual.subText;
      const provider = this.texts.plain(layout.provider.displayText, { size: 10, weight: '700', fill: subInk });
      provider.position.set(38, 15);
      const resource = this.texts.plain(layout.resource.displayText, { size: 10, weight: '600', fill: subInk });
      resource.anchor.set(1, 0);
      resource.position.set(node.size.width - 16, 15);
      const title = markTitle(this.texts.styled(layout.title.displayText, style, ink, wrap));
      title.position.set(layout.titleX, layout.titleY);
      content.addChild(provider, resource, title);
      decoratePixiText(content, title, style, ink);
      if (presentation.metadata.length > 0) {
        const metadata = this.texts.plain(layout.detail.displayText, {
          size: 10, weight: '500',
          fill: subInk, wrapWidth: Math.max(1, node.size.width + grown - 24),
        });
        metadata.position.set(12, layout.detailY);
        content.addChild(metadata);
      }
      return content;
    }
    // The caption is the layout's lines, one Text each, so the canvas and the export break and align alike.
    const text = iconCardLayout(grown === 0 ? node : { ...node, size: { ...node.size, width: finalWidth! } }, style).text;
    if (!text) return content;
    const anchor = text.anchor === 'start' ? 0 : text.anchor === 'end' ? 1 : 0.5;
    text.lines.forEach((line, index) => {
      if (!line) return;
      const title = markTitle(this.texts.styled(line, style, ink, null));
      title.anchor.set(anchor, 0);
      title.position.set(text.x, text.top + index * text.lineHeight);
      content.addChild(title);
      decoratePixiText(content, title, style, ink);
    });
    // The sub-label wears the node's family at its own size and 1.2 leading, as the layout measured it.
    const subStyle: NodeStyle = { ...style, ...SUBLABEL_FONT, lineHeight: text.subLineHeight / SUBLABEL_FONT.fontSize, textDecoration: 'none' };
    const subInk = style.subTextColor ? pixiPaintColor(style.subTextColor, visual.subText).color : visual.subText;
    text.subLines.forEach((line, index) => {
      if (!line) return;
      const sub = this.texts.styled(line, subStyle, subInk, null);
      sub.anchor.set(anchor, 0);
      sub.position.set(text.x, text.subTop + index * text.subLineHeight);
      content.addChild(sub);
    });
    return content;
  }

  private loadIcon(
    nodeId: string,
    generation: number,
    matrix: Matrix2d,
    bounds: ReturnType<typeof createBounds2d>,
    visual: PixiArchitectureNodeVisual,
    ink: string | null
  ): void {
    const { icon } = visual.presentation;
    if (icon.kind !== 'provider' && icon.kind !== 'url') return;
    const key = icon.kind === 'url' ? icon.url : `${icon.packId}/${icon.shapeId}`;
    this.mediaLayer.load({
      nodeId,
      generation,
      matrix,
      bounds,
      cacheKey: ink ? `${key}#${ink}` : key,
      resolveUrl: async () => {
        const url = icon.kind === 'url' ? icon.url : (await loadProviderShapePreview(icon.packId, icon.shapeId))?.previewUrl ?? null;
        return url && ink ? inkedIconUrl(url, ink) : url;
      },
    });
  }
}
