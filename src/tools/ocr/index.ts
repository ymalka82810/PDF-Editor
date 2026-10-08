/**
 * OCR לעמודים סרוקים: "זיהוי טקסט" מזין את התוצאה לכלי עריכת הטקסט (registerTextSource,
 * src/pdf-read/text.ts של סשן A), ו"הפוך לניתן לחיפוש" כותב אותה כשכבת טקסט שקופה בייצוא.
 * פועל על העמודים הנבחרים בפאנל העמודים (סשן C); בלי בחירה - על כל העמודים.
 */

import { userSpace } from '../../core/coords';
import { drawLine } from '../../core/pdf-text';
import type { EditorApi, Locale, Tool } from '../../core/registry';
import type { PageRef, TextItem } from '../../core/types';
import { registerTextSource } from '../../pdf-read/text';
import { pageSelection } from '../pages/selection';
import { wordsToItems } from './map';
import { recognizeCanvas } from './tesseract';
import en from './locales/en.json';
import he from './locales/he.json';

type Dict = Record<string, Locale>;
const dicts = { he: he as Dict, en: en as Dict };
const localesOf = (id: string) => ({ he: dicts.he[id] ?? {}, en: dicts.en[id] ?? {} });

/** רוחב התמונה שנשלחת לזיהוי, בפיקסלים. גדול מספיק לדיוק, לא כבד מדי */
const OCR_WIDTH = 2200;

const cache = new Map<string, Promise<TextItem[]>>();

/** המודל של שפת ה-OCR נטען מה-CDN בפעם הראשונה - בלי אינטרנט (או ברשת שחוסמת את ה-CDN) הזיהוי נכשל */
function offlineMessageKey(prefix: string, err: unknown): string {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const networkError = err instanceof TypeError || /network|fetch/i.test((err as Error)?.message ?? '');
  return offline || networkError ? prefix + '.offline' : prefix + '.failed';
}

function targetPages(api: EditorApi): PageRef[] {
  const sel = new Set(pageSelection.get());
  const pages = api.store.get().pages;
  return (sel.size ? pages.filter((p) => sel.has(p.id)) : pages).filter((p) => p.sourceId);
}

/** מרנדר את העמוד (בלי סיבוב - כמו שה-rect של TextItem מוגדר) ומריץ עליו OCR, עם cache לפי עמוד */
function recognizePage(api: EditorApi, page: PageRef): Promise<TextItem[]> {
  let p = cache.get(page.id);
  if (!p) {
    p = run();
    cache.set(page.id, p);
    p.catch(() => cache.delete(page.id));
  }
  return p;

  async function run() {
    const doc = await api.pdfjsDoc(page.sourceId!);
    const pjsPage = await doc.getPage(page.sourceIndex + 1);
    const unrotated = pjsPage.getViewport({ scale: 1, rotation: 0 });
    const scale = OCR_WIDTH / unrotated.width;
    const viewport = pjsPage.getViewport({ scale, rotation: 0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pjsPage.render({ canvas, canvasContext: ctx, viewport }).promise;
    const words = await recognizeCanvas(canvas);
    return wordsToItems(words, { pageId: page.id, scale, pageHeight: page.height });
  }
}

const recognize: Tool = {
  id: 'ocr-recognize',
  icon: '🔎',
  group: 'other',
  locales: localesOf('ocr-recognize'),

  onDocumentOpened() {
    cache.clear();
  },

  async run(api) {
    const pages = targetPages(api);
    if (!pages.length) return api.toast(api.t('ocr-recognize.noSelection'), 'error');
    api.toast(api.t('ocr-recognize.running'));
    try {
      for (const page of pages) registerTextSource(page.id, 'ocr', await recognizePage(api, page));
      api.toast(api.t('ocr-recognize.done'));
    } catch (err) {
      console.error(err);
      api.toast(api.t(offlineMessageKey('ocr-recognize', err)), 'error');
    }
  },
};

interface OcrLayerData {
  items: TextItem[];
}

const searchable: Tool = {
  id: 'ocr-searchable',
  icon: '🔍',
  group: 'other',
  opTypes: ['ocr-layer'],
  locales: localesOf('ocr-searchable'),
  movable: false,

  async run(api) {
    const pages = targetPages(api);
    if (!pages.length) return api.toast(api.t('ocr-searchable.noSelection'), 'error');
    try {
      for (const page of pages) {
        const items = await recognizePage(api, page);
        registerTextSource(page.id, 'ocr', items);
        const existing = api.store.get().ops.find((o) => o.pageId === page.id && o.type === 'ocr-layer');
        if (existing) api.store.updateOp(existing.id, { data: { items } });
        else
          api.store.addOp<OcrLayerData>({
            pageId: page.id,
            type: 'ocr-layer',
            rect: { x: 0, y: 0, w: page.width, h: page.height },
            data: { items },
          });
      }
      api.toast(api.t('ocr-searchable.done'));
    } catch (err) {
      console.error(err);
      api.toast(api.t(offlineMessageKey('ocr-searchable', err)), 'error');
    }
  },

  // שכבת ה-OCR שקופה - אין מה לצייר על המסך, ולא נוגעים בלחיצות (האלמנט מכסה את כל העמוד)
  renderOp(_op, el) {
    el.style.pointerEvents = 'none';
  },

  async exportOp(op, ctx) {
    const { items } = op.data as unknown as OcrLayerData;
    const font = await ctx.font();
    for (const it of items) {
      const p = userSpace(ctx.page, { x: it.rect.x, y: it.baseline, w: 0, h: 0 });
      // עוגן בקצה השמאלי של התיבה (it.rect.x), בלי תלות ב-rtl - כך הטקסט לא זז שמאלה מעבר לתיבה שזוהתה
      drawLine(ctx.pdfPage, it.str, p.x, p.y, { font, size: it.size, opacity: 0, dir: it.rtl ? 'rtl' : 'ltr' }, 'left');
    }
  },
};

export { recognize, searchable };
export default [recognize, searchable] satisfies Tool[];
