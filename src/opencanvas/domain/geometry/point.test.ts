import { describe, expect, it } from 'vitest';
import { areNearlyEqual, requireFiniteNumber, requireNonNegativeNumber } from './finite';
import {
  addVectorToPoint,
  arePointsNearlyEqual,
  createPoint2d,
  createVector2d,
  crossProduct,
  distanceBetweenPoints,
  dotProduct,
  isPoint2d,
  isVector2d,
  lerpPoint,
  normalizeVector,
  scaleVector,
  snapToAngle,
  subtractPoints,
  vectorLength,
} from './point';

describe('finite geometry values', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite value %s',
    (value) => {
      expect(() => requireFiniteNumber(value, 'test')).toThrow(RangeError);
      expect(isPoint2d({ x: value, y: 0 })).toBe(false);
    }
  );

  it('normalizes negative zero and rejects negative constrained values', () => {
    expect(Object.is(requireFiniteNumber(-0, 'test'), -0)).toBe(false);
    expect(() => requireNonNegativeNumber(-1, 'test')).toThrow(RangeError);
  });

  it('compares values with an inclusive, validated epsilon', () => {
    expect(areNearlyEqual(1, 1.5, 0.5)).toBe(true);
    expect(areNearlyEqual(1, 1.51, 0.5)).toBe(false);
    expect(() => areNearlyEqual(1, 1, -1)).toThrow(RangeError);
  });
});

describe('points and vectors', () => {
  it('constructs and recognizes finite structural values', () => {
    expect(createPoint2d(2, -3)).toEqual({ x: 2, y: -3 });
    expect(createVector2d(4, 5)).toEqual({ x: 4, y: 5 });
    expect(isPoint2d({ x: 2, y: -3 })).toBe(true);
    expect(isVector2d({ x: 4, y: 5 })).toBe(true);
    expect(isPoint2d(null)).toBe(false);
  });

  it('supports vector arithmetic without renderer types', () => {
    const start = createPoint2d(1, 2);
    const end = createPoint2d(4, 6);
    const vector = subtractPoints(end, start);

    expect(vector).toEqual({ x: 3, y: 4 });
    expect(addVectorToPoint(start, vector)).toEqual(end);
    expect(scaleVector(vector, 2)).toEqual({ x: 6, y: 8 });
    expect(vectorLength(vector)).toBe(5);
    expect(distanceBetweenPoints(start, end)).toBe(5);
    expect(dotProduct(vector, { x: -4, y: 3 })).toBe(0);
    expect(crossProduct(vector, { x: -4, y: 3 })).toBe(25);
  });

  it('normalizes non-zero vectors and rejects effectively zero vectors', () => {
    const normalized = normalizeVector({ x: 3, y: 4 });
    expect(normalized?.x).toBeCloseTo(0.6);
    expect(normalized?.y).toBeCloseTo(0.8);
    expect(normalizeVector({ x: 1e-10, y: 0 })).toBeNull();
  });

  it('interpolates and compares points', () => {
    expect(lerpPoint({ x: 0, y: 10 }, { x: 10, y: 20 }, 0.25)).toEqual({
      x: 2.5,
      y: 12.5,
    });
    expect(arePointsNearlyEqual({ x: 1, y: 2 }, { x: 1.001, y: 2.001 }, 0.001)).toBe(true);
  });

  it('⇧ snaps a direction to the nearest 45°, keeping the length projected onto it', () => {
    const origin = { x: 10, y: 10 };
    // 20° off the x axis lands on it.
    const flat = snapToAngle(origin, { x: 110, y: 10 + 100 * Math.tan(Math.PI / 9) }, Math.PI / 4);
    expect(flat.x).toBeCloseTo(110);
    expect(flat.y).toBeCloseTo(10);
    // 40° lands on the diagonal.
    const diagonal = snapToAngle(origin, { x: 10 + 100 * Math.cos(0.7), y: 10 - 100 * Math.sin(0.7) }, Math.PI / 4);
    expect(diagonal.x - 10).toBeCloseTo(-(diagonal.y - 10));
    expect(snapToAngle(origin, origin, Math.PI / 4)).toEqual(origin);
  });
});
