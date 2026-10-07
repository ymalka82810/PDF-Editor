/**
 * כתיבת טקסט (עברית, אנגלית ומעורב) לעמוד ב-pdf-lib.
 * pdf-lib כותבת את התווים בסדר שמקבלים, משמאל לימין – לכן מסדרים כל שורה בסדר תצוגה (bidi) לפני הכתיבה.
 * הבעלים: סשן A (עריכת טקסט). כלים אחרים משתמשים בפונקציות האלה ולא מעתיקים אותן.
 */

import bidiFactory from 'bidi-js';
import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Rect } from './types';

const bidi = bidiFactory();

export type Dir = 'rtl' | 'ltr' | 'auto';
export type Align = 'left' | 'right' | 'center' | 'start' | 'end';

const RTL_CHAR = /[\u0590-\u05FF\u0600-\u06FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const STRONG = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** כיוון לפי התו החזק הראשון */
export function isRtl(text: string): boolean {
  const m = STRONG.exec(text);
  return !!m && RTL_CHAR.test(m[0]);
}

/** שורה אחת בסדר לוגי ← בסדר תצוגה (משמאל לימין), עם היפוך סוגריים */
export function visualOrder(line: string, dir: Dir = 'auto'): string {
  if (!RTL_CHAR.test(line)) return line;
  const base = dir === 'auto' ? (isRtl(line) ? 'rtl' : 'ltr') : dir;
  const levels = bidi.getEmbeddingLevels(line, base);
  return bidi.getReorderedString(line, levels);
}

/** תווים בטקסט שאין להם צורה בגופן */
export function missingChars(font: PDFFont, text: string): string[] {
  const set = new Set(font.getCharacterSet());
  const out = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 32 && !set.has(cp)) out.add(ch);
  }
  return [...out];
}

export function measure(text: string, font: PDFFont, size: number) {
  return font.widthOfTextAtSize(text, size);
}

/** '#rrggbb' ← צבע של pdf-lib */
export function hexColor(hex = '#000000') {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

export interface LineStyle {
  font: PDFFont;
  size: number;
  color?: string;
  opacity?: number;
  dir?: Dir;
}

/** יישור start/end לפי הכיוון ← left/right */
function physical(align: Align, rtl: boolean): 'left' | 'right' | 'center' {
  if (align === 'start') return rtl ? 'right' : 'left';
  if (align === 'end') return rtl ? 'left' : 'right';
  return align;
}

/**
 * כתיבת שורה אחת. x הוא נקודת העיגון לפי align (שמאל/ימין/מרכז השורה), y – קו הבסיס.
 * הקואורדינטות כבר במערכת של pdf-lib לעמוד (userSpace ב-coords.ts).
 */
export function drawLine(page: PDFPage, text: string, x: number, y: number, style: LineStyle, align: Align = 'start') {
  const rtl = style.dir === 'rtl' || (style.dir !== 'ltr' && isRtl(text));
  const visual = visualOrder(text, style.dir);
  const w = measure(visual, style.font, style.size);
  const a = physical(align, rtl);
  const left = a === 'left' ? x : a === 'right' ? x - w : x - w / 2;
  page.drawText(visual, { x: left, y, size: style.size, font: style.font, color: hexColor(style.color), opacity: style.opacity });
  return w;
}

/** שבירת טקסט לשורות לפי רוחב (בסדר לוגי). ירידות שורה בטקסט נשמרות */
export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const part of words) {
      const next = line + part;
      if (line.trim() && measure(next.trimEnd(), font, size) > maxWidth) {
        out.push(line.trimEnd());
        line = part.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface BoxStyle extends LineStyle {
  align?: Align;
  /** גובה שורה כמכפלה של size, ברירת מחדל 1.25 */
  lineHeight?: number;
  /** false – בלי שבירה לפי רוחב */
  wrap?: boolean;
}

/** כתיבת טקסט בכמה שורות בתוך מלבן (מלמעלה למטה). rect במערכת של pdf-lib */
export function drawTextBox(page: PDFPage, text: string, rect: Rect, style: BoxStyle) {
  const lh = style.size * (style.lineHeight ?? 1.25);
  const lines = style.wrap === false ? text.split(/\r?\n/) : wrapLines(text, style.font, style.size, rect.w);
  const ascent = style.font.heightAtSize(style.size, { descender: false });
  let y = rect.y + rect.h - ascent;
  const align = style.align ?? 'start';
  for (const line of lines) {
    const rtl = style.dir === 'rtl' || (style.dir !== 'ltr' && isRtl(line || text));
    const a = physical(align, rtl);
    const x = a === 'left' ? rect.x : a === 'right' ? rect.x + rect.w : rect.x + rect.w / 2;
    if (line) drawLine(page, line, x, y, { ...style, dir: rtl ? 'rtl' : 'ltr' }, a);
    y -= lh;
  }
}

/**
 * fontkit (בתוך pdf-lib) מזהה כיוון לפי התו החזק הראשון, ואם הוא עברי – הופך את סדר האותיות בעצמו.
 * אנחנו כבר מעבירים טקסט בסדר תצוגה, לכן מכריחים ltr בכל גופן מוטמע. חובה אחרי כל embedFont.
 * (embedder הוא שדה פנימי של PDFFont; בגופנים הסטנדרטיים אין לו font ואין מה לתקן)
 */
export function forceLtrLayout(font: PDFFont): PDFFont {
  type Layout = (s: string, f?: unknown, script?: unknown, lang?: unknown, dir?: string) => unknown;
  const fk = (font as unknown as { embedder?: { font?: { layout?: Layout; __ltr?: boolean } } }).embedder?.font;
  if (fk?.layout && !fk.__ltr) {
    const layout = fk.layout.bind(fk);
    fk.layout = (s, f) => layout(s, f, undefined, undefined, 'ltr');
    fk.__ltr = true;
  }
  return font;
}
