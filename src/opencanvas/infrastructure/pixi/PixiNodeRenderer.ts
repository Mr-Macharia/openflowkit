import { pixiPaintColor } from './pixiColor';
import { resolveNodeStyle, type NodeStyle } from '../../domain/nodes/nodeStyle';
import { basicNodeOutlinePoints } from '../../domain/nodes/basicNodeOutline';
import { basicNodeDecorations } from '../../domain/nodes/basicNodeDecorations';
import { drawDashedPath } from './PixiConnectorRenderer';
import { buildNodeStateMap } from '../../domain/scene/nodeState';
import { Container, Graphics, Text } from 'pixi.js';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import type { ScenePage } from '../../domain/document/types';
import type { SceneIndex } from '../../domain/scene/types';
import { layoutNodeContent, resolveNodeContentLayout } from '../../domain/node-layout/model';
import type { Bounds2d } from '../../domain/geometry/types';
import { projectBasicNodeVisual } from './basicNodeVisual';
import { PixiArchitectureNodeRenderer } from './PixiArchitectureNodeRenderer';
import { PixiClassEntityNodeRenderer } from './PixiClassEntityNodeRenderer';
import { PixiFreeformNodeRenderer } from './PixiFreeformNodeRenderer';
import { PixiJourneyNodeRenderer } from './PixiJourneyNodeRenderer';
import { PixiMindmapNodeRenderer } from './PixiMindmapNodeRenderer';
import { PixiSequenceNodeRenderer } from './PixiSequenceNodeRenderer';
import { PixiWireframeNodeRenderer } from './PixiWireframeNodeRenderer';
import { PixiWidgetNodeRenderer } from './PixiWidgetNodeRenderer';
import { PixiChartNodeRenderer } from './PixiChartNodeRenderer';
import { drawPixiNodeOutline } from './pixiNodeOutline';
import type { PixiNodeDebugRecord } from './pixiNodeDebug';
import { isBackdropNode, isContainerNodeKind } from '../../domain/nodes/containerNodePresentation';
import { isSequenceParticipant } from './sequenceNodeVisual';
import { resolveLabelSizing } from '../../domain/node-sizing/labelWrap';
import { measurePortableText, SUBLABEL_FONT } from '../../domain/text/measurement';
import { decoratePixiText, isTitle, markTitle } from './pixiText';
import { PixiTextPool } from './pixiTextPool';
import { labelReadable, MIN_TITLE_SCREEN_PX, type SemanticDetailLevel } from './viewportProjection';
import { numericColorToHex } from '../../domain/color/adaptiveColor';

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xcbd5e1;
const ICON_FILL = 0xfef4f0;
const ICON_STROKE = 0xe95420;
const DETAILED_OUTLINE_NODE_LIMIT = 1_000;
// ponytail: family renderers (architecture, class, sequence…) draw their own text; their smallest, 12 px, stands for all of it.
const FAMILY_LABEL_FONT = 12;

export type { PixiNodeDebugRecord } from './pixiNodeDebug';

function textPosition(bounds: Bounds2d, alignment: 'start' | 'center' | 'end'): number {
  if (alignment === 'start') return bounds.x;
  if (alignment === 'end') return bounds.x + bounds.width;
  return bounds.x + bounds.width / 2;
}

function textAnchor(alignment: 'start' | 'center' | 'end'): number {
  if (alignment === 'start') return 0;
  if (alignment === 'end') return 1;
  return 0.5;
}

/** Sub-labels use the node's family/colour at a fixed smaller size. */
function subLabelStyle(style: NodeStyle): NodeStyle {
  return { ...style, ...SUBLABEL_FONT, textDecoration: 'none' };
}

