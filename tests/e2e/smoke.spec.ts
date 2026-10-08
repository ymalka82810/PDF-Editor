import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';
import { rectToPdf, userSpace } from '../../src/core/coords';
import type { EditorApi } from '../../src/core/registry';
import type { PageRef, Rect } from '../../src/core/types';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

declare global {
  interface Window {
    editor: EditorApi;
  }
}

async function openFixture(page: Page, name: string, pageCount: number) {
  await page.locator('.file-input').setInputFiles(path.join(fixtures, name));
  await expect(page.locator('.page[data-page-id]')).toHaveCount(pageCount);
  await expect(page.locator('.empty')).toBeHidden();
}

/** הבתים של ה-PDF המיוצא, מ-window.editor.exportPdf() */
async function exported(page: Page): Promise<Uint8Array> {
  const arr = await page.evaluate(async () => Array.from(await window.editor.exportPdf()));
  return new Uint8Array(arr);
}

/** כל ה-content streams של עמוד, מפוענחים לטקסט */
function contentOf(p: PDFPage): string {
  const contents = p.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return streams
    .map((ref) => p.doc.context.lookup(ref))
    .map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : ''))
    .join('\n');
}

/** המלבנים ש-pdf-lib drawRectangle ציירה: translate(x,y) ואחריו מסלול 0,0 → 0,h → w,h → w,0 */
function drawnRects(content: string): Rect[] {
  const num = '(-?[\\d.]+)';
  const re = new RegExp(`1 0 0 1 ${num} ${num} cm\\s+(?:[^\\n]*\\n){0,4}?0 0 m\\s+0 ${num} l\\s+${num} ${num} l`, 'g');
  return [...content.matchAll(re)].map((m) => ({ x: +m[1], y: +m[2], w: +m[4], h: +m[3] }));
}

/** גרירה מנקודה לנקודה, בפיקסלים יחסית לפינה השמאלית העליונה של אלמנט */
async function dragIn(page: Page, box: { x: number; y: number }, from: [number, number], to: [number, number]) {
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
}

const ops = (page: Page) => page.evaluate(() => window.editor.store.get().ops.map((o) => ({ ...o.rect })));

// השפה ההתחלתית נקבעת לפי navigator.language (ברירת המחדל של Playwright היא en-US)
test.use({ locale: 'he-IL' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('empty state, RTL by default', async ({ page }) => {
  await expect(page.locator('.empty')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-cmd=save]')).toBeDisabled();
});

test.describe('English browser', () => {
  test.use({ locale: 'en-US' });
  test('starts in English, LTR', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('[data-cmd=save]')).toHaveText('Save');
  });
});

test('opens multipage.pdf: 5 pages, rotated page is landscape, first canvas is painted', async ({ page }) => {
  await openFixture(page, 'multipage.pdf', 5);
  const pages = page.locator('.page[data-page-id]');

  const p3 = await pages.nth(2).boundingBox();
  expect(p3!.width).toBeGreaterThan(p3!.height);
  const p4 = await pages.nth(3).boundingBox(); // Letter landscape
  expect(p4!.width).toBeGreaterThan(p4!.height);
  const p1 = await pages.nth(0).boundingBox();
  expect(p1!.height).toBeGreaterThan(p1!.width);

  // הציור אסינכרוני: מחכים שיופיעו פיקסלים כהים (הספרה "1" הגדולה)
  await expect
    .poll(() =>
      pages
        .nth(0)
        .locator('canvas')
        .evaluate((c: HTMLCanvasElement) => {
          const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
          let dark = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) dark++;
          return dark;
        }),
    )
    .toBeGreaterThan(1000);
});

