import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { stateFromBytes } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { fontBytes } from '../../src/core/fonts';
import { drawLine, forceLtrLayout, measure } from '../../src/core/pdf-text';
import { registry } from '../../src/core/registry';
import type { DocState, Operation, TextItem } from '../../src/core/types';
import { fontKey, getFont } from '../../src/pdf-read/fonts';
import { readText } from '../../src/pdf-read/text';
import tool, { insidePage } from '../../src/tools/text-edit';
import { OP_TYPE, type TextEditData } from '../../src/tools/text-edit/export';
import { loadFixture, textOf } from '../helpers/pdf';

const HE = 'שלום עולם זו שורה ארוכה מאוד בעברית';
const EN = 'Hello world, this line runs past the right edge';

async function page(width = 400) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = forceLtrLayout(await pdf.embedFont(await fontBytes(), { subset: true }));
  return { pdf, font, page: pdf.addPage([width, 300]) };
}

describe('drawLine bounds', () => {
  it('without bounds, a line past the edge is cut by pdf.js (the problem)', async () => {
    const { pdf, font, page: p } = await page();
    drawLine(p, HE, 120, 150, { font, size: 14 }, 'right');
    const { text } = await textOf(await pdf.save());
    expect(text).not.toBe(HE);
  });

  it('an RTL line anchored on the right is moved in from the left edge', async () => {
    const { pdf, font, page: p } = await page();
    drawLine(p, HE, 120, 150, { font, size: 14, bounds: { left: 0, right: 400 } }, 'right');
    const [item] = (await textOf(await pdf.save())).items;
    expect(item.str).toBe(HE);
    expect(item.x).toBeCloseTo(0, 1);
    expect(item.size).toBeCloseTo(14, 1);
  });

  it('an LTR line anchored on the left is moved in from the right edge', async () => {
    const { pdf, font, page: p } = await page();
    const w = drawLine(p, EN, 300, 150, { font, size: 14, bounds: { left: 0, right: 400 } }, 'left');
    const [item] = (await textOf(await pdf.save())).items;
    expect(item.str).toBe(EN);
    expect(item.x).toBeCloseTo(400 - w, 1);
  });

  it('a line wider than the bounds gets a smaller size', async () => {
    const { pdf, font, page: p } = await page(200);
    expect(measure(HE, font, 14)).toBeGreaterThan(200);
    const w = drawLine(p, HE, 200, 150, { font, size: 14, bounds: { left: 0, right: 200 } }, 'right');
    expect(w).toBeLessThanOrEqual(200);
    const [item] = (await textOf(await pdf.save())).items;
    expect(item.str).toBe(HE);
    expect(item.size).toBeLessThan(14);
    expect(item.x).toBeGreaterThanOrEqual(-0.01);
  });

  it('a line inside the bounds is not touched', async () => {
    const { pdf, font, page: p } = await page();
    drawLine(p, 'קצר', 300, 150, { font, size: 14, bounds: { left: 0, right: 400 } }, 'right');
    const [item] = (await textOf(await pdf.save())).items;
    expect(item.x + measure('קצר', font, 14)).toBeCloseTo(300, 1);
  });
});

/* ---------- עריכת טקסט ---------- */

const tasks: PDFDocumentLoadingTask[] = [];
afterAll(async () => {
  await Promise.all(tasks.map((t) => t.destroy()));
});

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

async function open(name: string) {
  const state = await stateFromBytes(name, loadFixture(name));
  const api = {
    pdfjsDoc: (id: string) => {
      const task = getDocument({ data: state.sources[id].bytes.slice(), fontExtraProperties: true, verbosity: 0 });
      tasks.push(task);
      return task.promise as unknown as Promise<PDFDocumentProxy>;
    },
  };
  return { state, api, page: state.pages[0] };
}

function op(state: DocState, item: TextItem, text: string): Operation {
  const page = state.pages[0];
  const key = fontKey(page.sourceId!, item.fontName!);
  const d: TextEditData = {
    original: item,
    text,
    ...(getFont(key) ? { fontKey: key } : {}),
    size: item.size,
    color: '#000000',
    bg: '#ffffff',
  };
  return { id: 'e1', pageId: page.id, type: OP_TYPE, rect: item.rect, data: d as unknown as Record<string, unknown> };
}

describe('text-edit keeps a longer line inside the page', () => {
  it('hebrew.pdf: a line that grew past the left margin is moved in and read in full', async () => {
    const { state, api, page } = await open('hebrew.pdf');
    const item = (await readText(api, page))[4];
    const long = 'שורה אחרונה בעמוד שהתארכה מאוד מאוד מאוד ועכשיו היא עוברת את השוליים השמאליים של העמוד.';
    const { items } = await textOf(await exportPdf({ ...state, ops: [op(state, item, long)] }));
    const edited = items.find((i) => i.str === long);
    expect(edited).toBeTruthy();
    expect(edited!.x).toBeGreaterThanOrEqual(-0.01);
  });

  it('cropbox.pdf: the bounds are the visible area (CropBox), not the MediaBox', async () => {
    const { state, api, page } = await open('cropbox.pdf');
    const item = (await readText(api, page)).find((i) => i.str === 'CropBox top-left')!;
    const long = 'An edited line that is far too long for the visible area of this cropped page';
    const { items } = await textOf(await exportPdf({ ...state, ops: [op(state, item, long)] }));
    const edited = items.find((i) => i.str === long)!;
    expect(edited).toBeTruthy();
    // CropBox: 100..600 במערכת של הקובץ
    expect(edited.x).toBeGreaterThanOrEqual(100 - 0.01);
  });

  it('insidePage clamps the rect on screen the same way', () => {
    expect(insidePage({ x: -50, y: 0, w: 200, h: 10 }, 500)).toEqual({ x: 0, y: 0, w: 200, h: 10 });
    expect(insidePage({ x: 400, y: 0, w: 200, h: 10 }, 500)).toEqual({ x: 300, y: 0, w: 200, h: 10 });
    expect(insidePage({ x: -10, y: 0, w: 900, h: 10 }, 500)).toEqual({ x: 0, y: 0, w: 500, h: 10 });
  });
});

describe('add-text', () => {
  it('a word longer than the box near the right edge stays on the page', async () => {
    const addText = (await import('../../src/tools/add-text')).default;
    const { blankPage } = await import('../../src/core/document');
    registry.clear();
    registry.register(addText);
    const word = 'Supercalifragilisticexpialidocious';
    const state: DocState = {
      sources: {},
      pages: [{ ...blankPage(400, 300), id: 'p1' }],
      ops: [
        {
          id: 't1',
          pageId: 'p1',
          type: 'add-text',
          rect: { x: 330, y: 200, w: 60, h: 30 },
          data: { text: word, size: 16, color: '#000000', font: 'default', align: 'start' },
        },
      ],
      formValues: {},
    };
    const [item] = (await textOf(await exportPdf(state))).items;
    expect(item.str).toBe(word);
    expect(item.x).toBeGreaterThanOrEqual(-0.01);
  });
});