export class PixiNodeRenderer {
  /** Under the connectors, as the SVG export paints them: a sequence's fragment bands, then its participants. */
  readonly backdrop = new Graphics();
  readonly graphics = new Graphics();
  readonly media = new Container();
  readonly labels = new Container();
  private readonly labelByNodeId = new Map<string, Container>();
  /** Font size per label, for the on-screen readability check. */
  private readonly labelFontByNodeId = new Map<string, number>();
  /** A node whose label names it (a title Text): the whole label stays to the title floor, its other Texts to the body floor. */
  private readonly secondaryByNodeId = new Map<string, readonly Text[]>();
  // Label Text objects rasterize to a texture on creation (~0.5–1 ms each), so
  // a redraw reuses last draw's instances with the same text and style
  // instead of destroying and re-creating every label.
  private readonly texts = new PixiTextPool();
  private readonly freeformRenderer: PixiFreeformNodeRenderer;
  private readonly architectureRenderer: PixiArchitectureNodeRenderer;
  private readonly classEntityRenderer = new PixiClassEntityNodeRenderer();
  private readonly mindmapRenderer = new PixiMindmapNodeRenderer();
  private readonly journeyRenderer = new PixiJourneyNodeRenderer();
  private readonly sequenceRenderer = new PixiSequenceNodeRenderer();
  private readonly wireframeRenderer: PixiWireframeNodeRenderer;
  private readonly chartRenderer: PixiChartNodeRenderer;
  private readonly widgetRenderer = new PixiWidgetNodeRenderer((text, style, fill) => this.texts.styled(text, style, fill, null));
  private debugRecords: readonly PixiNodeDebugRecord[] = [];
  private editingNodeId: string | null = null;

  constructor(
    onMediaReady: () => void = () => undefined,
    private readonly resolveAsset?: (assetId: string) => Promise<string | null>
  ) {
    this.freeformRenderer = new PixiFreeformNodeRenderer((nodeId) => {
      this.debugRecords = this.debugRecords.map((record) =>
        record.id === nodeId ? { ...record, mediaState: 'loaded' } : record
      );
      const label = this.labelByNodeId.get(nodeId);
      if (label) label.visible = false;
      onMediaReady();
    }, resolveAsset);
    this.architectureRenderer = new PixiArchitectureNodeRenderer(this.texts, (nodeId) => {
      this.debugRecords = this.debugRecords.map((record) =>
        record.id === nodeId ? { ...record, mediaState: 'loaded' } : record
      );
      onMediaReady();
    });
    this.chartRenderer = new PixiChartNodeRenderer();
    this.wireframeRenderer = new PixiWireframeNodeRenderer((nodeId) => {
      this.debugRecords = this.debugRecords.map((record) =>
        record.id === nodeId ? { ...record, mediaState: 'loaded' } : record
      );
      onMediaReady();
    });
    this.media.addChild(
      this.freeformRenderer.media,
      this.architectureRenderer.media,
      this.wireframeRenderer.media
    );
  }