test('rectangle tool: draw, move, resize, undo, delete, export', async ({ page }) => {
  await openFixture(page, 'multipage.pdf', 5);
  const first = page.locator('.page[data-page-id]').first();
  const box = (await first.locator('.overlay').boundingBox())!;

  await page.keyboard.press('r');
  await expect(page.locator('.tool[data-tool=example-rect]')).toHaveAttribute('aria-pressed', 'true');

  // ציור
  await dragIn(page, box, [60, 60], [220, 160]);
  await expect(first.locator('.op')).toHaveCount(1);
  expect(await ops(page)).toHaveLength(1);
  const [drawn] = await ops(page);
  await expect(first.locator('.op.selected')).toHaveCount(1);

  // הזזה: 40px ימינה, 30px למטה (למטה במסך = y קטן ב-PDF)
  await dragIn(page, box, [140, 110], [180, 140]);
  const [movedRect] = await ops(page);
  expect(movedRect.x).toBeGreaterThan(drawn.x);
  expect(movedRect.y).toBeLessThan(drawn.y);
  expect(movedRect.w).toBeCloseTo(drawn.w, 3);
  expect(movedRect.h).toBeCloseTo(drawn.h, 3);

  // שינוי גודל מהפינה הימנית התחתונה
  const se = (await first.locator('.op.selected .handle-se').boundingBox())!;
  const seCenter = { x: se.x + se.width / 2, y: se.y + se.height / 2 };
  await dragIn(page, { x: 0, y: 0 }, [seCenter.x, seCenter.y], [seCenter.x + 50, seCenter.y + 40]);
  const [resized] = await ops(page);
  expect(resized.w).toBeGreaterThan(movedRect.w);
  expect(resized.h).toBeGreaterThan(movedRect.h);
  expect(resized.x).toBeCloseTo(movedRect.x, 3);

  // ייצוא: 5 עמודים, ומלבן אחד בעמוד 1 בדיוק במקום של ה-op
  const pdf = await PDFDocument.load(await exported(page));
  expect(pdf.getPageCount()).toBe(5);
  const rects = drawnRects(contentOf(pdf.getPage(0)));
  expect(rects).toHaveLength(1);
  expect(rects[0].x).toBeCloseTo(resized.x, 2);
  expect(rects[0].y).toBeCloseTo(resized.y, 2);
  expect(rects[0].w).toBeCloseTo(resized.w, 2);
  expect(rects[0].h).toBeCloseTo(resized.h, 2);
  for (let i = 1; i < 5; i++) expect(drawnRects(contentOf(pdf.getPage(i)))).toHaveLength(0);

  // undo: גודל ← הזזה ← ציור
  await page.locator('[data-cmd=undo]').click();
  expect((await ops(page))[0]).toEqual(movedRect);
  await page.keyboard.press('Control+z');
  expect((await ops(page))[0]).toEqual(drawn);
  await page.keyboard.press('Control+y');
  expect((await ops(page))[0]).toEqual(movedRect);

  // מחיקה עם Delete
  await first.locator('.op').click();
  await expect(first.locator('.op.selected')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(first.locator('.op')).toHaveCount(0);
  expect(await ops(page)).toHaveLength(0);
  await page.keyboard.press('Control+z');
  await expect(first.locator('.op')).toHaveCount(1);
});

test('language toggle switches to LTR English', async ({ page }) => {
  await page.locator('[data-cmd=lang]').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('[data-cmd=save]')).toHaveText('Save');
  await page.locator('[data-cmd=lang]').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('PWA: manifest link resolves and declares standalone + icons', async ({ page, request }) => {
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThan(0);
});

test('theme button cycles system → light → dark and persists data-theme', async ({ page }) => {
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme');
  await page.locator('[data-cmd=theme]').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.locator('[data-cmd=theme]').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-cmd=theme]').click();
  await expect(html).not.toHaveAttribute('data-theme');
});

test('help dialog opens with "?" and lists shortcuts, closes with the OK button', async ({ page }) => {
  await page.keyboard.press('?');
  const dlg = page.locator('dialog.dlg');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('dt kbd')).not.toHaveCount(0);
  await dlg.locator('.dlg-ok').click();
  await expect(dlg).toBeHidden();
});

