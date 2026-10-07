import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDocument, OPS as PDFJS_OPS, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { stateFromBytes } from '../../src/core/document';
import { fontBytes } from '../../src/core/fonts';
import { exportPdf } from '../../src/core/export';
import { Store } from '../../src/core/model';
import { registry } from '../../src/core/registry';
import type { DocState, Operation, PageRef, TextItem } from '../../src/core/types';
import { fontKey, getFont, missingChars, OPS } from '../../src/pdf-read/fonts';
import { fixVisualOrder, joinFragments, readText, registerTextSource, textItemsOf } from '../../src/pdf-read/text';
import tool from '../../src/tools/text-edit';
import { fontsFor, OP_TYPE, type TextEditData } from '../../src/tools/text-edit/export';
import { loadFixture, textOf } from '../helpers/pdf';

/* ---------- עזרים ---------- */

const tasks: PDFDocumentLoadingTask[] = [];
afterAll(async () => {
  await Promise.all(tasks.map((t) => t.destroy()));
});

/** api מינימלי לקריאה: pdf.js (legacy, node) לכל מקור במסמך */
function apiFor(state: DocState) {
  const docs = new Map<string, Promise<PDFDocumentProxy>>();
  return {
    pdfjsDoc(id: string) {
      let d = docs.get(id);
      if (!d) {
        const task = getDocument({ data: state.sources[id].bytes.slice(), fontExtraProperties: true, verbosity: 0 });
        tasks.push(task);
        docs.set(id, (d = task.promise as unknown as Promise<PDFDocumentProxy>));
      }
      return d;
    },
  };
}

async function open(name: string) {
  const state = await stateFromBytes(name, loadFixture(name));
  return { state, api: apiFor(state) };
}

/** הנתונים שהכלי יוצר מפריט (בלי canvas: שחור על לבן) */
function dataFor(page: PageRef, item: TextItem, text: string): TextEditData {
  const key = page.sourceId && item.fontName ? fontKey(page.sourceId, item.fontName) : undefined;
  return {
    original: item,
    text,
    ...(key && getFont(key) ? { fontKey: key } : {}),
    size: item.size,
    color: item.color ?? '#000000',
    bg: '#ffffff',
  };
}

const editOp = (page: PageRef, item: TextItem, text: string, rect = item.rect): Operation => ({
  id: 'edit-' + Math.random().toString(36).slice(2),
  pageId: page.id,
  type: OP_TYPE,
  rect,
  data: dataFor(page, item, text) as unknown as Record<string, unknown>,
});

/** מייצא, פותח את התוצאה מחדש וקורא את הפריטים של העמוד */
async function exportAndRead(state: DocState, ops: Operation[], pageIndex: number) {
  const out = await exportPdf({ ...state, ops });
  const s2 = await stateFromBytes('out.pdf', out);
  const items = await readText(apiFor(s2), s2.pages[pageIndex]);
  return { out, items };
}

const right = (it: TextItem) => it.rect.x + it.rect.w;

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

/* ---------- קריאה ---------- */

