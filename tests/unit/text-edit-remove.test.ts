import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument, PDFName, StandardFonts, StandardFontEmbedder } from 'pdf-lib';
import { stateFromBytes } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import type { DocState, Operation, PageRef, TextItem } from '../../src/core/types';
import { fontKey, getFont } from '../../src/pdf-read/fonts';
import { readText } from '../../src/pdf-read/text';
import tool from '../../src/tools/text-edit';
import { parseContent } from '../../src/tools/text-edit/content-lexer';
import { OP_TYPE, type TextEditData } from '../../src/tools/text-edit/export';
import { removeTextIn } from '../../src/tools/text-edit/remove-text';
import { loadFixture, textOf } from '../helpers/pdf';

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

function editOp(page: PageRef, item: TextItem, text: string): Operation {
  const key = page.sourceId && item.fontName ? fontKey(page.sourceId, item.fontName) : undefined;
  const data: TextEditData = {
    original: item,
    text,
    ...(key && getFont(key) ? { fontKey: key } : {}),
    size: item.size,
    color: '#000000',
    bg: '#ffffff',
  };
  return {
    id: 'e-' + item.str,
    pageId: page.id,
    type: OP_TYPE,
    rect: item.rect,
    data: data as unknown as Record<string, unknown>,
  };
}

async function openBytes(bytes: Uint8Array) {
  const state = await stateFromBytes('f.pdf', bytes);
  return { state, api: apiFor(state) };
}

/** הפריטים של עמוד כ-[טקסט, x, y] מעוגלים */
const layout = async (bytes: Uint8Array, page = 0) =>
  (await textOf(bytes, page)).items.map((i) => [i.str, Math.round(i.x * 10) / 10, Math.round(i.y * 10) / 10]);

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

