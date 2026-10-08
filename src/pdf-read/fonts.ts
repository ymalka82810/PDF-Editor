/**
 * הגופנים שמוטמעים בקובץ, כפי ש-pdf.js המיר אותם (fontExtraProperties שומר את הבתים).
 * pdf.js מעביר כל אות בגופן המומר לקוד פרטי (PUA), ולכן לכל גופן נשמרת מפה מהאות האמיתית לקוד –
 * לפי האותיות שמופיעות בעמודים שנקראו. גופן מוטמע הוא בדרך כלל חלקי: יש בו רק האותיות שהיו בקובץ.
 * הגופנים נשמרים במאגר לפי מפתח (fontKey), כי הייצוא (exportOp) לא ניגש ל-pdf.js.
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/** קודי הפעולות של pdf.js שצריך כאן (OPS). לא מייבאים את pdf.js עצמו – הוא נטען רק כשצריך. נבדק מול pdf.js בבדיקות */
export const OPS = {
  save: 10,
  restore: 11,
  setFont: 37,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  setFillRGBColor: 59,
} as const;

export interface EmbeddedFont {
  /** מפתח במאגר: '<sourceId>/<שם הגופן ב-pdf.js>' */
  key: string;
  /** השם הפנימי ב-pdf.js (TextItem.fontName) */
  name: string;
  /** השם המלא מהקובץ, בלי קידומת החלקיות ("ABCDEF+David-Bold" ← "David-Bold") */
  ps: string;
  family: string;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  /** קובץ הגופן המומר, או null – גופן לא מוטמע (למשל Helvetica מ-14 הגופנים הסטנדרטיים) */
  data: Uint8Array | null;
  /** אות ← הקוד שלה בגופן המומר */
  map: Record<string, string>;
  /** רוחב הרווח ביחידות 1/1000 em, אם הופיע רווח בעמוד */
  spaceWidth?: number;
  /** צבעי המילוי שבהם הגופן הופיע בעמודים שנקראו */
  colors: Set<string>;
}

interface Glyph {
  unicode?: string;
  fontChar?: string;
  width?: number;
  isSpace?: boolean;
}

interface FontObj {
  name?: string;
  data?: Uint8Array;
  missingFile?: boolean;
  bold?: boolean;
  italic?: boolean;
  isType3Font?: boolean;
  fallbackName?: string;
}

const fonts = new Map<string, EmbeddedFont>();
/** עמודים שכבר נקראו: '<sourceId>#<index>' */
const read = new Map<string, Promise<Record<string, EmbeddedFont>>>();

export const fontKey = (sourceId: string, name: string) => sourceId + '/' + name;

/** גופן מהמאגר (לייצוא) */
export function getFont(key: string): EmbeddedFont | undefined {
  return fonts.get(key);
}

/** לבדיקות */
export function clearFonts() {
  fonts.clear();
  read.clear();
}

/**
 * הגופנים של עמוד (ומעדכן את המאגר של המקור). pageIndex מ-0.
 * מחזיר שם גופן ב-pdf.js ← הגופן.
 */
export function readPageFonts(doc: PDFDocumentProxy, sourceId: string, pageIndex: number) {
  const id = sourceId + '#' + pageIndex;
  let p = read.get(id);
  if (!p) {
    p = doc.getPage(pageIndex + 1).then((page) => scanPage(page, sourceId));
    read.set(id, p);
    p.catch(() => read.delete(id));
  }
  return p;
}

async function scanPage(page: PDFPageProxy, sourceId: string) {
  const ops = await page.getOperatorList();
  const out: Record<string, EmbeddedFont> = {};
  let cur: EmbeddedFont | null = null;
  let color = '#000000';
  const stack: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(color);
    else if (fn === OPS.restore) color = stack.pop() ?? color;
    else if (fn === OPS.setFillRGBColor && typeof args[0] === 'string') color = args[0];
    else if (fn === OPS.setFont) {
      const name = String(args[0]);
      cur = out[name] ?? (out[name] = fontEntry(page, sourceId, name));
    } else if (
      cur &&
      (fn === OPS.showText ||
        fn === OPS.showSpacedText ||
        fn === OPS.nextLineShowText ||
        fn === OPS.nextLineSetSpacingShowText)
    ) {
      const glyphs = args.find(Array.isArray) as (Glyph | number | null)[] | undefined;
      if (!glyphs) continue;
      cur.colors.add(color);
      for (const g of glyphs) {
        if (!g || typeof g !== 'object' || typeof g.unicode !== 'string') continue;
        // רווח: בגופן המומר הוא בדרך כלל .notdef (ריבוע), ולכן שומרים רק את הרוחב שלו
        if (g.isSpace || /^\s$/.test(g.unicode)) {
          if (g.width) cur.spaceWidth ??= g.width;
          continue;
        }
        if (g.fontChar && [...g.unicode].length === 1 && !(g.unicode in cur.map)) cur.map[g.unicode] = g.fontChar;
      }
    }
  }
  return out;
}

/** הרשומה של גופן במאגר (משותפת לכל העמודים של המקור) */
function fontEntry(page: PDFPageProxy, sourceId: string, name: string): EmbeddedFont {
  const key = fontKey(sourceId, name);
  let f = fonts.get(key);
  if (f) return f;
  let obj: FontObj | null = null;
  try {
    obj = page.commonObjs.get(name) as FontObj;
  } catch {
    /* הגופן לא נטען */
  }
  const raw = String(obj?.name ?? '');
  const ps = raw.replace(/^[A-Z]{6}\+/, '');
  f = {
    key,
    name,
    ps,
    family: familyName(raw),
    bold: !!obj?.bold || /bold|black|heavy/i.test(raw),
    italic: !!obj?.italic || /italic|oblique/i.test(raw),
    serif: obj?.fallbackName === 'serif' || /times|serif|david|frank|narkis/i.test(raw),
    data: obj?.data && !obj.missingFile && !obj.isType3Font ? obj.data : null,
    map: {},
    colors: new Set(),
  };
  fonts.set(key, f);
  return f;
}

/** שם גופן להצגה: "ABCDEF+TimesNewRomanPS-BoldMT" ← "Times New Roman" */
export function familyName(raw: string) {
  const n = raw
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/[-,](Bold|Italic|Regular|Black|Light|Medium|Oblique|Heavy|Semi\w*|Demi\w*)+.*$/i, '')
    .replace(/(PSMT|PS|MT)$/, '')
    .replace(/(Bold|Italic|Regular)+$/i, '');
  return /\s/.test(n) ? n : n.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** האותיות בטקסט שאין בגופן המוטמע (רווחים לא נחשבים). גופן לא מוטמע – כל האותיות חסרות */
export function missingChars(f: EmbeddedFont, text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) if (!/\s/.test(ch) && (!f.data || !(ch in f.map))) out.add(ch);
  return [...out];
}

/** הגופנים הסטנדרטיים (לא מוטמעים) שאפשר לכתוב בהם שוב עם pdf-lib: שם ב-PDF ← שם ב-StandardFonts */
export function standardFontName(f: Pick<EmbeddedFont, 'ps' | 'bold' | 'italic'>): string | null {
  const ps = f.ps.replace(/[\s_]/g, '');
  const style = (bold: string, italic: string, both: string, plain: string) =>
    f.bold && f.italic ? both : f.bold ? bold : f.italic ? italic : plain;
  if (/^(Helvetica|Arial)/i.test(ps))
    return style('Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Helvetica');
  if (/^Times/i.test(ps)) return style('Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Times-Roman');
  if (/^Courier/i.test(ps)) return style('Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Courier');
  return null;
}
