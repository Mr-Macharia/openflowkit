import { describe, expect, it } from 'vitest';
import { cullReveal, cursorGlideMs, planAgentReveal, REVEAL_CAP, REVEAL_MAX, revealStateAt } from './agentReveal';
import { animEdge, animNode, animPage } from './testFixtures';

describe('planAgentReveal', () => {
  it('pops new shapes in connector order and draws each connector after its later end', () => {
    const before = animPage([animNode('old', 0, 0)]);
    // c is above a on the page, but a → b → c is the build order.
    const after = animPage(
      [animNode('old', 0, 0), animNode('c', 400, -200), animNode('a', 0, 200), animNode('b', 200, 200)],
      [animEdge('ab', 'a', 'b'), animEdge('bc', 'b', 'c')],
    );
    const plan = planAgentReveal(before, after)!;
    const pops = plan.groups.filter((group) => group.kind === 'pop');
    expect(pops.map((group) => group.nodeIds[0])).toEqual(['a', 'b', 'c']);
    expect(pops.map((group) => group.startMs)).toEqual([0, 110, 220]);
    const line = (id: string) => plan.groups.find((group) => group.connectorIds.includes(id))!;
    expect(line('ab').kind).toBe('line');
    expect(line('ab').startMs).toBeGreaterThan(pops[1]!.startMs);
    expect(line('bc').startMs).toBeGreaterThan(pops[2]!.startMs);
    // Drawn from its source's centre, out past the far corner of its target.
    expect(line('ab').pivot).toEqual({ x: 50, y: 225 });
    expect(line('ab').reach).toBeGreaterThan(Math.hypot(250, 25));
    // The cursor rests at each shape's lower right: first built, then last.
    expect(plan.trail).toEqual([{ x: 85, y: 240 }, { x: 485, y: -160 }]);
    expect(plan.durationMs).toBeLessThanOrEqual(560);
    expect(plan.groups.flatMap((group) => group.nodeIds)).not.toContain('old');
  });

  it('keeps any batch under the cap inside ~700 ms', () => {
    const nodes = Array.from({ length: REVEAL_CAP - 1 }, (_, i) => animNode(`n${i}`, i * 120, 0));
    const edges = nodes.slice(1).map((node, i) => animEdge(`e${i}`, `n${i}`, node.id));
    const plan = planAgentReveal(animPage([]), animPage(nodes, edges))!;
    expect(plan.groups.filter((group) => group.kind === 'pop')).toHaveLength(REVEAL_CAP - 1);
    expect(plan.durationMs).toBeLessThanOrEqual(560);
  });

  it('shows a batch of the cap or more as one quick fade', () => {
    const nodes = Array.from({ length: REVEAL_CAP }, (_, i) => animNode(`n${i}`, i * 120, 0));
    const plan = planAgentReveal(animPage([]), animPage(nodes, [animEdge('e', 'n0', 'n1')]))!;
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({ kind: 'fade', connectorIds: ['e'] });
    expect(plan.groups[0]!.nodeIds).toHaveLength(REVEAL_CAP);
    expect(plan.durationMs).toBeLessThan(300);
  });

  // Review 2 #3: the reveal draws its shapes a second time; at hundreds of shapes that is a long task, not motion.
  it('skips the reveal above REVEAL_MAX shapes: they simply show', () => {
    const nodes = Array.from({ length: REVEAL_MAX + 1 }, (_, i) => animNode(`n${i}`, i * 120, 0));
    const big = planAgentReveal(animPage([]), animPage(nodes))!;
    expect(big.groups).toEqual([]);
    // The cursor still has somewhere to go.
    expect(big.trail).toHaveLength(1);
    expect(planAgentReveal(animPage([]), animPage(nodes.slice(0, REVEAL_MAX)))!.groups).toHaveLength(1);
  });

  it('culls a plan to what is on screen; the page draws the rest as usual', () => {
    const after = animPage([animNode('a', 0, 0), animNode('b', 200, 0), animNode('far', 9000, 0)], [animEdge('ab', 'a', 'b'), animEdge('bf', 'b', 'far')]);
    const plan = planAgentReveal(animPage([]), after)!;
    const culled = cullReveal(plan, new Set(['a', 'b']), new Set(['ab']));
    expect(culled.groups.flatMap((group) => group.nodeIds)).toEqual(['a', 'b']);
    expect(culled.groups.flatMap((group) => group.connectorIds)).toEqual(['ab']);
    expect(culled.groups.every((group) => group.nodeIds.length + group.connectorIds.length > 0)).toBe(true);
    // No culling (a small page draws everything): the plan as made.
    expect(cullReveal(plan, null, null)).toBe(plan);
  });

  it('slides a moved shape from its old place, and brings its connectors back after it lands', () => {
    const before = animPage([animNode('a', 0, 0), animNode('b', 300, 0)], [animEdge('ab', 'a', 'b')]);
    const after = animPage([animNode('a', 0, 0), animNode('b', 300, 200)], [animEdge('ab', 'a', 'b')]);
    const plan = planAgentReveal(before, after)!;
    const morph = plan.groups.find((group) => group.kind === 'morph')!;
    expect(morph).toMatchObject({ nodeIds: ['b'], from: { x: 300, y: 0 }, to: { x: 300, y: 200 } });
    const lines = plan.groups.find((group) => group.connectorIds.includes('ab'))!;
    expect(lines.kind).toBe('fade');
    expect(lines.startMs).toBeGreaterThan(morph.startMs + morph.ms / 2);
    expect(revealStateAt(morph, 0)).toMatchObject({ x: 300, y: 0, opacity: 1 });
    expect(revealStateAt(morph, morph.ms)).toMatchObject({ x: 300, y: 200, scaleX: 1, scaleY: 1 });
  });

  it('is null when nothing was added or moved (a removal, a restyle)', () => {
    const page = animPage([animNode('a', 0, 0), animNode('b', 300, 0)]);
    expect(planAgentReveal(page, animPage([animNode('a', 0, 0)]))).toBeNull();
    expect(planAgentReveal(page, page)).toBeNull();
  });

  it('draws a connector between two shapes that were already there at once', () => {
    const before = animPage([animNode('a', 0, 0), animNode('b', 300, 0)]);
    const after = animPage(before.nodes as never, [animEdge('ab', 'a', 'b')]);
    const plan = planAgentReveal(before, after)!;
    expect(plan.groups).toEqual([expect.objectContaining({ kind: 'line', connectorIds: ['ab'], startMs: 0 })]);
  });
});

