/**
 * ציור לוח על גבי תבנית מקובץ ישן: כל אזור מכוסה בצבע הרקע שלו,
 * והערך החדש נכתב במקומו בצבע, בגודל ובגופן של הטקסט המקורי.
 * גופן שמוטמע ב-PDF הוא בדרך כלל חלקי: אות שאין בו נכתבת בגופן חלופי.
 */

import { hebDateString } from './hebrew.js';
import { toYmd } from './dates.js';

const FALLBACK = '"Assistant", Arial, sans-serif';
const SERIF_FALLBACK = '"Frank Ruhl Libre", "David Libre", Georgia, serif';
// pdf.js לא תמיד מזהה גופן עם תגים (למשל David מ-Chrome/Word), ותבניות ישנות נשמרו בלי serif – משלימים לפי שם הגופן
const SERIF_NAME = /serif|times|roman|david|frank|narkis|guttman|keter|hadasim|drugulin|koren|taamey|ezra|sbl|cardo|georgia|garamond/i;

/** גופן חלופי לגופן מהקובץ: קודם הגופן עצמו לפי השם (אם מותקן במכשיר), ואחר כך גופן עברי בסגנון דומה – עם תגים או בלי */
function fallbackCss(f) {
  const serif = f.serif || SERIF_NAME.test(f.family || '');
  return (f.family ? '"' + f.family.replace(/"/g, '') + '", ' : '') + (serif ? SERIF_FALLBACK : FALLBACK);
}

/* ---------- ניתוח צבעים (פעם אחת, בשמירת התבנית) ---------- */

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function median(list) {
  const out = [0, 1, 2].map(i => { const v = list.map(p => p[i]).sort((a, b) => a - b); return v[v.length >> 1] || 255; });
  return out;
}

/** צבע רקע, צבע טקסט ועובי, לפי הפיקסלים סביב האזור ובתוכו */
export function analyzeSlot(canvas, box) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pad = 3;
  const x0 = Math.max(0, Math.floor(box.x) - pad), y0 = Math.max(0, Math.floor(box.y) - pad);
  const x1 = Math.min(canvas.width, Math.ceil(box.x + box.w) + pad), y1 = Math.min(canvas.height, Math.ceil(box.y + box.h) + pad);
  if (x1 - x0 < 2 || y1 - y0 < 2) return { bg: '#ffffff', fg: '#000000', bold: false };
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, W = x1 - x0, H = y1 - y0;
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

  const ring = [];
  for (let x = 0; x < W; x++) { ring.push(px(x, 0), px(x, H - 1)); }
  for (let y = 0; y < H; y++) { ring.push(px(0, y), px(W - 1, y)); }
  const bg = median(ring);

  const inside = [];
  for (let y = pad; y < H - pad; y++) for (let x = pad; x < W - pad; x++) inside.push(px(x, y));
  const far = inside.map(p => [dist(p, bg), p]).sort((a, b) => b[0] - a[0]);
  const top = far.slice(0, Math.max(1, Math.floor(far.length * 0.08)));
  const fg = top[0] && top[0][0] > 40 ? [0, 1, 2].map(i => top.reduce((s, x) => s + x[1][i], 0) / top.length) : [0, 0, 0];
  // עובי הקו: אורך חציוני של רצפי דיו אופקיים ביחס לגובה האותיות
  const threshold = dist(fg, bg) * 0.5, runs = [];
  for (let y = pad; y < H - pad; y++) {
    let run = 0;
    for (let x = pad; x < W - pad; x++) {
      if (dist(px(x, y), bg) > threshold) run++;
      else if (run) { runs.push(run); run = 0; }
    }
    if (run) runs.push(run);
  }
  runs.sort((a, b) => a - b);
  const stroke = (runs[runs.length >> 1] || 0) / Math.max(1, H - 2 * pad);
  return { bg: hex(bg), fg: hex(fg), bold: stroke > 0.16, stroke };
}

/**
 * התאמת גובה התיבה לדיו בפועל: המיקום מה-PDF מוערך לפי גודל הגופן, ותיבה גבוהה מדי
 * הייתה מכסה גם חלק מהשורה שמעל או מתחת.
 */
export function refineBox(canvas, box) {
  if (!box.size) return box;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(canvas.width, Math.ceil(box.x + box.w));
  const y0 = Math.max(0, Math.floor(box.baseline - box.size * 1.05)), y1 = Math.min(canvas.height, Math.ceil(box.baseline + box.size * 0.4));
  if (x1 - x0 < 2 || y1 - y0 < 2) return box;
  // קוראים גם מעט מסביב לתיבה, כדי להשלים אות שנחתכה בקצה
  const ext = Math.ceil(box.size * 0.6), xa = Math.max(0, x0 - ext), xb = Math.min(canvas.width, x1 + ext);
  const DW = xb - xa, H = y1 - y0, data = ctx.getImageData(xa, y0, DW, H).data;
  const px = (x, y) => { const i = (y * DW + x - xa) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const bg = median([...Array(x1 - x0).keys()].flatMap(i => [px(x0 + i, 0), px(x0 + i, H - 1)]));
  const inkRow = y => { for (let x = x0; x < x1; x++) if (dist(px(x, y), bg) > 70) return true; return false; };
  // מתחילים מאמצע האותיות ומתרחבים עד שורה ריקה
  let top = Math.min(H - 1, Math.max(0, Math.round(box.baseline - box.size * 0.35) - y0)), bottom = top;
  if (!inkRow(top)) return box;
  while (top > 0 && inkRow(top - 1)) top--;
  while (bottom < H - 1 && inkRow(bottom + 1)) bottom++;
  // "דיו" גבוה בהרבה מהטקסט: הרקע לא אחיד (צבעים, תמונה), ואי אפשר למצוא לפיו את גבולות הטקסט
  if (bottom - top > box.size * 1.5) return box;
  // המיקום האופקי מוערך לפי רוחב תווים, ולפעמים חותך אות: מרחיבים עד עמודה ריקה
  const inkCol = x => { for (let y = top; y <= bottom; y++) if (dist(px(x, y), bg) > 70) return true; return false; };
  let left = x0, right = x1 - 1;
  while (left > xa && inkCol(left)) left--;
  while (right < xb - 1 && inkCol(right)) right++;
  // הגענו עד קצה התחום: זה רקע צבעוני ולא אות שנחתכה
  if (left === xa && xa < x0) left = x0;
  if (right === xb - 1 && xb > x1) right = x1 - 1;
  return { ...box, x: left, w: right - left + 1, y: y0 + top - 2, h: bottom - top + 5 };
}

/**
 * שורות הטקסט שבתוך האזור, לפי הפיקסלים (למסמך סרוק): [{ top, bottom }] מלמעלה למטה.
 * ניקוד או קו דק שנפרדו משורה מצורפים אליה
 */
export function inkLines(canvas, box) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(canvas.width, Math.ceil(box.x + box.w)), y1 = Math.min(canvas.height, Math.ceil(box.y + box.h));
  if (x1 - x0 < 2 || y1 - y0 < 2) return [];
  const W = x1 - x0, H = y1 - y0, data = ctx.getImageData(x0, y0, W, H).data;
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const bg = median([...Array(W).keys()].flatMap(x => [px(x, 0), px(x, H - 1)]));
  // שורה עם דיו: כמה פיקסלים כהים, ולא נקודה בודדת של רעש
  const ink = y => { let n = 0; for (let x = 0; x < W; x++) if (dist(px(x, y), bg) > 70 && ++n > 2) return true; return false; };
  const bands = [];
  for (let y = 0, start = -1; y <= H; y++) {
    const on = y < H && ink(y);
    if (on && start < 0) start = y;
    if (!on && start >= 0) { bands.push({ top: y0 + start, bottom: y0 + y - 1 }); start = -1; }
  }
  if (!bands.length) return [];
  const tall = Math.max(...bands.map(b => b.bottom - b.top + 1));
  const out = [];
  for (const b of bands) {
    const last = out[out.length - 1], h = b.bottom - b.top + 1;
    // פס נמוך (ניקוד, קו) או צמוד לשורה שלפניו – חלק ממנה
    if (last && (h < tall * 0.35 || b.top - last.bottom < tall * 0.15)) last.bottom = b.bottom;
    else if (h >= tall * 0.35) out.push({ ...b });
  }
  return out;
}

/* ---------- ערכים ---------- */

function gregText(day, fmt) {
  const [y, m, d] = toYmd(day).split('-');
  const p = s => fmt.pad ? s : String(+s);
  return p(d) + fmt.sep + p(m) + fmt.sep + (fmt.year === 2 ? y.slice(2) : y);
}

/** הטקסט החדש לאזור, או null אם אין ערך */
export function slotValue(slot, v) {
  switch (slot.kind) {
    case 'rule': return v.rules[slot.when + '|' + slot.name] ?? null;
    // ההודעה כולה, בנוסח שהגבאי קבע, באה מלוח הקידושים – גם בתבנית שנשמרה עם טקסט לפני הקידוש
    case 'kiddush': return v.rules[slot.when + '|' + slot.name] ?? null;
    case 'zman': return (v.zmanim[slot.when] || {})[slot.zman] ?? null;
    case 'title': return v.title;
    case 'parasha': return (slot.prefix || '') + v.parasha;
    case 'parashaName': return (slot.prefix || '') + v.parashaName;
    // בשבת בלי שם מיוחד האזור נמחק (נכתב טקסט ריק על הרקע)
    case 'special': return v.special || '';
    // בלי כתובת בהגדרות – הכתובת מהקובץ נשארת כמו שהיא
    case 'address': return v.address || null;
    case 'hebDate': {
      let s = hebDateString(v.hebDay);
      if (slot.noYear) s = s.split(' ').slice(0, -1).join(' ');
      // "ה'תשפ"ז" כמו בקובץ הישן
      else if (slot.hei) s = s.replace(/ (\S+)$/, ' ה׳$1');
      return slot.ascii ? s.replace(/״/g, '"').replace(/׳/g, "'") : s;
    }
    case 'gregDate': return gregText(v.firstDay, slot.fmt || { sep: '/', year: 4, pad: false });
    case 'text': return slot.text ?? '';
    default: return null;
  }
}

/** מפתח קבוע לאזור, לטקסט שהגבאי שינה בו. אזורים עם אותו תוכן (למשל הכותרת פעמיים) משתנים יחד */
export const slotKey = s => s.kind === 'text' ? 'text|' + Math.round(s.box.x) + ',' + Math.round(s.box.y)
  : [s.kind, s.when, s.name, s.zman].filter(x => x != null && x !== '').join('|');

/**
 * כשאין בתבנית אזור לשבת מיוחדת: סוג האזור שאליו מוסיפים את שם השבת ("שבת זכור") –
 * הכותרת, ואם אין כותרת – הפרשה. null כשיש אזור משלה, או כשאין לאן להוסיף.
 */
export function specialHost(slots) {
  if (slots.some(s => s.kind === 'special')) return null;
  return ['title', 'parasha', 'parashaName'].find(k => slots.some(s => s.kind === k)) || null;
}

/** הטקסט שנכתב באזור: מה שהגבאי כתב (v.edits), או הערך המחושב. host – מ-specialHost */
export function slotText(slot, v, host) {
  const k = slotKey(slot);
  if (v.edits && k in v.edits) return String(v.edits[k]);
  const text = slotValue(slot, v);
  // "שבת פרשת תצוה – שבת זכור", "לשבת תצוה – זכור"
  if (!v.special || slot.kind !== host || text == null) return reword(slot, text);
  return reword(slot, text + ' – ' + (slot.kind === 'parashaName' ? v.special.replace(/^שבת\s+/, '') : v.special));
}

/**
 * הנוסח שהגבאי שינה בשורה: slot.rewords – זוגות [מה שהיה, מה שנכתב במקומו], לפי הסדר.
 * רק המילים שנערכו מוחלפות, כך שמה שמשתנה משבוע לשבוע (שם בעל הקידוש) ממשיך להתעדכן
 */
function reword(slot, text) {
  if (text == null || !slot.rewords) return text;
  // המילים נמצאות גם כשיש ביניהן ירידת שורה (ההודעה מלוח הקידושים), וירידות השורה שבטקסט נשמרות
  const find = from => new RegExp(from.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
  const out = slot.rewords.reduce((t, [from, to]) => from && from.trim() ? t.replace(find(from), () => to) : t, text);
  return out.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\s]*/g, '\n').trim();
}

