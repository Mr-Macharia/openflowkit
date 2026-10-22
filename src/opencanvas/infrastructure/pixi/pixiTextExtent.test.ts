import { Container, Text } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { pixiTextExtent } from './pixiTextExtent';

describe('pixiTextExtent', () => {
  it('reaches as far as wrapped text runs, through the label and its nested transforms', () => {
    const label = new Container();
    label.position.set(100, 50);
    const group = new Container();
    group.position.set(10, 0);
    const body = new Text({ text: 'one two three four five six seven eight nine ten', style: { fontSize: 12, wordWrap: true, wordWrapWidth: 60 } });
    body.position.set(2, 30);
    group.addChild(body);
    label.addChild(group);
    const extent = pixiTextExtent(label)!;
    expect(extent.x).toBeCloseTo(112);
    expect(extent.y).toBeCloseTo(80);
    expect(extent.width).toBeLessThanOrEqual(60);
    // Ten words at 60 px wide wrap to several lines: far taller than one 12 px line.
    expect(extent.height).toBeGreaterThan(50);
  });

  it('follows the anchor and scale, and skips hidden or empty text', () => {
    const label = new Container();
    label.scale.set(2);
    const title = new Text({ text: 'Title', style: { fontSize: 10 } });
    title.anchor.set(0.5);
    label.addChild(title, new Text({ text: '' }));
    const hidden = new Text({ text: 'far away', style: { fontSize: 10 } });
    hidden.position.set(5000, 5000);
    hidden.visible = false;
    label.addChild(hidden);
    const extent = pixiTextExtent(label)!;
    expect(extent.x + extent.width / 2).toBeCloseTo(0);
    expect(extent.y + extent.height / 2).toBeCloseTo(0);
    expect(extent.height).toBeCloseTo(24);
    expect(pixiTextExtent(new Container())).toBeNull();
  });
});
