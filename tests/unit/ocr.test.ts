import { beforeEach, describe, expect, it } from 'vitest';
import { blankPage } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import type { DocState } from '../../src/core/types';
import { wordsToItems, type OcrWord } from '../../src/tools/ocr/map';
import { searchable } from '../../src/tools/ocr/index';
import { textOf } from '../helpers/pdf';

beforeEach(() => registry.clear());

describe('wordsToItems: מיפוי קואורדינטות OCR ← נקודות PDF', () => {
  const pageId = 'p1';

  it('ממיר bbox בפיקסלים לנקודות PDF לפי scale, עם ראשית בפינה השמאלית התחתונה', () => {
    const words: OcrWord[] = [{ text: 'Hello', confidence: 90, bbox: { x0: 100, y0: 50, x1: 180, y1: 90 } }];
    const [item] = wordsToItems(words, { pageId, scale: 2, pageHeight: 400 });
    expect(item.rect).toEqual({ x: 50, y: 355, w: 40, h: 20 });
    expect(item.baseline).toBe(355);
    expect(item.size).toBe(20);
    expect(item.pageId).toBe(pageId);
    expect(item.origin).toBe('ocr');
  });

  it('מסנן מילים עם ביטחון נמוך', () => {
    const words: OcrWord[] = [
      { text: 'ok', confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      { text: 'noisy', confidence: 10, bbox: { x0: 100, y0: 0, x1: 110, y1: 10 } },
    ];
    const items = wordsToItems(words, { pageId, scale: 1, pageHeight: 100 });
    expect(items.map((i) => i.str)).toEqual(['ok']);
  });

  it('מזהה rtl לפי אותיות עבריות', () => {
    const words: OcrWord[] = [{ text: 'שלום', confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }];
    const [item] = wordsToItems(words, { pageId, scale: 1, pageHeight: 100 });
    expect(item.rtl).toBe(true);
  });

  it('מאחד מילים סמוכות על אותה שורה לביטוי אחד (joinFragments)', () => {
    const words: OcrWord[] = [
      { text: 'Hello', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
      { text: 'World', confidence: 90, bbox: { x0: 55, y0: 0, x1: 110, y1: 20 } },
    ];
    const items = wordsToItems(words, { pageId, scale: 1, pageHeight: 100 });
    expect(items).toHaveLength(1);
    expect(items[0].str).toBe('Hello World');
  });

  it('מתעלם מתיבות ריקות או הפוכות', () => {
    const words: OcrWord[] = [{ text: 'bad', confidence: 90, bbox: { x0: 10, y0: 10, x1: 10, y1: 20 } }];
    expect(wordsToItems(words, { pageId, scale: 1, pageHeight: 100 })).toEqual([]);
  });
});

describe('ocr-layer: שכבת טקסט שקופה בייצוא (הפוך לניתן לחיפוש)', () => {
  it('הטקסט המזוהה נכתב לעמוד וניתן לחלץ אותו (גם שהוא שקוף)', async () => {
    registry.register(searchable);
    const page = blankPage(300, 200);
    const state: DocState = {
      sources: {},
      pages: [page],
      ops: [
        {
          id: 'op1',
          pageId: page.id,
          type: 'ocr-layer',
          rect: { x: 0, y: 0, w: page.width, h: page.height },
          data: {
            items: [
              {
                pageId: page.id,
                str: 'שלום עולם',
                rect: { x: 20, y: 150, w: 80, h: 16 },
                baseline: 150,
                size: 14,
                rtl: true,
                origin: 'ocr',
              },
            ],
          },
        },
      ],
      formValues: {},
    };

    const out = await exportPdf(state);
    const { text } = await textOf(out, 0);
    expect(text).toContain('שלום עולם');
  });

  it('לא חוסם לחיצות על האלמנט שמכסה את כל העמוד (pointer-events: none)', () => {
    const el = { style: {} as CSSStyleDeclaration } as HTMLElement;
    searchable.renderOp!(
      { id: 'o', pageId: 'p', type: 'ocr-layer', rect: { x: 0, y: 0, w: 1, h: 1 }, data: { items: [] } },
      el,
      {} as never,
      {} as never,
    );
    expect(el.style.pointerEvents).toBe('none');
  });
});
