import { Container, Graphics } from 'pixi.js';
import { isJsonObject } from '../../domain/document/json';
import type { SceneNode } from '../../domain/document/types';
import { SEQUENCE_ACTIVATION_WIDTH, sequenceHeadShape } from '../../domain/nodes/sequenceNodePresentation';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import type { Matrix2d, Point2d } from '../../domain/geometry/types';
import { measurePortableText } from '../../domain/text/measurement';
import type { PixiNodeDebugRecord } from './pixiNodeDebug';
import { drawPixiLocalRect, drawPixiNodeOutline } from './pixiNodeOutline';
import { applyPixiNodeMatrix } from './pixiNodeTransform';
import { createPixiText, truncateTextToWidth } from './pixiText';
import { projectSequenceNodeVisual, type PixiSequenceNodeVisual } from './sequenceNodeVisual';

const PARTICIPANT_HEADER_HEIGHT = 48;
const ACTOR_HEIGHT = 40;
const MESSAGE_OFFSET = 44;
const MESSAGE_SPACING = 52;

interface PixiSequenceNodeDrawResult {
  readonly label: Container;
  readonly debug: PixiNodeDebugRecord;
}

function drawLocalLine(
  graphics: Graphics,
  start: Point2d,
  end: Point2d,
  matrix: Matrix2d,
  color: number,
  width = 1.5
): void {
  const worldStart = applyMatrixToPoint(matrix, start);
  const worldEnd = applyMatrixToPoint(matrix, end);
  graphics
    .moveTo(worldStart.x, worldStart.y)
    .lineTo(worldEnd.x, worldEnd.y)
    .stroke({ color, width });
}

function drawDashedLifeline(
  graphics: Graphics,
  x: number,
  startY: number,
  endY: number,
  matrix: Matrix2d,
  color: number
): void {
  for (let y = startY; y < endY; y += 12) {
    drawLocalLine(graphics, { x, y }, { x, y: Math.min(y + 6, endY) }, matrix, color, 1.5);
  }
}

export class PixiSequenceNodeRenderer {
  drawNode(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics,
    canvasColor?: string
  ): PixiSequenceNodeDrawResult | null {
    const visual = projectSequenceNodeVisual(node, canvasColor);
    if (!visual) return null;
    switch (visual.presentation.kind) {
      case 'sequence_participant':
        return this.drawParticipant(node, matrix, graphics, visual);
      case 'sequence_note':
        return this.drawNote(node, matrix, graphics, visual);
      case 'sequence_fragment':
        return this.drawFragment(node, matrix, graphics, visual);
    }
  }

