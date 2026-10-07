/**
 * מחיקה אמיתית של טקסט מזרם התוכן של עמוד: כל אות שהמרכז שלה וקו הבסיס שלה בתוך אחד המלבנים
 * מוחלפת בהזזה ריקה באותו רוחב (מספר ב-TJ). כך שאר האותיות באותה פקודה, ושאר הטקסט בעמוד, נשארים במקומם.
 *
 * - רק זרמי התוכן המקוריים של העמוד: מה ש-pdf-lib (או כלים אחרים) ציירו בייצוא הזה לא נוגעים בו.
 *   pdf-lib עוטף את המקוריים ב-q … Q (getPushGraphicsStateContentStream), וכל מה שנוסף בא אחרי ה-Q.
 * - זרם שהשתנה נכתב כאובייקט חדש (זרם יכול להיות משותף לכמה עמודים).
 * - Form XObject (פקודת Do): נכנסים פנימה; אם השתנה – עותק חדש בשם חדש במשאבים של העמוד.
 * - גופן שלא מצליחים לקרוא את הרוחבים שלו: רוחב משוער, ואם אין אפילו גופן – לא מוחקים בפקודה הזאת.
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  StandardFontEmbedder,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import type { Rect } from '../../core/types';
import { parseContent, type Operand } from './content-lexer';

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
/** A×B, בסימון של PDF (וקטור שורה) */
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

interface FontInfo {
  /** 1 – גופן פשוט, 2 – Type0 (CID) */
  bytes: 1 | 2;
  /** רוחב לפי קוד, ביחידות של 1/1000 em */
  width(code: number): number;
  vertical: boolean;
}

interface TextState {
  ctm: M;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  rise: number;
  font: FontInfo | null;
  size: number;
}

const name = (s: string) => PDFName.of(s);

export class TextRemover {
  private fonts = new Map<PDFDict, FontInfo>();
  removed = 0;

  constructor(
    private context: PDFContext,
    /** מלבנים במערכת של העמוד (userSpace) */
    private rects: Rect[],
  ) {}

  /** מוחק מהעמוד. מחזיר את מספר האותיות שנמחקו */
  run(page: PDFPage): number {
    const { Resources } = page.node.normalizedEntries();
    // Contents יכול להיות זרם אחד (גם אחרי normalize, אם מישהו הציב זרם אחרי שהעמוד נוצר)
    const raw = page.node.get(name('Contents'));
    let Contents = raw && this.context.lookup(raw);
    if (Contents instanceof PDFStream && raw) {
      Contents = this.context.obj([raw]);
      page.node.set(name('Contents'), Contents);
    }
    if (!(Contents instanceof PDFArray)) return 0;
    const refs = Contents.asArray();
    const push = this.context.getPushGraphicsStateContentStream();
    const pop = this.context.getPopGraphicsStateContentStream();
    const a = refs.findIndex((r) => r === push);
    const z = refs.lastIndexOf(pop);
    const from = a >= 0 && z > a ? a + 1 : 0;
    const to = a >= 0 && z > a ? z : refs.length;
    // מצב גרפי משותף לכל הזרמים של העמוד (הם המשך אחד של אותו תוכן)
    const st: TextState = { ctm: I, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, font: null, size: 0 };
    const stack: TextState[] = [];
    const text = { tm: I, tlm: I };
    for (let k = from; k < to; k++) {
      const ref = refs[k];
      const stream = this.context.lookup(ref);
      if (!(stream instanceof PDFStream)) continue;
      const bytes = decode(stream);
      if (!bytes) continue;
      const out = this.process(bytes, Resources, st, stack, text, 0);
      if (out) Contents.set(k, this.context.register(this.context.flateStream(out)));
    }
    return this.removed;
  }

