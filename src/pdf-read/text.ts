/**
 * פריטי הטקסט של עמוד (TextItem ב-core/types.ts): מ-pdf.js, ובנוסף פריטים שמקור אחר הזין (OCR של סשן D).
 * המיקומים בנקודות PDF יחסית לפינת ה-CropBox, לפני סיבוב – כמו כל rect במודל.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { EditorApi } from '../core/registry';
import type { PageRef, TextItem } from '../core/types';
import { readPageFonts } from './fonts';

type Api = Pick<EditorApi, 'pdfjsDoc'>;

interface RawItem {
  str: string;
  dir?: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
  hasEOL?: boolean;
}

interface Style {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
}

const cache = new Map<string, Promise<TextItem[]>>();
/** פריטים ממקורות אחרים: pageId ← (שם המקור ← פריטים) */
const external = new Map<string, Map<string, TextItem[]>>();
const listeners = new Set<(pageId: string) => void>();

const pageKey = (p: PageRef) => p.id + '|' + p.sourceId + '|' + p.sourceIndex;

/** פריטי הטקסט של עמוד מ-pdf.js (עם cache). עמוד ריק – [] */
export function readText(api: Api, page: PageRef): Promise<TextItem[]> {
  if (!page.sourceId) return Promise.resolve([]);
  const key = pageKey(page);
  let p = cache.get(key);
  if (!p) {
    p = api.pdfjsDoc(page.sourceId).then((doc) => extract(doc, page));
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** כל פריטי הטקסט של עמוד: מ-pdf.js ומהמקורות שנרשמו (OCR) */
export async function textItemsOf(api: Api, page: PageRef): Promise<TextItem[]> {
  const extra = [...(external.get(page.id)?.values() ?? [])].flat();
  return [...(await readText(api, page)), ...extra];
}

/**
 * הזנת פריטי טקסט ממקור אחר (למשל OCR) לעמוד. source – שם המקור; קריאה חוזרת מחליפה את הפריטים שלו.
 * items=[] מנקה. כלי העריכה מתעדכן לבד (onTextItems).
 */
export function registerTextSource(pageId: string, source: string, items: TextItem[]) {
  let m = external.get(pageId);
  if (!m) external.set(pageId, (m = new Map()));
  if (items.length)
    m.set(
      source,
      items.map((it) => ({ ...it, pageId })),
    );
  else m.delete(source);
  for (const fn of listeners) fn(pageId);
}

/** האזנה לשינוי בפריטים של עמוד (מקור חיצוני נרשם) */
export function onTextItems(fn: (pageId: string) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** לבדיקות, ובפתיחת מסמך חדש */
export function clearTextCache() {
  cache.clear();
  external.clear();
}

async function extract(doc: PDFDocumentProxy, ref: PageRef): Promise<TextItem[]> {
  const page = await doc.getPage(ref.sourceIndex + 1);
  const [content, fonts] = await Promise.all([
    page.getTextContent(),
    readPageFonts(doc, ref.sourceId!, ref.sourceIndex),
  ]);
  const styles = content.styles as Record<string, Style>;
  const [ox, oy] = page.view;
  const items: TextItem[] = [];
  for (const raw of content.items as RawItem[]) {
    if (!('str' in raw)) continue;
    const str = fixVisualOrder(raw.str.replace(/\s+/g, ' ').trim());
    if (!str) continue;
    const [a, b, c, d, e, f] = raw.transform;
    // רק טקסט אופקי. נטוי מ-Word: האותיות מוטות במטריצה (c≠0) ולא בגופן
    if (Math.abs(b) > Math.abs(a) * 0.05 || styles[raw.fontName]?.vertical) continue;
    const italic = Math.abs(c) > Math.abs(d) * 0.1;
    const size = Math.abs(d);
    if (size < 2 || raw.width <= 0) continue;
    // גובה האותיות לפי הגופן, מוגבל: בגופנים עבריים ascent גבוה מאוד, ומלבן גבוה מדי יכסה את השורה שמעל
    const st = styles[raw.fontName] ?? {};
    const ascent = clamp(st.ascent ?? 0.8, 0.7, 0.95);
    const descent = clamp(-(st.descent ?? -0.2), 0.15, 0.3);
    const font = fonts[raw.fontName];
    const colors = font ? [...font.colors] : [];
    items.push({
      pageId: ref.id,
      str,
      rect: { x: e - ox, y: f - oy - descent * size, w: raw.width, h: (ascent + descent) * size },
      baseline: f - oy,
      size,
      rtl: raw.dir === 'rtl' || /[֐-׿]/.test(str),
      fontName: raw.fontName,
      ...(colors.length === 1 ? { color: colors[0] } : {}),
      ...(italic ? { italic } : {}),
      origin: 'pdf',
    });
  }
  return joinFragments(items);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * איחוד שברים צמודים באותה שורה (Word שומר לפעמים מילה או שעה בכמה פריטים).
 * מאחדים פריטים באותו גופן, גודל וקו בסיס, כשהרווח ביניהם קטן. בשורה מימין לשמאל הפריט השמאלי בא אחרי.
 * הסדר בין הפריטים שלא אוחדו נשמר.
 */
export function joinFragments(items: TextItem[]): TextItem[] {
  const list = items.map((it, i) => ({ it: { ...it, rect: { ...it.rect } }, i, gone: false }));
  const sorted = [...list].sort((p, q) => p.it.baseline - q.it.baseline || p.it.rect.x - q.it.rect.x);
  let run: (typeof list)[number] | null = null;
  for (const cur of sorted) {
    const r = run?.it;
    const it = cur.it;
    if (
      r &&
      it.fontName === r.fontName &&
      Math.abs(it.baseline - r.baseline) < r.size * 0.3 &&
      Math.abs(it.size - r.size) < r.size * 0.1
    ) {
      const gap = it.rect.x - (r.rect.x + r.rect.w);
      if (gap > -r.size * 0.3 && gap < r.size * 0.6) {
        const rtl = r.rtl || it.rtl;
        // רווח רק כשיש רווח גם בדף, ולא אחרי מקף
        const sp =
          gap > r.size * 0.15 && !/[-–־]$/.test(rtl ? it.str : r.str) && !/^[-–־]/.test(rtl ? r.str : it.str)
            ? ' '
            : '';
        r.str = rtl ? it.str + sp + r.str : r.str + sp + it.str;
        r.rect.w = Math.max(r.rect.x + r.rect.w, it.rect.x + it.rect.w) - r.rect.x;
        const top = Math.max(r.rect.y + r.rect.h, it.rect.y + it.rect.h);
        r.rect.y = Math.min(r.rect.y, it.rect.y);
        r.rect.h = top - r.rect.y;
        r.rtl = rtl;
        r.italic = r.italic || it.italic || undefined;
        if (r.color !== it.color) delete r.color;
        run!.i = Math.min(run!.i, cur.i);
        cur.gone = true;
        continue;
      }
    }
    run = cur;
  }
  return list
    .filter((x) => !x.gone)
    .sort((p, q) => p.i - q.i)
    .map((x) => {
      if (!x.it.italic) delete x.it.italic;
      return x.it;
    });
}

/**
 * יש קבצים שבהם העברית שמורה הפוכה (סדר ויזואלי). מזהים לפי אותיות סופיות:
 * בטקסט תקין הן בסוף מילה, בטקסט הפוך – בתחילתה.
 */
export function fixVisualOrder(s: string): string {
  let atStart = 0;
  let atEnd = 0;
  for (const w of s.match(/[א-ת]{2,}/g) ?? []) {
    if (/[ךםןףץ]/.test(w[0])) atStart++;
    if (/[ךםןףץ]/.test(w[w.length - 1])) atEnd++;
  }
  if (atStart <= atEnd) return s;
  return [...s]
    .reverse()
    .join('')
    .replace(/[0-9A-Za-z:./-]+/g, (m) => [...m].reverse().join(''))
    .replace(/[()]/g, (c) => (c === '(' ? ')' : '('));
}
