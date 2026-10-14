import { pointAtPolylineRatio, polylineLength } from '../geometry/polyline';
import { distanceBetweenPoints } from '../geometry/point';
import type { Bounds2d, Point2d } from '../geometry/types';
import { intersectsBounds } from '../geometry/bounds';

// Ratios tried along a route once no run's middle is clear, nearest the middle first.
const LABEL_RATIOS = [0.5, 0.35, 0.65, 0.25, 0.75];
const LABEL_NUDGE_GAP_PX = 4;

/** The unit normal of the route where it meets `ratio`, for stepping a plate off the line. */
function normalAtRatio(samples: readonly Point2d[], ratio: number): Point2d {
  let remaining = polylineLength(samples) * ratio;
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1]!;
    const to = samples[index]!;
    const length = distanceBetweenPoints(from, to);
    if (length > 1e-9 && (remaining <= length || index === samples.length - 1)) return { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
    remaining -= length;
  }
  return { x: 0, y: -1 };
}

/**
 * Where a label may sit along its route, in the order it is tried: the asked-for point (so a label
 * never jumps while its neighbours move), the middle of each run longest first (a label mid-run reads
 * better than one on a corner), a few steps along the route, then a step off the line to either side.
 */
function* labelCandidates(pathRatio: number, samples: readonly Point2d[], plateHeight: number): Generator<Point2d> {
  const preferred = pointAtPolylineRatio(samples, pathRatio);
  if (!preferred) return;
  yield preferred;
  const runs = samples.slice(1).map((point, index) => ({ from: samples[index]!, to: point }))
    .sort((a, b) => distanceBetweenPoints(b.from, b.to) - distanceBetweenPoints(a.from, a.to));
  for (const { from, to } of runs) yield { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  for (const ratio of LABEL_RATIOS) {
    const point = pointAtPolylineRatio(samples, ratio);
    if (point) yield point;
  }
  const normal = normalAtRatio(samples, pathRatio);
  const step = plateHeight + LABEL_NUDGE_GAP_PX;
  for (const side of [1, -1]) yield { x: preferred.x + normal.x * step * side, y: preferred.y + normal.y * step * side };
}

/** Whether the segment a→b passes through `box` (Liang–Barsky clip). */
function segmentTouchesBounds(a: Point2d, b: Point2d, box: Bounds2d): boolean {
  let from = 0;
  let to = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.x], [dx, box.x + box.width - a.x], [-dy, a.y - box.y], [dy, box.y + box.height - a.y]] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    if (from > to) return false;
  }
  return true;
}

/**
 * Where a label sits clear of everything in `obstacles` (the nodes, and the labels placed before
 * it) and off every line in `lines`: the asked-for point if it is, else the first of the other candidates that is, else the
 * asked-for point after all. Labels the user placed (an offset) never come here.
 */
export function clearLabelPoint(
  text: string,
  pathRatio: number,
  samples: readonly Point2d[],
  obstacles: readonly Bounds2d[],
  plate: (text: string, point: Point2d) => Bounds2d,
  /** Other connectors' routes: a plate on one of their lines hides it. */
  lines: readonly (readonly Point2d[])[] = []
): Point2d | null {
  const preferred = pointAtPolylineRatio(samples, pathRatio);
  if (!preferred) return null;
  const clear = (point: Point2d) => {
    const box = plate(text, point);
    return !obstacles.some((bounds) => intersectsBounds(bounds, box));
  };
  const offLines = (point: Point2d) => {
    const box = plate(text, point);
    return !lines.some((line) => line.some((to, index) => index > 0 && segmentTouchesBounds(line[index - 1]!, to, box)));
  };
  const candidates = [...labelCandidates(pathRatio, samples, plate(text, preferred).height)];
  // Off everything first; failing that, off the nodes and labels at least (a crossing is the lesser harm).
  return candidates.find((point) => clear(point) && offLines(point)) ?? candidates.find(clear) ?? preferred;
}
