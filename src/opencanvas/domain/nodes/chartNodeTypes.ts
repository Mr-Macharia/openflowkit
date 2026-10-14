import type { Point2d } from '../geometry/types';

export type ChartKind =
  | 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'donut' | 'radar' | 'heatmap' | 'table'
  | 'quadrant';

export const CHART_KINDS: readonly ChartKind[] = [
  'bar', 'line', 'area', 'scatter', 'pie', 'donut', 'radar', 'heatmap', 'table', 'quadrant',
];

/** Quadrant charts are points on a 0–1 plane, not series over categories. */
export interface QuadrantData {
  readonly xLabels: readonly [string, string];
  readonly yLabels: readonly [string, string];
  /** Top-left, top-right, bottom-left, bottom-right. */
  readonly quadrants: readonly [string, string, string, string];
  readonly points: readonly { readonly label: string; readonly x: number; readonly y: number }[];
}


export interface ChartData {
  readonly categories: readonly string[];
  readonly series: readonly { readonly name: string; readonly values: readonly number[] }[];
}

export interface ChartMark {
  readonly kind: 'bar' | 'line' | 'area' | 'point' | 'slice' | 'cell' | 'swatch';
  /** Local node coordinates; a line has its full polyline. */
  readonly points: readonly Point2d[];
  readonly seriesIndex: number;
  readonly color: string;
  readonly opacity: number;
  readonly value?: number;
  readonly label?: string;
}

export interface ChartLabel {
  readonly at: Point2d;
  readonly text: string;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly role: 'title' | 'axis' | 'tick' | 'value' | 'cell' | 'legend';
  /** Overrides the theme text colour, e.g. white on a saturated wedge. */
  readonly color?: string;
}

export interface ChartPresentation {
  readonly chart: ChartKind;
  readonly data: ChartData;
  readonly marks: readonly ChartMark[];
  /** Axis/baseline/spoke lines. */
  readonly rules: readonly (readonly Point2d[])[];
  readonly labels: readonly ChartLabel[];
  readonly legend: readonly { readonly color: string; readonly label: string }[];
  /** Table layout for the `table` chart kind. */
  readonly table?: {
    readonly columns: readonly number[];
    readonly rows: readonly number[];
    readonly headerHeight: number;
  };
  /** Quadrant axis captions, when a quadrant chart carries them. */
  readonly quadrants?: {
    readonly xLabels: readonly [string, string];
    readonly yLabels: readonly [string, string];
    readonly titles: readonly [string, string, string, string];
  };
}
