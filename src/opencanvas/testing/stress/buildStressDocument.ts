import { compileWorkspace } from '../../../dsl/compile';
import { deterministicLayout } from '../../../dsl/layout';
import {
  PRODUCTION_NODE_CATALOG,
  createProductionSceneNode,
} from '../../application/active-document/productionNodeCatalog';
import type { JsonObject } from '../../domain/document/json';
import {
  SCENE_DOCUMENT_FORMAT,
  SCENE_DOCUMENT_VERSION,
  type SceneDocumentV1,
  type SceneNode,
} from '../../domain/document/types';
import type { Point2d, Size2d } from '../../domain/geometry/types';
import { createChartNode } from '../../domain/nodes/chartNode';
import { CHART_KINDS, type ChartData, type ChartKind } from '../../domain/nodes/chartNodePresentation';
import { FRAME_PRESET_SPECS, FRAME_PRESETS, createPresetFrame } from '../../domain/nodes/framePreset';
import { createIconNode, type IconChoice } from '../../domain/nodes/iconNode';
import { createImageNode } from '../../domain/nodes/imageNode';
import { SHAPE_KINDS, createShapeNode, defaultShapeSize, type ShapeKind } from '../../domain/nodes/shapeNode';
import { strokeBounds } from '../../domain/nodes/strokeGeometry';
import { createWidgetNode } from '../../domain/nodes/widgetNode';
import { WIDGETS, WIDGET_KINDS, type WidgetKind, type WidgetVariant } from '../../domain/nodes/widgetNodePresentation';
import {
  C4_WORKSPACE,
  FAMILY_SAMPLES,
  IMAGE_DATA_URL,
  MERMAID_SAMPLE_SVG,
  STRESS_ICONS,
  STRESS_ICON_RESOLUTIONS,
} from './stressSamples';
import {
  COLUMN_WIDTH,
  LAYER_ID,
  catalogNode,
  packCatalogNodes,
  compiledBlock,
  createBuilder,
  type StressBuilder,
} from './stressBuilder';
import { addConnectorDemos, addFreeEndpointDemo, addScaleBlock } from './stressConnectors';

const resolveStressIcon = (id: string): { packId: string; shapeId: string } | null =>
  STRESS_ICON_RESOLUTIONS[id] ?? null;


function addShapeGrid(builder: StressBuilder, kinds: readonly ShapeKind[]): void {
  builder.pack(kinds, {
    sizeOf: (kind) => defaultShapeSize(kind),
    place: (at, kind) => {
      builder.add(createShapeNode(builder.page, { kind, id: builder.nextId(kind), at, label: kind }));
    },
  });
}

interface ExtraShape {
  readonly label: string;
  readonly shape: string;
  readonly size: Size2d;
}

const DSL_ONLY_SHAPES: readonly ExtraShape[] = [
  { label: 'comment', shape: 'comment', size: { width: 168, height: 96 } },
  { label: 'panel', shape: 'panel', size: { width: 168, height: 110 } },
  { label: 'callout-stack', shape: 'callout-stack', size: { width: 168, height: 110 } },
  { label: 'queue', shape: 'queue', size: { width: 168, height: 96 } },
  { label: 'stadium', shape: 'capsule', size: { width: 168, height: 64 } },
  { label: 'fork', shape: 'rectangle', size: { width: 160, height: 12 } },
  { label: 'join', shape: 'rectangle', size: { width: 160, height: 12 } },
  { label: 'choice', shape: 'diamond', size: { width: 84, height: 84 } },
];

function addExtraShapes(builder: StressBuilder): void {
  builder.pack(DSL_ONLY_SHAPES, {
    sizeOf: (shape) => shape.size,
    place: (at, shape) => {
      const node = createProductionSceneNode('process', builder.nextId(shape.label), at, LAYER_ID, {
        shape: shape.shape,
        label: shape.label,
      });
      builder.add({ ...node, size: shape.size });
    },
  });
}

function addChild(
  builder: StressBuilder,
  catalogId: string,
  parentId: string,
  localAt: Point2d,
  content: JsonObject,
  size?: Size2d
): SceneNode {
  const base = createProductionSceneNode(catalogId, builder.nextId(catalogId), { x: 0, y: 0 }, LAYER_ID, content);
  return builder.add({
    ...base,
    ...(size ? { size } : {}),
    parentId,
    transform: { ...base.transform, translation: localAt },
  });
}