/* ---------- ציור ---------- */

const imgCache = new Map();
function loadImage(src) {
  if (!imgCache.has(src)) {
    imgCache.clear();
    imgCache.set(src, new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; }));
  }
  return imgCache.get(src);
}

/* ---------- גופנים מהקובץ ---------- */

const faces = new Map();   // שם משפחה ← Promise<boolean>

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 7) h = (h * 33 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + str.length.toString(36);
}

/**
 * טעינת גופן (base64) לדפדפן. מחזיר את שם המשפחה, או null אם הטעינה נכשלה.
 * weight, style – המשקל והסגנון שהגופן רשום בהם, כדי שהדפדפן לא יעבה או יטה שוב גופן שכבר מודגש או נטוי
 */
async function loadFace(data, weight = 'normal', style = 'normal') {
  const family = 'tpl-' + hash(data) + (weight === 'normal' ? '' : '-' + weight) + (style === 'normal' ? '' : '-' + style);
  if (!faces.has(family)) {
    faces.set(family, (async () => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const face = new FontFace(family, bytes, { weight, style });
      await face.load();
      document.fonts.add(face);
      return true;
    })().catch(() => false));
  }
  return (await faces.get(family)) ? family : null;
}

const isItalic = f => !!f.italic || /italic|oblique/i.test(f.ps || '');