describe('readText', () => {
  it('hebrew.pdf: lines in logical order with size, baseline and embedded font', async () => {
    const { state, api } = await open('hebrew.pdf');
    const page = state.pages[0];
    const items = await readText(api, page);
    expect(items.map((i) => i.str)).toEqual([
      'מסמך בדיקה בעברית',
      'שלום עולם, זו שורה ראשונה.',
      'זו שורה שנייה עם עוד קצת טקסט.',
      'הזמנה מספר 12345 נשלחה ל-PDF Editor בתאריך 07/10/2026.',
      'שורה אחרונה בעמוד.',
    ]);
    const [title, line] = items;
    expect(title).toMatchObject({
      pageId: page.id,
      size: 24,
      baseline: 760,
      rtl: true,
      origin: 'pdf',
      color: '#000000',
    });
    expect(right(title)).toBeCloseTo(545, 0);
    expect(line.size).toBe(14);
    expect(line.rect.y).toBeLessThan(line.baseline);
    expect(line.rect.y + line.rect.h).toBeGreaterThan(line.baseline + line.size * 0.6);
    // הגופן המוטמע נקרא, עם מפה לאותיות שבעמוד
    const ef = getFont(fontKey(page.sourceId!, line.fontName!))!;
    expect(ef.data).toBeInstanceOf(Uint8Array);
    expect(ef.ps).toMatch(/^Alef/);
    expect(missingChars(ef, 'שלום עולם')).toEqual([]);
    expect(missingChars(ef, 'גץ')).toEqual(['ג', 'ץ']);
    expect(ef.spaceWidth).toBeGreaterThan(0);
  });

  it('english.pdf: LTR items and the standard fonts', async () => {
    const { state, api } = await open('english.pdf');
    const items = await readText(api, state.pages[0]);
    expect(items[0]).toMatchObject({ str: 'English Test Document', baseline: 770, size: 22, rtl: false });
    expect(items[0].rect.x).toBeCloseTo(50, 3);
    const ef = getFont(fontKey(state.pages[0].sourceId!, items[0].fontName!))!;
    expect(ef).toMatchObject({ ps: 'Helvetica-Bold', bold: true, data: null });
  });

  it('cropbox.pdf: rects are relative to the CropBox corner', async () => {
    const { state, api } = await open('cropbox.pdf');
    const items = await readText(api, state.pages[0]);
    const tl = items.find((i) => i.str === 'CropBox top-left')!;
    // נכתב ב-(120,770) במערכת של הקובץ; ה-CropBox מתחיל ב-(100,100)
    expect(tl.rect.x).toBeCloseTo(20, 3);
    expect(tl.baseline).toBeCloseTo(670, 3);
  });

  it('caches per page', async () => {
    const { state, api } = await open('english.pdf');
    expect(readText(api, state.pages[0])).toBe(readText(api, state.pages[0]));
  });

  it('a blank page has no items', async () => {
    const { api } = await open('english.pdf');
    expect(
      await readText(api, {
        id: 'b',
        sourceId: null,
        sourceIndex: 0,
        rotation: 0,
        width: 10,
        height: 10,
        origin: { x: 0, y: 0 },
      }),
    ).toEqual([]);
  });
});

describe('joinFragments', () => {
  const base = { pageId: 'p', size: 12, origin: 'pdf' as const, fontName: 'f1' };
  const item = (str: string, x: number, w: number, rtl: boolean, baseline = 100): TextItem => ({
    ...base,
    str,
    rtl,
    baseline,
    rect: { x, y: baseline - 3, w, h: 14 },
  });

  it('joins Hebrew fragments right to left, with a space only where there is a gap', () => {
    // "שלום" בימין, "עול" משמאלו עם רווח, ו-"ם" צמודה משמאל
    const out = joinFragments([item('שלום', 200, 30, true), item('עול', 170, 25, true), item('ם', 160, 10, true)]);
    expect(out).toHaveLength(1);
    expect(out[0].str).toBe('שלום עולם');
    expect(out[0].rect).toMatchObject({ x: 160, w: 70 });
  });

  it('joins digits and words left to right and keeps other lines apart', () => {
    const out = joinFragments([
      item('18', 10, 12, false),
      item(':24', 22, 16, false),
      item('Other', 10, 30, false, 80),
      item('line', 44, 20, false, 80),
    ]);
    expect(out.map((i) => i.str)).toEqual(['18:24', 'Other line']);
    expect(out[0].rect).toMatchObject({ x: 10, w: 28 });
  });

  it('does not join different fonts or far items', () => {
    const a = item('abc', 10, 20, false);
    const b = { ...item('def', 32, 20, false), fontName: 'f2' };
    const c = item('ghi', 100, 20, false);
    expect(joinFragments([a, b, c]).map((i) => i.str)).toEqual(['abc', 'def', 'ghi']);
  });
});

describe('fixVisualOrder', () => {
  it('reverses Hebrew stored in visual order', () => {
    expect(fixVisualOrder('םולש')).toBe('שלום');
    expect(fixVisualOrder('שלום עולם')).toBe('שלום עולם');
  });
});

it('OPS matches pdf.js', () => {
  for (const [k, v] of Object.entries(OPS)) expect(PDFJS_OPS[k as keyof typeof PDFJS_OPS], k).toBe(v);
});

