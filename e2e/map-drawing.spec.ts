import { expect, test, type Page } from './test';
import { doc, rect, state } from './helpers';

// A repo map and its drawing are one Canvas | Map switch apart: Canvas on the map opens its drawing (made from the map on
// screen the first time), Map on the drawing goes back, and the boxes stay where the reader was looking both ways.
// GitHub is served by page.route from a small fake repo, so no network. npx playwright test e2e/map-drawing.spec.ts

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset' };
const REPO: Readonly<Record<string, string>> = {
  'README.md': '# shop\n',
  'web/package.json': '{"name":"web"}',
  'web/src/main.ts': "import { App } from './App';\nApp();\n",
  'web/src/App.ts': 'export const App = () => 1;\n',
  'api/package.json': '{"name":"api"}',
  'api/src/server.ts': "import { users } from './users';\nexport const s = users;\n",
  'api/src/users.ts': 'export const users = 1;\n',
};

interface MapState { mode: 'canvas' | 'map'; nodes: string[] }
const mapState = (page: Page): Promise<MapState> =>
  page.evaluate(() => (window as unknown as { __V2__: { getMapState(): MapState } }).__V2__.getMapState())
    .catch(() => ({ mode: 'canvas', nodes: [] }) as MapState);
const settled = (page: Page) => expect.poll(() => page.evaluate(() =>
  (window as unknown as { __V2__: { getMapMotion(): { running: boolean } } }).__V2__.getMapMotion().running), { timeout: 20_000 }).toBe(false);
const pagesOf = async (page: Page) => (await doc(page).catch(() => null))?.pages ?? [];

