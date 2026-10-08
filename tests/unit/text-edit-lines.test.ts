import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { stateFromBytes } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { fontBytes } from '../../src/core/fonts';
import { drawLine, forceLtrLayout, measure } from '../../src/core/pdf-text';
import { registry } from '../../src/core/registry';
import type { DocState, Operation, PageRef, TextItem } from '../../src/core/types';
import { fontKey, getFont } from '../../src/pdf-read/fonts';
import { readText, visualLines, type TextLine } from '../../src/pdf-read/text';
import tool from '../../src/tools/text-edit';
import { fontsFor, OP_TYPE, type TextEditData } from '../../src/tools/text-edit/export';
import { textOf } from '../helpers/pdf';

const tasks: PDFDocumentLoadingTask[] = [];
afterAll(async () => {
  await Promise.all(tasks.map((t) => t.destroy()));
});

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

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

/* ---------- visualLines ---------- */

describe('visualLines', () => {
  const item = (str: string, x: number, w: number, o: Partial<TextItem> = {}): TextItem => ({
    pageId: 'p',
    str,
    rect: { x, y: 97, w, h: 14 },
    baseline: 100,
    size: 12,
    rtl: /[א-ת]/.test(str),
    origin: 'pdf',
    fontName: 'f1',
    ...o,
  });
  const strs = (items: TextItem[]) => visualLines(items).map((l) => l.str);

  it('a Hebrew line with an English word in the middle (like Word)', () => {
    // משמאל לימין: "באמצע." | "English" | "שלום ומילה"
    const parts = [
      item('באמצע.', 100, 40),
      item('English', 143, 45, { fontName: 'f2', size: 13 }),
      item('שלום ומילה', 191, 70),
    ];
    const [line] = visualLines(parts);
    expect(line.str).toBe('שלום ומילה English באמצע.');
    expect(line.rtl).toBe(true);
    expect(line.rect).toMatchObject({ x: 100, w: 161 });
    expect(line.parts).toHaveLength(3);
    expect(line.fontName).toBe('f1');
    expect(line.size).toBe(12);
  });

  it('an English line with a Hebrew phrase and a trailing period', () => {
    const parts = [item('Say', 10, 20), item('שלום', 33, 30), item('to all of you', 66, 60), item('.', 126, 3)];
    expect(strs(parts)).toEqual(['Say שלום to all of you.']);
    expect(visualLines(parts)[0].rtl).toBe(false);
  });

  it('two Hebrew words in different fonts keep right-to-left order', () => {
    expect(strs([item('עולם', 10, 30, { fontName: 'f2' }), item('שלום', 43, 30)])).toEqual(['שלום עולם']);
  });

  it('does not join far items, other lines, very different sizes, or OCR with PDF', () => {
    expect(strs([item('Name', 10, 30), item('Value', 200, 30)])).toEqual(['Name', 'Value']);
    expect(strs([item('a', 10, 10), item('b', 22, 10, { baseline: 80 })])).toEqual(['a', 'b']);
    expect(strs([item('Big', 10, 30, { size: 24 }), item('small', 42, 20)])).toEqual(['Big', 'small']);
    expect(strs([item('pdf', 10, 20), item('ocr', 32, 20, { origin: 'ocr' })])).toEqual(['pdf', 'ocr']);
  });

  it('keeps the order of the lines like the items', () => {
    const a = item('first', 10, 30, { baseline: 50 });
    const b = item('second', 10, 30, { baseline: 300 });
    expect(strs([a, b])).toEqual(['first', 'second']);
  });

  it('a single item is returned as is, with itself as the only part', () => {
    const it0 = item('alone', 10, 30, { color: '#ff0000' });
    const [line] = visualLines([it0]);
    expect(line).toEqual({ ...it0, parts: [it0] });
  });
});

/* ---------- שורה מעורבת מקצה לקצה ---------- */

/** עמוד עם שורה אחת בשלושה פריטים: עברית ב-Alef, "English" ב-Helvetica, ועוד עברית ב-Alef (כמו Word) */
async function mixedPdf() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const alef = forceLtrLayout(await pdf.embedFont(await fontBytes(), { subset: true }));
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 300]);
  const y = 200;
  let right = 380;
  const sp = measure(' ', alef, 14);
  right -= drawLine(page, 'שלום עולם ומילה', right, y, { font: alef, size: 14 }, 'right') + sp;
  const w = measure('English', helv, 14);
  page.drawText('English', { x: right - w, y, size: 14, font: helv });
  right -= w + sp;
  drawLine(page, 'באמצע השורה.', right, y, { font: alef, size: 14 }, 'right');
  drawLine(page, 'שורה אחרת', 380, 150, { font: alef, size: 14 }, 'right');
  return pdf.save();
}