function addContainers(builder: StressBuilder): void {
  const row = builder.cursorY;

  const group = builder.add(
    createProductionSceneNode('group', builder.nextId('group'), { x: 0, y: row }, LAYER_ID, { label: 'Group — 2 children' })
  );
  addChild(builder, 'process', group.id, { x: 16, y: 72 }, { label: 'Inside A' }, { width: 150, height: 60 });
  addChild(builder, 'process', group.id, { x: 166, y: 72 }, { label: 'Inside B' }, { width: 150, height: 60 });

  const section = builder.add(
    createProductionSceneNode('section', builder.nextId('section'), { x: 420, y: row }, LAYER_ID, { label: 'Section — rows + nested group' })
  );
  addChild(builder, 'process', section.id, { x: 32, y: 72 }, { label: 'Row 1' }, { width: 150, height: 60 });
  addChild(builder, 'process', section.id, { x: 32, y: 148 }, { label: 'Row 2' }, { width: 150, height: 60 });
  addChild(builder, 'process', section.id, { x: 32, y: 224 }, { label: 'Row 3' }, { width: 150, height: 60 });
  const nested = createProductionSceneNode('group', builder.nextId('group-nested'), { x: 240, y: 64 }, LAYER_ID, { label: 'Nested group' });
  const placedNested = builder.add({ ...nested, size: { width: 220, height: 180 }, parentId: section.id });
  addChild(builder, 'process', placedNested.id, { x: 24, y: 56 }, { label: 'Deep child' }, { width: 150, height: 60 });

  const swimlane = builder.add(
    createProductionSceneNode('swimlane', builder.nextId('swimlane'), { x: 1020, y: row }, LAYER_ID, { label: 'Swimlane' })
  );
  addChild(builder, 'process', swimlane.id, { x: 32, y: 76 }, { label: 'Step 1' }, { width: 170, height: 76 });
  addChild(builder, 'process', swimlane.id, { x: 232, y: 76 }, { label: 'Step 2' }, { width: 170, height: 76 });
  addChild(builder, 'process', swimlane.id, { x: 432, y: 76 }, { label: 'Step 3' }, { width: 170, height: 76 });

  builder.setCursor(row + 380);
}

async function addFamilyFrames(builder: StressBuilder): Promise<void> {
  const workspaces = await Promise.all(
    FAMILY_SAMPLES.map((sample) =>
      compileWorkspace(sample.text, { layout: deterministicLayout, resolveIcon: resolveStressIcon })
    )
  );
  const blocks = workspaces.map((workspace, index) => {
    const result = workspace.views[0]?.result;
    if (!result) throw new RangeError(`Sample ${FAMILY_SAMPLES[index]?.key ?? index} compiled to no views.`);
    return { key: FAMILY_SAMPLES[index]?.key ?? `family-${index}`, block: compiledBlock(result) };
  });
  builder.pack(blocks, {
    maxWidth: 4600,
    gap: 96,
    sizeOf: (item) => item.block.frame.size,
    place: (at, item) => builder.appendBlock(`fam-${item.key}`, item.block, at),
  });
}

async function addC4Views(builder: StressBuilder): Promise<void> {
  const workspace = await compileWorkspace(C4_WORKSPACE, { layout: deterministicLayout, resolveIcon: resolveStressIcon });
  const blocks = workspace.views.map((view) => ({
    key: view.viewId || view.name,
    block: {
      ...compiledBlock(view.result),
      frame: { ...view.result.frame, content: { ...view.result.frame.content, label: `C4 — ${view.name}` } },
    },
  }));
  builder.pack(blocks, {
    maxWidth: 4600,
    gap: 96,
    sizeOf: (item) => item.block.frame.size,
    place: (at, item) => builder.appendBlock(`c4-${item.key.replace(/[^a-z0-9]+/gi, '-')}`, item.block, at),
  });
}

