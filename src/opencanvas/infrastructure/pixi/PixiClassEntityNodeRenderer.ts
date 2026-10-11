import { Container, Graphics } from 'pixi.js';
import { createBounds2d } from '../../domain/geometry/bounds';
import type { Matrix2d } from '../../domain/geometry/types';
import type { SceneNode } from '../../domain/document/types';
import {
  projectClassEntityNodeVisual,
  type PixiClassEntityNodeVisual,
} from './classEntityNodeVisual';
import type { PixiNodeDebugRecord } from './pixiNodeDebug';
import { drawPixiLocalRect, drawPixiNodeOutline } from './pixiNodeOutline';
import { applyPixiNodeMatrix } from './pixiNodeTransform';
import { createPixiText } from './pixiText';
import {
  classEntityLayout,
  type ClassEntityLayout,
  CLASS_ENTITY_HEADER_HEIGHT as HEADER_HEIGHT,
} from '../../domain/nodes/classEntityRows';

export interface PixiClassEntityNodeDrawResult {
  readonly label: Container;
  readonly debug: PixiNodeDebugRecord;
}

export class PixiClassEntityNodeRenderer {
  drawNode(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics
  ): PixiClassEntityNodeDrawResult | null {
    const visual = projectClassEntityNodeVisual(node);
    if (!visual) return null;
    const layout = classEntityLayout(node)!;
    this.drawChrome(node, matrix, graphics, visual, layout);
    const label = this.createLabel(layout, visual);
    applyPixiNodeMatrix(label, matrix);
    const rowCount =
      visual.presentation.kind === 'class'
        ? visual.presentation.attributes.length + visual.presentation.methods.length
        : visual.presentation.fields.length;
    return {
      label,
      debug: {
        id: node.id,
        kind: visual.presentation.kind,
        shape: visual.presentation.kind === 'class' ? 'class-compartments' : 'entity-table',
        fill: visual.fill,
        stroke: visual.stroke,
        mediaState: 'none',
        rowCount,
        compartmentCount: visual.presentation.kind === 'class' ? 3 : 2,
      },
    };
  }

  private drawChrome(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics,
    visual: PixiClassEntityNodeVisual,
    layout: ClassEntityLayout
  ): void {
    drawPixiNodeOutline(graphics, 'rounded', node.size, matrix);
    graphics.fill({ color: visual.fill }).stroke({ color: visual.stroke, width: 1.5 });
    drawPixiLocalRect(
      graphics,
      createBounds2d(1, 1, Math.max(0, node.size.width - 2), HEADER_HEIGHT - 1),
      matrix,
      11
    );
    graphics.fill({ color: visual.headerFill });
    for (const y of layout.dividers) {
      drawPixiLocalRect(graphics, createBounds2d(0, y, node.size.width, 1), matrix);
      graphics.fill({ color: visual.stroke });
    }
  }

  private createLabel(layout: ClassEntityLayout, visual: PixiClassEntityNodeVisual): Container {
    const content = new Container();
    for (const run of layout.texts) {
      const text = createPixiText(run.text, {
        size: run.size,
        weight: String(run.weight),
        fill: visual[run.ink],
        family: run.family,
      });
      text.anchor.set(run.anchor === 'start' ? 0 : run.anchor === 'middle' ? 0.5 : 1, 0);
      text.position.set(run.x, run.y);
      content.addChild(text);
    }
    return content;
  }
}
