import type { SceneNode } from '../document/types';
import type { Bounds2d, Point2d, Size2d } from '../geometry/types';
import { createBounds2d } from '../geometry/bounds';
import { paletteSwatch } from './nodePalette';
import type { ChartLabel, ChartMark, ChartPresentation, QuadrantData } from './chartNodeTypes';

export const DEFAULT_QUADRANT: QuadrantData = {
  xLabels: ['Low Effort', 'High Effort'],
  yLabels: ['Low Impact', 'High Impact'],
  quadrants: ['Quick wins', 'Big bets', 'Deprioritise', 'Time sinks'],
  points: [
    { label: 'Feature A', x: 0.32, y: 0.78 },
    { label: 'Feature B', x: 0.74, y: 0.7 },
    { label: 'Feature C', x: 0.68, y: 0.3 },
    { label: 'Feature D', x: 0.26, y: 0.32 },
  ],
};

export function quadrantContent(node: SceneNode): QuadrantData | null {
  if (node.kind !== 'chart' || node.content.chart !== 'quadrant') return null;
  const pair = (value: unknown, fallback: readonly [string, string]): readonly [string, string] => {
    if (!Array.isArray(value) || value.length < 2) return fallback;
    return [String(value[0] ?? fallback[0]), String(value[1] ?? fallback[1])];
  };
  const quad = (value: unknown): readonly [string, string, string, string] => {
    if (!Array.isArray(value) || value.length < 4) return DEFAULT_QUADRANT.quadrants;
    return [String(value[0]), String(value[1]), String(value[2]), String(value[3])];
  };
  const points = Array.isArray(node.content.points)
    ? node.content.points.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        const x = typeof record.x === 'number' && Number.isFinite(record.x) ? record.x : 0;
        const y = typeof record.y === 'number' && Number.isFinite(record.y) ? record.y : 0;
        return [{ label: String(record.label ?? 'Point'), x: clamp01(x), y: clamp01(y) }];
      })
    : DEFAULT_QUADRANT.points;
  return {
    xLabels: pair(node.content.xLabels, DEFAULT_QUADRANT.xLabels),
    yLabels: pair(node.content.yLabels, DEFAULT_QUADRANT.yLabels),
    quadrants: quad(node.content.quadrants),
    points,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Where a quadrant point sits in node-local coordinates (x right, y up). */
export function quadrantPointPosition(data: QuadrantData, point: QuadrantData['points'][number], plot: Bounds2d): Point2d {
  return { x: plot.x + point.x * plot.width, y: plot.y + (1 - point.y) * plot.height };
}

const QUADRANT_FILLS = ['blue', 'emerald', 'red', 'amber'] as const;

export function quadrantPresentation(data: QuadrantData, size: Size2d): ChartPresentation {
  const caption = 22;
  const plot = createBounds2d(caption + 26, 8, Math.max(20, size.width - caption - 26 - 12), Math.max(20, size.height - 8 - caption));
  const marks: ChartMark[] = [];
  [0, 1, 2, 3].forEach((index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const swatch = paletteSwatch(QUADRANT_FILLS[index]!, 'pastel');
    marks.push({
      kind: 'cell', seriesIndex: index, color: swatch.fill, opacity: 1,
      points: [
        { x: plot.x + (column * plot.width) / 2, y: plot.y + (row * plot.height) / 2 },
        { x: plot.x + ((column + 1) * plot.width) / 2, y: plot.y + ((row + 1) * plot.height) / 2 },
      ],
    });
  });
  const labels: ChartLabel[] = [];
  data.quadrants.forEach((title, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    labels.push({
      at: { x: plot.x + ((column + 0.5) * plot.width) / 2, y: plot.y + (row * plot.height) / 2 + 14 },
      text: title, anchor: 'middle', role: 'axis',
    });
  });
  labels.push({ at: { x: plot.x + plot.width / 2, y: plot.y + plot.height + 14 }, text: data.xLabels[0], anchor: 'middle', role: 'axis' });
  labels.push({ at: { x: plot.x + plot.width, y: plot.y + plot.height + 14 }, text: data.xLabels[1], anchor: 'end', role: 'axis' });
  labels.push({ at: { x: plot.x - 28, y: plot.y + plot.height / 2 }, text: data.yLabels[0], anchor: 'middle', role: 'axis' });
  labels.push({ at: { x: plot.x - 28, y: plot.y + 6 }, text: data.yLabels[1], anchor: 'middle', role: 'axis' });
  data.points.forEach((point, index) => {
    const at = quadrantPointPosition(data, point, plot);
    marks.push({ kind: 'point', points: [at], seriesIndex: index, color: paletteSwatch('blue', 'solid').fill, opacity: 1 });
    labels.push({ at: { x: at.x + 8, y: at.y }, text: point.label, anchor: 'start', role: 'cell' });
  });
  const rules: Point2d[][] = [
    [{ x: plot.x + plot.width / 2, y: plot.y }, { x: plot.x + plot.width / 2, y: plot.y + plot.height }],
    [{ x: plot.x, y: plot.y + plot.height / 2 }, { x: plot.x + plot.width, y: plot.y + plot.height / 2 }],
  ];
  return {
    chart: 'quadrant', data: { categories: [], series: [] }, marks, rules, labels, legend: [],
    quadrants: { xLabels: data.xLabels, yLabels: data.yLabels, titles: data.quadrants },
  };
}