describe('removing the original text on export', () => {
  it('hebrew.pdf: the old line is gone, the other lines are untouched', async () => {
    const src = loadFixture('hebrew.pdf');
    const { state, api } = await openBytes(src);
    const page = state.pages[0];
    const items = await readText(api, page);
    const out = await exportPdf({ ...state, ops: [editOp(page, items[1], 'שורה חדשה לגמרי')] });
    const { text } = await textOf(out);
    expect(text).not.toContain('שלום עולם');
    expect(text).toContain('שורה חדשה לגמרי');
    const before = (await layout(src)).filter(([s]) => s !== items[1].str);
    const after = (await layout(out)).filter(([s]) => s !== 'שורה חדשה לגמרי');
    expect(after).toEqual(before);
  });

  it('english.pdf: the old line is gone, the other lines are untouched', async () => {
    const src = loadFixture('english.pdf');
    const { state, api } = await openBytes(src);
    const page = state.pages[0];
    const items = await readText(api, page);
    const target = items.find((i) => i.str.startsWith('Second paragraph'))!;
    const out = await exportPdf({ ...state, ops: [editOp(page, target, 'A new second line.')] });
    const { text } = await textOf(out);
    expect(text).not.toContain('Second paragraph');
    expect(text).not.toContain('2024-001');
    expect(text).toContain('A new second line.');
    const before = (await layout(src)).filter(([s]) => s !== target.str);
    const after = (await layout(out)).filter(([s]) => s !== 'A new second line.');
    expect(after).toEqual(before);
  });

  it('deleting (empty text) removes the line and writes nothing', async () => {
    const src = loadFixture('english.pdf');
    const { state, api } = await openBytes(src);
    const page = state.pages[0];
    const items = await readText(api, page);
    const out = await exportPdf({ ...state, ops: [editOp(page, items[0], '')] });
    expect((await textOf(out)).text).not.toContain('English Test Document');
    expect((await textOf(out)).items).toHaveLength(items.length - 1);
  });

  it('cropbox.pdf and the rotated page of multipage.pdf', async () => {
    for (const [name, index, str] of [
      ['cropbox.pdf', 0, 'CropBox top-left'],
      ['multipage.pdf', 2, 'Page 3'],
    ] as const) {
      const { state, api } = await openBytes(loadFixture(name));
      const page = state.pages[index];
      const item = (await readText(api, page)).find((i) => i.str === str)!;
      const out = await exportPdf({ ...state, ops: [editOp(page, item, 'Replaced')] });
      const { items } = await textOf(out, index);
      expect(items.map((i) => i.str)).not.toContain(str);
      expect(items.map((i) => i.str)).toContain('Replaced');
      expect(items.length).toBe((await textOf(loadFixture(name), index)).items.length);
    }
  });

  it('text drawn in the same export by another tool is not removed', async () => {
    const { state, api } = await openBytes(loadFixture('english.pdf'));
    const page = state.pages[0];
    const target = (await readText(api, page)).find((i) => i.str.startsWith('Please review'))!;
    registry.register({
      id: 'stamp',
      async exportOp(op, ctx) {
        ctx.pdfPage.drawText('STAMP', {
          x: op.rect.x,
          y: op.rect.y + 3,
          size: 10,
          font: await ctx.pdf.embedFont(StandardFonts.Helvetica),
        });
      },
    });
    // הפעולה של הכלי האחר קודמת, ומציירת בדיוק במקום של השורה שנערכת
    const stamp: Operation = {
      id: 's',
      pageId: page.id,
      type: 'stamp',
      rect: { ...target.rect, x: target.rect.x + 5 },
      data: {},
    };
    const out = await exportPdf({ ...state, ops: [stamp, editOp(page, target, 'Edited')] });
    const { text } = await textOf(out);
    expect(text).toContain('STAMP');
    expect(text).toContain('Edited');
    expect(text).not.toContain('Please review');
  });

  it('editing an already edited file removes the text written by the first edit', async () => {
    const first = await openBytes(loadFixture('hebrew.pdf'));
    const p1 = first.state.pages[0];
    const items1 = await readText(first.api, p1);
    const out1 = await exportPdf({ ...first.state, ops: [editOp(p1, items1[0], 'כותרת ראשונה')] });
    // בקובץ שנשמר יש כמה זרמי תוכן (q, המקורי, Q, והכתיבה החדשה)
    const doc1 = await PDFDocument.load(out1);
    expect(doc1.getPage(0).node.Contents()?.toString()).toMatch(/\[.*R.*R.*\]/);

    const second = await openBytes(out1);
    const p2 = second.state.pages[0];
    const items2 = await readText(second.api, p2);
    const t = items2.find((i) => i.str === 'כותרת ראשונה')!;
    const out2 = await exportPdf({ ...second.state, ops: [editOp(p2, t, 'כותרת שנייה')] });
    const { text } = await textOf(out2);
    expect(text).not.toContain('כותרת ראשונה');
    expect(text).not.toContain('מסמך בדיקה');
    expect(text).toContain('כותרת שנייה');
    expect(text).toContain('שורה אחרונה בעמוד.');
  });
});

