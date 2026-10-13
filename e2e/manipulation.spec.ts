// Direct-manipulation conventions, Figma first (tldraw/Excalidraw where they agree): a
// modifier held before the press counts, ⌥ copies, ⇧ constrains, double-click enters a group.
// npx playwright test e2e/manipulation.spec.ts --headed
import { expect, test, type Page } from './test';
import { centreOf, clickNode, doc, drawShape, emptyPoint, node, openCanvas, rect, state } from './helpers';

const canvasBox = async (page: Page) => (await page.locator('[data-testid="v2-canvas"] canvas').boundingBox())!;

/** Presses with `modifier` already down, drags by (dx, dy), lets go of both. */
async function dragWith(page: Page, modifier: string, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down(modifier);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up(modifier);
}

test('⇧ held before grabbing a corner keeps the proportions; ⌥ resizes about the centre', async ({ page }) => {
  await openCanvas(page);
  const id = await drawShape(page, 'r', 420, 340);
  await clickNode(page, id);
  const box = await canvasBox(page);
  const before = (await rect(page, id))!;
  await dragWith(page, 'Shift', { x: box.x + before.x + before.width, y: box.y + before.y + before.height }, 90, 4);
  await expect.poll(async () => Math.round((await rect(page, id))!.width)).toBeGreaterThan(Math.round(before.width) + 60);
  const shifted = (await rect(page, id))!;
  expect(Math.abs(shifted.width / shifted.height - before.width / before.height)).toBeLessThan(0.02);
  expect((await state(page)).selectedNodes).toEqual([id]);

  const centre = { x: shifted.x + shifted.width / 2, y: shifted.y + shifted.height / 2 };
  await dragWith(page, 'Alt', { x: box.x + shifted.x + shifted.width, y: box.y + shifted.y + shifted.height }, 30, 20);
  await expect.poll(async () => Math.round((await rect(page, id))!.width - shifted.width)).toBe(60);
  const centred = (await rect(page, id))!;
  expect(Math.abs(centred.x + centred.width / 2 - centre.x)).toBeLessThan(1.5);
  expect(Math.abs(centred.y + centred.height / 2 - centre.y)).toBeLessThan(1.5);
});

test('⇧ on a second shape adds it and the drag moves both along one axis, as one undo step', async ({ page }) => {
  await openCanvas(page);
  const a = await drawShape(page, 'r', 360, 300);
  const b = await drawShape(page, 'r', 760, 300);
  await clickNode(page, a);
  const at = async (id: string) => (await node(page, id)).transform!.translation;
  const [a0, b0] = [await at(a), await at(b)];
  await dragWith(page, 'Shift', await centreOf(page, b), 40, 160);
  await expect.poll(async () => (await state(page)).selectedNodes.toSorted()).toEqual([a, b].toSorted());
  await expect.poll(async () => (await at(b)).y - b0.y).toBeGreaterThan(100);
  expect((await at(b)).x).toBe(b0.x);
  expect((await at(a)).x).toBe(a0.x);
  expect((await at(a)).y - a0.y).toBe((await at(b)).y - b0.y);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await at(a)).y).toBe(a0.y);
  expect((await at(b)).y).toBe(b0.y);
});

test('⌥-drag leaves the original and drops a copy; one undo takes the copy away', async ({ page }) => {
  await openCanvas(page);
  const id = await drawShape(page, 'r', 420, 340);
  const original = (await node(page, id)).transform!.translation;
  await clickNode(page, id);
  await dragWith(page, 'Alt', await centreOf(page, id), 260, 0);
  await expect.poll(async () => (await state(page)).nodes.length).toBe(2);
  const copy = (await state(page)).nodes.find((candidate) => candidate !== id)!;
  expect((await node(page, id)).transform!.translation).toEqual(original);
  expect((await node(page, copy)).transform!.translation.x - original.x).toBeGreaterThan(200);
  expect((await state(page)).selectedNodes).toEqual([copy]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await state(page)).nodes).toEqual([id]);
});