/**
 * הדגשה ונטייה של אזור: מה שהגבאי בחר, ואם לא בחר – כמו בקובץ: לפי הגופן, עובי הקו בתמונה,
 * או טקסט שהוטה בקובץ עצמו (box.italic)
 */
export function slotLook(slot, f, style) {
  return { bold: slot.bold ?? !!((f && f.bold) || (style && style.bold)),
    italic: slot.italic ?? !!((f && isItalic(f)) || (slot.box && slot.box.italic)) };
}

const cssFont = (look, size, css) => (look.italic ? 'italic ' : '') + (look.bold ? '700 ' : '400 ') + size + 'px ' + css;

/**
 * לכל גופן בתבנית: { family, map } לגופן מוטמע, או { css } לגופן מערכת לפי השם.
 * plainCss – בלי הגופן המלא, לטקסט שהגבאי ביטל בו הדגשה או נטייה של הגופן שבקובץ
 */
async function templateFonts(tpl) {
  const out = {};
  for (const [k, f] of Object.entries(tpl.fonts || {})) {
    const weight = f.bold ? '700' : '400', style = isItalic(f) ? 'italic' : 'normal';
    const family = f.data && f.map ? await loadFace(f.data, weight, style) : null;
    // f.full – האותיות מהגופן המלא (מהמחשב של הגבאי או מקובץ שהעלה), לאותיות שחסרות בגופן המוטמע
    const full = f.full ? await loadFace(f.full, weight, style) : null;
    const plainCss = fallbackCss(f), css = (full ? '"' + full + '", ' : '') + plainCss;
    out[k] = { ...(family ? { family, map: f.map } : {}), bold: !!f.bold, italic: style === 'italic', css, plainCss };
    // הקנבס לא מחכה לגופן רשת – טוענים מראש את האותיות העבריות של הגופן החלופי, בכל הדגשה ונטייה
    await Promise.all([false, true].flatMap(bold => [false, true].map(italic =>
      document.fonts.load(cssFont({ bold, italic }, 20, css), 'אבצץ').catch(() => {}))));
  }
  return out;
}

const HEB = /[֐-׿]/;

/**
 * הטקסט בסדר ויזואלי (משמאל לימין), כי האותיות בגופן המוטמע נמצאות בקוד פרטי
 * שהדפדפן לא מזהה כעברית. מספרים ואותיות לטיניות נשארים משמאל לימין.
 */
function visualOrder(text) {
  if (!HEB.test(text)) return text;
  const mirror = { '(': ')', ')': '(', '[': ']', ']': '[' };
  return [...text].reverse().join('')
    .replace(/[0-9A-Za-z:./-]+/g, m => [...m].reverse().join(''))
    .replace(/[()[\]]/g, c => mirror[c]);
}

/**
 * כותב טקסט במרכז (cx) בגופן מהקובץ. אות שאין בגופן נכתבת בגופן החלופי.
 * draw=false – רק מודד ומחזיר את הרוחב.
 */
function embeddedText(ctx, text, f, look, size, cx, baseline, draw) {
  const segs = [];
  for (const ch of visualOrder(text)) {
    const emb = !/\s/.test(ch) && ch in f.map;
    const last = segs[segs.length - 1];
    if (last && last.emb === emb) last.s += emb ? f.map[ch] : ch;
    else segs.push({ emb, s: emb ? f.map[ch] : ch });
  }
  // גופן רגיל שהגבאי הדגיש או הטה: הדפדפן מעבה או מטה אותו בעצמו
  const fonts = { true: cssFont(look, size, '"' + f.family + '"'), false: cssFont(look, size, f.css) };
  // LRO … PDF – כופה סדר משמאל לימין על קטע בגופן החלופי, שכבר נמצא בסדר ויזואלי
  const str = sg => sg.emb ? sg.s : '\u202D' + sg.s + '\u202C';
  let w = 0, asc = 0, desc = 0;
  for (const sg of segs) {
    ctx.font = fonts[sg.emb];
    const m = ctx.measureText(str(sg));
    sg.w = m.width; w += sg.w;
    asc = Math.max(asc, m.actualBoundingBoxAscent ?? size * 0.75); desc = Math.max(desc, m.actualBoundingBoxDescent ?? size * 0.25);
  }
  if (draw) {
    ctx.save();
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
    let x = cx - w / 2;
    for (const sg of segs) { ctx.font = fonts[sg.emb]; ctx.fillText(str(sg), x, baseline); x += sg.w; }
    ctx.restore();
  }
  return { w, asc, desc };
}

/** מחלקים טקסט לעד n שורות בנקודות הרווח שבהן השורה הרחבה ביותר הכי צרה */
function splitLines(text, measure, n) {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best = null, bestMax = Infinity;
  // כל החלוקות של המילים לשורות רצופות (עד n), מהשורה הראשונה והלאה
  const walk = (from, acc) => {
    if (from === words.length) {
      if (acc.length < 2) return;
      const max = Math.max(...acc.map(measure));
      if (max < bestMax) { bestMax = max; best = acc; }
      return;
    }
    if (acc.length === n) return;
    for (let i = from + 1; i <= words.length; i++) walk(i, [...acc, words.slice(from, i).join(' ')]);
  };
  walk(0, []);
  return best;
}

