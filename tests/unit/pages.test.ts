import { describe, expect, it } from 'vitest';
import { blankPage, readSource, stateFromBytes } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { Store } from '../../src/core/model';
import { duplicatePages } from '../../src/tools/pages/duplicate';
import { loadFixture, pageInfo, textOf } from '../helpers/pdf';

/** "Page N" ו-N גדול מצוירים על כל עמוד ב-multipage.pdf (ראו scripts/make-fixtures.mjs) */
async function label(bytes: Uint8Array, pageIndex: number) {
  const { text } = await textOf(bytes, pageIndex);
  return text;
}

describe('pages: order, rotation, delete, duplicate, merge', () => {
  it('rotation: setPages על עמוד נבחר משנה רק את rotation, לא את ה-rect של פעולותיו', async () => {
    const state = await stateFromBytes('multipage.pdf', loadFixture('multipage.pdf'));
    const store = new Store();
    store.reset(state);
    const [p1, p2] = state.pages;
    const op = store.addOp({ pageId: p1.id, type: 'box', rect: { x: 1, y: 2, w: 3, h: 4 }, data: {} });

    store.setPages(store.get().pages.map((p) => (p.id === p1.id ? { ...p, rotation: 90 } : p)));
    expect(store.get().pages.find((p) => p.id === p1.id)!.rotation).toBe(90);
    expect(store.get().pages.find((p) => p.id === p2.id)!.rotation).toBe(0);
    // ה-op לא זז - הסיבוב מתבצע בתצוגה/בייצוא בלבד
    expect(store.get().ops.find((o) => o.id === op)!.rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });

    const out = await exportPdf(store.get());
    const { pages } = await pageInfo(out);
    expect(pages[0].rotation).toBe(90);
    expect(pages[1].rotation).toBe(0);
  });

  it('order: setPages משנה את סדר הייצוא', async () => {
    const state = await stateFromBytes('multipage.pdf', loadFixture('multipage.pdf'));
    const store = new Store();
    store.reset(state);
    const [p1, p2, p3] = state.pages;
    store.setPages([p3, p1, p2, ...state.pages.slice(3)]);

    const out = await exportPdf(store.get());
    expect(await label(out, 0)).toContain('Page 3');
    expect(await label(out, 1)).toContain('Page 1');
    expect(await label(out, 2)).toContain('Page 2');
  });

  it('delete: setPages בלי העמודים הנבחרים מוחק גם את הפעולות שלהם, ו-undo מחזיר הכל', async () => {
    const state = await stateFromBytes('multipage.pdf', loadFixture('multipage.pdf'));
    const store = new Store();
    store.reset(state);
    const [p1, p2] = state.pages;
    store.addOp({ pageId: p1.id, type: 'box', rect: { x: 0, y: 0, w: 1, h: 1 }, data: {} });

    store.setPages(store.get().pages.filter((p) => p.id !== p1.id));
    expect(store.get().pages.map((p) => p.id)).not.toContain(p1.id);
    expect(store.get().ops).toEqual([]);

    const out = await exportPdf(store.get());
    expect(await label(out, 0)).toContain('Page 2');

    store.undo();
    expect(store.get().pages.map((p) => p.id)).toEqual(state.pages.map((p) => p.id));
    expect(store.get().ops).toHaveLength(1);
    void p2;
  });

  it('duplicate: משכפל עמוד ישר אחריו, עם עותק חדש של הפעולות שלו ו-id-ים חדשים', async () => {
    const state = await stateFromBytes('multipage.pdf', loadFixture('multipage.pdf'));
    const store = new Store();
    store.reset(state);
    const [p1, p2] = state.pages;
    const opId = store.addOp({ pageId: p1.id, type: 'box', rect: { x: 5, y: 5, w: 1, h: 1 }, data: { n: 1 } });

    const [dupId] = duplicatePages(store, [p1.id]);
    const pages = store.get().pages;
    expect(pages[0].id).toBe(p1.id);
    expect(pages[1].id).toBe(dupId);
    expect(pages[2].id).toBe(p2.id);
    expect(pages[1]).toMatchObject({
      sourceId: p1.sourceId,
      sourceIndex: p1.sourceIndex,
      width: p1.width,
      height: p1.height,
    });

    const dupOp = store.get().ops.find((o) => o.pageId === dupId)!;
    expect(dupOp.id).not.toBe(opId);
    expect(dupOp.rect).toEqual({ x: 5, y: 5, w: 1, h: 1 });
    expect(dupOp.data).toEqual({ n: 1 });
    expect(store.get().ops).toHaveLength(2);

    const out = await exportPdf(store.get());
    expect(await label(out, 0)).toContain('Page 1');
    expect(await label(out, 1)).toContain('Page 1'); // העותק - מאותו sourceIndex
    expect(await label(out, 2)).toContain('Page 2');
  });

  it('duplicate: מחליף pageId מקונן בתוך op.data (למשל data.original.pageId) לעמוד המשוכפל', () => {
    const store = new Store();
    const pages = [blankPage(), blankPage()];
    store.reset({ sources: {}, pages, ops: [], formValues: {} });
    store.addOp({
      pageId: pages[0].id,
      type: 'text-edit',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      data: { original: { pageId: pages[0].id, str: 'x' } },
    });

    const [dupId] = duplicatePages(store, [pages[0].id]);
    const dupOp = store.get().ops.find((o) => o.pageId === dupId)!;
    expect((dupOp.data as { original: { pageId: string } }).original.pageId).toBe(dupId);
  });

  it('duplicate: לא נוגע בעמודים ובפעולות שלא נבחרו', () => {
    const store = new Store();
    const pages = [blankPage(), blankPage()];
    store.reset({ sources: {}, pages, ops: [], formValues: {} });
    const otherOp = store.addOp({ pageId: pages[1].id, type: 'box', rect: { x: 0, y: 0, w: 1, h: 1 }, data: {} });

    duplicatePages(store, [pages[0].id]);
    expect(store.get().ops.map((o) => o.id)).toContain(otherOp);
    expect(store.get().pages.find((p) => p.id === pages[1].id)).toEqual(pages[1]);
  });

  it('merge: readSource מחזיר עמודים של קובץ נוסף, ושילוב שלהם ב-pages מייצא את שני הקבצים', async () => {
    const state = await stateFromBytes('multipage.pdf', loadFixture('multipage.pdf'));
    const extra = await readSource('hebrew.pdf', loadFixture('hebrew.pdf'));
    const store = new Store();
    store.reset({
      ...state,
      sources: { ...state.sources, [extra.source.id]: extra.source },
      pages: [state.pages[0], extra.pages[0]],
    });

    const out = await exportPdf(store.get());
    const { pageCount } = await pageInfo(out);
    expect(pageCount).toBe(2);
    expect(await label(out, 0)).toContain('Page 1');
  });

  it('extract: exportPdf עם pageIds מוציא רק את העמודים הנבחרים, בסדר המסמך', async () => {
    const state = await stateFromBytes('multipage.pdf', loadFixture('multipage.pdf'));
    const [p1, p2, p3] = state.pages;
    // הסדר ב-pageIds לא קובע - exportPdf שומר על סדר state.pages
    const out = await exportPdf(state, { pageIds: [p3.id, p1.id] });
    const { pageCount } = await pageInfo(out);
    expect(pageCount).toBe(2);
    expect(await label(out, 0)).toContain('Page 1');
    expect(await label(out, 1)).toContain('Page 3');
    void p2;
  });

  it('split: exportPdf לכל עמוד בנפרד מפיק קובץ בודד תקין', async () => {
    const state = await stateFromBytes('multipage.pdf', loadFixture('multipage.pdf'));
    for (let i = 0; i < state.pages.length; i++) {
      const out = await exportPdf(state, { pageIds: [state.pages[i].id] });
      const { pageCount } = await pageInfo(out);
      expect(pageCount).toBe(1);
      expect(await label(out, 0)).toContain(`Page ${i + 1}`);
    }
  });

  it('insert blank: blankPage בגודל העמוד הנוכחי, בלי שום פעולה עליו', async () => {
    const state = await stateFromBytes('multipage.pdf', loadFixture('multipage.pdf'));
    const store = new Store();
    store.reset(state);
    const ref = state.pages[3]; // עמוד לרוחב (Letter הפוך)
    const blank = blankPage(ref.width, ref.height);
    const pages = [...store.get().pages];
    pages.splice(4, 0, blank);
    store.setPages(pages);

    const out = await exportPdf(store.get());
    const { pages: info } = await pageInfo(out);
    expect(info[4].width).toBe(ref.width);
    expect(info[4].height).toBe(ref.height);
    expect(await label(out, 4)).toBe('');
  });
});
