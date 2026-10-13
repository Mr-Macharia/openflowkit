import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { elkDslLayoutPort } from '../services/elk-layout/runtime';
import { createEmptyV2Document } from '../opencanvas/presentation/v2/v2Document';
import { projectPageConnectors } from '../opencanvas/domain/connectors/routeProjection';

// A rect (120 wide) and a diamond (156 wide) joined both ways: each lane must run straight, not jog by the width difference.
describe('opposite-edge lanes between nodes of different widths', () => {
  it('give every lane a straight middle run', async () => {
    const compiled = await compile('flowchart TD\nStart -> Valid? [diamond]\nValid? -> Done : yes\nValid? -> Start : no', { layout: elkDslLayoutPort });
    const document = createEmptyV2Document('lanes', 'lanes');
    const page = { ...document.pages[0]!, nodes: [compiled.frame, ...compiled.groups, ...compiled.nodes], connectors: compiled.connectors };
    const lanes = compiled.connectors.filter((connector) => connector.source.anchor && connector.target.anchor);
    expect(lanes).toHaveLength(2);
    const routes = projectPageConnectors(page);
    for (const lane of lanes) {
      const x = (end: 'source' | 'target') => {
        const node = compiled.nodes.find((candidate) => candidate.id === lane[end].nodeId)!;
        const anchor = lane[end].anchor as { ratio: number };
        return node.transform.translation.x + node.size.width * anchor.ratio;
      };
      expect(x('source')).toBeCloseTo(x('target'), 6);
      // One straight run: a move and a single line, no jog between.
      const commands = routes.find((candidate) => candidate.id === lane.id)!.commands;
      expect(commands.map((command) => command.kind)).toEqual(['move', 'line']);
    }
  });
});