/**
 * החלוקה שהגבאי בחר: lines[i] – השורה (0 עד count-1) של המילה ה-i. מילים שאחרי סוף הרשימה
 * (שם פרשה ארוך יותר מזה שבתצוגה) הולכות לשורה של המילה האחרונה.
 */
export function wordLine(lines, i, count = 2) {
  return Math.min(lines && lines.length ? lines[Math.min(i, lines.length - 1)] || 0 : 0, count - 1);
}
/**
 * השורות לפי הבחירה, בלי שורות ריקות. null כשהכל נשאר בשורה אחת.
 * נוסח שהגבאי ערך לשבוע מסוים שומר את השורות שלו בירידות שורה (\n)
 */
function chosenLines(text, lines, count) {
  if (text.includes('\n')) {
    const own = text.split('\n').map(ln => ln.trim()).filter(Boolean);
    return own.length > 1 ? own : null;
  }
  const out = Array.from({ length: count }, () => []);
  text.trim().split(/\s+/).forEach((w, i) => out[wordLine(lines, i, count)].push(w));
  const full = out.filter(a => a.length).map(a => a.join(' '));
  return full.length > 1 ? full : null;
}

/**
 * פותח עד d שורות ריקות בתמונה, בשורה ריקה שבין from ל-to: מה שמתחתיה יורד, והמקום נלקח מהרווחים
 * הריקים הגדולים שמתחתיה (עד 60% מכל רווח). השורה הריקה משוכפלת, כך שקווים אנכיים (מסגרת) נמשכים.
 * shift(cut, end, k) – נקרא על כל הזזה: מה שבין cut ל-end ירד ב-k
 */
function openRows(canvas, from, to, d, shift) {
  const { W, H, c2, runs, best } = blankGap(canvas, from, to);
  if (!best) return 0;
  const cut = (best.s + best.e) >> 1;
  // השוליים שבתחתית התמונה לא נלקחים
  const below = runs.filter(r => r.s > best.run.e && r.e < H).sort((a, b) => (b.e - b.s) - (a.e - a.s));
  const take = [];
  let left = Math.ceil(d);
  for (const r of below) {
    if (left <= 0) break;
    const k = Math.min(left, Math.floor((r.e - r.s) * 0.6));
    if (k < 1) continue;
    take.push({ at: r.s + ((r.e - r.s - k) >> 1), k });
    left -= k;
  }
  c2.imageSmoothingEnabled = false;
  for (const { at, k } of take.sort((a, b) => a.at - b.at)) {
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = at - cut;
    tmp.getContext('2d').drawImage(canvas, 0, cut, W, at - cut, 0, 0, W, at - cut);
    c2.drawImage(tmp, 0, cut + k);
    c2.drawImage(tmp, 0, 0, W, 1, 0, cut, W, k);
    shift(cut, at, k);
  }
  return Math.ceil(d) - left;
}

/**
 * ההפך מ-openRows: סוגר עד d שורות ריקות ברווח שבין from ל-to, ומה שמתחתיו עולה. השורות שנסגרו נוספות
 * לרווחים הריקים הגדולים שמתחתיו (עד פי 2 מכל רווח), ואם אין כאלה – לשוליים שבתחתית
 */
function closeRows(canvas, from, to, d, shift) {
  const { W, H, c2, runs, best } = blankGap(canvas, from, to);
  if (!best) return 0;
  // שורה ריקה אחת לפחות נשארת בין השורות
  const total = Math.min(Math.ceil(d), best.e - best.s - 1);
  if (total < 1) return 0;
  const cut = best.s + ((best.e - best.s - total) >> 1);
  const blankRow = document.createElement('canvas');
  blankRow.width = W; blankRow.height = 1;
  blankRow.getContext('2d').drawImage(canvas, 0, cut, W, 1, 0, 0, W, 1);
  const below = runs.filter(r => r.s > best.run.e).sort((a, b) => (a.e === H) - (b.e === H) || (b.e - b.s) - (a.e - a.s));
  const give = [];
  let left = total;
  for (const r of below) {
    if (left <= 0) break;
    const k = r.e === H ? left : Math.min(left, r.e - r.s);
    if (k < 1) continue;
    give.push({ at: r.e === H ? H : r.s + ((r.e - r.s) >> 1), k });
    left -= k;
  }
  if (left > 0) give.push({ at: H, k: left });
  c2.imageSmoothingEnabled = false;
  for (const { at, k } of give.sort((a, b) => a.at - b.at)) {
    const h = at - cut - k;
    if (h > 0) {
      const tmp = document.createElement('canvas');
      tmp.width = W; tmp.height = h;
      tmp.getContext('2d').drawImage(canvas, 0, cut + k, W, h, 0, 0, W, h);
      c2.drawImage(tmp, 0, cut);
    }
    c2.drawImage(blankRow, 0, 0, W, 1, 0, at - k, W, k);
    shift(cut + k, at, -k);
  }
  return total;
}

/** השורות הריקות בתמונה (runs: { s, e }), והרווח הריק הארוך ביותר שבין from ל-to (best) */
function blankGap(canvas, from, to) {
  const W = canvas.width, H = canvas.height, c2 = canvas.getContext('2d', { willReadFrequently: true });
  const data = c2.getImageData(0, 0, W, H).data;
  const sample = [];
  for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 7) { const i = (y * W + x) * 4; sample.push([data[i], data[i + 1], data[i + 2]]); }
  const bg = median(sample);
  const ink = i => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 110;
  // עמודה שיש בה דיו ברוב הגובה היא קו אנכי (מסגרת): שורה שיש בה רק קווים כאלה היא ריקה
  const col = new Uint32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink((y * W + x) * 4)) col[x]++;
  const blank = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W && n <= 2; x++) if (col[x] < H * 0.5 && ink((y * W + x) * 4)) n++;
    blank[y] = n <= 2;
  }
  const runs = [];
  for (let y = 0, s = -1; y <= H; y++) {
    if (y < H && blank[y]) { if (s < 0) s = y; } else if (s >= 0) { runs.push({ s, e: y }); s = -1; }
  }
  // הרווח הארוך ביותר בין from ל-to
  let best = null;
  for (const r of runs) {
    const s = Math.max(r.s, Math.ceil(from)), e = Math.min(r.e, Math.floor(to));
    if (e - s > 0 && (!best || e - s > best.e - best.s)) best = { s, e, run: r };
  }
  return { W, H, c2, runs, best };
}

