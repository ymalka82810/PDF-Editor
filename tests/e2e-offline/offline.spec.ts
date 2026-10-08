/**
 * בדיקת PWA אמיתית: אחרי build+preview (לא npm run dev - ה-service worker מתנהג אחרת ב-dev),
 * טעינה ראשונה אונליין, ואז אופליין: לפתוח PDF עברי, לערוך טקסט (מה שמחייב גם את הגופן Alef
 * וגם את core/export.ts שנטען ב-import() דינמי), ולייצא. זו הבדיקה שהייתה תופסת את הבאג שבו
 * .mjs (ה-worker של pdf.js) ו-.ttf (הגופנים) לא היו ב-precache, והעורך לא עבד בלי אינטרנט.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PDFDict, PDFName, PDFDocument } from 'pdf-lib';
import type { EditorApi } from '../../src/core/registry';

declare global {
  interface Window {
    editor: EditorApi;
  }
}

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // הטעינה הראשונה לא בשליטת ה-SW (אין clients.claim מיידי); reload אונליין מבטיח שליטה
  // לפני שעוברים לאופליין, ושה-precache (כולל ה-worker וה-ttf) כבר הושלם.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 30000 });
}

test('offline: pdf.js worker and Alef font are precached, so editing+export still work without a network', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.empty')).toBeVisible();

  await page.locator('.file-input').setInputFiles(path.join(fixtures, 'hebrew.pdf'));
  const pageEl = page.locator('.page[data-page-id]').first();
  await expect(pageEl).toHaveCount(1);

  // הציור (pdf.js, דרך ה-worker ב-.mjs) חייב להצליח גם אופליין: מצפים לפיקסלים לא-לבנים
  await expect
    .poll(() =>
      pageEl.locator('canvas').evaluate((c: HTMLCanvasElement) => {
        const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) dark++;
        return dark;
      }),
    )
    .toBeGreaterThan(50);

  // עריכת השורה הראשונה (הכותרת, y=760 ב-PDF) כדי להפעיל גם את core/export.ts (import() דינמי)
  // וגם את fontBytes('default') (Alef, ב-.ttf) - שניהם צריכים לעבוד מה-cache בלי רשת.
  await page.locator('.tool[data-tool=text-edit]').click();
  // .text-edit-frame הוא pointer-events:none (רק הדגשה ויזואלית) - הלחיצה בפועל מטופלת
  // ע"י מאזין ה-pointerdown של .overlay עצמו (viewer.ts), לפי קואורדינטת ה-PDF שמתחת לעכבר
  const frame = pageEl.locator('.text-edit-frame').first();
  const box = (await frame.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(pageEl.locator('.text-edit-input')).toBeVisible();
  await page.keyboard.type('טקסט שנערך אופליין');
  await page.keyboard.press('Enter');
  await expect(page.evaluate(() => window.editor.store.get().ops.length)).resolves.toBeGreaterThan(0);

  const bytes = await page.evaluate(async () => Array.from(await window.editor.exportPdf()));
  expect(bytes.length).toBeGreaterThan(1000);
  // "Alef" הוא שם הגופן המוטמע (core/fonts.ts); ctx.font('default') נקרא תמיד מ-text-edit/export.ts
  // כ-fallback, ולכן אם הגופן נטען בהצלחה מה-cache שם הבסיס שלו (עם קידומת subset) מופיע ב-/Font
  // של העמוד. בודקים עם pdf-lib ולא חיפוש טקסט גולמי, כי ה-PDF המיוצא משתמש ב-object streams דחוסים.
  const pdf = await PDFDocument.load(new Uint8Array(bytes));
  const resources = pdf.getPage(0).node.Resources();
  const fontDict = resources?.lookup(PDFName.of('Font'), PDFDict);
  const baseFonts = (fontDict?.keys() ?? []).map((k) => {
    const font = fontDict!.lookup(k, PDFDict);
    return font.lookup(PDFName.of('BaseFont'))?.toString() ?? '';
  });
  expect(baseFonts.some((n) => n.includes('Alef'))).toBe(true);
});
