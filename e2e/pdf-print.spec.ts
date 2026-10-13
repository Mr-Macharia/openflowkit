import { expect, test } from './test';
import { openCanvas } from './helpers';

// PDF export is the browser's print dialog, opened by the parent on a srcdoc frame: the app's CSP has no
// 'unsafe-inline', so the frame cannot print itself. A real print() would block a headed run, so the frame
// window's print is replaced the moment the parent asks for it; ./test fails the spec on any CSP violation.
test('PDF export prints the frame from the parent under the production CSP @gate', async ({ page }) => {
  await page.addInitScript(() => {
    const own = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get() {
        const view = own.get!.call(this) as Window | null;
        if (view && !(view as unknown as { __stubbed?: boolean }).__stubbed) {
          (view as unknown as { __stubbed: boolean }).__stubbed = true;
          view.print = () => { (window as unknown as { __printed: number }).__printed = ((window as unknown as { __printed?: number }).__printed ?? 0) + 1; };
        }
        return view;
      },
    });
  });
  await openCanvas(page);
  await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Diagram as code' }).click();
  await page.getByRole('textbox', { name: 'Diagram source' }).fill('flowchart\nA -> B');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __V2__: { getState(): { nodes: string[] } } }).__V2__.getState().nodes.length)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'PDF', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Print / PDF' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: number }).__printed ?? 0)).toBeGreaterThan(0);
});