/**
 * מספור האזורים לפי הסדר בעמוד: מלמעלה למטה, ובאותה שורה – מימין לשמאל. ranks[i] – המספר של slots[i]
 */
export function slotRanks(slots) {
  const items = slots.map((s, i) => ({ i, x: s.box.x, y: s.box.y, h: s.box.h }));
  items.sort((a, b) => a.y - b.y);
  const rows = [];
  items.forEach(it => {
    const row = rows.find(r => Math.abs(r.y - it.y) <= it.h * 0.6);
    if (row) { row.items.push(it); row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length; }
    else rows.push({ y: it.y, items: [it] });
  });
  rows.sort((a, b) => a.y - b.y);
  const ranks = [];
  let n = 0;
  rows.forEach(r => { r.items.sort((a, b) => b.x - a.x); r.items.forEach(it => { ranks[it.i] = ++n; }); });
  return ranks;
}

/**
 * הפסקאות: אזור שסומן joinPrev מצטרף לפסקה של האזור שלפניו בעמוד. הרווח לפני הפסקה נקבע באזור הראשון שלה
 * (spaceBefore), והרווח אחריה – באחרון (spaceAfter), באחוזים מגודל הטקסט. לכל אזור: { top, bottom } –
 * { pct } רווח שנקבע, {} אוטומטי, { inner: true } בתוך הפסקה. אזורים בשורה הראשונה או האחרונה מקבלים את רווח הפסקה
 */
export function paraEdges(slots) {
  const ranks = slotRanks(slots);
  const groups = [];
  for (const i of slots.map((s, i) => i).sort((a, b) => ranks[a] - ranks[b])) {
    if (slots[i].joinPrev && groups.length) groups[groups.length - 1].push(slots[i]);
    else groups.push([slots[i]]);
  }
  const sameRow = (a, b) => Math.abs(a.box.y - b.box.y) <= Math.max(a.box.h, b.box.h) * 0.6;
  const out = new Map();
  for (const g of groups) {
    const head = g[0], tail = g[g.length - 1];
    for (const s of g) out.set(s, {
      top: !sameRow(s, head) ? { inner: true } : head.spaceBefore != null ? { pct: head.spaceBefore } : {},
      bottom: !sameRow(s, tail) ? { inner: true } : tail.spaceAfter != null ? { pct: tail.spaceAfter } : {}
    });
  }
  return out;
}