/* ---------- עריכה וייצוא ---------- */

describe('export', () => {
  it('hebrew.pdf: the new line is real text, in logical order, in the same place', async () => {
    const { state, api } = await open('hebrew.pdf');
    const page = state.pages[0];
    const items = await readText(api, page);
    const orig = items[1];
    const { out, items: after } = await exportAndRead(state, [editOp(page, orig, 'שלום לכולם, שורה חדשה.')], 0);
    const edited = after.find((i) => i.str === 'שלום לכולם, שורה חדשה.')!;
    expect(edited).toBeTruthy();
    expect(right(edited)).toBeCloseTo(right(orig), -0.5); // ±2pt: יישור לימין כמו במקור
    expect(Math.abs(right(edited) - right(orig))).toBeLessThan(2);
    expect(Math.abs(edited.baseline - orig.baseline)).toBeLessThan(2);
    expect(edited.size).toBeCloseTo(14, 1);
    // ידוע ומקובל: הכיסוי מסתיר את הטקסט הישן, אבל הוא נשאר בזרם התוכן ולכן עדיין נקרא
    expect((await textOf(out)).text).toContain('שלום עולם, זו שורה ראשונה.');
  });

  it('hebrew.pdf: the embedded font when it has all letters, otherwise the whole line in the default font', async () => {
    const { state, api } = await open('hebrew.pdf');
    const page = state.pages[0];
    const items = await readText(api, page);
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fallback = await pdf.embedFont(await fontBytes());
    const ctx = { pdf, font: async () => fallback, embedFontBytes: (_k: string, b: Uint8Array) => pdf.embedFont(b) };
    const d = (text: string) => dataFor(page, items[4], text);
    expect((await fontsFor(d('שורה בעמוד'), ctx)).font).not.toBe(fallback);
    expect((await fontsFor(d('גמל'), ctx)).font).toBe(fallback);

    // "ג" חסרה בגופן המוטמע: כל השורה בגופן ברירת המחדל, ונקראת כפריט אחד
    const { items: after } = await exportAndRead(state, [editOp(page, items[4], 'גמל ושורה')], 0);
    const edited = after.find((i) => i.str === 'גמל ושורה')!;
    expect(edited).toBeTruthy();
    expect(Math.abs(right(edited) - right(items[4]))).toBeLessThan(2);
  });

  it('hebrew.pdf: mixed Hebrew, English and numbers', async () => {
    const { state, api } = await open('hebrew.pdf');
    const page = state.pages[0];
    const orig = (await readText(api, page))[3];
    const text = 'הזמנה מספר 345 נשלחה ל-PDF Editor.';
    const { items } = await exportAndRead(state, [editOp(page, orig, text)], 0);
    const edited = items.find((i) => i.str === text);
    expect(edited).toBeTruthy();
    expect(Math.abs(right(edited!) - right(orig))).toBeLessThan(2);
  });

  it('english.pdf: left aligned like the original, in the original standard font', async () => {
    const { state, api } = await open('english.pdf');
    const page = state.pages[0];
    const orig = (await readText(api, page)).find((i) => i.str.startsWith('The quick'))!;
    const { items } = await exportAndRead(state, [editOp(page, orig, 'The quick red fox.')], 0);
    const edited = items.find((i) => i.str === 'The quick red fox.')!;
    expect(Math.abs(edited.rect.x - 50)).toBeLessThan(2);
    expect(Math.abs(edited.baseline - 720)).toBeLessThan(2);
    // נכתב ב-Helvetica כמו המקור (pdf.js מזהה את הגופן הסטנדרטי)
    const s2 = await stateFromBytes(
      'o.pdf',
      await exportPdf({ ...state, ops: [editOp(page, orig, 'The quick red fox.')] }),
    );
    const again = (await readText(apiFor(s2), s2.pages[0])).find((i) => i.str === 'The quick red fox.')!;
    expect(getFont(fontKey(s2.pages[0].sourceId!, again.fontName!))?.ps).toBe('Helvetica');
  });

  it('a moved edit is written at the new rect; an empty text only covers', async () => {
    const { state, api } = await open('english.pdf');
    const page = state.pages[0];
    const items = await readText(api, page);
    const a = items.find((i) => i.str.startsWith('Please review'))!;
    const b = items.find((i) => i.str.startsWith('Third paragraph'))!;
    const moved = { ...a.rect, x: a.rect.x + 100, y: a.rect.y - 200 };
    const { items: after } = await exportAndRead(state, [editOp(page, a, 'Moved line', moved), editOp(page, b, '')], 0);
    const m = after.find((i) => i.str === 'Moved line')!;
    expect(Math.abs(m.rect.x - 150)).toBeLessThan(2);
    expect(Math.abs(m.baseline - (a.baseline - 200))).toBeLessThan(2);
  });

  it('multipage.pdf page 3 (rotated 90): same position in page space', async () => {
    const { state, api } = await open('multipage.pdf');
    const page = state.pages[2];
    expect(page.rotation).toBe(90);
    const orig = (await readText(api, page)).find((i) => i.str === 'Page 3')!;
    const { out, items } = await exportAndRead(state, [editOp(page, orig, 'Seite 3')], 2);
    const edited = items.find((i) => i.str === 'Seite 3')!;
    expect(Math.abs(edited.rect.x - orig.rect.x)).toBeLessThan(2);
    expect(Math.abs(edited.baseline - orig.baseline)).toBeLessThan(2);
    expect((await PDFDocument.load(out)).getPage(2).getRotation().angle).toBe(90);
  });

  it('cropbox.pdf: written relative to the CropBox', async () => {
    const { state, api } = await open('cropbox.pdf');
    const page = state.pages[0];
    const orig = (await readText(api, page)).find((i) => i.str === 'CropBox top-left')!;
    const { out, items } = await exportAndRead(state, [editOp(page, orig, 'Edited corner')], 0);
    const edited = items.find((i) => i.str === 'Edited corner')!;
    expect(Math.abs(edited.rect.x - orig.rect.x)).toBeLessThan(2);
    expect(Math.abs(edited.baseline - orig.baseline)).toBeLessThan(2);
    // ובמערכת של הקובץ (textOf): 120,770 כמו המקור
    const raw = (await textOf(out)).items.find((i) => i.str === 'Edited corner')!;
    expect(Math.abs(raw.x - 120)).toBeLessThan(2);
    expect(Math.abs(raw.y - 770)).toBeLessThan(2);
  });
});