test('drawing with ⇧ makes a square; with ⌥ the press is the centre', async ({ page }) => {
  await openCanvas(page);
  const drawn = async (modifier: string, from: { x: number; y: number }) => {
    const before = (await state(page)).nodes;
    await page.keyboard.press('r');
    await dragWith(page, modifier, from, 150, 60);
    await expect.poll(async () => (await state(page)).nodes.length).toBe(before.length + 1);
    await page.keyboard.press('Escape');
    return (await state(page)).nodes.find((candidate) => !before.includes(candidate))!;
  };
  const square = await drawn('Shift', await emptyPoint(page, 300, 300));
  const size = (await doc(page))!.pages[0]!.nodes.find((candidate) => candidate.id === square) as unknown as { size: { width: number; height: number } };
  expect(size.size.width).toBe(size.size.height);

  const press = await emptyPoint(page, 760, 520);
  const centred = await drawn('Alt', press);
  const box = await canvasBox(page);
  const r = (await rect(page, centred))!;
  expect(Math.abs(box.x + r.x + r.width / 2 - press.x)).toBeLessThan(1.5);
  expect(Math.abs(box.y + r.y + r.height / 2 - press.y)).toBeLessThan(1.5);
});

test('double-click enters a group, Escape climbs out, and a moved member re-fits the group', async ({ page }) => {
  await openCanvas(page);
  const a = await drawShape(page, 'r', 360, 300);
  const b = await drawShape(page, 'r', 700, 300);
  await clickNode(page, a);
  await clickNode(page, b, 'Shift');
  await page.keyboard.press('ControlOrMeta+g');
  await expect.poll(async () => (await state(page)).selectedNodes.length).toBe(1);
  const group = (await state(page)).selectedNodes[0]!;
  expect(group).not.toBe(a);

  // A click picks the group; a double-click on a member enters it.
  await page.keyboard.press('Escape');
  await clickNode(page, a);
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([group]);
  const centre = await centreOf(page, a);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([a]);
  // Inside, a click picks the other member.
  await clickNode(page, b);
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([b]);

  // Drag the member down out of the group's box: the group grows to hug it.
  const groupBefore = (await rect(page, group))!;
  const from = await centreOf(page, b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 220, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await rect(page, group))!.height)).toBeGreaterThan(Math.round(groupBefore.height) + 150);
  const member = (await rect(page, b))!;
  const hugged = (await rect(page, group))!;
  expect(hugged.y + hugged.height).toBeGreaterThanOrEqual(member.y + member.height);
  expect((await state(page)).selectedNodes).toEqual([b]);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([group]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([]);
});

test('⌘0 and ⇧0 zoom to 100 %, ⇧1 fits', async ({ page }) => {
  await openCanvas(page);
  await drawShape(page, 'r', 420, 340);
  const zoom = page.getByRole('button', { name: /^Zoom \d+%$/ });
  await page.keyboard.press('Shift+Digit1');
  await expect(zoom).not.toHaveAccessibleName('Zoom 100%');
  await page.keyboard.press('ControlOrMeta+0');
  await expect(zoom).toHaveAccessibleName('Zoom 100%');
  await page.keyboard.press('Shift+Digit1');
  await expect(zoom).not.toHaveAccessibleName('Zoom 100%');
  await page.keyboard.press('Shift+Digit0');
  await expect(zoom).toHaveAccessibleName('Zoom 100%');
});

test('the connector tool with ⇧ draws a free line on the nearest 45°', async ({ page }) => {
  await openCanvas(page);
  await page.keyboard.press('a');
  const from = await emptyPoint(page, 400, 300);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x + 220, from.y + 30, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).connectors.length).toBe(1);
  const line = (await doc(page))!.pages[0]!.connectors[0] as unknown as {
    source: { point: { x: number; y: number } }; target: { nodeId: string | null; point: { x: number; y: number } };
  };
  expect(line.target.nodeId).toBeNull();
  expect(Math.abs(line.target.point.y - line.source.point.y)).toBeLessThan(0.5);
});

test('a click on one shape of a multi-selection selects just it; a paste out of sight lands in view', async ({ page }) => {
  await openCanvas(page);
  const a = await drawShape(page, 'r', 360, 300);
  const b = await drawShape(page, 'r', 700, 300);
  await page.keyboard.press('ControlOrMeta+a');
  await clickNode(page, a);
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([a]);
  expect(b).not.toBe(a);

  await page.keyboard.press('ControlOrMeta+c');
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i += 1) await page.mouse.wheel(0, 400);
  // The menu's Paste reads the in-memory copy: ⌘V reads the OS clipboard, which other headed runs on this
  // machine may overwrite between the copy and the paste. Both place the paste with the same pasteOffset.
  const spot = await emptyPoint(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste' }).click();
  await expect.poll(async () => (await state(page)).nodes.length).toBe(3);
  const pasted = (await state(page)).selectedNodes[0]!;
  const r = (await rect(page, pasted))!;
  expect(r.y).toBeGreaterThan(0);
  expect(r.y + r.height).toBeLessThan(box.height);
});

