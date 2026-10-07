/** בדיקות שילוב בין כלים של סשנים שונים */
import { beforeEach, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { stateFromBytes } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { Store } from '../../src/core/model';
import { registry } from '../../src/core/registry';
import type { DocState, Operation } from '../../src/core/types';
import { fontKey, getFont } from '../../src/pdf-read/fonts';
import { readText } from '../../src/pdf-read/text';
import tool from '../../src/tools/text-edit';
import { OP_TYPE } from '../../src/tools/text-edit/export';
import { duplicatePages } from '../../src/tools/pages/duplicate';
import { loadFixture, textOf } from '../helpers/pdf';

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

it('שכפול עמוד עם עריכת טקסט וסיבוב העותק (סשנים A + C)', async () => {
  const state0 = await stateFromBytes('h.pdf', loadFixture('hebrew.pdf'));
  const m = new Map();
  const api = {
    pdfjsDoc: (id: string) =>
      m.get(id) ??
      (m.set(
        id,
        getDocument({ data: (state0 as DocState).sources[id].bytes.slice(), fontExtraProperties: true, verbosity: 0 })
          .promise as unknown as Promise<PDFDocumentProxy>,
      ),
      m.get(id)),
  };
  const page = state0.pages[0];
  const items = await readText(api as never, page);
  const it1 = items[1];
  const key = fontKey(page.sourceId!, it1.fontName!);
  const op: Operation = {
    id: 'e1',
    pageId: page.id,
    type: OP_TYPE,
    rect: it1.rect,
    data: {
      original: it1,
      text: 'שורה ערוכה',
      ...(getFont(key) ? { fontKey: key } : {}),
      size: it1.size,
      color: '#000000',
      bg: '#ffffff',
    } as never,
  };
  const store = new Store();
  store.reset({ ...state0, ops: [op] });
  duplicatePages(store, [page.id]);
  const s = store.get();
  store.setPages(s.pages.map((p, i) => (i === 1 ? { ...p, rotation: 90 } : p)));
  const out = await exportPdf(store.get());
  for (const i of [0, 1]) {
    const { text } = await textOf(out, i);
    expect(text).toContain('שורה ערוכה');
    expect(text).not.toContain('שלום עולם');
    expect(text).toContain('שורה אחרונה בעמוד');
  }
});