export async function templateCanvas(tpl, values) {
  const img = await loadImage(tpl.image);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  const fonts = await templateFonts(tpl);
  // התמונה שעליה כותבים, לפני הכתיבה: ממנה בודקים את המקום הפנוי מעל ומתחת לכל אזור,
  // ובה פותחים מקום כשצריך (ולכן גם התיבות מועתקות – הן זזות יחד עם התמונה)
  const src = document.createElement('canvas');
  src.width = canvas.width; src.height = canvas.height;
  src.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  // אזור שהוזז בעורך (origin – המקום שלו בקובץ): הטקסט המקורי נמחק מהמקום הישן, והשם שליד השעה עובר יחד איתה
  const sctx0 = src.getContext('2d');
  const wipe = (b, bg) => {
    const pad = Math.max(2, (b.size || b.h * 0.72) * 0.08);
    sctx0.fillStyle = bg;
    sctx0.fillRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
  };
  for (const s of tpl.slots) {
    if (!s.origin) continue;
    const bg = (s.style || {}).bg || '#ffffff';
    wipe(s.origin.box, bg);
    if (s.origin.labelBox && s.labelBox) wipe(s.origin.labelBox, (s.labelStyle || {}).bg || bg);
  }
  for (const s of tpl.slots) {
    const from = s.origin && s.origin.labelBox, to = s.labelBox;
    if (from && to) sctx0.drawImage(img, from.x, from.y, from.w, from.h, to.x, to.y, to.w, to.h);
  }
  const copy = b => b && { ...b }, given = tpl;
  tpl = { ...tpl, slots: tpl.slots.map(s => ({ ...s, box: copy(s.box), labelBox: copy(s.labelBox),
    ...(s.origin ? { origin: { box: s.origin.box, labelBox: copy(s.origin.labelBox) } } : {}) })),
    candidates: (tpl.candidates || []).map(c => ({ ...c, box: copy(c.box) })) };
  // המקום הישן של השם זז יחד עם הטקסט שבקובץ, כדי שיימצא לפיו הטקסט של השם (redrawLabel)
  const allBoxes = [...tpl.slots.flatMap(s => [s.box, s.labelBox, s.origin && s.origin.labelBox]), ...tpl.candidates.map(c => c.box)].filter(Boolean);
  // כל ההזזות לפי הסדר: מהן יודעים איפה נקודה מהקובץ נמצאת בתמונה החדשה, ולהפך
  const moves = [];
  const shiftBoxes = (cut, end, k) => {
    moves.push([cut, end, k]);
    for (const b of allBoxes) {
      const mid = b.y + b.h / 2;
      if (mid >= cut && mid < end) { b.y += k; if (b.baseline != null) b.baseline += k; }
    }
  };

  // שלב 1: השורות והגודל של כל אזור, לפי הרוחב
  const host = specialHost(tpl.slots);
  const plans = [];
  for (const s of tpl.slots) {
    const raw = slotText(s, values, host);
    if (raw == null) continue;
    // ירידות שורה שנשמרו בעריכה לשבוע מסוים: קובעות את השורות רק כשמותר לגלוש
    const own = s.wrap && /\S\s*\n\s*\S/.test(raw);
    const text = own ? raw.trim() : raw.replace(/\s*\n\s*/g, ' ').trim();
    const b = s.box, st = s.style || { bg: '#fff', fg: '#000', bold: false };
    let size = (b.size || b.h * 0.72) * ((s.sizePct || 100) / 100);
    const minSize = size * 0.6;
    const cx = b.x + b.w / 2, baseline = b.baseline ?? (b.y + b.h * 0.78);
    const f = fonts[b.font] || fonts[tpl.mainFont];
    const writeAt = textWriter(ctx, f, slotLook(s, f, st), cx);
    // טקסט ארוך מהמקום: מקטינים עד 70%, ואם עדיין לא נכנס ומותר לגלוש – מחלקים לכמה שורות
    let w = writeAt(text, size, baseline, false);
    const room = Math.max(b.w * 1.15, b.w + size);
    let lines = [text];
    // שם שבת מיוחדת שנוסף לכותרת ולא נכנס בשורה אחת יורד לשורה משלו, בגודל המקורי ככל האפשר
    const added = s.kind === host && values.special ? text.lastIndexOf(' – ') : -1;
    const count = s.lineCount || 2;
    const chosen = s.wrap ? chosenLines(text, s.lines, count) : null;
    const widest = ls => Math.max(...ls.map(ln => writeAt(ln, size, baseline, false)));
    // טקסט שתפס כמה שורות בקובץ הישן (srcLines): מחלקים לשורות בגודל המקורי, ומקטינים רק אם עדיין לא נכנס
    const multi = s.wrap && s.srcLines > 1;
    const split = w > room && multi && !chosen ? splitLines(text, str => writeAt(str, size, baseline, false), count) : null;
    if ((w > room || own) && chosen) {
      const cw = multi || own ? widest(chosen) : w;
      if ((!multi && !own) || cw > room) size = Math.max(size * 0.7, size * room / cw);
      lines = chosen;
      w = widest(lines);
    } else if (split && widest(split) <= room) {
      lines = split;
      w = widest(lines);
    } else if (w > room && added > 0) {
      lines = [text.slice(0, added), text.slice(added + 3)];
      const widest = () => Math.max(...lines.map(ln => writeAt(ln, size, baseline, false)));
      w = widest();
      if (w > room) { size = Math.max(size * 0.7, size * room / w); w = widest(); }
    } else if (w > room) {
      size = Math.max(size * 0.7, size * room / w);
      w = writeAt(text, size, baseline, false);
      if (s.wrap) {
        const split = splitLines(text, str => writeAt(str, size, baseline, false), count);
        if (split) { lines = split; w = Math.max(...lines.map(ln => writeAt(ln, size, baseline, false))); }
      }
    }
    // המרווח בין השורות: כפי שנבחר, אבל לא פחות ממרווח נוח לקריאה. need – המינימום שבו שורה לא עולה על השורה שמעליה
    const n = lines.length, pct = s.wrap ? (s.lineHeightPct || 100) / 100 : 1;
    const layout = sz => {
      const ink = lines.map(ln => writeAt.ink(ln, sz));
      const touch = n > 1 ? Math.max(...ink.slice(1).map((m, i) => ink[i].desc + m.asc)) : 0, need = n > 1 ? touch + sz * 0.08 : 0;
      const gap = Math.max(sz * 1.15 * pct, need + sz * 0.15);
      // ריווח פסקה: הרווח שמעל הטקסט ומתחתיו גדול מהרווח שבין שורותיו, כדי שייראה כפסקה נפרדת מהשורות השכנות
      const para = n > 1 ? gap - touch + sz * 0.35 : 0;
      return { ink, need, gap, touch, para, minPara: n > 1 ? sz * 0.15 : 0, height: g => (n - 1) * g + ink[0].asc + ink[n - 1].desc };
    };
    // pen – כותב באותו גופן על קנבס אחר (התמונה שעליה מסדרים את הפסקאות)
    plans.push({ s, text, st, size, minSize, cx, writeAt, lines, w, n, layout, pen: c => textWriter(c, f, slotLook(s, f, st), cx) });
  }

  // שלב 2: ריווח הפסקאות, מלמעלה למטה. הרווח מעל פסקה ומתחתיה נקבע בשורות הריקות שבתמונה (מה שמתחת עולה או יורד),
  // וטקסט של כמה שורות נכתב כבר כאן על התמונה, כדי שהרווח מהשורה שמתחתיו יימדד מהטקסט החדש
  const spaceOf = (p, sz) => {
    const b = p.s.box;
    return verticalRoom(src, b, Math.min(b.x, p.cx - p.w / 2), Math.max(b.x + b.w, p.cx + p.w / 2), sideBoxes(tpl, p.s), p.st.bg, sz * (p.n + 1), sz);
  };
  const edges = paraEdges(tpl.slots);
  // המרווח הרצוי: { px, exact }. exact – בדיוק כך (הגבאי קבע), אחרת – לפחות כך. null – נשאר כמו בקובץ
  const want = (spec, p, L) => {
    if (spec.pct != null) return { px: spec.pct / 100 * p.size, exact: true };
    if (p.n < 2) return null;
    // בתוך פסקה – כמו הרווח שבין השורות; פסקה אוטומטית – רווח מעט גדול ממנו
    return { px: spec.inner ? L.gap - L.touch : L.para, exact: false };
  };
  // רווח שנקבע מתחת לפסקה נשמר, כדי שרווח קטן יותר שנקבע מעל הפסקה שאחריה לא יבטל אותו (הגדול קובע)
  const marks = [];
  const markBelow = (y, px) => { const m = { x: 0, y, w: 0, h: 0, px }; marks.push(m); allBoxes.push(m); };
  const markAt = (y, p) => marks.find(m => Math.abs(m.y - y) < p.size * 0.3);
  const resize = (from, to, d) => d > 0.5 ? openRows(src, from, to, d, shiftBoxes) : d < -0.5 ? closeRows(src, from, to, -d, shiftBoxes) : 0;
  const sctx = src.getContext('2d');
  sctx.direction = 'rtl';
  sctx.textAlign = 'center';
  const done = new Set();
  for (const p of [...plans].sort((a, b) => a.s.box.y - b.s.box.y)) {
    const b = p.s.box, e = edges.get(p.s), L = p.layout(p.size), pad = Math.max(1, p.size * 0.06);
    let top = want(e.top, p, L);
    const bottom = want(e.bottom, p, L);
    const baseline = () => b.baseline ?? (b.y + b.h * 0.78);
    let space = spaceOf(p, p.size);
    const mark = markAt(space.top - pad, p);
    if (mark) top = { px: Math.max(mark.px, top ? top.px : 0), exact: true };
    if (p.n < 2) {
      // שורה אחת נשארת במקומה, והרווחים שהגבאי קבע נקבעים סביבה
      if (top) {
        const inkTop = Math.min(b.y, baseline() - L.ink[0].asc), above = space.top - pad;
        resize(above, inkTop, top.px - (inkTop - above));
        space = spaceOf(p, p.size);
      }
      if (bottom) {
        const inkBottom = Math.max(b.y + b.h, baseline() + L.ink[0].desc), below = space.bottom + pad;
        resize(inkBottom, below, bottom.px - (below - inkBottom));
        markBelow(inkBottom, bottom.px);
      }
      continue;
    }
    // כמה שורות: לא נכנס עם הרווחים – מורידים את מה שמתחתיו; נשאר יותר מדי מקום ושני הרווחים נקבעו – מעלים אותו
    const a = top ? top.px : 0, z = bottom ? bottom.px : 0, h = L.height(L.gap);
    const miss = h + a + z - (space.bottom - space.top + (top && top.exact ? pad : 0) + (bottom && bottom.exact ? pad : 0));
    if (miss > 1) openRows(src, b.y + b.h, space.bottom + pad, miss, shiftBoxes);
    else if (miss < -1 && top && top.exact && bottom && bottom.exact) resize(Math.max(b.y + b.h, space.top - pad + a + h), space.bottom + pad, miss);
    const inkBottom = paint(p, sctx, p.pen(sctx), top, bottom);
    done.add(p);
    if (bottom && bottom.exact) markBelow(inkBottom, bottom.px);
  }
  ctx.drawImage(src, 0, 0);

  // שלב 3: כתיבת שאר האזורים, והשם שליד השעה
  for (const p of plans) {
    if (!done.has(p)) paint(p, ctx, p.writeAt, null, null);
    if ((p.s.sizePct || 100) !== 100) p.s.labelInk = redrawLabel(ctx, tpl, p.s, fonts, p.st);
  }
  // איפה נכתב כל אזור בתמונה החדשה – כדי שהמסגרות בעורך יהיו על הטקסט עצמו ובגודל שלו
  canvas.layout = {
    slots: new Map(given.slots.map((s, i) => {
      const o = tpl.slots[i];
      return [s, { box: o.box, labelBox: o.labelBox, ink: o.ink, labelInk: o.labelInk }];
    })),
    candidates: tpl.candidates.map(c => c.box),
    toView: y => moves.reduce((y, [cut, end, k]) => y >= cut && y < end ? y + k : y, y),
    toSrc: y => moves.reduceRight((y, [cut, end, k]) => y >= cut + k && y < end + k ? y - k : y, y)
  };

  /**
   * המקום, המרווח והגודל הסופיים, והכתיבה על c. top, bottom – הרווח הרצוי מעל ומתחת (מ-want).
   * מחזיר את תחתית הדיו של הטקסט
   */
  function paint(p, c, write, top, bottom) {
    const { s, st, cx, lines, n, minSize } = p, b = s.box;
    let { size, w } = p;
    const baseline = b.baseline ?? (b.y + b.h * 0.78);
    let L = p.layout(size), lineGap = L.gap;
    const space = spaceOf(p, size), pad = Math.max(1, size * 0.06);
    const avail = space.bottom - space.top, room = avail - (top ? L.minPara : 0) - (bottom ? L.minPara : 0);
    // לא נכנס: קודם מצמצמים את ריווח הפסקה, אחר כך את המרווח בין השורות (עד שהן כמעט נוגעות), ואחר כך מקטינים את הטקסט
    if (L.height(lineGap) > room && n > 1) lineGap = Math.max(L.need, lineGap - (L.height(lineGap) - room) / (n - 1));
    if (L.height(lineGap) > room && size > minSize) {
      const k = Math.max(minSize / size, room / L.height(lineGap));
      size *= k;
      L = p.layout(size);
      lineGap = Math.max(L.need, lineGap * k);
      w = Math.max(...lines.map(ln => p.writeAt(ln, size, baseline, false)));
    }
    // השורות ממורכזות סביב קו הבסיס המקורי, ומוזזות למעלה או למטה לפי הרווחים שמעליהן ומתחתיהן.
    // רווח שהגבאי קבע נמדד מהדיו השכן עצמו; כשאין מספיק מקום, הרווחים קטנים באותו יחס
    const first = baseline - (n - 1) / 2 * lineGap;
    const top0 = first - L.ink[0].asc, bottom0 = first + (n - 1) * lineGap + L.ink[n - 1].desc;
    const lo0 = space.top - (top && top.exact ? pad : 0), hi0 = space.bottom + (bottom && bottom.exact ? pad : 0);
    const a = top ? top.px : 0, z = bottom ? bottom.px : 0, slack = hi0 - lo0 - (bottom0 - top0);
    let shift;
    if (slack < 0) shift = (space.top + space.bottom) / 2 - (top0 + bottom0) / 2;
    else {
      const k = a + z > slack ? slack / (a + z) : 1, lo = lo0 + a * k, hi = hi0 - z * k;
      shift = top && top.exact ? lo - top0 : bottom && bottom.exact ? hi - bottom0
        : top0 < lo ? lo - top0 : bottom0 > hi ? hi - bottom0 : 0;
    }
    const baselines = lines.map((ln, i) => first + shift + i * lineGap);
    const left = Math.min(b.x, cx - w / 2) - 2, right = Math.max(b.x + b.w, cx + w / 2) + 2;
    // הרקע מכסה את הטקסט המקורי ואת הדיו של החדש, ולא יותר – כדי לא למחוק את השורה השכנה
    const y0 = Math.min(b.y, baselines[0] - L.ink[0].asc - 2) - 1, y1 = Math.max(b.y + b.h, baselines[n - 1] + L.ink[n - 1].desc + 2) + 1;
    c.fillStyle = st.bg;
    c.fillRect(left, y0, right - left, y1 - y0);
    c.fillStyle = st.fg;
    lines.forEach((ln, i) => write(ln, size, baselines[i], true));
    // המקום של הטקסט החדש; נוסף לתיבות, כדי שיזוז יחד עם מה שנפתח או נסגר מעליו אחר כך
    if (w > 0) {
      const iy = baselines[0] - L.ink[0].asc;
      s.ink = { x: cx - w / 2, y: iy, w, h: baselines[n - 1] + L.ink[n - 1].desc - iy };
      allBoxes.push(s.ink);
    }
    return baselines[n - 1] + L.ink[n - 1].desc;
  }
  return canvas;
}

