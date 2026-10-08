/**
 * הנתונים של פעולת text-edit וכתיבתה ל-PDF:
 * מכסים את המקום המקורי במלבן בצבע הרקע, וכותבים את הטקסט החדש במיקום של op.rect –
 * בגופן המוטמע מהקובץ אם יש בו את האותיות, ובגופן ברירת המחדל לאותיות שחסרות בו.
 * הטקסט הישן נמחק גם מזרם התוכן (remove-text.ts), כדי שחיפוש בקובץ לא ימצא אותו. הכיסוי נשאר כגיבוי.
 */

import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';
import { userSpace } from '../../core/coords';
import { drawLine, hexColor, lineWidth, missingChars, remapFont, type LineStyle } from '../../core/pdf-text';
import type { ExportCtx } from '../../core/registry';
import type { Operation, Rect, TextItem } from '../../core/types';
import { getFont, standardFontName } from '../../pdf-read/fonts';
import { removeTextIn } from './remove-text';

export const OP_TYPE = 'text-edit';

export interface TextEditData {
  /** הפריט המקורי – המקום שמכסים */
  original: TextItem;
  /** הטקסט החדש (בסדר לוגי). ריק – מחיקה */
  text: string;
  /** הגופן המוטמע (fontKey ב-pdf-read/fonts.ts) */
  fontKey?: string;
  /** גופנים נוספים של השורה (שורה מעורבת), לפי הסדר – לאותיות שאין ב-fontKey */
  fontKeys?: string[];
  size: number;
  /** '#rrggbb' */
  color: string;
  /** צבע הכיסוי */
  bg: string;
  bold?: boolean;
  italic?: boolean;
}

export const dataOf = (op: Operation) => op.data as unknown as TextEditData;

/** הטיית נטוי, במעלות */
const ITALIC_SKEW = 12;

/** המרחק של קו הבסיס מתחתית המלבן */
export const baselineOffset = (d: TextEditData) => d.original.baseline - d.original.rect.y;

/** המלבן שמכסה את הטקסט המקורי, עם ריפוד קטן (אותיות יוצאות מעט מהמלבן המשוער) */
export function coverRect(d: TextEditData): Rect {
  const r = d.original.rect;
  const pad = Math.max(0.5, d.size * 0.06);
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

/**
 * הגופן לכתיבה: המוטמע מהקובץ (או סטנדרטי כמו Helvetica) – רק אם יש בו את כל האותיות של הטקסט.
 * אחרת כל השורה בגופן ברירת המחדל: שורה בשני גופנים נקראת ב-pdf.js כמה פריטים נפרדים, וחיפוש והעתקה נשברים.
 */
export async function fontsFor(
  d: TextEditData,
  ctx: Pick<ExportCtx, 'pdf' | 'font' | 'embedFontBytes'>,
): Promise<{ font: PDFFont; fallbacks?: PDFFont[] }> {
  const fallback = await ctx.font(d.bold ? 'default-bold' : 'default');
  const keys = [d.fontKey, ...(d.fontKeys ?? [])].filter((k): k is string => !!k);
  const chain: PDFFont[] = [];
  for (const k of keys) {
    const f = await pdfFont(k, ctx);
    if (f) chain.push(f);
  }
  // שורה מעורבת: כל אות בגופן הראשון בשורה שיש בו אותה – כמו במקור
  const covered = (ch: string) => ch.codePointAt(0)! <= 32 || chain.some((f) => !missingChars(f, ch).length);
  if (!chain.length || ![...d.text].every(covered)) return { font: fallback };
  return chain.length > 1 ? { font: chain[0], fallbacks: chain.slice(1) } : { font: chain[0] };
}

/** גופן מהמאגר ← גופן ב-pdf-lib: המוטמע (ממופה), או סטנדרטי כמו Helvetica, או null */
async function pdfFont(key: string, ctx: Pick<ExportCtx, 'pdf' | 'embedFontBytes'>): Promise<PDFFont | null> {
  const ef = getFont(key);
  if (ef?.data) {
    try {
      return remapFont(await ctx.embedFontBytes('pdf:' + ef.key, ef.data), ef.map, ef.spaceWidth);
    } catch (err) {
      console.warn('לא ניתן להטמיע את הגופן מהקובץ', ef.ps, err);
      return null;
    }
  }
  const std = ef && standardFontName(ef);
  return std ? standard(ctx.pdf, std) : null;
}

const standards = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();
/** אחד מ-14 הגופנים הסטנדרטיים (לא מוטמע, אין בו עברית – לכן תמיד עם fallback) */
function standard(pdf: PDFDocument, name: string) {
  let m = standards.get(pdf);
  if (!m) standards.set(pdf, (m = new Map()));
  let f = m.get(name);
  if (!f) m.set(name, (f = pdf.embedFont(name as StandardFonts)));
  return f;
}

/** הסגנון של השורה לפי הנתונים והגופנים */
export function lineStyle(d: TextEditData, fonts: { font: PDFFont; fallbacks?: PDFFont[] }): LineStyle {
  return {
    ...fonts,
    size: d.size,
    color: d.color,
    dir: d.original.rtl ? 'rtl' : 'ltr',
    skew: d.italic ? ITALIC_SKEW : undefined,
  };
}

export async function exportTextEdit(op: Operation, ctx: ExportCtx) {
  const d = dataOf(op);
  // הטקסט הישן נמחק מזרם התוכן (רק מהזרמים המקוריים של העמוד). הכיסוי נשאר כגיבוי
  if (d.original.origin === 'pdf') {
    try {
      removeTextIn(ctx.pdf.context, ctx.pdfPage, [userSpace(ctx.page, d.original.rect)]);
    } catch (err) {
      console.warn('לא ניתן למחוק את הטקסט המקורי מזרם התוכן', err);
    }
  }
  const c = userSpace(ctx.page, coverRect(d));
  ctx.pdfPage.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: hexColor(d.bg), borderWidth: 0 });
  if (!d.text.trim()) return;
  const style = lineStyle(d, await fontsFor(d, ctx));
  const r = userSpace(ctx.page, op.rect);
  const y = r.y + baselineOffset(d);
  // יישור כמו במקור: עברית לימין, אנגלית לשמאל
  if (d.original.rtl) drawLine(ctx.pdfPage, d.text, r.x + r.w, y, style, 'right');
  else drawLine(ctx.pdfPage, d.text, r.x, y, style, 'left');
}

/** הרוחב שהטקסט יתפוס ב-PDF (בנקודות) */
export async function textWidth(d: TextEditData, ctx: Pick<ExportCtx, 'pdf' | 'font' | 'embedFontBytes'>) {
  return lineWidth(d.text, lineStyle(d, await fontsFor(d, ctx)));
}