describe('removeTextIn', () => {
  const helv = StandardFontEmbedder.for(
    StandardFonts.Helvetica as unknown as Parameters<typeof StandardFontEmbedder.for>[0],
  );
  const w = (s: string) => helv.widthOfTextAtSize(s, 12);

  /** עמוד עם זרם תוכן כתוב ביד ו-Helvetica בשם F1 */
  async function rawPage(content: string) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.node.setFontDictionary(PDFName.of('F1'), font.ref);
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(content)));
    return { pdf, page };
  }

  it('removes one word from a longer TJ and keeps the rest in place', async () => {
    const { pdf, page } = await rawPage('BT /F1 12 Tf 50 300 Td [(Hello) -250 (World) -250 (Foo)] TJ ET');
    const before = await layout(await pdf.save());
    const x = 50 + w('Hello') + 3;
    const n = removeTextIn(pdf.context, page, [{ x, y: 297, w: w('World'), h: 12 }]);
    expect(n).toBe(5);
    const out = await pdf.save();
    const { text } = await textOf(out);
    expect(text).not.toContain('World');
    expect(text).toMatch(/Hello\s+Foo/);
    // "Hello" במקום
    expect((await layout(out))[0][1]).toBe(before[0][1]);
  });

  it('handles Tj, \', " and Tc/Tw spacing, and leaves other lines alone', async () => {
    const { pdf, page } = await rawPage(
      'BT /F1 12 Tf 14 TL 0.2 Tc 50 300 Td (Keep me) Tj (Drop me) \' 1 0.1 (Third line) " ET\n' +
        'BT /F1 12 Tf 50 200 Td (Untouched) Tj ET',
    );
    const before = await layout(await pdf.save());
    // השורה השנייה: קו בסיס 286
    expect(removeTextIn(pdf.context, page, [{ x: 40, y: 284, w: 200, h: 8 }])).toBe('Drop me'.length);
    const after = await layout(await pdf.save());
    expect(after.map((i) => i[0]).join('|')).not.toContain('Drop');
    // שאר השורות לא זזו
    const rest = (l: (string | number)[][]) => l.filter((i) => i[2] !== 286);
    expect(rest(after)).toEqual(rest(before));
  });

  it('removes text inside a Form XObject only on this page', async () => {
    const inner = await PDFDocument.create();
    const ip = inner.addPage([200, 100]);
    ip.drawText('Inside form', { x: 10, y: 50, size: 12, font: await inner.embedFont(StandardFonts.Helvetica) });
    const pdf = await PDFDocument.create();
    const [form] = await pdf.embedPdf(await inner.save());
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const p1 = pdf.addPage([400, 400]);
    p1.drawPage(form, { x: 100, y: 200 });
    p1.drawText('Outside', { x: 100, y: 100, size: 12, font });
    const p2 = pdf.addPage([400, 400]);
    p2.drawPage(form, { x: 100, y: 200 });
    // pdf-lib כותב את הטופס רק בשמירה – טוענים מחדש, כמו בייצוא (העמודים מגיעים מקובץ)
    const doc = await PDFDocument.load(await pdf.save());
    // הטקסט שבטופס: 110,250 בעמוד
    const n = removeTextIn(doc.context, doc.getPage(0), [{ x: 105, y: 245, w: 80, h: 15 }]);
    expect(n).toBe('Inside form'.length);
    const out = await doc.save();
    expect((await textOf(out, 0)).text).not.toContain('Inside form');
    expect((await textOf(out, 0)).text).toContain('Outside');
    // העמוד השני משתמש באותו טופס – לא השתנה
    expect((await textOf(out, 1)).text).toContain('Inside form');
  });
});

describe('parseContent', () => {
  const dec = (b: Uint8Array) => String.fromCharCode(...b);

  it('reads strings with escapes and nesting, hex strings, names and arrays', () => {
    const ops = parseContent(
      new TextEncoder().encode('/F#31 12 Tf (a\\(b\\)c (n) \\101\\n) Tj <48 49> Tj [(x) -20.5 <7A>] TJ % comment\nET'),
    );
    expect(ops.map((o) => o.op)).toEqual(['Tf', 'Tj', 'Tj', 'TJ', 'ET']);
    expect(ops[0].args[0]).toEqual({ t: 'name', v: 'F1' });
    const s = ops[1].args[0];
    expect(s.t === 'str' && dec(s.v)).toBe('a(b)c (n) A\n');
    const h = ops[2].args[0];
    expect(h.t === 'str' && dec(h.v)).toBe('HI');
    const arr = ops[3].args[0];
    expect(arr.t === 'arr' && arr.v.map((x) => (x.t === 'str' ? dec(x.v) : x.t === 'num' ? x.v : null))).toEqual([
      'x',
      -20.5,
      'z',
    ]);
  });

  it('skips inline image data and keeps exact byte ranges', () => {
    const src = 'q BI /W 2 /H 1 /BPC 8 /CS /G ID \x00EI)(\xff EI Q (t) Tj';
    const bytes = Uint8Array.from(src, (c) => c.charCodeAt(0));
    const ops = parseContent(bytes);
    expect(ops.map((o) => o.op)).toEqual(['q', 'BI', 'Q', 'Tj']);
    const tj = ops[3];
    expect(src.slice(tj.start, tj.end)).toBe('(t) Tj');
  });
});