test('arrow keys move the selected operation by screen pixels', async ({ page }) => {
  await openFixture(page, 'multipage.pdf', 5);
  const first = page.locator('.page[data-page-id]').first();
  const box = (await first.locator('.overlay').boundingBox())!;
  await page.keyboard.press('r');
  await dragIn(page, box, [60, 60], [160, 140]);
  const [before] = await ops(page);
  await first.locator('.op').click();
  await page.keyboard.press('ArrowRight');
  const [after] = await ops(page);
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBeCloseTo(before.y, 3);
});

test('phone viewport: toolbar is reachable and touch targets are at least 44px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, 'multipage.pdf', 5);
  const toolBtn = page.locator('.tool').first();
  const box = (await toolBtn.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('phone viewport: a crowded toolbar (many tool groups) scrolls horizontally instead of wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, 'multipage.pdf', 5);
  const toolbar = page.locator('.toolbar');
  const [scrollWidth, clientHeight] = await toolbar.evaluate((el) => [el.scrollWidth, el.clientHeight]);
  // כלי "page" (סיבוב, מחיקה, שכפול, ...) יוצרים סרגל רחב יותר מהמסך; חשוב שהוא יגלול אופקית ולא יתפוס גובה רב
  expect(scrollWidth).toBeGreaterThan(390);
  expect(clientHeight).toBeLessThan(100);
  await expect(page.locator('.tool[data-tool=pages-rotate-left]')).toBeAttached();
});

test('phone viewport: the thumbnails side panel opens as a drawer and closes on backdrop click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, 'multipage.pdf', 5);
  await expect(page.locator('[data-cmd=drawer-start]')).toBeVisible();
  await page.locator('[data-cmd=drawer-start]').click();
  await expect(page.locator('.panel-start')).toHaveClass(/open/);
  await page.locator('.drawer-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.panel-start')).not.toHaveClass(/open/);
});

test('cropbox.pdf: a dragged rectangle lands at the right PDF user-space position', async ({ page }) => {
  await openFixture(page, 'cropbox.pdf', 1);
  const pageEl = page.locator('.page[data-page-id]').first();
  const box = (await pageEl.locator('.overlay').boundingBox())!;

  await page.locator('.tool[data-tool=example-rect]').click();
  await dragIn(page, box, [10, 10], [110, 60]);
  await expect(pageEl.locator('.op')).toHaveCount(1);

  const { ref, scale } = await page.evaluate(() => {
    const ref = window.editor.store.get().pages[0];
    return { ref, scale: window.editor.viewOf(ref.id)!.geom.scale };
  });
  expect((ref as PageRef).origin).toEqual({ x: 100, y: 100 });
  const geom = { width: ref.width, height: ref.height, rotation: ref.rotation, scale };
  const expected = userSpace(ref, rectToPdf(geom, { x: 10, y: 10, w: 100, h: 50 }));

  const pdf = await PDFDocument.load(await exported(page));
  const rects = drawnRects(contentOf(pdf.getPage(0)));
  // ב-cropbox.pdf יש כבר מסגרת מקורית אחת (drawRectangle ב-110,110); המלבן שלנו הוא האחרון
  expect(rects.length).toBeGreaterThanOrEqual(1);
  const ours = rects[rects.length - 1];
  expect(ours.x).toBeCloseTo(expected.x, 1);
  expect(ours.y).toBeCloseTo(expected.y, 1);
  expect(ours.w).toBeCloseTo(expected.w, 1);
  expect(ours.h).toBeCloseTo(expected.h, 1);
  // ובפיקסלים: הפינה השמאלית העליונה של המלבן היא 10/scale נקודות מהפינה של ה-CropBox
  expect(ours.x).toBeCloseTo(100 + 10 / scale, 1);
  expect(ours.y + ours.h).toBeCloseTo(800 - 10 / scale, 1);
});
