/**
 * כתיבת טקסט (עברית, אנגלית ומעורב) לעמוד ב-pdf-lib.
 * pdf-lib כותבת את התווים בסדר שמקבלים, משמאל לימין – לכן מסדרים כל שורה בסדר תצוגה (bidi) לפני הכתיבה.
 * הבעלים: סשן A (עריכת טקסט). כלים אחרים משתמשים בפונקציות האלה ולא מעתיקים אותן.
 */

import bidiFactory from 'bidi-js';
import { degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
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

/** גופן עם מפה מאות לקוד בגופן (remapFont) – getCharacterSet שלו מחזיר את הקודים הפנימיים, לא אותיות */
interface Remap {
  map: Record<string, string>;
  /** רוחב הרווח (ביחידות 1/1000 em), כשאין לגופן צורה לרווח */
  spaceWidth?: number;
}
const remaps = new WeakMap<PDFFont, Remap>();
const charsets = new WeakMap<PDFFont, Set<number>>();

/** האם יש בגופן צורה לתו */
export function hasChar(font: PDFFont, ch: string): boolean {
  const r = remaps.get(font);
  if (r) return ch in r.map;
  let set = charsets.get(font);
  if (!set) charsets.set(font, (set = new Set(font.getCharacterSet())));
  return set.has(ch.codePointAt(0)!);
}

/** תווים בטקסט שאין להם צורה בגופן */
export function missingChars(font: PDFFont, text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) if (ch.codePointAt(0)! > 32 && !hasChar(font, ch)) out.add(ch);
  return [...out];
}

/**
 * גופן מוטמע שמגיע מ-pdf.js: pdf.js ממיר כל גופן לקובץ שבו כל אות יושבת בקוד פרטי (PUA),
 * ולכן כותבים בו דרך מפה מהאות האמיתית לקוד. ב-ToUnicode נשמרת האות האמיתית, כדי שחיפוש והעתקה יעבדו.
 * הרווח בגופנים האלה הוא בדרך כלל ‎.notdef (ריבוע) – לכן spaceWidth, ו-drawLine משאיר במקומו רווח ריק.
 */
export function remapFont(font: PDFFont, map: Record<string, string>, spaceWidth?: number): PDFFont {
  if (remaps.has(font)) return font;
  type Glyph = { codePoints: number[] };
  type Layout = (s: string, f?: unknown, script?: unknown, lang?: unknown, dir?: string) => { glyphs: Glyph[] };
  const fk = (font as unknown as { embedder?: { font?: { layout?: Layout } } }).embedder?.font;
  if (!fk?.layout) return font;
  const layout = fk.layout.bind(fk);
  fk.layout = (s, f) => {
    const chars = [...s];
    const run = layout(chars.map((c) => map[c] ?? c).join(''), f, undefined, undefined, 'ltr');
    // אות אחת ← צורה אחת (אין ליגטורות בגופנים של pdf.js), לכן אפשר להחזיר לכל צורה את האות שלה
    if (run.glyphs.length === chars.length) run.glyphs.forEach((g, i) => (g.codePoints = [chars[i].codePointAt(0)!]));
    return run;
  };
  remaps.set(font, { map, spaceWidth });
  return font;
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
  /** גופן לאותיות שאין ב-font (למשל גופן מוטמע חלקי) */
  fallback?: PDFFont;
  /**
   * גופנים נוספים לפי סדר, לפני fallback: כל אות נכתבת בגופן הראשון שיש בו אותה
   * (שורה מעורבת מ-Word – עברית ב-David ואנגלית ב-Arial)
   */
  fallbacks?: PDFFont[];
  /** הטיה במעלות (נטוי בגופן שאין לו גרסה נטויה) */
  skew?: number;
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
  const a = physical(align, rtl);
  const color = hexColor(style.color);
  const xSkew = style.skew ? degrees(style.skew) : undefined;
  if (simple(style)) {
    const w = measure(visual, style.font, style.size);
    const left = a === 'left' ? x : a === 'right' ? x - w : x - w / 2;
    page.drawText(visual, { x: left, y, size: style.size, font: style.font, color, opacity: style.opacity, xSkew });
    return w;
  }
  // כמה קטעים, כל אחד בגופן שיש בו את האותיות שלו. pdf.js מחבר אותם בחזרה לשורה אחת
  const runs = splitRuns(visual, style);
  const w = runs.reduce((s, r) => s + r.w, 0);
  let left = a === 'left' ? x : a === 'right' ? x - w : x - w / 2;
  for (const r of runs) {
    if (r.font)
      page.drawText(r.s, { x: left, y, size: style.size, font: r.font, color, opacity: style.opacity, xSkew });
    left += r.w;
  }
  return w;
}

/** רוחב שורה (בסדר לוגי) כפי ש-drawLine יכתוב אותה */
export function lineWidth(text: string, style: LineStyle): number {
  const visual = visualOrder(text, style.dir);
  if (simple(style)) return measure(visual, style.font, style.size);
  return splitRuns(visual, style).reduce((s, r) => s + r.w, 0);
}

/** גופן אחד שיש לו צורה לכל תו – כתיבה בפקודה אחת */
const simple = (style: LineStyle) => !style.fallback && !style.fallbacks?.length && !remaps.has(style.font);

/** רוחב רווח בגופן: הצורה שלו, או spaceWidth בגופן ממופה שאין לו צורה לרווח */
function spaceOf(f: PDFFont, size: number): number | null {
  const r = remaps.get(f);
  if (r) return r.spaceWidth != null ? (r.spaceWidth / 1000) * size : null;
  return hasChar(f, ' ') ? measure(' ', f, size) : null;
}

/**
 * שורה בסדר תצוגה ← קטעים לפי הגופן: כל אות בגופן הראשון ברשימה שיש בו אותה.
 * רווח נשאר בגופן של הקטע שלפניו אם יש בו רווח; אחרת רווח ריק (font=null) ברוחב הרווח של הגופן הזה.
 */
function splitRuns(visual: string, style: LineStyle) {
  const { font, size } = style;
  const chain = [font, ...(style.fallbacks ?? []), ...(style.fallback ? [style.fallback] : [])];
  const runs: { font: PDFFont | null; s: string; w: number }[] = [];
  for (const ch of visual) {
    const last = runs[runs.length - 1];
    let f: PDFFont | null;
    let w = 0;
    if (/\s/.test(ch)) {
      const near = last?.font ?? font;
      if (!remaps.has(near) && hasChar(near, ch)) f = near;
      else {
        f = null;
        w = spaceOf(near, size) ?? chain.map((c) => spaceOf(c, size)).find((x) => x != null) ?? size / 4;
      }
    } else f = chain.find((c) => hasChar(c, ch)) ?? style.fallback ?? font;
    if (last && last.font === f) {
      last.s += ch;
      last.w += w;
    } else runs.push({ font: f, s: ch, w });
  }
  for (const r of runs) if (r.font) r.w = measure(r.s, r.font, size);
  return runs;
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
