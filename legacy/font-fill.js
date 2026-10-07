/**
 * השלמת אותיות לגופן שמוטמע ב-PDF. גופן מוטמע הוא חלקי – יש בו רק האותיות שהיו בקובץ,
 * ולכן אות כמו צ או ץ שלא הופיעה בלוח הישן נכתבת בגופן אחר.
 * כאן לוקחים את הגופן המלא מהמחשב (Local Font Access – Chrome ו-Edge במחשב) או מקובץ גופן שהגבאי מעלה,
 * ושומרים בתבנית רק את האותיות העבריות, הספרות והסימנים – כדי שהתבנית תישאר קטנה.
 */

const OPENTYPE = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.module.min.js';
const HEB_LETTERS = 'אבגדהוזחטיכךלמםנןסעפףצץקרשת';

/** התווים שנשמרים מהגופן: אותיות לטיניות, ספרות וסימנים, עברית (כולל ניקוד וגרשיים), מקפים, מירכאות ו-₪ */
const RANGES = [[0x20, 0x7e], [0xa0, 0xbf], [0xd7, 0xd7], [0x0591, 0x05f4], [0x2010, 0x2027], [0x2030, 0x203a], [0x20aa, 0x20aa]];

export const canReadLocalFonts = () => typeof window.queryLocalFonts === 'function';

/**
 * טלפון או טאבלט (גם באפליקציה): אין בהם גישה לגופנים שבמכשיר, ולרוב גם אין קובץ גופן להעלות.
 * iPad מציג את עצמו כ-Mac, ולכן מזהים אותו לפי מסך המגע
 */
