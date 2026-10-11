// Slice 6.2 headed check: library shapes draw, connect, restyle and undo.
import { expect, test } from './test';

type V2Api = {
  getState(): { nodes: string[]; connectors: string[] };
  getNodeRect(id: string): { x: number; y: number; width: number; height: number } | null;
  getDocument(): {
    pages: [{
      nodes: { id: string; content: Record<string, unknown>; appearance: Record<string, unknown> }[];
      connectors: { id: string }[];
    }];
  };
};
const state = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __V2__: V2Api }).__V2__.getState());
const doc = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __V2__: V2Api }).__V2__.getDocument());
const nodeRect = (page: import('@playwright/test').Page, id: string) =>
  page.evaluate((nodeId: string) => (window as unknown as { __V2__: V2Api }).__V2__.getNodeRect(nodeId), id);

const BLUE_PASTEL = '#eff6ff';

test('draws a library shape, connects it, restyles it and undoes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('v2-canvas').focus();

  // Pick the star from the flyout, then place it.
  await page.getByRole('button', { name: 'Shapes options' }).click();
  await page.getByRole('option', { name: 'Star' }).click();
  await page.mouse.click(420, 320);
  await expect.poll(async () => (await state(page)).nodes.length).toBe(1);
  expect((await doc(page)).pages[0].nodes[0]!.content.shape).toBe('star');

  // Two more shapes with the plain tools (Escape first: a selected blank shape would
  // swallow the tool letter as type-to-edit).
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await page.mouse.click(760, 320);
  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  await page.mouse.click(1080, 320);
  await expect.poll(async () => (await state(page)).nodes.length).toBe(3);

  // Connect the first two with the arrow tool.
  const [first, second, third] = (await state(page)).nodes;
  const rectA = (await nodeRect(page, first!))!;
  const rectB = (await nodeRect(page, second!))!;
  const box = (await page.locator('[data-testid="v2-canvas"] canvas').boundingBox())!;
  await page.keyboard.press('Escape');
  await page.keyboard.press('a');
  await page.mouse.move(box.x + rectA.x + rectA.width / 2, box.y + rectA.y + rectA.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + rectB.x + rectB.width / 2, box.y + rectB.y + rectB.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).connectors.length).toBe(1);

  // Fill from the style bar, one undo step.
  await page.keyboard.press('Escape');
  const starRect = (await nodeRect(page, first!))!;
  await page.mouse.click(box.x + starRect.x + starRect.width / 2, box.y + starRect.y + starRect.height / 2);
  await expect.poll(async () => (await state(page)).nodes).toEqual([first!, second!, third!].map(String));
  await page.locator('[data-context-bar]').getByRole('button', { name: 'Fill' }).click();
  await page.getByRole('radio', { name: 'Blue', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => String((await doc(page)).pages[0].nodes[0]!.appearance.fill)).toBe(BLUE_PASTEL);

  await page.keyboard.press('Meta+z');
  await expect.poll(async () => String((await doc(page)).pages[0].nodes[0]!.appearance.fill)).not.toBe(BLUE_PASTEL);
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await state(page)).connectors.length).toBe(0);
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await state(page)).nodes.length).toBe(2);
});

test('Square is the first Basic shape: a rectangle drawn 1:1 @gate', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('v2-canvas').focus();
  await page.getByRole('button', { name: 'Shapes options' }).click();
  const basic = page.getByRole('option');
  await expect(basic.first()).toHaveAccessibleName('Square');
  await basic.first().click();

  // Click: 120×120, same kind and content as the Rectangle tool's node.
  await page.mouse.click(500, 400);
  await expect.poll(async () => (await state(page)).nodes.length).toBe(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await page.mouse.click(900, 400);
  await expect.poll(async () => (await state(page)).nodes.length).toBe(2);
  const [square, rectangle] = (await doc(page)).pages[0].nodes as unknown as
    { content: Record<string, unknown>; appearance: Record<string, unknown>; size: { width: number; height: number } }[];
  expect(square!.size).toEqual({ width: 120, height: 120 });
  expect(square!.content).toEqual(rectangle!.content);
  expect(square!.appearance).toEqual(rectangle!.appearance);

  // The rail now offers Square: its button shows the square glyph, one click re-arms it.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Shapes options' }).click();
  await page.getByRole('option', { name: 'Square' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect(page.getByRole('button', { name: 'Shapes', exact: true }).locator('path')).toHaveAttribute('d', 'M4.75 4.75h14.5v14.5H4.75z');
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();

  // Drag: equal sides, the larger extent, anchored at the start corner.
  await page.mouse.move(300, 600);
  await page.mouse.down();
  await page.mouse.move(380, 640, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).nodes.length).toBe(3);
  const drawn = (await doc(page)).pages[0].nodes[2] as unknown as { size: { width: number; height: number } };
  expect(drawn.size.width).toBeGreaterThan(40);
  expect(drawn.size.width).toBe(drawn.size.height);
});
