import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { blankPage, readSource, stateFromBytes } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import { drawLine, visualOrder } from '../../src/core/pdf-text';
import { userSpace } from '../../src/core/coords';
import type { DocState } from '../../src/core/types';

/** PDF עם עמודים שעל כל אחד כתוב השם שלו */
async function makePdf(labels: string[], size: [number, number] = [300, 400]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const l of labels) doc.addPage(size).drawText(l, { x: 20, y: 50, size: 24, font });
  return doc.save();
}

async function pageTexts(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' ').trim());
  }
  return out;
}

beforeEach(() => registry.clear());

describe('exportPdf', () => {
  it('מסדר, משכפל, מסובב, מוסיף עמוד ריק וממזג קובץ נוסף', async () => {
    const state = await stateFromBytes('a.pdf', await makePdf(['A1', 'A2', 'A3']));
    const extra = await readSource('b.pdf', await makePdf(['B1'], [200, 200]));
    const [a1, a2, a3] = state.pages;
    const s: DocState = {
      ...state,
      sources: { ...state.sources, [extra.source.id]: extra.source },
      pages: [a3, a1, { ...a1, id: 'dup' }, blankPage(100, 100), { ...extra.pages[0], rotation: 90 }],
    };
    void a2;
    const out = await exportPdf(s);
    expect(await pageTexts(out)).toEqual(['A3', 'A1', 'A1', '', 'B1']);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 0, 0, 0, 90]);
    expect(doc.getPage(3).getSize()).toEqual({ width: 100, height: 100 });
  });

  it('מייצא רק עמודים נבחרים', async () => {
    const state = await stateFromBytes('a.pdf', await makePdf(['A1', 'A2', 'A3']));
    const out = await exportPdf(state, { pageIds: [state.pages[1].id] });
    expect(await pageTexts(out)).toEqual(['A2']);
  });

  it('כותב פעולות דרך הכלי, כולל עברית בסדר הנכון', async () => {
    registry.register({
      id: 'test-text',
      async exportOp(op, ctx) {
        const r = userSpace(ctx.page, op.rect);
        drawLine(ctx.pdfPage, String(op.data.text), r.x + r.w, r.y, { font: await ctx.font(), size: 14 }, 'right');
      },
    });
    const state = await stateFromBytes('a.pdf', await makePdf(['A1']));
    const op = (id: string, y: number, text: string) => ({ id, pageId: state.pages[0].id, type: 'test-text', rect: { x: 20, y, w: 250, h: 20 }, data: { text } });
    // שורה שבסדר התצוגה מתחילה באנגלית, ושורה שמתחילה בעברית (fontkit הופך אותה בעצמו אם לא מכריחים ltr)
    const s: DocState = { ...state, ops: [op('o1', 100, 'שלום עולם 123 (test)'), op('o2', 150, 'אחת שתיים שלוש')] };
    const [page] = await pageTexts(await exportPdf(s));
    // הקובץ מכיל את הטקסט בסדר תצוגה, ו-pdf.js מחזיר אותו בסדר לוגי – כלומר חיפוש והעתקה עובדים
    expect(page).toContain('שלום עולם');
    expect(page).toContain('123');
    expect(page).toContain('אחת שתיים שלוש');
  });
});

describe('visualOrder', () => {
  it('הופך עברית, משאיר מספרים ואנגלית, ומחליף סוגריים', () => {
    expect(visualOrder('abc')).toBe('abc');
    expect(visualOrder('שלום 12')).toBe('12 םולש');
    expect(visualOrder('(שלום)')).toBe('(םולש)');
  });
});