  /** Containers are drawn by PixiContainerRenderer; everything else lands here. */
  draw(
    page: ScenePage,
    index: SceneIndex,
    renderedNodeIds: ReadonlySet<string> | null = null,
    detailLevel: SemanticDetailLevel = 'full',
    canvasColor = 0xf7f7f5,
    textWidths?: ReadonlyMap<string, number>
  ): void {
    this.graphics.clear();
    this.backdrop.clear();
    for (const content of this.labels.removeChildren()) this.texts.recycle(content);
    const freeformMediaGeneration = this.freeformRenderer.beginDraw();
    const architectureMediaGeneration = this.architectureRenderer.beginDraw();
    const wireframeMediaGeneration = this.wireframeRenderer.beginDraw();
    this.mindmapRenderer.beginDraw(page.nodes);
    this.labelByNodeId.clear();
    this.labelFontByNodeId.clear();
    this.secondaryByNodeId.clear();
    const debugRecords: PixiNodeDebugRecord[] = [];
    const nodeStates = buildNodeStateMap(page);
    const bands = page.nodes.filter((node) => !isContainerNodeKind(node.kind) && isBackdropNode(node));
    const participants = page.nodes.filter(isSequenceParticipant);
    const ordered = bands.length + participants.length === 0 ? page.nodes
      : [...bands, ...participants, ...page.nodes.filter((node) => !isBackdropNode(node) && !isSequenceParticipant(node))];
    for (const node of ordered) {
      if (!nodeStates.get(node.id)?.visible) continue;
      if (renderedNodeIds && !renderedNodeIds.has(node.id)) continue;
      if (isContainerNodeKind(node.kind)) continue;
      const matrix = index.worldMatricesByNodeId.get(node.id);
      if (!matrix) continue;
      const canvasHex = numericColorToHex(canvasColor);
      const target = isBackdropNode(node) || isSequenceParticipant(node) ? this.backdrop : this.graphics;
      // Family renderers take the node in order; the first one that claims it wins.
      const family = detailLevel === 'overview' ? null
        : this.chartRenderer.drawNode(node, matrix, target, canvasHex)
          ?? this.widgetRenderer.drawNode(node, matrix, target, canvasHex, (id) => index.nodesById.get(id))
          ?? this.architectureRenderer.drawNode(node, matrix, target, architectureMediaGeneration, canvasHex, textWidths?.get(node.id))
          ?? this.classEntityRenderer.drawNode(node, matrix, target)
          ?? this.mindmapRenderer.drawNode(node, matrix, target)
          ?? this.journeyRenderer.drawNode(node, matrix, target)
          ?? this.sequenceRenderer.drawNode(node, matrix, target, canvasHex)
          ?? this.wireframeRenderer.drawNode(node, matrix, target, wireframeMediaGeneration)
          ?? this.freeformRenderer.drawNode(node, matrix, target, freeformMediaGeneration, canvasHex);
      if (family) {
        this.labels.addChild(family.label);
        this.labelByNodeId.set(node.id, family.label);
        this.trackTitle(node.id, family.label);
        debugRecords.push(family.debug);
        continue;
      }
      const visual = projectBasicNodeVisual(node);
      const shape = visual?.shape ?? 'rectangle';
      const renderedShape =
        page.nodes.length > DETAILED_OUTLINE_NODE_LIMIT && shape === 'rounded'
          ? 'rectangle'
          : shape;
      const style = resolveNodeStyle(node, numericColorToHex(canvasColor));
      const fillPaint = pixiPaintColor(style.fill, visual?.fill ?? NODE_FILL);
      const strokePaint = pixiPaintColor(style.stroke, visual?.stroke ?? NODE_STROKE);
      const fill = fillPaint.color;
      const stroke = strokePaint.color;
      // ponytail: opacity honoured for basic shapes only; family renderers
      // draw into the shared graphics and would each need an alpha argument.
      const alpha = style.opacity;
      const customPath = typeof node.content.customSvgPath === 'string' ? node.content.customSvgPath : undefined;
      if (style.shadow && fillPaint.alpha > 0) {
        drawPixiNodeOutline(this.graphics, renderedShape, node.size,
          { ...matrix, tx: matrix.tx + 2, ty: matrix.ty + 4 }, customPath, style.cornerRadius);
        this.graphics.fill({ color: 0x0f172a, alpha: 0.12 * alpha });
      }
      drawPixiNodeOutline(this.graphics, renderedShape, node.size, matrix, customPath, style.cornerRadius);
      this.graphics.fill({ color: fill, alpha: alpha * fillPaint.alpha });
      if (style.strokeWidth > 0 && style.dash.length) {
        const outline = basicNodeOutlinePoints(renderedShape, node.size, customPath, style.cornerRadius)
          .map((point) => applyMatrixToPoint(matrix, point));
        drawDashedPath(this.graphics, [...outline, outline[0]], {
          color: `#${stroke.toString(16).padStart(6, '0')}`, width: style.strokeWidth,
          opacity: alpha * strokePaint.alpha, dash: style.dash,
        });
      } else if (style.strokeWidth > 0) {
        this.graphics.stroke({ color: stroke, width: style.strokeWidth, alpha: alpha * strokePaint.alpha });
      }
      // Inner lines (venn lens, target rings, note fold) ride the same stroke.
      if (detailLevel !== 'overview' && style.strokeWidth > 0) {
        for (const decoration of basicNodeDecorations(renderedShape, node.size)) {
          // Open polylines, like the SVG export: a closed shape repeats its first point.
          const points = decoration.map((point) => applyMatrixToPoint(matrix, point));
          this.graphics.poly(points.flatMap((point) => [point.x, point.y]), false);
          this.graphics.stroke({ color: stroke, width: style.strokeWidth, alpha: alpha * strokePaint.alpha });
        }
      }
      debugRecords.push({
        id: node.id,
        kind: visual?.kind ?? node.kind,
        shape,
        fill,
        stroke,
        mediaState: 'none',
      });
      if (detailLevel === 'overview') continue;
      const labelText = typeof node.content.label === 'string' ? node.content.label : node.id;
      const sizing = resolveLabelSizing(node, style);
      const baseLayout = resolveNodeContentLayout(node.content);
      // Style keys win over the stored content layout: one place to set alignment.
      const pad = style.textPadding;
      const layout = {
        ...baseLayout,
        horizontal: style.textAlign,
        vertical: style.textVerticalAlign === 'top' ? 'start' as const
          : style.textVerticalAlign === 'bottom' ? 'end' as const : 'center' as const,
        labelAlignment: style.textAlign,
        padding: { top: pad, right: pad, bottom: pad, left: pad },
      };
      // A move (Map mode) wraps each label to the width its box ends with, so the text pool keeps hitting while the box resizes.
      const availableTextWidth = Math.max(1, (textWidths?.get(node.id) ?? node.size.width) - pad * 2);
      const wrap = sizing.overflow === 'visible' ? null : availableTextWidth;
      const labelMeasurement = measurePortableText(labelText, {
        fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.fontSize * style.lineHeight,
        ...(wrap === null ? {} : { maxWidth: wrap, maxLines: sizing.maxLines, overflow: sizing.overflow }),
      });
      const textColor = pixiPaintColor(style.textColor, visual?.text ?? 0x1e293b).color;
      const label = markTitle(this.texts.styled(labelMeasurement.displayText, style, textColor, wrap));
      const subStyle = subLabelStyle(style);
      const subLabel =
        typeof node.content.subLabel === 'string' && node.content.subLabel.length > 0
          ? this.texts.styled(
              measurePortableText(node.content.subLabel, {
                ...SUBLABEL_FONT,
                ...(wrap === null ? {} : { maxWidth: wrap, maxLines: sizing.maxLines, overflow: sizing.overflow }),
              }).displayText,
              subStyle, style.subTextColor ? pixiPaintColor(style.subTextColor, 0).color : visual?.subText ?? 0x64748b, wrap
            )
          : null;
      const hasIcon =
        (typeof node.content.icon === 'string' && node.content.icon !== 'none') ||
        typeof node.content.archIconShapeId === 'string';
      const geometry = layoutNodeContent(
        layout,
        {
          nodeSize: node.size,
          iconSize: hasIcon ? { width: 28, height: 28 } : null,
          labelSize: labelMeasurement,
          subLabelSize: subLabel ? measurePortableText(subLabel.text, {
            ...SUBLABEL_FONT,
          }) : null,
        }
      );
      if (geometry.iconBounds) {
        const iconCorners = [
          { x: geometry.iconBounds.x, y: geometry.iconBounds.y },
          { x: geometry.iconBounds.x + geometry.iconBounds.width, y: geometry.iconBounds.y },
          {
            x: geometry.iconBounds.x + geometry.iconBounds.width,
            y: geometry.iconBounds.y + geometry.iconBounds.height,
          },
          { x: geometry.iconBounds.x, y: geometry.iconBounds.y + geometry.iconBounds.height },
        ].map((point) => applyMatrixToPoint(matrix, point));
        this.graphics
          .poly(iconCorners.flatMap((point) => [point.x, point.y]))
          .fill({ color: visual?.iconFill ?? ICON_FILL })
          .stroke({ color: visual?.iconStroke ?? ICON_STROKE, width: 1 });
      }
      const labelPoint = applyMatrixToPoint(matrix, {
        x: textPosition(geometry.labelBounds, geometry.labelAlignment),
        y: geometry.labelBounds.y,
      });
      label.anchor.set(textAnchor(geometry.labelAlignment), 0);
      label.position.set(labelPoint.x, labelPoint.y);
      const content = new Container();
      content.alpha = alpha;
      content.addChild(label);
      decoratePixiText(content, label, style, textColor);
      if (subLabel && geometry.subLabelBounds) {
        const subLabelPoint = applyMatrixToPoint(matrix, {
          x: textPosition(geometry.subLabelBounds, geometry.labelAlignment),
          y: geometry.subLabelBounds.y,
        });
        subLabel.anchor.set(textAnchor(geometry.labelAlignment), 0);
        subLabel.position.set(subLabelPoint.x, subLabelPoint.y);
        content.addChild(subLabel);
      }
      if (sizing.clipContent) {
        const corners = [
          { x: geometry.contentBounds.x, y: geometry.contentBounds.y },
          { x: geometry.contentBounds.x + geometry.contentBounds.width, y: geometry.contentBounds.y },
          { x: geometry.contentBounds.x + geometry.contentBounds.width,
            y: geometry.contentBounds.y + geometry.contentBounds.height },
          { x: geometry.contentBounds.x, y: geometry.contentBounds.y + geometry.contentBounds.height },
        ].map((point) => applyMatrixToPoint(matrix, point));
        const mask = new Graphics().poly(corners.flatMap((point) => [point.x, point.y])).fill(0xffffff);
        content.addChild(mask);
        content.mask = mask;
      }
      this.labels.addChild(content);
      this.labelByNodeId.set(node.id, content);
      this.trackTitle(node.id, content);
    }
    this.texts.flush();
    this.debugRecords = debugRecords;
  }