  private drawParticipant(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics,
    visual: PixiSequenceNodeVisual
  ): PixiSequenceNodeDrawResult {
    const presentation = visual.presentation;
    if (presentation.kind !== 'sequence_participant') throw new TypeError('Expected participant.');
    const actorOffset = presentation.participantKind === 'actor' ? ACTOR_HEIGHT : 0;
    if (presentation.head === 'box') {
      drawPixiLocalRect(
        graphics,
        { x: 0, y: actorOffset, width: node.size.width, height: PARTICIPANT_HEADER_HEIGHT },
        matrix,
        5
      );
      graphics.fill({ color: visual.fill }).stroke({ color: visual.stroke, width: 1.5 });
    } else {
      const shape = sequenceHeadShape(presentation.head, node.size.width);
      const at = (point: Point2d) => applyMatrixToPoint(matrix, { x: point.x, y: point.y + actorOffset });
      graphics.poly(shape.outline.map(at).flatMap((point) => [point.x, point.y]));
      graphics.fill({ color: visual.fill }).stroke({ color: visual.stroke, width: 1.5 });
      const rim = shape.rim.map(at);
      graphics.moveTo(rim[0]!.x, rim[0]!.y);
      for (const point of rim.slice(1)) graphics.lineTo(point.x, point.y);
      graphics.stroke({ color: visual.stroke, width: 1.5 });
    }
    const centerX = node.size.width / 2;
    const lifelineStart = actorOffset + PARTICIPANT_HEADER_HEIGHT;
    drawDashedLifeline(graphics, centerX, lifelineStart, node.size.height, matrix, visual.stroke);
    for (const activation of presentation.activations) {
      const y = lifelineStart + MESSAGE_OFFSET + activation.startOrder * MESSAGE_SPACING;
      if (y >= node.size.height) continue;
      const height = Math.max(12, (activation.endOrder - activation.startOrder) * MESSAGE_SPACING);
      drawPixiLocalRect(
        graphics,
        { x: centerX - SEQUENCE_ACTIVATION_WIDTH / 2, y, width: SEQUENCE_ACTIVATION_WIDTH, height: Math.min(height, node.size.height - y) },
        matrix,
        2
      );
      graphics.fill({ color: visual.accentFill }).stroke({ color: visual.stroke, width: 1 });
    }
    if (presentation.participantKind === 'actor') {
      const head = applyMatrixToPoint(matrix, { x: centerX, y: 9 });
      graphics.circle(head.x, head.y, 5).stroke({ color: visual.stroke, width: 1.5 });
      drawLocalLine(graphics, { x: centerX, y: 14 }, { x: centerX, y: 28 }, matrix, visual.stroke);
      drawLocalLine(
        graphics,
        { x: centerX - 9, y: 20 },
        { x: centerX + 9, y: 20 },
        matrix,
        visual.stroke
      );
      drawLocalLine(
        graphics,
        { x: centerX, y: 28 },
        { x: centerX - 8, y: 37 },
        matrix,
        visual.stroke
      );
      drawLocalLine(
        graphics,
        { x: centerX, y: 28 },
        { x: centerX + 8, y: 37 },
        matrix,
        visual.stroke
      );
    }
    const label = new Container();
    const title = createPixiText(truncateTextToWidth(presentation.label, node.size.width - 24, 7), {
      size: 12,
      weight: '600',
      fill: visual.text,
    });
    title.anchor.set(0.5, 0.5);
    // A cylinder's rim takes the top of the head and a queue's its right end; the name sits in the body.
    title.position.set(
      centerX - (presentation.head === 'queue' ? 6 : 0),
      actorOffset + PARTICIPANT_HEADER_HEIGHT / 2 - (presentation.alias ? 6 : 0) + (presentation.head === 'cylinder' ? 6 : 0)
    );
    label.addChild(title);
    if (presentation.alias) {
      const alias = createPixiText(
        truncateTextToWidth(presentation.alias, node.size.width - 28, 5.5),
        {
          size: 9,
          weight: '500',
          fill: visual.subText,
        }
      );
      alias.anchor.set(0.5, 0.5);
      alias.position.set(centerX, actorOffset + PARTICIPANT_HEADER_HEIGHT / 2 + 10);
      label.addChild(alias);
    }
    applyPixiNodeMatrix(label, matrix);
    return {
      label,
      debug: {
        id: node.id,
        kind: presentation.kind,
        shape: presentation.participantKind === 'actor' ? 'actor-lifeline' : 'participant-lifeline',
        fill: visual.fill,
        stroke: visual.stroke,
        mediaState: 'none',
        sequenceParticipantKind: presentation.participantKind,
        sequenceAlias: presentation.alias ?? null,
        activationCount: presentation.activations.length,
      },
    };
  }

