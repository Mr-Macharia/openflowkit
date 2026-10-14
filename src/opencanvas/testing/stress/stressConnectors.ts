import type { JsonObject } from '../../domain/document/json';
import type { ConnectorEndpoint, SceneConnector } from '../../domain/document/types';
import type { Point2d } from '../../domain/geometry/types';
import { catalogNode, type StressBuilder } from './stressBuilder';

const boundEndpoint = (nodeId: string, side: 'top' | 'right' | 'bottom' | 'left'): ConnectorEndpoint => ({
  nodeId,
  portId: null,
  anchor: { kind: 'side', side, ratio: 0.5 },
  point: null,
});

export function connector(
  builder: StressBuilder,
  source: ConnectorEndpoint,
  target: ConnectorEndpoint,
  route: SceneConnector['route'],
  appearance: JsonObject,
  semantics: JsonObject = {},
  labels: readonly string[] = [],
  waypoints: readonly Point2d[] = []
): SceneConnector {
  const id = builder.nextId('wire');
  return {
    id,
    source,
    target,
    route,
    waypoints,
    labels: labels.map((text, index) => ({
      id: `${id}-label-${index}`,
      text,
      pathRatio: labels.length === 1 ? 0.5 : (index + 1) / (labels.length + 1),
      offset: { x: 0, y: index === 0 ? 0 : -14 },
      metadata: {},
    })),
    appearance,
    semantics,
    metadata: {},
    extensions: {},
  };
}

export const orthogonal: SceneConnector['route'] = { kind: 'orthogonal', ownership: 'automatic' };

interface ConnectorDemo {
  readonly caption: string;
  readonly demos: (builder: StressBuilder, source: string, target: string, x: number, y: number) => readonly SceneConnector[];
}

const CONNECTOR_DEMOS: readonly ConnectorDemo[] = [
  { caption: 'Direct · arrow', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), { kind: 'direct', ownership: 'automatic' }, { markerEnd: 'arrow' })] },
  { caption: 'Orthogonal', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow' })] },
  { caption: 'Bezier curve', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), { kind: 'bezier', ownership: 'automatic' }, { markerEnd: 'arrow' })] },
  {
    caption: 'Polyline · manual bends',
    demos: (b, s, t, x, y) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), { kind: 'polyline', ownership: 'manual' }, { markerEnd: 'arrow' }, {}, [], [
      { x: x + 205, y: y + 32 },
      { x: x + 205, y: y + 160 },
      { x: x + 300, y: y + 160 },
    ])],
  },
  { caption: 'Dashed', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow', dashPattern: 'dashed' })] },
  { caption: 'Dotted', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow', dashPattern: 'dotted' })] },
  { caption: 'Dash-dot', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow', dashPattern: 'dashdot' })] },
  { caption: 'Thick · orange', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow', strokeWidth: 4, stroke: '#ea580c' })] },
  { caption: 'Thin · faded', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow', strokeWidth: 1, opacity: 0.4 })] },
  { caption: 'Arrow at start only', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerStart: 'arrow', markerEnd: 'none' })] },
  { caption: 'Dots both ends', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerStart: 'dot', markerEnd: 'dot' })] },
  { caption: 'Cross at start', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerStart: 'cross', markerEnd: 'arrow' })] },
  { caption: 'Diamond at end', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'diamond' })] },
  { caption: 'Corner radius 24', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow', cornerRadius: 24 })] },
  { caption: 'Class · extends --|>', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {}, { classRelation: '--|>' })] },
  { caption: 'Class · composition *--', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {}, { classRelation: '*--' })] },
  { caption: 'Class · aggregation o--', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {}, { classRelation: 'o--' })] },
  { caption: 'Class · dependency ..>', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {}, { classRelation: '..>' })] },
  { caption: 'ER · one to many ||--o{', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {}, { erRelation: '||--o{' })] },
  { caption: 'ER · many to many }o--o{', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {}, { erRelation: '}o--o{' })] },
  { caption: 'Sequence · sync call', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {}, { seqMessageKind: 'sync' })] },
  { caption: 'Sequence · return', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {}, { seqMessageKind: 'return' })] },
  { caption: 'Condition · error', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow' }, { condition: 'error' })] },
  { caption: 'Condition · success', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, { markerEnd: 'arrow' }, { condition: 'success' })] },
  {
    caption: 'Label plate · styled',
    demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), orthogonal, {
      markerEnd: 'arrow', labelColor: '#1d4ed8', labelBackground: '#dbeafe', labelFontSize: 15, labelFontWeight: 600,
    }, {}, ['styled label'])],
  },
  { caption: 'Two labels', demos: (b, s, t) => [connector(b, boundEndpoint(s, 'right'), boundEndpoint(t, 'left'), { kind: 'bezier', ownership: 'automatic' }, { markerEnd: 'arrow' }, {}, ['first', 'second'])] },
];

export function addConnectorDemos(builder: StressBuilder): void {
  const cellWidth = 560;
  const cellHeight = 270;
  const columns = 5;
  CONNECTOR_DEMOS.forEach((entry, index) => {
    const column = index % columns;
    const rowIndex = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = builder.cursorY + rowIndex * cellHeight;
    const source = catalogNode(builder, 'process', { x, y }, { label: 'Source' });
    const target = catalogNode(builder, 'process', { x: x + 260, y }, { label: 'Target' });
    for (const wire of entry.demos(builder, source.id, target.id, x, y)) builder.addConnector(wire);
    builder.addText(entry.caption, { x, y: y + 116 }, { size: { width: 500, height: 24 }, fontSize: 15, customColor: '#334155' });
  });
  const rows = Math.ceil(CONNECTOR_DEMOS.length / columns);
  builder.setCursor(builder.cursorY + rows * cellHeight + 40);
}

export function addFreeEndpointDemo(builder: StressBuilder, y: number): void {
  const source = { x: 0, y };
  const target = { x: 380, y: y + 90 };
  builder.addConnector({
    id: builder.nextId('wire-free'),
    source: { nodeId: null, portId: null, anchor: null, point: source },
    target: { nodeId: null, portId: null, anchor: null, point: target },
    route: { kind: 'bezier', ownership: 'manual' },
    waypoints: [],
    labels: [{ id: builder.nextId('wire-free-label'), text: 'free endpoints (no nodes)', pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {} }],
    appearance: { markerStart: 'dot', markerEnd: 'arrow', stroke: '#7c3aed' },
    semantics: {},
    metadata: {},
    extensions: {},
  });
  builder.addText('Free endpoints', { x: 420, y }, { size: { width: 300, height: 24 }, fontSize: 15, customColor: '#334155' });
}

export function addScaleBlock(builder: StressBuilder, count: number): void {
  const columns = 20;
  const cellWidth = 220;
  const cellHeight = 130;
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const node = catalogNode(
      builder,
      'process',
      { x: column * cellWidth, y: builder.cursorY + row * cellHeight },
      { label: `Node ${index + 1}` }
    );
    ids.push(node.id);
  }
  for (let index = 0; index + 1 < ids.length; index += 1) {
    builder.addConnector(connector(
      builder,
      { nodeId: ids[index] ?? null, portId: null, anchor: null, point: null },
      { nodeId: ids[index + 1] ?? null, portId: null, anchor: null, point: null },
      orthogonal,
      { markerEnd: 'arrow' }
    ));
  }
  const rows = Math.ceil(count / columns);
  builder.setCursor(builder.cursorY + rows * cellHeight + 80);
}