async function openRepo(page: Page) {
  await page.route('https://api.github.com/repos/acme/shop/git/trees/**', (route) => route.fulfill({
    json: { sha: 'abc', truncated: false, tree: Object.entries(REPO).map(([path, text]) => ({ path, type: 'blob', mode: '100644', sha: 'x', size: text.length })) }, headers: CORS }));
  await page.route('https://raw.githubusercontent.com/acme/shop/**', (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/acme\/shop\/[^/]+\//, ''));
    return route.fulfill({ status: REPO[path] === undefined ? 404 : 200, contentType: 'text/plain', body: REPO[path] ?? '', headers: CORS });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/map/github/acme/shop');
  await page.waitForFunction(() => '__V2__' in window);
  const mapReady = async () => {
    await expect.poll(async () => (await mapState(page)).mode, { timeout: 20_000 }).toBe('map');
    await expect.poll(async () => (await mapState(page)).nodes.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await settled(page);
  };
  await mapReady();
  return {
    mapReady,
    canvasSwitch: page.getByRole('button', { name: 'Canvas', exact: true }),
    mapSwitch: page.getByRole('button', { name: 'Map', exact: true }),
  };
}

test('Canvas on a repo map opens its drawing in place, and Map goes back to the same map @gate', async ({ page }) => {
  test.setTimeout(120_000);
  const { mapReady, canvasSwitch, mapSwitch } = await openRepo(page);
  const createTools = page.getByRole('toolbar', { name: 'Create', exact: true });
  const before = (await pagesOf(page)).length;
  const box = (await mapState(page)).nodes[0]!;
  const onMap = (await rect(page, box))!;

  // Canvas: a drawing of the map, editable, the box where it was on screen.
  await canvasSwitch.click();
  await expect.poll(async () => (await pagesOf(page)).length).toBe(before + 1);
  await expect(canvasSwitch).toHaveAttribute('aria-pressed', 'true');
  await expect(createTools).toBeVisible();
  const drawing = (await pagesOf(page)).at(-1)!;
  expect(drawing.nodes.map((node) => node.id)).toContain(box);
  const onDrawing = (await rect(page, box))!;
  expect(Math.abs(onDrawing.x - onMap.x)).toBeLessThan(2);
  expect(Math.abs(onDrawing.y - onMap.y)).toBeLessThan(2);

  // Draw on it: a rectangle.
  const canvas = (await page.locator('[data-testid="v2-canvas"] canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(canvas.x + canvas.width - 260, canvas.y + canvas.height - 260);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width - 160, canvas.y + canvas.height - 180, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await pagesOf(page)).at(-1)!.nodes.length).toBe(drawing.nodes.length + 1);

  // Map: the same map, still showing the box where the reader left it.
  await mapSwitch.click();
  await mapReady();
  await expect(mapSwitch).toHaveAttribute('aria-pressed', 'true');
  const back = (await rect(page, box))!;
  expect(Math.abs(back.x - onMap.x)).toBeLessThan(2);
  expect(Math.abs(back.y - onMap.y)).toBeLessThan(2);

  // Undo on the map changes the drawing: it shows the drawing, so the step never happens out of sight; redo too.
  await page.locator('[data-testid="v2-canvas"]').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvasSwitch).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await pagesOf(page)).at(-1)!.nodes.length).toBe(drawing.nodes.length);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await pagesOf(page)).at(-1)!.nodes.length).toBe(drawing.nodes.length + 1);
  await mapSwitch.click();
  await mapReady();

  // Canvas again: the same drawing with the edit, not a second copy. M goes back and forth too.
  await canvasSwitch.click();
  await expect(canvasSwitch).toHaveAttribute('aria-pressed', 'true');
  expect((await pagesOf(page)).length).toBe(before + 1);
  expect((await pagesOf(page)).at(-1)!.nodes.length).toBe(drawing.nodes.length + 1);
  await page.locator('[data-testid="v2-canvas"]').focus();
  await page.keyboard.press('m');
  await mapReady();
  await page.keyboard.press('m');
  await expect(canvasSwitch).toHaveAttribute('aria-pressed', 'true');
  expect((await pagesOf(page)).length).toBe(before + 1);
  await expect.poll(async () => ['saved', 'clean'].includes((await state(page)).save)).toBe(true);

  // A second drawing (Edit as drawing makes a fresh copy): Canvas goes back to the drawing the reader came from, whichever it is.
  await page.keyboard.press('m');
  await mapReady();
  await page.getByRole('toolbar', { name: 'Map depth', exact: true }).getByRole('button', { name: 'Edit as drawing', exact: true }).click();
  await expect.poll(async () => (await pagesOf(page)).length).toBe(before + 2);
  const second = (await pagesOf(page)).at(-1)!;
  expect(second.name).toMatch(/\(drawing 2\)$/);
  const current = () => page.getByRole('button', { name: /^Pages \(current: / }).getAttribute('aria-label');
  await mapSwitch.click();
  await mapReady();
  await canvasSwitch.click();
  await expect.poll(current).toContain(second.name);
  await page.getByRole('button', { name: /^Pages/ }).click();
  await page.getByRole('button', { name: drawing.name, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(current).toContain(`${drawing.name})`);
  await mapSwitch.click();
  await mapReady();
  await canvasSwitch.click();
  await expect.poll(current).toContain(`${drawing.name})`);

  // Asking for the repo's map (its address) shows the map, even though the document was left on the drawing.
  await page.goto('/#/map/github/acme/shop');
  await page.waitForFunction(() => '__V2__' in window);
  await mapReady();
  // And a reload on the map stays on the map.
  await page.reload();
  await page.waitForFunction(() => '__V2__' in window);
  await mapReady();
  expect((await pagesOf(page)).length).toBe(before + 2);
});

// Reported: boxes opened on the map never reached its drawing. A drawing nobody has edited follows the map; an edited one
// keeps the reader's work and offers a fresh copy.
test('an untouched drawing follows the boxes opened on the map; an edited one offers a new copy @gate', async ({ page }) => {
  test.setTimeout(120_000);
  const { mapReady, canvasSwitch, mapSwitch } = await openRepo(page);
  const openAll = async () => {
    const shown = (await mapState(page)).nodes;
    await page.evaluate((ids) => (window as unknown as { __V2__: { openMapBoxes(ids: string[]): void } }).__V2__.openMapBoxes(ids), shown);
    await expect.poll(async () => (await mapState(page)).nodes.length, { timeout: 20_000 }).toBeGreaterThan(shown.length);
    await settled(page);
    return (await mapState(page)).nodes;
  };
  const before = (await pagesOf(page)).length;
  await canvasSwitch.click();
  await expect.poll(async () => (await pagesOf(page)).length).toBe(before + 1);
  const drawn = (await pagesOf(page)).at(-1)!;

  // Untouched: back on the map, open boxes, Canvas shows them, in the same drawing, as one undo step.
  await mapSwitch.click();
  await mapReady();
  const opened = await openAll();
  await canvasSwitch.click();
  await expect(canvasSwitch).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await pagesOf(page)).at(-1)!.nodes.map((node) => node.id).sort()).toEqual([...opened].sort());
  expect((await pagesOf(page)).length).toBe(before + 1);
  expect((await pagesOf(page)).at(-1)!.id).toBe(drawn.id);
  await expect(page.getByText('Drawing updated from the map')).toBeVisible();
  await page.locator('[data-testid="v2-canvas"]').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await pagesOf(page)).at(-1)!.nodes.length).toBe(drawn.nodes.length);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await pagesOf(page)).at(-1)!.nodes.length).toBe(opened.length);

  // Edited: a box deleted from the drawing is the reader's choice; the map still shows it, so a fresh copy is offered.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await pagesOf(page)).at(-1)!.nodes.length).toBe(0);
  await mapSwitch.click();
  await mapReady();
  await canvasSwitch.click();
  await expect(canvasSwitch).toHaveAttribute('aria-pressed', 'true');
  expect((await pagesOf(page)).at(-1)!.nodes.length).toBe(0);
  const offer = page.getByText(`The map shows ${opened.length} boxes this drawing has not got`);
  await expect(offer).toBeVisible();
  await page.getByRole('button', { name: 'New copy', exact: true }).click();
  await expect.poll(async () => (await pagesOf(page)).length).toBe(before + 2);
  const copy = (await pagesOf(page)).at(-1)!;
  expect(copy.nodes.map((node) => node.id).sort()).toEqual([...opened].sort());
  await expect(page.getByRole('button', { name: /^Pages \(current: / })).toHaveAttribute('aria-label', new RegExp(copy.name.replace(/[()]/g, '\\$&')));
  // Its Map goes back to the map; its Canvas comes back to the new copy.
  await mapSwitch.click();
  await mapReady();
  await canvasSwitch.click();
  await expect.poll(async () => (await page.getByRole('button', { name: /^Pages \(current: / }).getAttribute('aria-label'))).toContain(copy.name);
});
