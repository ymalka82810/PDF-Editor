import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { EditorApi } from '../../src/core/registry';

declare global {
  interface Window {
    editor: EditorApi;
  }
}

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** PNG בגודל w×h (יחס 2:1) */
function png(w: number, h: number): Buffer {
  const chunk = (t: string, d: Buffer) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 90);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function open(page: Page, name: string, pages: number) {
  await page.locator('.file-input').setInputFiles(path.join(fixtures, name));
  await expect(page.locator('.page[data-page-id]')).toHaveCount(pages);
}

async function addImage(page: Page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.tool[data-tool=image]').click(),
  ]);
  await chooser.setFiles({ name: 'wide.png', mimeType: 'image/png', buffer: png(200, 100) });
  await expect(page.locator('.op.image-op.selected')).toHaveCount(1);
}

const lastOp = (page: Page) =>
  page.evaluate(() => {
    const ops = window.editor.store.get().ops;
    const o = ops[ops.length - 1];
    return { rect: o.rect, rotate: (o.data as { rotate?: number }).rotate ?? 0 };
  });

/** גרירת הידית הימנית התחתונה (על המסך) של הפעולה הנבחרת */
async function dragSe(page: Page, dx: number, dy: number, shift = false) {
  // הידית צריכה להיות בתוך החלון (אחרת העכבר לא מגיע אליה)
  await page.locator('.op.selected').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const h = (await page.locator('.op.selected .handle-se').boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

test.use({ viewport: { width: 1200, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('image: the resize handle keeps the aspect ratio, and the opposite corner stays', async ({ page }) => {
  await open(page, 'english.pdf', 1);
  await addImage(page);
  const el = page.locator('.op.image-op');
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const before = (await el.boundingBox())!;
  // גרירה כמעט אופקית – הגובה צריך לגדול יחד
  await dragSe(page, 120, 5);
  const { rect } = await lastOp(page);
  expect(rect.w / rect.h).toBeCloseTo(2, 2);
  const after = (await el.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 100);
  expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);
  expect(after.width / after.height).toBeCloseTo(2, 1);
});

test('image on a rotated page: same on screen, and the PDF rect has the inverted ratio', async ({ page }) => {
  await open(page, 'multipage.pdf', 5);
  // העמוד המסובב (3) במרכז החלון – התמונה תונח עליו
  await page
    .locator('.page')
    .nth(2)
    .evaluate((p) => p.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await addImage(page);
  expect((await lastOp(page)).rotate).toBe(-90);
  const el = page.locator('.op.image-op');
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const before = (await el.boundingBox())!;
  await dragSe(page, 100, 10);
  const { rect } = await lastOp(page);
  // בעמוד המסגרת מסובבת: רוחב/גובה ב-PDF הם 1:2
  expect(rect.h / rect.w).toBeCloseTo(2, 2);
  const after = (await el.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 80);
  expect(after.width / after.height).toBeCloseTo(2, 1);
  expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);
});

test('shapes: free resize, and Shift keeps the ratio', async ({ page }) => {
  await open(page, 'english.pdf', 1);
  const box = (await page.locator('.page').first().boundingBox())!;
  await page.keyboard.press('b');
  await page.mouse.move(box.x + 100, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 600, { steps: 5 });
  await page.mouse.up();
  const start = (await lastOp(page)).rect;
  expect(start.w / start.h).toBeCloseTo(2, 1);
  await dragSe(page, 60, 0);
  const free = (await lastOp(page)).rect;
  expect(free.w / free.h).toBeGreaterThan(2.4);
  await dragSe(page, 30, 80, true);
  const kept = (await lastOp(page)).rect;
  expect(kept.w / kept.h).toBeCloseTo(free.w / free.h, 2);
});