describe('revealStateAt', () => {
  const pop = { nodeIds: ['a'], connectorIds: [], kind: 'pop' as const, startMs: 100, ms: 300, pivot: { x: 10, y: 20 }, reach: 0 };
  it('is hidden before its start and whole after its end', () => {
    expect(revealStateAt(pop, 0).opacity).toBe(0);
    expect(revealStateAt(pop, 0).scaleX).toBeCloseTo(0.92);
    expect(revealStateAt(pop, 400)).toEqual({ opacity: 1, x: 10, y: 20, scaleX: 1, scaleY: 1, radius: null });
  });
  it('uncovers a line outward, then drops the mask', () => {
    const line = { ...pop, kind: 'line' as const, reach: 200 };
    expect(revealStateAt(line, 50).opacity).toBe(0);
    expect(revealStateAt(line, 175).radius).toBeGreaterThan(0);
    expect(revealStateAt(line, 175).radius).toBeLessThan(200);
    expect(revealStateAt(line, 400).radius).toBeNull();
  });
});

describe('cursorGlideMs', () => {
  it('is calm at any distance', () => {
    expect(cursorGlideMs(0)).toBe(420);
    expect(cursorGlideMs(400)).toBe(540);
    expect(cursorGlideMs(5000)).toBe(950);
  });
});