  /** מעבר על זרם אחד. מחזיר את הבתים החדשים אם משהו השתנה, אחרת null */
  private process(
    bytes: Uint8Array,
    res: PDFDict | undefined,
    st: TextState,
    stack: TextState[],
    text: { tm: M; tlm: M },
    depth: number,
  ): Uint8Array | null {
    const edits: { start: number; end: number; text: string }[] = [];
    const num = (o: Operand | undefined) => (o?.t === 'num' ? o.v : 0);
    const td = (x: number, y: number) => {
      text.tlm = mul([1, 0, 0, 1, x, y], text.tlm);
      text.tm = text.tlm;
    };
    for (const op of parseContent(bytes)) {
      const a = op.args;
      switch (op.op) {
        case 'q':
          stack.push({ ...st });
          break;
        case 'Q':
          Object.assign(st, stack.pop() ?? st);
          break;
        case 'cm':
          if (a.length === 6) st.ctm = mul(a.map(num) as M, st.ctm);
          break;
        case 'BT':
          text.tm = text.tlm = I;
          break;
        case 'Tc':
          st.tc = num(a[0]);
          break;
        case 'Tw':
          st.tw = num(a[0]);
          break;
        case 'Tz':
          st.th = num(a[0]) / 100;
          break;
        case 'TL':
          st.tl = num(a[0]);
          break;
        case 'Ts':
          st.rise = num(a[0]);
          break;
        case 'Tf':
          st.font = a[0]?.t === 'name' ? this.font(res, a[0].v) : null;
          st.size = num(a[1]);
          break;
        case 'Td':
          td(num(a[0]), num(a[1]));
          break;
        case 'TD':
          st.tl = -num(a[1]);
          td(num(a[0]), num(a[1]));
          break;
        case 'Tm':
          if (a.length === 6) text.tm = text.tlm = a.map(num) as M;
          break;
        case 'T*':
          td(0, -st.tl);
          break;
        case 'Tj':
        case 'TJ':
        case "'":
        case '"': {
          let prefix = '';
          let items: Operand[];
          if (op.op === "'") {
            td(0, -st.tl);
            prefix = 'T* ';
            items = a.slice(0, 1);
          } else if (op.op === '"') {
            st.tw = num(a[0]);
            st.tc = num(a[1]);
            td(0, -st.tl);
            prefix = `${fmt(st.tw)} Tw ${fmt(st.tc)} Tc T* `;
            items = a.slice(2, 3);
          } else items = op.op === 'TJ' && a[0]?.t === 'arr' ? a[0].v : a.slice(0, 1);
          const out = this.show(items, st, text);
          if (out) edits.push({ start: op.start, end: op.end, text: prefix + out + ' TJ' });
          break;
        }
        case 'Do': {
          if (a[0]?.t !== 'name' || depth > 8) break;
          const renamed = this.form(res, a[0].v, st, depth);
          if (renamed) edits.push({ start: op.start, end: op.end, text: `/${renamed} Do` });
          break;
        }
      }
    }
    return edits.length ? splice(bytes, edits) : null;
  }

  /**
   * פקודת הצגת טקסט: מתקדם אות אחרי אות, ומחליף אותיות שבתוך המלבנים בהזזה באותו רוחב.
   * מחזיר את המערך החדש ל-TJ, או null אם לא נמחק כלום.
   */
  private show(items: Operand[], st: TextState, text: { tm: M }): string | null {
    const f = st.font;
    const fs = st.size;
    const out: (string | number)[] = [];
    let changed = false;
    for (const it of items) {
      if (it.t === 'num') {
        text.tm = mul([1, 0, 0, 1, (-it.v / 1000) * fs * st.th, 0], text.tm);
        out.push(it.v);
        continue;
      }
      if (it.t !== 'str') continue;
      const bytes = f?.bytes ?? 1;
      let keep: number[] = [];
      const flush = () => {
        if (keep.length) out.push(hexOf(keep, bytes));
        keep = [];
      };
      for (let k = 0; k + bytes <= it.v.length; k += bytes) {
        const code = bytes === 2 ? (it.v[k] << 8) | it.v[k + 1] : it.v[k];
        const w = (f ? f.width(code) : 500) / 1000;
        const space = bytes === 1 && code === 32 ? st.tw : 0;
        const adv = (w * fs + st.tc + space) * st.th;
        const trm = mul(text.tm, st.ctm);
        // רק טקסט אופקי בגופן ידוע
        const horizontal = Math.abs(trm[1]) < Math.abs(trm[0]) * 0.05 && !f?.vertical;
        if (f && fs && horizontal && this.inside(trm, (w * fs * st.th) / 2, st.rise)) {
          flush();
          out.push(-(adv / (fs * st.th)) * 1000);
          changed = true;
          this.removed++;
        } else keep.push(code);
        text.tm = mul([1, 0, 0, 1, adv, 0], text.tm);
      }
      flush();
    }
    if (!changed) return null;
    // מספרים צמודים מתאחדים
    const merged: (string | number)[] = [];
    for (const x of out) {
      const last = merged[merged.length - 1];
      if (typeof x === 'number' && typeof last === 'number') merged[merged.length - 1] = last + x;
      else merged.push(x);
    }
    return '[' + merged.map((x) => (typeof x === 'number' ? fmt(x) : x)).join(' ') + ']';
  }

