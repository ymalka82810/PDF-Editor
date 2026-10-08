import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { blankPage } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import type { DocState, Operation, PageRef } from '../../src/core/types';
import tool, { type TextData } from '../../src/tools/add-text';
import { textOf } from '../helpers/pdf';

const tasks: PDFDocumentLoadingTask[] = [];
afterAll(async () => {
  await Promise.all(tasks.map((t) => t.destroy()));
});

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

const base: TextData = { text: '', size: 20, color: '#000000', font: 'default', align: 'start' };
const op = (
  id: string,
  data: Partial<TextData>,
  rect = { x: 40, y: 700, w: 300, h: 40 },
  pageId = 'p1',
): Operation => ({
  id,
  pageId,
  type: 'add-text',
  rect,
  data: { ...base, ...data } as unknown as Record<string, unknown>,
});

const stateOf = (ops: Operation[], page: PageRef = { ...blankPage(), id: 'p1' }): DocState => ({
  sources: {},
  pages: [page],
  ops,
  formValues: {},
});

/** הפריטים של העמוד עם המטריצה המלאה (textOf מחזיר רק x/y) */
async function rawItems(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  tasks.push(task);
  const page = await (await task.promise).getPage(1);
  const content = await page.getTextContent();
  return content.items.filter((i) => 'str' in i && i.str.trim()) as { str: string; transform: number[] }[];
}

describe('add-text exportOp', () => {
  it('writes Hebrew and English in logical order', async () => {
    const bytes = await exportPdf(
      stateOf([
        op('o1', { text: 'שלום עולם 123' }),
        op('o2', { text: 'Hello World' }, { x: 40, y: 600, w: 300, h: 40 }),
      ]),
    );
    const { items } = await textOf(bytes);
    expect(items.map((i) => i.str)).toEqual(['שלום עולם 123', 'Hello World']);
    // עברית מיושרת לימין התיבה (start), אנגלית לשמאל
    expect(items[1].x).toBeCloseTo(40, 0);
    expect(items[0].x).toBeGreaterThan(200);
  });

  it('several lines, alignment, size and bold', async () => {
    const bytes = await exportPdf(
      stateOf([
        op(
          'o1',
          { text: 'first line\nsecond', align: 'center', size: 14, font: 'default-bold' },
          { x: 100, y: 500, w: 200, h: 60 },
        ),
      ]),
    );
    const { items } = await textOf(bytes);
    expect(items.map((i) => i.str)).toEqual(['first line', 'second']);
    expect(items[0].size).toBeCloseTo(14, 1);
    expect(items[1].y).toBeLessThan(items[0].y);
    // ממורכז: מרכז השורה במרכז התיבה (200)
    expect(items[0].x).toBeGreaterThan(150);
    expect(items[0].x).toBeLessThan(200);
  });

  it('writes nothing for empty text', async () => {
    const { items } = await textOf(await exportPdf(stateOf([op('o1', { text: '  ' })])));
    expect(items).toHaveLength(0);
  });

  it('on a page rotated 90: the text is rotated so that it reads upright, inside the rect', async () => {
    // העמוד מוצג מסובב 90° עם כיוון השעון; המשתמש גרר תיבה רחבה על המסך, שבעמוד היא גבוהה וצרה
    const page = { ...blankPage(), id: 'p1', rotation: 90 as const };
    const rect = { x: 100, y: 300, w: 40, h: 300 };
    const bytes = await exportPdf(stateOf([op('o1', { text: 'Upright', rotate: -90 }, rect)], page));
    const [item] = await rawItems(bytes);
    expect(item.str).toBe('Upright');
    // סיבוב של 90° נגד כיוון השעון ב-PDF: [0, s, -s, 0]
    const [a, b, c, d, e, f] = item.transform;
    expect(Math.abs(a)).toBeLessThan(0.01);
    expect(b).toBeCloseTo(20, 1);
    expect(c).toBeCloseTo(-20, 1);
    expect(Math.abs(d)).toBeLessThan(0.01);
    // תחילת השורה בתוך המלבן
    expect(e).toBeGreaterThanOrEqual(rect.x);
    expect(e).toBeLessThanOrEqual(rect.x + rect.w);
    expect(f).toBeGreaterThanOrEqual(rect.y);
    expect(f).toBeLessThanOrEqual(rect.y + rect.h);
  });
});
