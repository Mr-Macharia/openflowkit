// A titled diagram with groups: the title and every group name keep clear air, and an edge into a group runs past its name.
import type { Page } from '@playwright/test';
import { containerTextBounds } from '../src/opencanvas/domain/nodes/nodeLabelBounds';
import type { SceneNode } from '../src/opencanvas/domain/document/types';
import { rect } from './helpers';
import { expect, test } from './test';

const DSL = `flowchart down
title: Order flow
group Checkout {
  Cart -> Payment
}
group Fulfilment {
  Pick -> Ship
}
Payment -> Pick
`;

type Api = {
  getDocument(): { pages: [{ nodes: SceneNode[]; connectors: { id: string; source: { nodeId: string | null }; target: { nodeId: string | null } }[] }] };
  getConnectorScreenSamples(id: string): { x: number; y: number }[] | null;
};

test('a section header keeps clear of the diagram and its edges @gate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="v2-canvas"]');
  await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Diagram as code' }).click();
  const source = page.getByRole('textbox', { name: 'Diagram source' });
  await source.fill(DSL);
  await source.press('ControlOrMeta+Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __V2__: Api }).__V2__.getDocument().pages[0].nodes
    .some((node) => node.content.label === 'Fulfilment'))).toBe(true);

  const { frame, groups, edge } = await page.evaluate(() => {
    const api = (window as unknown as { __V2__: Api }).__V2__;
    const [{ nodes, connectors }] = api.getDocument().pages;
    const id = (label: string) => nodes.find((node) => node.content.label === label)!.id;
    return {
      frame: nodes.find((node) => node.kind === 'frame')!,
      groups: nodes.filter((node) => ['Checkout', 'Fulfilment'].includes(String(node.content.label))),
      edge: connectors.find((connector) => connector.source.nodeId === id('Payment') && connector.target.nodeId === id('Pick'))!,
    };
  });
  // The camera fits the new diagram: measure once it has stopped moving.
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await rect(page, frame.id));
    const settled = now === last;
    last = now;
    return settled;
  }, { intervals: [250] }).toBe(true);
  const frameRect = (await rect(page, frame.id))!;
  const zoom = frameRect.width / frame.size.width;

  // The first content starts 72px (the 40px title band plus air) below the frame's top.
  for (const group of groups) {
    expect((await rect(page, group.id))!.y).toBeGreaterThanOrEqual(frameRect.y + 72 * zoom - 1);
  }

  // The Payment -> Pick edge enters Fulfilment without reading through its name.
  const fulfilment = groups.find((group) => group.content.label === 'Fulfilment')!;
  const groupRect = (await rect(page, fulfilment.id))!;
  const [text] = containerTextBounds(fulfilment);
  const name = { x: groupRect.x + text!.x * zoom, y: groupRect.y + text!.y * zoom, width: text!.width * zoom, height: text!.height * zoom };
  await expect.poll(() => samples(page, edge.id)).not.toBeNull();
  const route = (await samples(page, edge.id))!;
  for (let index = 1; index < route.length; index += 1) {
    const [from, to] = [route[index - 1]!, route[index]!];
    const across = Math.max(from.x, to.x) > name.x && Math.min(from.x, to.x) < name.x + name.width
      && Math.max(from.y, to.y) > name.y && Math.min(from.y, to.y) < name.y + name.height;
    expect(across, `segment ${index} reads through the group name`).toBe(false);
  }
  // It arrives on the top of Pick in one straight run.
  const [beforeEnd, end] = route.slice(-2) as [{ x: number; y: number }, { x: number; y: number }];
  expect(Math.abs(beforeEnd.x - end.x)).toBeLessThan(0.5);
  expect(end.y).toBeGreaterThan(beforeEnd.y);
});

const samples = (page: Page, id: string) =>
  page.evaluate((connectorId) => (window as unknown as { __V2__: Api }).__V2__.getConnectorScreenSamples(connectorId), id);