export function isPhone() {
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return true;
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** מצב ההרשאה לגופנים שבמחשב: 'granted', 'denied' או 'prompt' (הדפדפן ישאל) */
export async function localFontsPermission() {
  try { return (await navigator.permissions.query({ name: 'local-fonts' })).state; } catch (e) { return 'prompt'; }
}

/**
 * האותיות העבריות שחסרות בגופן המוטמע (ריק אם הגופן לא מוטמע או כבר הושלם).
 * גופן שאין בו אף אות עברית משמש בקובץ רק לאנגלית, לספרות או לרווחים – ואין בו מה להשלים
 */
export function missingLetters(f) {
  if (!f || !f.data || !f.map || f.full) return '';
  const missing = [...HEB_LETTERS].filter(ch => !(ch in f.map));
  return missing.length < HEB_LETTERS.length ? missing.join('') : '';
}

/** הגופנים בתבנית שחסרות בהם אותיות: [[מפתח, גופן, אותיות חסרות]] */
export function fontsToFill(fonts) {
  return Object.entries(fonts || {}).map(([k, f]) => [k, f, missingLetters(f)]).filter(([, , m]) => m);
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** השם המלא של הגופן מה-PDF, בלי קידומת החלקיות ("ABCDEF+David-Bold" ← "David-Bold") */
const psName = f => f.ps || f.family || '';

/**
 * גופן שהשם האמיתי שלו לא נשמר בקובץ ("CIDFont+F1", "F3", "TT2", "T1_0" – כך שומרות חלק מהתוכנות):
 * אי אפשר לחפש אותו לפי השם, ולכן מזהים אותו לפי רוחב האותיות (ראו matchByWidths)
 */
export const isUnnamed = f => /^(CIDFont\+)?(F|TT|T\d+_)\d+$/i.test(psName(f));

/** שם הגופן להצגה: השם שזוהה לפי צורת האותיות, או תיאור של גופן בלי שם */
export function fontLabel(f) {
  if (f.realName) return f.realName;
  return isUnnamed(f) ? 'גופן בלי שם (' + psName(f).replace(/^CIDFont\+/i, '') + ')' : f.family;
}

/** רוחב כל תו בגופן המוטמע, ביחס לגודל הגופן: { תו: רוחב } */
const widthsCache = new WeakMap();
async function embeddedWidths(f) {
  if (!widthsCache.has(f)) {
    const opentype = await loadOpentype();
    const bin = atob(f.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const font = opentype.parse(bytes.buffer, { lowMemory: true });
    const out = {};
    for (const [ch, fc] of Object.entries(f.map)) {
      const g = font.charToGlyph(fc);
      if (g && g.index) out[ch] = g.advanceWidth / font.unitsPerEm;
    }
    widthsCache.set(f, out);
  }
  return widthsCache.get(f);
}

/**
 * הגופן מהרשימה שרוחב האותיות שלו זהה לגופן המוטמע, או null.
 * רוחבי האותיות נשמרים ב-PDF בדיוק כמו בגופן המקורי, ולכן גופן אחר כמעט אף פעם לא מתאים בכולן.
 * כשכמה גופנים מתאימים (למשל Arial Bold ו-Arial Bold Italic) – מעדיפים את המשקל והנטייה שבקובץ
 */
async function matchByWidths(f, list) {
  const want = Object.entries(await embeddedWidths(f));
  const scored = [];
  for (const x of list) {
    let n = 0, diff = 0;
    for (const [ch, w] of want) {
      const g = x.font.charToGlyph(ch);
      if (!g || !g.index) continue;
      n++; diff += Math.abs(g.advanceWidth / x.font.unitsPerEm - w);
    }
    // מעט מדי תווים משותפים לא מספיקים לזיהוי
    if (n >= 3 && n >= want.length * 0.8 && diff / n < 0.004) scored.push({ x, d: diff / n });
  }
  if (!scored.length) return null;
  const best = Math.min(...scored.map(s => s.d));
  const tied = scored.filter(s => s.d - best < 0.001).map(s => s.x);
  return tied.find(x => x.bold === !!f.bold && x.italic === !!f.italic) || tied.find(x => x.italic === !!f.italic) || tied[0];
}

/** כל הגופנים העבריים שבמחשב, לזיהוי גופן בלי שם: [{ ...parseAll, d (הגופן במחשב) }]. לוקח כמה שניות */
async function localHebrewFonts(list) {
  const out = [], seen = new Set();
  for (const d of list) {
    if (seen.has(d.postscriptName)) continue;
    seen.add(d.postscriptName);
    let fonts;
    try { fonts = await parseAll(await (await d.blob()).arrayBuffer(), true); } catch (e) { continue; }
    const x = fonts.find(x => x.ps === norm(d.postscriptName)) || (fonts.length === 1 && fonts[0]);
    if (x && x.font.charToGlyph('א').index) out.push({ ...x, d });
  }
  return out;
}

/**
 * השלמה מהגופנים שמותקנים במחשב. חייב להיקרא ישר מלחיצה (הדפדפן מבקש אישור).
 * מחזיר { filled: [שמות], notFound: [שמות], unknown: [גופנים בלי שם שלא זוהו], failed: [{ family, file (שם הגופן במחשב), why }] }.
 * why: 'format' – פורמט שלא ניתן לקרוא (למשל Type 1 ב-Linux), 'noHebrew' – אין בגופן עברית, 'network' – אין חיבור
 */
export async function fillFromLocal(fonts) {
  const list = await window.queryLocalFonts();
  const filled = [], notFound = [], unknown = [], failed = [];
  let hebrew = null;   // נסרק רק כשיש גופן בלי שם
  for (const [, f] of fontsToFill(fonts)) {
    let d;
    if (isUnnamed(f)) {
      hebrew = hebrew || await localHebrewFonts(list);
      const hit = await matchByWidths(f, hebrew);
      if (!hit) { unknown.push(fontLabel(f)); continue; }
      d = hit.d;
      f.realName = d.fullName;
    } else {
      const ps = norm(psName(f)), fam = norm(f.family);
      const sameFam = list.filter(d => norm(d.family) === fam);
      d = list.find(d => norm(d.postscriptName) === ps) || list.find(d => norm(d.fullName) === ps)
        || sameFam.find(d => /bold|black|heavy/i.test(d.style) === !!f.bold) || sameFam[0];
    }
    if (!d) { notFound.push(fontLabel(f)); continue; }
    try {
      // ב-Mac גופנים רבים שמורים באוסף (‎.ttc) – לוקחים ממנו את הגופן שהמחשב מצא
      const list = await parseAll(await (await d.blob()).arrayBuffer());
      if (!list.length) throw Object.assign(new Error('פורמט גופן לא נתמך'), { code: 'format' });
      const src = list.find(x => x.ps === norm(d.postscriptName)) || pick(f, list);
      f.full = await subset(src.font);
      filled.push(fontLabel(f));
    } catch (e) {
      console.warn('לא ניתן לקרוא את הגופן ' + d.fullName, e);
      failed.push({ family: fontLabel(f), file: d.fullName, why: e.code || 'format' });
    }
  }
  return { filled, notFound, unknown, failed };
}

/**
 * השלמה מקובץ גופן (‎.ttf/‎.otf, או אוסף ‎.ttc/‎.otc) שהגבאי העלה. הקובץ משלים את הגופנים באותו שם,
 * וגופן בלי שם – כשרוחב האותיות שלו זהה. אם בלוח יש רק משפחת גופן אחת שחסרות בה אותיות – משלים אותה בכל מקרה.
 * מחזיר את שמות הגופנים שהושלמו, או זורק שגיאה עם הסבר
 */
export async function fillFromFile(fonts, file) {
  const list = await parseAll(await file.arrayBuffer());
  if (!list.length) throw new Error('לא ניתן לקרוא את קובץ הגופן. צריך קובץ ‎.ttf, ‎.otf או ‎.ttc.');
  const need = fontsToFill(fonts);
  // [גופן בלוח, הגופן המתאים לו מהקובץ (רגיל או מודגש, כשהקובץ הוא אוסף)]
  let hit = [];
  for (const [, f] of need) {
    const src = isUnnamed(f) ? await matchByWidths(f, list)
      : list.some(x => x.names.includes(norm(f.family)) || x.names.includes(norm(psName(f)))) ? pick(f, list) : null;
    if (src) hit.push([f, src]);
  }
  if (!hit.length && new Set(need.map(([, f]) => f.family)).size === 1) hit = need.map(([, f]) => [f, pick(f, list)]);
  if (!hit.length) {
    throw new Error('הקובץ הוא הגופן ' + list.map(x => x.title).join(', ') + ', והוא לא מתאים לגופנים שבלוח: ' +
      [...new Set(need.map(([, f]) => fontLabel(f)))].join(', ') + '.');
  }
  const done = new Map();
  for (const [f, src] of hit) {
    if (!done.has(src)) done.set(src, await subset(src.font));
    f.full = done.get(src);
    if (isUnnamed(f)) f.realName = src.title;
  }
  return [...new Set(hit.map(([f]) => fontLabel(f)))];
}

/** הגופן מהרשימה שהכי מתאים לגופן מה-PDF: לפי השם המלא, אחר כך משפחה ומשקל */
function pick(f, list) {
  const ps = norm(psName(f)), fam = norm(f.family);
  const sameFam = list.filter(x => x.names.includes(fam));
  const pool = sameFam.length ? sameFam : list;
  // השם המלא מול שם ה-PostScript בלבד: "David" הוא גם שם המשפחה של David-Bold
  return list.find(x => x.ps === ps) || pool.find(x => x.bold === !!f.bold) || pool[0];
}

/**
 * כל הגופנים בקובץ: [{ font, names (מנורמלים), ps, title, bold, italic }]. גופן שלא ניתן לקרוא מדולג.
 * lowMemory: צורות האותיות נקראות רק כשצריך – לסריקה מהירה של כל הגופנים שבמחשב
 */
async function parseAll(buf, lowMemory = false) {
  const opentype = await loadOpentype();
  const out = [];
  for (const b of splitCollection(buf)) {
    let font;
    try { font = opentype.parse(b, { lowMemory }); } catch (e) { continue; }
    const n = font.names, os2 = font.tables.os2;
    const vals = k => n[k] ? Object.values(n[k]) : [];
    out.push({ font, title: vals('fullName')[0] || vals('fontFamily')[0] || '', ps: norm(vals('postScriptName')[0]),
      names: ['fontFamily', 'postScriptName', 'fullName', 'preferredFamily'].flatMap(vals).map(norm),
      bold: ((os2 && os2.usWeightClass) || 400) >= 600, italic: !!(os2 && os2.fsSelection & 1) });
  }
  return out;
}

/**
 * פירוק אוסף גופנים (‎.ttc/‎.otc – מתחיל ב-"ttcf") לקבצי גופן בודדים, כי opentype.js קורא רק גופן בודד.
 * כל גופן באוסף הוא טבלת תוכן שמצביעה על טבלאות משותפות – מעתיקים את הטבלאות שלו לקובץ חדש.
 * קובץ שאינו אוסף מוחזר כמו שהוא
 */
function splitCollection(buf) {
  const v = new DataView(buf);
  if (buf.byteLength < 12 || v.getUint32(0) !== 0x74746366) return [buf];
  const out = [];
  for (let i = 0, n = v.getUint32(8); i < n; i++) {
    try {
      const off = v.getUint32(12 + i * 4), count = v.getUint16(off + 4);
      const tables = [];
      for (let t = 0; t < count; t++) {
        const r = off + 12 + t * 16;
        tables.push({ tag: v.getUint32(r), sum: v.getUint32(r + 4), offset: v.getUint32(r + 8), length: v.getUint32(r + 12) });
      }
      const pad = n => (n + 3) & ~3;
      const head = 12 + count * 16;
      const res = new ArrayBuffer(head + tables.reduce((s, t) => s + pad(t.length), 0));
      const o = new DataView(res), bytes = new Uint8Array(res);
      bytes.set(new Uint8Array(buf, off, 12), 0);
      let pos = head;
      tables.forEach((t, j) => {
        const r = 12 + j * 16;
        o.setUint32(r, t.tag); o.setUint32(r + 4, t.sum); o.setUint32(r + 8, pos); o.setUint32(r + 12, t.length);
        bytes.set(new Uint8Array(buf, t.offset, t.length), pos);
        pos += pad(t.length);
      });
      out.push(res);
    } catch (e) { /* גופן פגום באוסף */ }
  }
  return out;
}

let opentypePromise = null;
function loadOpentype() {
  if (!opentypePromise) opentypePromise = import(OPENTYPE).then(m => m.default || m).catch(e => {
    opentypePromise = null;
    throw Object.assign(new Error('לא ניתן לטעון את רכיב קריאת הגופנים. בדקו את החיבור לאינטרנט ונסו שוב.'), { code: 'network' });
  });
  return opentypePromise;
}

/** גופן חדש (base64) רק עם התווים שב-RANGES. זורק שגיאה אם אין בגופן אותיות עבריות */
async function subset(src) {
  const opentype = await loadOpentype();
  const notdef = src.glyphs.get(0);
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: notdef.advanceWidth || src.unitsPerEm / 2, path: new opentype.Path() })];
  let heb = 0;
  for (const [a, b] of RANGES) for (let code = a; code <= b; code++) {
    const g = src.charToGlyph(String.fromCharCode(code));
    if (!g || g.index === 0) continue;
    if (code >= 0x05d0 && code <= 0x05ea) heb++;
    glyphs.push(new opentype.Glyph({ name: 'u' + code.toString(16), unicode: code, advanceWidth: g.advanceWidth, path: g.path }));
  }
  if (heb < 20) throw Object.assign(new Error('בגופן הזה אין אותיות עבריות.'), { code: 'noHebrew' });
  const out = new opentype.Font({ familyName: 'TplFill', styleName: 'Regular', unitsPerEm: src.unitsPerEm,
    ascender: src.ascender, descender: src.descender, glyphs });
  const bytes = new Uint8Array(out.toArrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