/* ---------- OCR ---------- */

describe('items from another source (OCR)', () => {
  it('are listed with the PDF items and can be edited', async () => {
    const { state, api } = await open('scanned.pdf');
    const page = state.pages[0];
    expect(await textItemsOf(api, page)).toEqual([]);
    const ocr: TextItem = {
      pageId: 'ignored',
      str: 'טקסט סרוק',
      rect: { x: 300, y: 700, w: 120, h: 20 },
      baseline: 705,
      size: 16,
      rtl: true,
      origin: 'ocr',
    };
    registerTextSource(page.id, 'ocr', [ocr]);
    const items = await textItemsOf(api, page);
    expect(items).toEqual([{ ...ocr, pageId: page.id }]);

    const { items: after } = await exportAndRead(state, [editOp(page, items[0], 'טקסט מתוקן')], 0);
    const edited = after.find((i) => i.str === 'טקסט מתוקן')!;
    expect(Math.abs(right(edited) - 420)).toBeLessThan(2);
    expect(Math.abs(edited.baseline - 705)).toBeLessThan(2);

    registerTextSource(page.id, 'ocr', []);
    expect(await textItemsOf(api, page)).toEqual([]);
  });
});

/* ---------- היסטוריה ---------- */

it('undo restores the original (the op is removed)', async () => {
  const { state, api } = await open('hebrew.pdf');
  const store = new Store();
  store.reset(state);
  const page = state.pages[0];
  const item = (await readText(api, page))[0];
  const op = editOp(page, item, 'כותרת חדשה');
  store.addOp(op);
  expect(store.get().ops).toHaveLength(1);
  store.updateOp(op.id, { data: { text: 'עוד שינוי' } });
  store.undo();
  expect((store.get().ops[0].data as unknown as TextEditData).text).toBe('כותרת חדשה');
  store.undo();
  expect(store.get().ops).toEqual([]);
});