function chartDataFor(kind: ChartKind): ChartData {
  if (kind === 'radar') {
    return {
      categories: ['Speed', 'Cost', 'Support', 'Coverage', 'DX'],
      series: [
        { name: 'Alpha', values: [4.2, 3.1, 4.8, 2.4, 4.0] },
        { name: 'Beta', values: [3.1, 4.6, 2.9, 4.4, 3.3] },
      ],
    };
  }
  if (kind === 'pie' || kind === 'donut') {
    return { categories: ['Search', 'Direct', 'Social', 'Email'], series: [{ name: 'Traffic', values: [42, 28, 18, 12] }] };
  }
  if (kind === 'heatmap' || kind === 'table') {
    return {
      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      series: [
        { name: 'Morning', values: [12, 18, 9, 22, 17] },
        { name: 'Afternoon', values: [19, 14, 21, 11, 24] },
        { name: 'Evening', values: [7, 12, 15, 9, 13] },
      ],
    };
  }
  if (kind === 'scatter') {
    return {
      categories: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      series: [
        { name: 'Sample', values: [12, 34, 22, 48, 31, 44, 19] },
        { name: 'Control', values: [8, 26, 30, 28, 40, 24, 33] },
      ],
    };
  }
  return {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    series: [
      { name: 'Revenue', values: [12, 19, 9, 22, 17, 26] },
      { name: 'Costs', values: [8, 9, 7, 11, 12, 14] },
    ],
  };
}

function addCharts(builder: StressBuilder): void {
  const quadrant = {
    xLabels: ['Low effort', 'High effort'] as const,
    yLabels: ['Low impact', 'High impact'] as const,
    quadrants: ['Quick wins', 'Big bets', 'Deprioritise', 'Time sinks'] as const,
    points: [
      { label: 'Feature A', x: 0.32, y: 0.78 },
      { label: 'Feature B', x: 0.74, y: 0.7 },
      { label: 'Feature C', x: 0.68, y: 0.3 },
      { label: 'Feature D', x: 0.26, y: 0.32 },
    ],
  };
  builder.pack(CHART_KINDS, {
    maxWidth: COLUMN_WIDTH,
    gap: 72,
    sizeOf: () => ({ width: 720, height: 440 }),
    place: (at, kind) => {
      const node = kind === 'quadrant'
        ? createChartNode(builder.page, { id: builder.nextId(`chart-${kind}`), at, chart: kind, quadrant, title: `Chart — ${kind}` })
        : createChartNode(builder.page, { id: builder.nextId(`chart-${kind}`), at, chart: kind, data: chartDataFor(kind), title: `Chart — ${kind}` });
      builder.add(node);
    },
  });
}

function addFrames(builder: StressBuilder): void {
  builder.pack(FRAME_PRESETS, {
    maxWidth: COLUMN_WIDTH,
    gap: 72,
    sizeOf: (preset) => FRAME_PRESET_SPECS[preset].size,
    place: (at, preset) => {
      builder.add(createPresetFrame(builder.page, { id: builder.nextId(`frame-${preset}`), preset, at, label: `Frame — ${preset}` }));
    },
  });
}

interface WidgetState {
  readonly variant?: WidgetVariant;
  readonly active?: number;
  readonly value?: number;
  readonly checked?: boolean;
}

function addWidgets(builder: StressBuilder): void {
  const variants: Partial<Record<WidgetKind, WidgetState>> = {
    button: { variant: 'primary' },
    alert: { variant: 'warning' },
    badge: { variant: 'success' },
    slider: { value: 0.35 },
    progress: { value: 0.75 },
    rating: { value: 1 },
    toggle: { checked: false },
    dropdown: { active: 1 },
  };
  builder.pack(WIDGET_KINDS, {
    maxWidth: COLUMN_WIDTH,
    gap: 56,
    sizeOf: (kind) => WIDGETS[kind].size,
    place: (at, kind) => {
      builder.add(createWidgetNode(builder.page, { id: builder.nextId(`widget-${kind}`), widget: kind, at, ...variants[kind] }));
    },
  });
}

function inkNode(
  builder: StressBuilder,
  kind: 'pen' | 'highlighter' | 'line' | 'arrow',
  at: Point2d,
  points: readonly Point2d[],
  style: { readonly color: string; readonly width: number; readonly opacity: number }
): SceneNode {
  const bounds = strokeBounds(points);
  const local = points.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }));
  const node = createProductionSceneNode(kind, builder.nextId(kind), at, LAYER_ID, {
    points: local,
    strokeColor: style.color,
    strokeWidth: style.width,
    transparency: style.opacity,
  });
  return builder.add({ ...node, size: { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) } });
}

function wave(x0: number, y0: number, length: number, amplitude: number, count: number): readonly Point2d[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    return { x: x0 + t * length, y: y0 + Math.sin(t * Math.PI * 3) * amplitude };
  });
}