/**
 * כותב טקסט ממורכז ב-cx בגופן f מהקובץ, או לפי שם הגופן אם הוא לא מוטמע. draw=false – רק מודד.
 * look – { bold, italic }. בגופן מודגש או נטוי אי אפשר לבטל את ההדגשה או הנטייה, ולכן אז כותבים בגופן לפי השם
 */
function textWriter(ctx, f, look, cx) {
  const removed = f && ((f.bold && !look.bold) || (f.italic && !look.italic));
  let run;
  if (f && f.family && !removed) run = (str, sz, y, draw) => embeddedText(ctx, str, f, look, sz, cx, y, draw);
  else {
    const css = !f ? FALLBACK : removed ? f.plainCss : f.css;
    run = (str, sz, y, draw) => {
      ctx.font = cssFont(look, sz, css);
      if (draw) ctx.fillText(str, cx, y);
      const m = ctx.measureText(str);
      return { w: m.width, asc: m.actualBoundingBoxAscent ?? sz * 0.75, desc: m.actualBoundingBoxDescent ?? sz * 0.25 };
    };
  }
  const write = (str, sz, y, draw) => run(str, sz, y, draw).w;
  // גובה הדיו של הטקסט מעל קו הבסיס ומתחתיו: { w, asc, desc }
  write.ink = (str, sz) => run(str, sz, 0, false);
  return write;
}

