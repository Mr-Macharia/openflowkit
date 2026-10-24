import { Text, type Container } from 'pixi.js';
import { createBounds2d, unionBounds } from '../../domain/geometry/bounds';
import { multiplyMatrices, transformBounds } from '../../domain/geometry/matrix';
import type { Bounds2d, Matrix2d } from '../../domain/geometry/types';
import { measurePortableText } from '../../domain/text/measurement';

const local = (view: Container): Matrix2d => {
  view.updateLocalTransform();
  const { a, b, c, d, tx, ty } = view.localTransform;
  return { a, b, c, d, tx, ty };
};

const weightOf = (weight: unknown): 400 | 500 | 600 | 700 => {
  const value = weight === 'bold' ? 700 : Number(weight) || 400;
  return value >= 700 ? 700 : value >= 600 ? 600 : value >= 500 ? 500 : 400;
};

/**
 * Where a label's text reaches, in its parent's space: each Text's measured box through the transforms down to it.
 * A sticky's body wraps to its width but not its height, so its text can run past the box it belongs to.
 * ponytail: portable glyph widths, not the browser's — an estimate within a few px; Pixi's own measure needs a canvas.
 */
export function pixiTextExtent(label: Container): Bounds2d | null {
  let extent: Bounds2d | null = null;
  const visit = (view: Container, parent: Matrix2d): void => {
    const matrix = multiplyMatrices(parent, local(view));
    if (view instanceof Text) {
      if (!view.visible || view.text.length === 0) return;
      const style = view.style;
      const fontSize = Number(style.fontSize) || 12;
      const size = measurePortableText(view.text, {
        fontSize,
        fontWeight: weightOf(style.fontWeight),
        ...(style.lineHeight ? { lineHeight: style.lineHeight } : {}),
        ...(style.wordWrap && style.wordWrapWidth > 0 ? { maxWidth: style.wordWrapWidth, overflow: 'wrap' as const } : {}),
      });
      const box = transformBounds(matrix, createBounds2d(-view.anchor.x * size.width, -view.anchor.y * size.height, size.width, size.height));
      extent = extent ? unionBounds(extent, box) : box;
      return;
    }
    for (const child of view.children) visit(child as Container, matrix);
  };
  visit(label, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  return extent;
}