  getDebugSnapshot(): readonly PixiNodeDebugRecord[] {
    return this.debugRecords;
  }

  /** Records a label's title font and its other Texts, once per draw, so a zoom tick only compares numbers. */
  private trackTitle(nodeId: string, label: Container): void {
    let titleFont = 0;
    const secondary: Text[] = [];
    const visit = (node: Container): void => {
      if (node instanceof Text) {
        if (isTitle(node)) titleFont = Math.max(titleFont, Number(node.style.fontSize));
        else secondary.push(node);
        return;
      }
      for (const child of node.children) visit(child as Container);
    };
    visit(label);
    if (titleFont === 0) return;
    this.labelFontByNodeId.set(nodeId, titleFont);
    this.secondaryByNodeId.set(nodeId, secondary);
  }

  setLabelVisibility(visibleNodeIds: ReadonlySet<string> | null, zoom: number): void {
    this.labels.visible = visibleNodeIds !== null;
    if (!visibleNodeIds) return;
    for (const [nodeId, label] of this.labelByNodeId) {
      const secondary = this.secondaryByNodeId.get(nodeId);
      // A titled node reads down to the title floor; the rest of its text (tech, description) keeps the body floor.
      label.visible = visibleNodeIds.has(nodeId) && nodeId !== this.editingNodeId
        && labelReadable(zoom, this.labelFontByNodeId.get(nodeId) ?? FAMILY_LABEL_FONT, secondary ? MIN_TITLE_SCREEN_PX : undefined)
        && !this.freeformRenderer.isMediaLoaded(nodeId);
      if (secondary && label.visible) for (const text of secondary) text.visible = labelReadable(zoom, Number(text.style.fontSize));
    }
  }

  /** The DOM editor replaces this node's label while it is open. */
  setEditingNode(nodeId: string | null): void {
    const previous = this.editingNodeId;
    this.editingNodeId = nodeId;
    if (previous) { const label = this.labelByNodeId.get(previous); if (label) label.visible = true; }
    if (nodeId) { const label = this.labelByNodeId.get(nodeId); if (label) label.visible = false; }
  }
}