const rgb = h => (h.length === 4 ? [1, 2, 3].map(i => h[i] + h[i]) : [1, 3, 5].map(i => h.slice(i, i + 2))).map(v => parseInt(v, 16));

/**
 * המקום הפנוי מעל האזור ומתחתיו בתמונה המקורית – עד הדיו הקרוב (שורה אחרת, קו בטבלה): { top, bottom }.
 * עמודות של טקסט שבאותה שורה (השם שליד השעה) לא נבדקות. reach – עד כמה רחוק מחפשים
 */
function verticalRoom(src, b, x0, x1, side, bg, reach, size) {
  x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(src.width, Math.ceil(x1));
  const y0 = Math.max(0, Math.floor(b.y - reach)), y1 = Math.min(src.height, Math.ceil(b.y + b.h + reach));
  const free = { top: y0, bottom: y1 };
  const cols = [];
  for (let x = x0; x < x1; x++) if (!side.some(k => x >= k.x - 1 && x <= k.x + k.w + 1)) cols.push(x - x0);
  if (cols.length < 2 || y1 - y0 < 2) return free;
  const RW = x1 - x0, data = src.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, RW, y1 - y0).data, c = rgb(bg);
  const ink = y => {
    let n = 0;
    for (const x of cols) { const i = ((y - y0) * RW + x) * 4; if (dist([data[i], data[i + 1], data[i + 2]], c) > 70 && ++n > 2) return true; }
    return false;
  };
  // דיו שצמוד לקצה האזור הוא עוד חלק מהטקסט המקורי (אות שיורדת מתחת לשורה), ולא השורה השכנה
  const edge = Math.ceil(size * 0.35);
  const scan = (from, step, end) => {
    let y = from;
    for (let n = 0; y !== end && n < edge && ink(y); n++) y += step;
    for (; y !== end; y += step) if (ink(y)) return y;
    return end;
  };
  const pad = Math.max(1, size * 0.06);
  return { top: scan(Math.floor(b.y) - 1, -1, y0 - 1) + 1 + pad, bottom: scan(Math.ceil(b.y + b.h), 1, y1) - pad };
}

/** תיבות של טקסט באותה שורה של האזור, מימינו או משמאלו (לא מעליו או מתחתיו, ולא הטקסט המקורי שלו) */
function sideBoxes(tpl, s) {
  const b = s.box, out = [];
  const boxes = [...tpl.slots.flatMap(o => o === s ? [s.labelBox] : [o.box, o.labelBox]), ...(tpl.candidates || []).map(c => c.box)];
  for (const k of boxes) {
    if (!k || k === b) continue;
    const mid = k.y + k.h / 2, over = Math.min(k.x + k.w, b.x + b.w) - Math.max(k.x, b.x);
    if (mid > b.y && mid < b.y + b.h && over < k.w * 0.3) out.push(k);
  }
  return out;
}

/**
 * השם שליד השעה ("מנחה") הוא חלק מהתמונה, ולכן כשמשנים את גודל האזור כותבים אותו מחדש באותו גודל.
 * הצד הקרוב לשעה נשאר במקומו, כך שהשם גדל לכיוון הרחוק ממנה ולא עולה עליה.
 */
function redrawLabel(ctx, tpl, s, fonts, timeStyle) {
  const lb = s.labelBox;
  if (!lb || !['rule', 'zman', 'kiddush'].includes(s.kind)) return;
  const at = (s.origin && s.origin.labelBox) || lb;
  const cand = (tpl.candidates || []).find(c => c.box.x === at.x && c.box.y === at.y);
  const text = cand ? cand.old : s.label;
  if (!text) return;
  // טקסט רחוק מהשעה או גדול ממנה בהרבה הוא כותרת ולא השם שלה – נשאר כמו שהוא בקובץ
  const tSize = s.box.size || s.box.h * 0.72, lSize = lb.size || lb.h * 0.72;
  const gap = Math.max(lb.x - (s.box.x + s.box.w), s.box.x - (lb.x + lb.w));
  if (gap > tSize * 2 || lSize > tSize * 1.25) return;
  // תבנית שנשמרה בלי הגופן של השם: עדיף להשאיר אותו מהתמונה מאשר לכתוב אותו בגופן אחר
  if (lb.font && !fonts[lb.font]) return;
  const st = s.labelStyle || timeStyle;
  const size = lSize * (s.sizePct / 100);
  const baseline = lb.baseline ?? (lb.y + lb.h * 0.78);
  const f = fonts[lb.font] || fonts[tpl.mainFont];
  const look = slotLook({ box: lb }, f, st);
  const w = textWriter(ctx, f, look, 0)(text, size, baseline, false);
  const onRight = lb.x + lb.w / 2 > s.box.x + s.box.w / 2;
  const cx = onRight ? lb.x + w / 2 : lb.x + lb.w - w / 2;
  const left = Math.min(lb.x, cx - w / 2) - 2, right = Math.max(lb.x + lb.w, cx + w / 2) + 2;
  const top = Math.min(lb.y, baseline - size) - 1, bottom = Math.max(lb.y + lb.h, baseline + size * 0.3) + 1;
  ctx.fillStyle = st.bg;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.fillStyle = st.fg;
  textWriter(ctx, f, look, cx)(text, size, baseline, true);
  return { x: cx - w / 2, y: top + 1, w, h: bottom - top - 2 };
}
