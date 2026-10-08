/**
 * פירוק content stream של PDF לפקודות, עם המיקום של כל פקודה בבתים – כדי שאפשר יהיה להחליף פקודה אחת
 * ולהשאיר את כל השאר בדיוק כמו שהוא. תמונה מוטמעת (BI … ID … EI) מדולגת כיחידה אחת.
 */

export type Operand =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; v: Uint8Array }
  | { t: 'arr'; v: Operand[] }
  | { t: 'other' };

export interface Op {
  op: string;
  args: Operand[];
  /** טווח הבתים של הפקודה כולל האופרנדים: [start, end) */
  start: number;
  end: number;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)));
const isRegular = (b: number) => !WS.has(b) && !DELIM.has(b);

export function parseContent(b: Uint8Array): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let args: Operand[] = [];
  let argStart = -1;

  const skipWs = () => {
    while (i < b.length) {
      if (WS.has(b[i])) i++;
      else if (b[i] === 37 /* % */) while (i < b.length && b[i] !== 10 && b[i] !== 13) i++;
      else break;
    }
  };

  /** אופרנד אחד, או מילה (פקודה / true / false / null) כ-string */
  function token(): Operand | string | null {
    skipWs();
    if (i >= b.length) return null;
    const c = b[i];
    if (c === 40 /* ( */) return { t: 'str', v: literal() };
    if (c === 60 /* < */) {
      if (b[i + 1] === 60) {
        skipDict();
        return { t: 'other' };
      }
      return { t: 'str', v: hex() };
    }
    if (c === 91 /* [ */) {
      i++;
      const arr: Operand[] = [];
      for (;;) {
        skipWs();
        if (i >= b.length) break;
        if (b[i] === 93 /* ] */) {
          i++;
          break;
        }
        const t = token();
        if (t === null) break;
        arr.push(typeof t === 'string' ? { t: 'other' } : t);
      }
      return { t: 'arr', v: arr };
    }
    if (c === 47 /* / */) {
      i++;
      const s = i;
      while (i < b.length && isRegular(b[i])) i++;
      const raw = String.fromCharCode(...b.subarray(s, i));
      return { t: 'name', v: raw.replace(/#([\da-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (DELIM.has(c)) {
      // סוגר בודד (] } >) – לא אמור לקרות; מדלגים
      i++;
      return { t: 'other' };
    }
    const s = i;
    while (i < b.length && isRegular(b[i])) i++;
    const word = String.fromCharCode(...b.subarray(s, i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word) };
    return word;
  }

  function literal(): Uint8Array {
    i++; // (
    const out: number[] = [];
    let depth = 1;
    while (i < b.length) {
      const c = b[i++];
      if (c === 92 /* \ */) {
        const n = b[i++];
        if (n === 110) out.push(10);
        else if (n === 114) out.push(13);
        else if (n === 116) out.push(9);
        else if (n === 98) out.push(8);
        else if (n === 102) out.push(12);
        else if (n === 13) {
          if (b[i] === 10) i++; // המשך שורה
        } else if (n === 10) {
          /* המשך שורה */
        } else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + (b[i++] - 48);
          out.push(v & 0xff);
        } else out.push(n);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return new Uint8Array(out);
  }

  function hex(): Uint8Array {
    i++; // <
    let s = '';
    while (i < b.length && b[i] !== 62) {
      if (!WS.has(b[i])) s += String.fromCharCode(b[i]);
      i++;
    }
    i++; // >
    if (s.length % 2) s += '0';
    const out = new Uint8Array(s.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = parseInt(s.substr(k * 2, 2), 16);
    return out;
  }

  function skipDict() {
    let depth = 0;
    while (i < b.length) {
      if (b[i] === 60 && b[i + 1] === 60) {
        depth++;
        i += 2;
      } else if (b[i] === 62 && b[i + 1] === 62) {
        depth--;
        i += 2;
        if (!depth) return;
      } else if (b[i] === 40) literal();
      else i++;
    }
  }

  /** הנתונים של תמונה מוטמעת: מ-ID עד EI שלפניו ואחריו רווח */
  function skipInlineImage() {
    i++; // תו הרווח שאחרי ID
    while (i < b.length) {
      if (b[i] === 69 && b[i + 1] === 73 && WS.has(b[i - 1]) && (i + 2 >= b.length || WS.has(b[i + 2]))) {
        i += 2;
        return;
      }
      i++;
    }
  }

  for (;;) {
    skipWs();
    if (i >= b.length) break;
    const s = i;
    const t = token();
    if (t === null) break;
    if (argStart < 0) argStart = s;
    if (typeof t !== 'string' || t === 'true' || t === 'false' || t === 'null') {
      args.push(typeof t === 'string' ? { t: 'other' } : t);
      continue;
    }
    if (t === 'BI') {
      // BI <מילון> ID <נתונים> EI – פקודה אחת
      for (;;) {
        skipWs();
        const k = token();
        if (k === null || k === 'ID') break;
      }
      skipInlineImage();
      ops.push({ op: 'BI', args: [], start: argStart, end: i });
    } else ops.push({ op: t, args, start: argStart, end: i });
    args = [];
    argStart = -1;
  }
  return ops;
}