function addInkAndMedia(builder: StressBuilder): void {
  const row = builder.cursorY;
  inkNode(builder, 'pen', { x: 0, y: row }, wave(0, 60, 360, 38, 16), { color: '#334155', width: 3, opacity: 1 });
  inkNode(builder, 'pen', { x: 420, y: row }, wave(0, 40, 360, 24, 24), { color: '#2563eb', width: 6, opacity: 1 });
  inkNode(builder, 'highlighter', { x: 840, y: row + 12 }, wave(0, 30, 360, 12, 8), { color: '#fde047', width: 18, opacity: 0.45 });
  inkNode(builder, 'highlighter', { x: 1260, y: row + 12 }, wave(0, 30, 360, 12, 8), { color: '#f9a8d4', width: 22, opacity: 0.45 });
  inkNode(builder, 'line', { x: 1680, y: row + 40 }, [{ x: 0, y: 0 }, { x: 180, y: 0 }], { color: '#334155', width: 2, opacity: 1 });
  inkNode(builder, 'arrow', { x: 1900, y: row + 40 }, [{ x: 0, y: 0 }, { x: 180, y: 0 }], { color: '#dc2626', width: 3, opacity: 1 });
  inkNode(builder, 'pen', { x: 2140, y: row }, [{ x: 0, y: 80 }, { x: 40, y: 0 }, { x: 80, y: 80 }, { x: 120, y: 0 }, { x: 160, y: 80 }], { color: '#059669', width: 4, opacity: 1 });
  builder.advance(180);

  builder.subheading('Text styles');
  const textRow = builder.cursorY;
  builder.addText('Display · 40 bold', { x: 0, y: textRow }, { size: { width: 320, height: 56 }, fontSize: 40, fontWeight: '700', customColor: '#0f172a' });
  builder.addText('Heading · 28 semibold', { x: 360, y: textRow + 8 }, { size: { width: 340, height: 44 }, fontSize: 28, fontWeight: '600', color: 'blue' });
  builder.addText('Body · 18 regular', { x: 740, y: textRow + 14 }, { size: { width: 300, height: 36 }, fontSize: 18, customColor: '#334155' });
  builder.addText('Caption · 12 italic', { x: 1080, y: textRow + 18 }, { size: { width: 260, height: 28 }, fontSize: 12, customColor: '#64748b' });
  builder.addText('Highlighted label', { x: 1380, y: textRow + 10 }, { size: { width: 320, height: 40 }, fontSize: 20, fontWeight: '600', backgroundColor: '#fef08a' });
  builder.advance(120);

  builder.subheading('Notes, callouts & media');
  const noteRow = builder.cursorY;
  catalogNode(builder, 'sticky', { x: 0, y: noteRow }, { label: 'Sticky note', subLabel: 'Yellow, 180×120', color: 'yellow' });
  catalogNode(builder, 'sticky', { x: 210, y: noteRow }, { label: 'Sticky note', subLabel: 'Blue variant', color: 'blue' });
  catalogNode(builder, 'annotation', { x: 420, y: noteRow }, { label: 'Annotation', subLabel: 'Annotates a node' });
  catalogNode(builder, 'callout', { x: 630, y: noteRow }, { label: 'Callout', subLabel: 'Points at something', color: 'pink' });
  catalogNode(builder, 'journey', { x: 840, y: noteRow }, {
    label: 'Journey step', journeyTitle: 'Checkout', journeySection: 'Payment',
    journeyTask: 'Pay', journeyActor: 'Customer', journeyScore: 4,
  });
  catalogNode(builder, 'browser', { x: 1090, y: noteRow }, { label: 'Browser frame' });
  catalogNode(builder, 'mobile', { x: 1540, y: noteRow }, { label: 'Mobile frame' });
  builder.add(createImageNode(builder.page, {
    id: builder.nextId('image'), at: { x: 1840, y: noteRow }, size: { width: 320, height: 200 },
    label: 'Inline image', url: IMAGE_DATA_URL,
  }));
  builder.addText('Mermaid import (mermaid_svg)', { x: 2220, y: noteRow }, { size: { width: 260, height: 24 }, fontSize: 14, customColor: '#64748b' });
  builder.add({
    id: builder.nextId('mermaid-svg'),
    kind: 'mermaid_svg',
    parentId: null,
    layerId: LAYER_ID,
    zIndex: 0,
    transform: { translation: { x: 2220, y: noteRow + 32 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    size: { width: 240, height: 120 },
    content: { label: 'Mermaid import', mermaidSvg: MERMAID_SAMPLE_SVG },
    appearance: {},
    ports: [],
    metadata: {},
    extensions: {},
  });
  builder.advance(420);
}


function addIcons(builder: StressBuilder): void {
  builder.pack(STRESS_ICONS, {
    maxWidth: COLUMN_WIDTH,
    gap: 40,
    sizeOf: () => ({ width: 148, height: 116 }),
    place: (at, icon: IconChoice) => {
      builder.add(createIconNode(builder.page, { id: builder.nextId(`icon-${icon.shapeId}`), at, icon }));
    },
  });
}


export interface StressDocumentOptions {
  readonly documentId?: string;
  readonly name?: string;
  readonly now?: string;
  readonly scaleNodes?: number;
}

export async function buildStressDocument(options: StressDocumentOptions = {}): Promise<SceneDocumentV1> {
  const now = options.now ?? new Date().toISOString();
  const builder = createBuilder();

  builder.addText('FlowMind — everything sheet', { x: 0, y: builder.cursorY }, {
    size: { width: 1600, height: 72 }, fontSize: 46, fontWeight: '700', customColor: '#0f172a',
  });
  builder.advance(80);
  builder.addText(
    'One page with every shape, node kind, diagram family, chart, widget, connector, ink stroke and icon pack the editor can draw. Open the scale documents for capacity tests.',
    { x: 0, y: builder.cursorY },
    { size: { width: 2400, height: 32 }, fontSize: 18, customColor: '#475569' }
  );
  builder.advance(100);

  builder.heading('1 · Shape library — every pickable shape');
  addShapeGrid(builder, SHAPE_KINDS);
  builder.subheading('Shapes only the DSL can name');
  addExtraShapes(builder);

  builder.heading('2 · Node kinds — insert catalogue');
  packCatalogNodes(
    builder,
    PRODUCTION_NODE_CATALOG.filter((entry) => entry.id !== 'group' && entry.id !== 'section' && entry.id !== 'swimlane')
  );

  builder.heading('3 · Containers — group, section, swimlane (with nesting)');
  addContainers(builder);

  builder.heading('4 · Diagram families — one compiled frame each');
  await addFamilyFrames(builder);

  builder.heading('5 · C4 model views — the drill-down system');
  await addC4Views(builder);

  builder.heading('6 · Charts — all ten kinds');
  addCharts(builder);

  builder.heading('7 · Widgets & device frames');
  builder.subheading('Frame presets');
  addFrames(builder);
  builder.subheading('Wireframe widgets');
  addWidgets(builder);

  builder.heading('8 · Ink, media & notes');
  addInkAndMedia(builder);

  builder.heading('9 · Connectors — routes, markers, dashes, labels');
  addConnectorDemos(builder);
  addFreeEndpointDemo(builder, builder.cursorY);
  builder.advance(220);

  builder.heading('10 · Icon packs — curated from all six providers');
  addIcons(builder);

  const scaleNodes = options.scaleNodes ?? 240;
  builder.heading(`11 · Scale block — ${scaleNodes} nodes chained`);
  addScaleBlock(builder, scaleNodes);

  return {
    format: SCENE_DOCUMENT_FORMAT,
    schemaVersion: SCENE_DOCUMENT_VERSION,
    id: options.documentId ?? 'stress-everything',
    name: options.name ?? 'Everything — all shapes & diagram types',
    createdAt: now,
    updatedAt: now,
    pages: [builder.page],
    metadata: {},
    extensions: {},
  };
}

export interface ScaleDocumentOptions {
  readonly documentId?: string;
  readonly name?: string;
  readonly now?: string;
}

export function buildScaleDocument(nodes: number, options: ScaleDocumentOptions = {}): SceneDocumentV1 {
  if (!Number.isInteger(nodes) || nodes < 2) throw new RangeError('Scale node count must be an integer ≥ 2.');
  const now = options.now ?? new Date().toISOString();
  const builder = createBuilder();
  builder.addText(`Scale test — ${nodes} nodes, ${nodes - 1} connectors`, { x: 0, y: 0 }, {
    size: { width: 1200, height: 56 }, fontSize: 32, fontWeight: '700', customColor: '#0f172a',
  });
  builder.advance(90);
  addScaleBlock(builder, nodes);
  return {
    format: SCENE_DOCUMENT_FORMAT,
    schemaVersion: SCENE_DOCUMENT_VERSION,
    id: options.documentId ?? `stress-scale-${nodes}`,
    name: options.name ?? `Scale ${nodes}`,
    createdAt: now,
    updatedAt: now,
    pages: [builder.page],
    metadata: {},
    extensions: {},
  };
}