  private drawNote(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics,
    visual: PixiSequenceNodeVisual
  ): PixiSequenceNodeDrawResult {
    const presentation = visual.presentation;
    if (presentation.kind !== 'sequence_note') throw new TypeError('Expected sequence note.');
    drawPixiNodeOutline(graphics, 'rounded', node.size, matrix);
    graphics.fill({ color: visual.fill }).stroke({ color: visual.stroke, width: 1.25 });
    const label = new Container();
    const note = createPixiText(presentation.label, {
      size: 11,
      weight: '500',
      fill: visual.text,
      wrapWidth: Math.max(40, node.size.width - 24),
    });
    // Centred top to bottom, as the export draws it (canonicalSvg sequence_note).
    const measured = measurePortableText(presentation.label, { fontSize: 11, fontWeight: 500, maxWidth: Math.max(40, node.size.width - 24), overflow: 'wrap' });
    note.position.set(12, Math.max(8, (node.size.height - measured.height) / 2));
    label.addChild(note);
    applyPixiNodeMatrix(label, matrix);
    return {
      label,
      debug: {
        id: node.id,
        kind: presentation.kind,
        shape: 'sequence-note',
        fill: visual.fill,
        stroke: visual.stroke,
        mediaState: 'none',
        sequenceOrder: presentation.order,
        sequenceTargetCount: presentation.targets.length,
        sequenceFragmentType: presentation.fragment?.type ?? null,
      },
    };
  }

  private drawFragment(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics,
    visual: PixiSequenceNodeVisual
  ): PixiSequenceNodeDrawResult {
    const presentation = visual.presentation;
    if (presentation.kind !== 'sequence_fragment') throw new TypeError('Expected fragment.');
    // One frame per block: an `else`/`and` branch opens on a dashed divider, and a branch the
    // next one continues leaves its bottom edge to that divider.
    drawPixiNodeOutline(graphics, 'rectangle', node.size, matrix);
    graphics.fill({ color: visual.fill, alpha: 0.3 });
    const { width, height } = node.size;
    drawLocalLine(graphics, { x: 0, y: 0 }, { x: 0, y: height }, matrix, visual.stroke, 1.25);
    drawLocalLine(graphics, { x: width, y: 0 }, { x: width, y: height }, matrix, visual.stroke, 1.25);
    if (!presentation.continued) drawLocalLine(graphics, { x: 0, y: height }, { x: width, y: height }, matrix, visual.stroke, 1.25);
    if (presentation.divider) {
      for (let x = 0; x < width; x += 10) drawLocalLine(graphics, { x, y: 0 }, { x: Math.min(x + 5, width), y: 0 }, matrix, visual.stroke, 1.25);
    } else {
      drawLocalLine(graphics, { x: 0, y: 0 }, { x: width, y: 0 }, matrix, visual.stroke, 1.25);
      drawPixiLocalRect(
        graphics,
        { x: 0, y: 0, width: Math.min(72, width), height: 24 },
        matrix
      );
      graphics.fill({ color: visual.accentFill }).stroke({ color: visual.stroke, width: 1 });
    }
    const label = new Container();
    if (!presentation.divider) {
      const type = createPixiText(truncateTextToWidth(presentation.label, 60, 6.2), {
        size: 10,
        weight: '700',
        fill: visual.text,
      });
      type.position.set(8, 6);
      label.addChild(type);
    }
    if (presentation.condition) {
      // The layout says where the guard fits between lifelines; without it, it follows the tag.
      const guard = node.content.seqGuard;
      const box = isJsonObject(guard) && typeof guard.x === 'number' && typeof guard.width === 'number'
        ? { x: guard.x, width: guard.width } : { x: 82, width: node.size.width - 92 };
      const condition = createPixiText(
        truncateTextToWidth(presentation.divider ? `[${presentation.condition}]` : presentation.condition, box.width, 6.2),
        { size: 10, weight: '500', fill: visual.subText }
      );
      condition.position.set(box.x, 6);
      label.addChild(condition);
    }
    applyPixiNodeMatrix(label, matrix);
    return {
      label,
      debug: {
        id: node.id,
        kind: presentation.kind,
        shape: 'sequence-fragment',
        fill: visual.fill,
        fillAlpha: 0.3,
        stroke: visual.stroke,
        mediaState: 'none',
        sequenceOrder: presentation.order,
        sequenceFragmentId: presentation.fragmentId,
      },
    };
  }
}