  /** מרכז האות על קו הבסיס – בתוך אחד המלבנים? m: Tm×CTM, cx: חצי רוחב האות ביחידות של מרחב הטקסט */
  private inside(m: M, cx: number, rise: number) {
    const c = apply(m, cx, rise);
    return this.rects.some((r) => c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h);
  }

  /** Form XObject: מעבר על התוכן שלו. אם השתנה – עותק חדש במשאבים, ומחזיר את השם החדש */
  private form(res: PDFDict | undefined, xname: string, st: TextState, depth: number): string | null {
    const xobjects = res?.lookupMaybe(name('XObject'), PDFDict);
    const ref = xobjects?.get(name(xname));
    const stream = ref && this.context.lookup(ref);
    if (!xobjects || !(stream instanceof PDFStream)) return null;
    if (stream.dict.lookupMaybe(name('Subtype'), PDFName)?.asString() !== '/Form') return null;
    const bytes = decode(stream);
    if (!bytes) return null;
    const matrix = stream.dict.lookupMaybe(name('Matrix'), PDFArray);
    const m = matrix ? (matrix.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) as M) : I;
    const inner: TextState = { ...st, ctm: mul(m, st.ctm) };
    const formRes = stream.dict.lookupMaybe(name('Resources'), PDFDict) ?? res;
    const out = this.process(bytes, formRes, inner, [], { tm: I, tlm: I }, depth + 1);
    if (!out) return null;
    const dict = stream.dict.clone(this.context);
    dict.delete(name('Filter'));
    dict.delete(name('DecodeParms'));
    dict.delete(name('Length'));
    const copy = this.context.flateStream(out, {});
    for (const [k, v] of dict.entries()) copy.dict.set(k, v);
    let n = 1;
    while (xobjects.has(name(`${xname}_te${n}`))) n++;
    const renamed = `${xname}_te${n}`;
    xobjects.set(name(renamed), this.context.register(copy));
    return renamed;
  }

  private font(res: PDFDict | undefined, fname: string): FontInfo | null {
    const dict = res?.lookupMaybe(name('Font'), PDFDict)?.lookupMaybe(name(fname), PDFDict);
    if (!dict) return null;
    let f = this.fonts.get(dict);
    if (!f) this.fonts.set(dict, (f = fontInfo(this.context, dict)));
    return f;
  }
}