async function open(bytes: Uint8Array) {
  const state = await stateFromBytes('m.pdf', bytes);
  return { state, api: apiFor(state), page: state.pages[0] };
}

/** כמו newData בכלי: הגופן של השורה והגופנים הנוספים שלה */
function dataFor(page: PageRef, line: TextLine, text: string): TextEditData {
  const { parts, ...original } = line;
  const key = (it: TextItem) => fontKey(page.sourceId!, it.fontName!);
  const more = [...new Set(parts.map(key))].filter((k) => k !== key(original) && getFont(k));
  return {
    original,
    text,
    fontKey: key(original),
    ...(more.length ? { fontKeys: more } : {}),
    size: original.size,
    color: '#000000',
    bg: '#ffffff',
  };
}

const opFor = (page: PageRef, d: TextEditData): Operation => ({
  id: 'e1',
  pageId: page.id,
  type: OP_TYPE,
  rect: d.original.rect,
  data: d as unknown as Record<string, unknown>,
});

describe('editing a mixed line', () => {
  it('pdf.js gives three items, visualLines one line in logical order', async () => {
    const { api, page } = await open(await mixedPdf());
    const items = await readText(api, page);
    expect(items.filter((i) => i.baseline === 200)).toHaveLength(3);
    const lines = visualLines(items);
    expect(lines.map((l) => l.str)).toEqual(['שלום עולם ומילה English באמצע השורה.', 'שורה אחרת']);
    expect(Math.abs(lines[0].rect.x + lines[0].rect.w - 380)).toBeLessThan(1);
  });

  it('writes the whole line, Hebrew in the Hebrew font and English in the English font', async () => {
    const { state, api, page } = await open(await mixedPdf());
    const [line] = visualLines(await readText(api, page));
    const d = dataFor(page, line, 'שלום לעולם ומילה English בשורה.');
    expect(d.fontKeys).toHaveLength(1);

    // שרשרת הגופנים: Alef מהקובץ ואז Helvetica – לא גופן ברירת המחדל
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fallback = await pdf.embedFont(await fontBytes());
    const ctx = { pdf, font: async () => fallback, embedFontBytes: (_k: string, b: Uint8Array) => pdf.embedFont(b) };
    const fonts = await fontsFor(d, ctx);
    expect(fonts.font === fallback).toBe(false);
    expect(fonts.fallbacks).toHaveLength(1);

    const out = await exportPdf({ ...state, ops: [opFor(page, d)] });
    const { text } = await textOf(out);
    // השורה הישנה נמחקה כולה (שלושת החלקים), ושאר העמוד נשאר
    expect(text).not.toContain('שלום עולם');
    expect(text).not.toContain('באמצע');
    expect(text).toContain('שורה אחרת');
    // השורה החדשה נקראת בחזרה כשורה אחת, במקום של המקורית
    const again = await open(out);
    const lines = visualLines(await readText(again.api, again.page));
    const edited = lines.find((l) => l.str === 'שלום לעולם ומילה English בשורה.')!;
    expect(edited).toBeTruthy();
    expect(Math.abs(edited.rect.x + edited.rect.w - 380)).toBeLessThan(2);
    expect(Math.abs(edited.baseline - 200)).toBeLessThan(1);
    // האנגלית נכתבה ב-Helvetica, כמו במקור
    const en = edited.parts.find((p) => p.str.includes('English'))!;
    expect(getFont(fontKey(again.page.sourceId!, en.fontName!))?.ps).toBe('Helvetica');
  });

  it('a letter missing in all the fonts of the line: the whole line in the default font', async () => {
    const { api, page } = await open(await mixedPdf());
    const [line] = visualLines(await readText(api, page));
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fallback = await pdf.embedFont(await fontBytes());
    const ctx = { pdf, font: async () => fallback, embedFontBytes: (_k: string, b: Uint8Array) => pdf.embedFont(b) };
    // "ץ" אינה בתת-הקבוצה של Alef בקובץ, ואין עברית ב-Helvetica
    const fonts = await fontsFor(dataFor(page, line, 'קיץ English'), ctx);
    expect(fonts.font === fallback && !fonts.fallbacks).toBe(true);
  });
});