test('a key that opens a panel or an editor never types itself into it', async ({ page }) => {
  await openCanvas(page);
  await page.keyboard.press('i');
  const icons = page.getByRole('searchbox', { name: 'Search icons' }).or(page.getByRole('textbox', { name: 'Search icons' }));
  await expect(icons).toBeFocused();
  await expect(icons).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('e');
  const emoji = page.getByRole('searchbox', { name: 'Search emoji' }).or(page.getByRole('textbox', { name: 'Search emoji' }));
  await expect(emoji).toBeFocused();
  await expect(emoji).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.getByTestId('v2-canvas').focus();
  // N drops a sticky with its label open: empty, not "n".
  await page.keyboard.press('n');
  await expect.poll(async () => (await state(page)).nodes.length).toBe(1);
  await page.keyboard.press('Escape');
  const sticky = (await doc(page))!.pages[0]!.nodes[0] as unknown as { content: { label?: string } };
  expect(sticky.content.label ?? '').toBe('');
});

test('a shape copied out of a section pastes a step off where it is, back in that section, one undo step', async ({ page }) => {
  await openCanvas(page);
  const id = await drawShape(page, 'r', 600, 400);
  await clickNode(page, id);
  await page.keyboard.press('ControlOrMeta+Alt+g');
  await expect.poll(async () => (await state(page)).selectedNodes).not.toEqual([id]);
  const section = (await state(page)).selectedNodes[0]!;
  await page.keyboard.press('Escape');
  await clickNode(page, id);
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([id]);
  const before = (await rect(page, id))!;
  await page.keyboard.press('ControlOrMeta+c');
  // The menu's Paste reads the in-memory copy, never the OS clipboard other headed runs share.
  const spot = await emptyPoint(page, 300, 700);
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste' }).click();
  await expect.poll(async () => (await state(page)).nodes.length).toBe(3);
  const copy = (await state(page)).selectedNodes[0]!;
  const zoom = before.width / 160;
  const after = (await rect(page, copy))!;
  expect(Math.abs(after.x - before.x - 24 * zoom)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y - 24 * zoom)).toBeLessThan(1);
  const pasted = (await doc(page))!.pages[0]!.nodes.find((candidate) => candidate.id === copy) as unknown as { parentId: string | null };
  expect(pasted.parentId).toBe(section);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await state(page)).nodes.length).toBe(2);

  // The whole section: it and its shape land a step off, the shape still inside the new section.
  // A click on the section's own empty corner selects it (a click on its shape picks the shape).
  const frame = (await rect(page, section))!;
  const box = await canvasBox(page);
  await page.mouse.click(box.x + frame.x + 8, box.y + frame.y + frame.height - 8);
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([section]);
  await page.keyboard.press('ControlOrMeta+c');
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste' }).click();
  await expect.poll(async () => (await state(page)).nodes.length).toBe(4);
  const pastedIds = (await state(page)).selectedNodes;
  const nodes = (await doc(page))!.pages[0]!.nodes as unknown as { id: string; kind: string; parentId: string | null }[];
  const sectionCopy = nodes.find((candidate) => pastedIds.includes(candidate.id) && candidate.kind === 'section')!.id;
  const sectionRect = (await rect(page, sectionCopy))!;
  expect(Math.abs(sectionRect.x - frame.x - 24 * zoom)).toBeLessThan(1);
  const member = (await doc(page))!.pages[0]!.nodes.find((candidate) =>
    (candidate as unknown as { parentId: string | null }).parentId === sectionCopy)!;
  const memberRect = (await rect(page, member.id))!;
  expect(Math.abs(memberRect.x - before.x - 24 * zoom)).toBeLessThan(1);
  expect(Math.abs(memberRect.y - before.y - 24 * zoom)).toBeLessThan(1);
});