/** הרוחבים של גופן מהמילון שלו (Widths / W), או מהמדדים של 14 הגופנים הסטנדרטיים */
function fontInfo(ctx: PDFContext, dict: PDFDict): FontInfo {
  const look = (d: PDFDict | undefined, k: string): PDFObject | undefined =>
    d ? ctx.lookup(d.get(name(k))) : undefined;
  const numOf = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);
  const subtype = (look(dict, 'Subtype') as PDFName | undefined)?.asString();

  if (subtype === '/Type0') {
    const enc = look(dict, 'Encoding');
    const vertical = enc instanceof PDFName && /-V$/.test(enc.asString());
    const desc = (look(dict, 'DescendantFonts') as PDFArray | undefined)?.lookup(0, PDFDict);
    const dw = numOf(look(desc, 'DW')) ?? 1000;
    const widths = new Map<number, number>();
    const W = look(desc, 'W');
    if (W instanceof PDFArray) {
      const arr = W.asArray().map((x) => ctx.lookup(x));
      for (let k = 0; k < arr.length;) {
        const first = numOf(arr[k]) ?? 0;
        const next = arr[k + 1];
        if (next instanceof PDFArray) {
          next.asArray().forEach((w, j) => widths.set(first + j, numOf(ctx.lookup(w)) ?? dw));
          k += 2;
        } else {
          const last = numOf(next) ?? first;
          const w = numOf(arr[k + 2]) ?? dw;
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, w);
          k += 3;
        }
      }
    }
    return { bytes: 2, vertical, width: (c) => widths.get(c) ?? dw };
  }

  // גופן פשוט (Type1, TrueType, Type3): קוד של בית אחד
  const first = numOf(look(dict, 'FirstChar')) ?? 0;
  const W = look(dict, 'Widths');
  const widths = W instanceof PDFArray ? W.asArray().map((x) => numOf(ctx.lookup(x)) ?? 0) : null;
  const missing = numOf(look(look(dict, 'FontDescriptor') as PDFDict | undefined, 'MissingWidth')) ?? 0;
  // Type3: הרוחבים ביחידות של FontMatrix
  const fm = look(dict, 'FontMatrix');
  const scale = subtype === '/Type3' && fm instanceof PDFArray ? (numOf(ctx.lookup(fm.get(0))) ?? 0.001) * 1000 : 1;
  const std = widths ? null : standardWidths((look(dict, 'BaseFont') as PDFName | undefined)?.asString() ?? '');
  return {
    bytes: 1,
    vertical: false,
    width: (c) => {
      const w = widths?.[c - first];
      if (w != null) return w * scale;
      return std?.get(c) ?? (missing || 500);
    },
  };
}

const stdCache = new Map<string, Map<number, number> | null>();
/** קוד (WinAnsi) ← רוחב, לגופן סטנדרטי בלי Widths (כמו ש-pdf-lib כותב Helvetica) */
function standardWidths(base: string): Map<number, number> | null {
  const ps = base.replace(/^\/?([A-Z]{6}\+)?/, '').replace(/[\s_,]/g, '');
  const bold = /bold|black|heavy/i.test(ps);
  const italic = /italic|oblique/i.test(ps);
  const pick = (b: string, i: string, bi: string, p: string) => (bold && italic ? bi : bold ? b : italic ? i : p);
  const std = /^(Helvetica|Arial)/i.test(ps)
    ? pick('Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Helvetica')
    : /^Times/i.test(ps)
      ? pick('Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Times-Roman')
      : /^Courier/i.test(ps)
        ? pick('Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Courier')
        : /^(Symbol|ZapfDingbats)$/.test(ps)
          ? ps
          : null;
  if (!std) return null;
  let m = stdCache.get(std);
  if (m === undefined) {
    const e = StandardFontEmbedder.for(std as Parameters<typeof StandardFontEmbedder.for>[0]);
    m = new Map();
    for (const cp of e.encoding.supportedCodePoints) {
      const g = e.encoding.encodeUnicodeCodePoint(cp);
      const w = e.font.getWidthOfGlyph(g.name);
      if (typeof w === 'number') m.set(g.code, w);
    }
    stdCache.set(std, m);
  }
  return m;
}

/** הבתים המפוענחים של זרם, או null אם המסנן לא נתמך */
function decode(stream: PDFStream): Uint8Array | null {
  try {
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    // זרם שנוצר בזיכרון (PDFContentStream, למשל טופס של embedPdf): getContents מחזיר אותו מכווץ
    const s = stream as PDFStream & { getUnencodedContents?: () => Uint8Array };
    return s.getUnencodedContents ? s.getUnencodedContents() : stream.getContents();
  } catch {
    return null;
  }
}

const hexOf = (codes: number[], bytes: 1 | 2) =>
  '<' + codes.map((c) => c.toString(16).padStart(bytes * 2, '0')).join('') + '>';

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** החלפת טווחים בזרם, והשארת כל השאר כמו שהוא */
function splice(bytes: Uint8Array, edits: { start: number; end: number; text: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const e of edits.sort((x, y) => x.start - y.start)) {
    parts.push(bytes.subarray(at, e.start), latin1(e.text));
    at = e.end;
  }
  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** מוחק את הטקסט שבמלבנים (במערכת של העמוד, userSpace) מזרמי התוכן המקוריים של העמוד */
export function removeTextIn(context: PDFContext, page: PDFPage, rects: Rect[]): number {
  return new TextRemover(context, rects).run(page);
}
