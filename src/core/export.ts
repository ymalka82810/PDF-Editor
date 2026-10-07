/**
 * ייצוא המסמך ל-PDF אמיתי:
 * 1. המסמך הבסיסי הוא הקובץ הראשון (כדי לשמור טופס, מטא-דאטה וקישורים פנימיים שלו).
 *    כל העמודים מוסרים ממנו ומוכנסים מחדש לפי state.pages – עמודים שלו מוחזרים כמו שהם,
 *    עמוד שמופיע פעמיים מועתק, ועמודים מקבצים אחרים מועתקים עם copyPages.
 * 2. סיבוב מוחלט לכל עמוד.
 * 3. כל פעולה נכתבת על ידי הכלי שלה (exportOp), לפי סדר הפעולות.
 * 4. שלב ברמת המסמך (exportDocument) – טפסים וכו'.
 */

import fontkit from '@pdf-lib/fontkit';
import { degrees, PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { fontBytes } from './fonts';
import { forceLtrLayout } from './pdf-text';
import { registry, type DocExportCtx, type ExportCtx } from './registry';
import type { DocState, PageRef } from './types';

export interface ExportOptions {
  /** רק העמודים האלה (לחילוץ/פיצול). ברירת מחדל: כולם */
  pageIds?: string[];
}

export async function exportPdf(state: DocState, opts: ExportOptions = {}): Promise<Uint8Array> {
  const wanted = opts.pageIds ? new Set(opts.pageIds) : null;
  const pages = state.pages.filter((p) => !wanted || wanted.has(p.id));
  const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

  const primaryId = pages.find((p) => p.sourceId)?.sourceId ?? Object.keys(state.sources)[0];
  const pdf = primaryId ? await load(state.sources[primaryId].bytes) : await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  // העמודים המקוריים של הבסיס, לפני ההסרה
  const originals = primaryId ? pdf.getPages() : [];
  for (let i = pdf.getPageCount() - 1; i >= 0; i--) pdf.removePage(i);

  const used = new Set<number>();
  const others = new Map<string, Promise<PDFDocument>>();
  const other = (id: string) => {
    let d = others.get(id);
    if (!d) others.set(id, (d = load(state.sources[id].bytes)));
    return d;
  };

  const placed: { page: PageRef; pdfPage: PDFPage }[] = [];
  for (const ref of pages) {
    let pdfPage: PDFPage;
    if (!ref.sourceId) {
      pdfPage = pdf.addPage([ref.width, ref.height]);
    } else if (ref.sourceId === primaryId && !used.has(ref.sourceIndex)) {
      used.add(ref.sourceIndex);
      pdfPage = pdf.addPage(originals[ref.sourceIndex]);
    } else {
      // עמוד שכבר בשימוש מהבסיס – מעתיקים מעותק נפרד של הקובץ
      const src = await other(ref.sourceId);
      const [copy] = await pdf.copyPages(src, [ref.sourceIndex]);
      pdfPage = pdf.addPage(copy);
    }
    pdfPage.setRotation(degrees(ref.rotation));
    placed.push({ page: ref, pdfPage });
  }

  const fonts = new Map<string, Promise<PDFFont>>();
  const embedFontBytes = (key: string, bytes: Uint8Array) => {
    let f = fonts.get(key);
    if (!f) fonts.set(key, (f = pdf.embedFont(bytes, { subset: true }).then(forceLtrLayout)));
    return f;
  };
  const font = async (name = 'default') => {
    const key = 'builtin:' + name;
    let f = fonts.get(key);
    if (!f) fonts.set(key, (f = fontBytes(name).then((b) => pdf.embedFont(b, { subset: true })).then(forceLtrLayout)));
    return f;
  };

  for (const { page, pdfPage } of placed) {
    const ctx: ExportCtx = { pdf, pdfPage, page, state, font, embedFontBytes };
    for (const op of state.ops) {
      if (op.pageId !== page.id) continue;
      const tool = registry.forOp(op.type);
      if (!tool?.exportOp) {
        console.warn('אין כלי לייצוא פעולה מסוג', op.type);
        continue;
      }
      await tool.exportOp(op, ctx);
    }
  }

  const docCtx: DocExportCtx = { pdf, state, font, embedFontBytes, pages: placed };
  for (const tool of registry.all()) if (tool.exportDocument) await tool.exportDocument(docCtx);

  return pdf.save();
}
