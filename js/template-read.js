/**
 * קריאת לוח ישן (PDF או תמונה) כתבנית: ציור העמוד, חילוץ הטקסט עם המיקומים,
 * זיהוי שעות, תאריכים ופרשה, והסקת הכללים (למשל "מנחה = שקיעה פחות 40").
 * ספריית pdf.js נטענת רק כשמעלים קובץ PDF, ו-Tesseract.js (זיהוי טקסט בתמונה) רק כשמעלים תמונה.
 */

import { hm, toDayNum, dow, DAY_MS } from './dates.js';
import { PARSHIYOT, fromHebrew, toHebrew, isLeap, TISHREI, CHESHVAN, KISLEV, TEVET, SHVAT, ADAR, ADAR2, NISAN, IYYAR, SIVAN, TAMUZ, AV, ELUL } from './hebrew.js';
import { timesFor, applyOffset, findOccasion } from './luach.js';

const PDFJS = new URL('../vendor/pdfjs/', import.meta.url).href;   // pdf.js 6.3.289, רישיון Apache 2.0
const PAGE_W = 1600;   // רוחב התבנית בפיקסלים

let pdfjsPromise;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS + 'pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
      return m;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

// Tesseract.js 7.0.0 (רישיון Apache 2.0) ומודל העברית נטענים מהרשת בפעם הראשונה, והמודל נשמר בדפדפן
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
const OCR_W = 2400;   // רוחב התמונה לזיהוי: בתמונה קטנה הזיהוי גרוע, ובגדולה מדי הוא איטי

/* ---------- קריאת הקובץ ---------- */

/**
 * מחזיר { canvas, items } – העמוד הראשון כתמונה, ופריטי הטקסט עם תיבות בפיקסלים.
 * לתמונה או ל-PDF סרוק items ריק.
 */
export async function readFile(file, onStatus = () => {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? readPdf(file) : readImage(file, onStatus);
}

async function readPdf(file) {
  const pdfjs = await loadPdfjs();
  // fontExtraProperties: שומר את קובצי הגופנים אחרי הציור, כדי שאפשר יהיה לכתוב בהם את הערכים החדשים
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, fontExtraProperties: true });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const scale = PAGE_W / page.getViewport({ scale: 1 }).width;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    const str = fixVisualOrder(String(it.str || '').replace(/\s+/g, ' ').trim());
    if (!str) continue;
    const tx = pdfjs.Util.transform(vp.transform, it.transform);
    // נטוי מ-Word בגופן שאין לו גרסה נטויה (כמו רוב הגופנים העבריים): האותיות מוטות במטריצה ולא בגופן
    const italic = Math.abs(tx[1]) < Math.abs(tx[0]) * 0.05 && Math.abs(tx[2]) > Math.abs(tx[3]) * 0.1;
    const size = italic ? Math.abs(tx[3]) : Math.hypot(tx[2], tx[3]);
    if (size < 4) continue;
    const w = it.width * scale;
    const baseline = tx[5];
    items.push({ str, x: tx[4], w, baseline, size, y: baseline - size * 0.92, h: size * 1.2, rtl: it.dir === 'rtl' || /[א-ת]/.test(str), font: it.fontName,
      ...(italic ? { italic } : {}) });
  }
  let fonts = {};
  try { fonts = await readFonts(pdfjs, page); } catch (e) { console.warn('לא ניתן לקרוא את הגופנים מהקובץ', e); }
  let docDayNum = null;
  try {
    const meta = await doc.getMetadata();
    const raw = meta && meta.info && (meta.info.CreationDate || meta.info.ModDate);
    docDayNum = parsePdfDate(raw);
  } catch (e) { /* אין מטא-דאטה בקובץ */ }
  task.destroy();
  return { canvas, items: joinFragments(items), fonts, docDayNum };
}

/**
 * ב-Word ובעוד תוכנות טקסט נשמר לפעמים בכמה פריטים צמודים: שעה ("1", "8", ":", "24")
 * או כותרת ("מנחה ערב", "שבת"). מחברים פריטים סמוכים באותה שורה – ספרות עם ספרות ועברית עם עברית –
 * כדי שהשעה והתווית שלה יזוהו בשלמותן.
 */
export function joinFragments(items) {
  const kindOf = it => /^[\d:.]+$/.test(it.str) ? 'num' : /^[א-ת"'״׳,.()\s\-–־]+$/.test(it.str) && /[א-ת]/.test(it.str) ? 'heb' : null;
  const list = items.map((it, i) => ({ ...it, i, k: kindOf(it) }));
  const joinable = list.filter(it => it.k).sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const runs = [];
  let run = null;
  for (const it of joinable) {
    const gap = run ? it.x - (run.x + run.w) : 0;
    const touches = run && run.k === it.k && Math.abs(it.baseline - run.baseline) < run.size * 0.3 &&
      Math.abs(it.size - run.size) < run.size * 0.1 && gap > -run.size * 0.3 && gap < run.size * (it.k === 'num' ? 0.15 : 0.5);
    if (touches) {
      // עברית: הפריט השמאלי בא אחרי הקודם בטקסט. רווח רק כשיש רווח גם בדף
      const sp = it.k === 'heb' && gap > run.size * 0.15 && !/[-–־]$/.test(it.str) && !/^[-–־]/.test(run.str) ? ' ' : '';
      run.str = it.k === 'heb' ? it.str + sp + run.str : run.str + it.str;
      run.w = it.x + it.w - run.x; run.i = Math.min(run.i, it.i);
      continue;
    }
    run = { ...it };
    runs.push(run);
  }
  // כל רצף נכנס במקום הפריט הראשון שלו, כדי שסדר האזורים יישאר כמו בקובץ
  const at = new Map(runs.map(r => [r.i, r]));
  return list.flatMap(({ i, k, ...it }) => !k ? [it] : at.has(i) ? [(({ i: _, k: __, ...r }) => r)(at.get(i))] : []);
}

/**
 * הגופנים שבקובץ. pdf.js ממיר כל גופן מוטמע לקובץ OpenType שבו כל אות נמצאת בקוד פרטי (PUA),
 * ולכן שומרים גם מפה מהאות האמיתית לקוד שבגופן, לפי האותיות שמופיעות בעמוד.
 * גופן מוטמע הוא בדרך כלל חלקי – יש בו רק האותיות שהיו בקובץ.
 * מחזיר { [שם פנימי]: { family, ps (השם המלא), bold, italic, serif, data (base64) או null, map } }
 */
async function readFonts(pdfjs, page) {
  const ops = await page.getOperatorList();
  const maps = {};
  let cur = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === pdfjs.OPS.setFont) { cur = args[0]; maps[cur] = maps[cur] || {}; continue; }
    if (fn !== pdfjs.OPS.showText || !cur) continue;
    for (const g of args[0]) {
      if (!g || typeof g !== 'object' || !g.fontChar || typeof g.unicode !== 'string') continue;
      const u = [...g.unicode];
      // רווח לא נשמר: בגופן המומר הוא מופיע כריבוע
      if (u.length === 1 && !/\s/.test(u[0]) && !(u[0] in maps[cur])) maps[cur][u[0]] = g.fontChar;
    }
  }
  const out = {};
  for (const name of Object.keys(maps)) {
    let f;
    try { f = page.commonObjs.get(name); } catch (e) { continue; }
    if (!f || f.isType3Font) continue;
    const raw = String(f.name || '');
    const data = f.data && !f.missingFile && !f.disableFontFace ? toBase64(f.data) : null;
    out[name] = { family: familyName(raw), ps: raw.replace(/^[A-Z]{6}\+/, ''), bold: !!f.bold || /bold|black|heavy/i.test(raw), italic: !!f.italic || /italic|oblique/i.test(raw),
      serif: f.fallbackName === 'serif', data, map: data ? maps[name] : null };
  }
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** שם גופן להצגה ולגופן מערכת: "ABCDEF+TimesNewRomanPS-BoldMT" ← "Times New Roman" */
function familyName(raw) {
  const n = raw.replace(/^[A-Z]{6}\+/, '').replace(/[-,](Bold|Italic|Regular|Black|Light|Medium|Oblique|Heavy|Semi\w*|Demi\w*)+.*$/i, '')
    .replace(/(PSMT|PS|MT)$/, '').replace(/(Bold|Italic|Regular)+$/i, '');
  return /\s/.test(n) ? n : n.replace(/([a-z])([A-Z])/g, '$1 $2');
}

async function readImage(file, onStatus) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, PAGE_W / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const docDayNum = file.lastModified ? Math.floor(file.lastModified / DAY_MS) : null;
  // בלי חיבור לרשת או כשהזיהוי נכשל: התמונה עדיין נפתחת, ומסמנים אזורים ידנית
  let items = [];
  try { items = joinFragments(await ocrImage(bmp, canvas.width / OCR_W, onStatus)); }
  catch (e) { console.warn('לא ניתן לזהות טקסט בתמונה', e); }
  bmp.close();
  return { canvas, items, fonts: {}, docDayNum };
}

/**
 * זיהוי הטקסט בתמונה (OCR). מחזיר פריטים באותה צורה כמו ב-PDF – מילה לכל פריט,
 * ו-joinFragments מחבר מילים סמוכות. k: היחס בין התמונה שנשלחת לזיהוי לבין התבנית.
 * מודל העברית קורא שעות גרוע ("16:42" נקרא "12"), ומודל האנגלית משבש עברית – לכן יש שני מעברים:
 * מהעברי לוקחים את המילים, ומהאנגלי את המספרים והשעות.
 */
async function ocrImage(bmp, k, onStatus) {
  const src = document.createElement('canvas');
  src.width = OCR_W; src.height = Math.round(bmp.height * OCR_W / bmp.width);
  const ctx = src.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, src.width, src.height);
  ctx.drawImage(bmp, 0, 0, src.width, src.height);

  onStatus('טוען את זיהוי הטקסט…');
  const { createWorker, PSM } = (await import(TESSERACT)).default;
  const progress = [0, 0];
  const pass = async (lang, i) => {
    const worker = await createWorker(lang, 1, {
      logger: m => {
        if (m.status !== 'recognizing text') return;
        progress[i] = m.progress;
        onStatus('מזהה טקסט בתמונה… ' + Math.round((progress[0] + progress[1]) * 50) + '%');
      },
    });
    try {
      // טקסט מפוזר: בלוח יש טבלאות ותוויות בודדות, לא פסקאות
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const { data } = await worker.recognize(src, {}, { blocks: true });
      return (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines));
    } finally {
      await worker.terminate();
    }
  };
  const [hebLines, engLines] = await Promise.all([pass('heb', 0), pass('eng', 1)]);

  // מירכאות "חכמות" שהזיהוי מחזיר לפעמים (כ”ג, ה’) הופכות לגרשיים רגילים, כדי שהתאריך העברי ייקרא
  const clean = w => String(w.text || '').replace(/[”“„]|''/g, '"').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
  const isNum = s => /\d/.test(s) && /^[\d:.\/\-–()]+$/.test(s);
  const item = (str, b, baseline, size) => ({ str, x: b.x0 * k, w: (b.x1 - b.x0) * k, baseline: baseline * k, size: size * k,
    y: (baseline - size * 0.92) * k, h: size * 1.2 * k, rtl: /[א-ת]/.test(str) });

  // שתי מילים באותו מקום (למשל "הרב" נקרא במעבר האנגלי "77"): נשארת זו שהזיהוי שלה בטוח יותר
  const area = b => (b.x1 - b.x0) * (b.y1 - b.y0);
  const overlaps = (a, b) => {
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return ix > 0 && iy > 0 && ix * iy > Math.min(area(a), area(b)) * 0.3;
  };
  const numsOf = lines => lines.flatMap(l => l.words).filter(w => w.confidence >= 60 && isNum(clean(w)));
  // שעה שרק המעבר העברי קרא – נכנסת גם היא
  const engNums = numsOf(engLines);
  engNums.push(...numsOf(hebLines).filter(w => !engNums.some(o => overlaps(w.bbox, o.bbox))));
  // מילה בעברית עם ביטחון נמוך נשארת כשהיא בשורה שזוהתה היטב: Tesseract נותן לפעמים 0 למילה שנקראה נכון ("ה' באדר")
  const hebWords = new Map(hebLines.map(line => {
    const good = line.words.some(w => w.confidence >= 80 && /[א-ת]{2}/.test(clean(w)));
    return [line, line.words.filter(w => {
      const str = clean(w);
      // כתמים קטנים (קווים, קישוטים) מזוהים לפעמים כאות בודדת
      if (!/[א-תA-Za-z]/.test(str) || /\d/.test(str) || Math.min(w.bbox.x1 - w.bbox.x0, w.bbox.y1 - w.bbox.y0) < 12) return false;
      return w.confidence >= 60 || (good && /[א-ת]/.test(str) && !/[A-Za-z]/.test(str));
    })];
  }));
  const allHeb = [...hebWords.values()].flat();
  const beats = (w, others) => !others.some(o => overlaps(w.bbox, o.bbox) && o.confidence > w.confidence);

  // ספרות: הגובה שלהן הוא בערך 0.72 מגודל הגופן, והן יושבות על קו הבסיס.
  // הגובה והבסיס לפי הספרות עצמן: תיבת המילה כוללת לפעמים גם מסגרת או רקע כהה סביב השעה
  const digitBox = w => {
    const ds = (w.symbols || []).filter(s => /\d/.test(s.text));
    if (!ds.length) return { h: w.bbox.y1 - w.bbox.y0, base: w.bbox.y1 };
    const mid = list => list.sort((a, b) => a - b)[list.length >> 1];
    return { h: mid(ds.map(s => s.bbox.y1 - s.bbox.y0)), base: mid(ds.map(s => s.bbox.y1)) };
  };
  const nums = engNums.filter(w => beats(w, allHeb)).map(w => {
    const d = digitBox(w);
    return item(clean(w), w.bbox, d.base, d.h / 0.72);
  });

  const items = [];
  for (const line of hebLines) {
    const words = hebWords.get(line).filter(w => beats(w, engNums)).map(w => ({ w, str: clean(w) }));
    if (!words.length) continue;
    // גודל הגופן לפי המילה הנמוכה בשורה: רוב האותיות בעברית בלי עולים ויורדים, בגובה של כ-0.55 מהגופן
    const size = Math.min(...words.map(({ w }) => w.bbox.y1 - w.bbox.y0)) / 0.55;
    // מילים סמוכות באותה שורה הן ביטוי אחד ("מנחה ערב שבת"). הרווחים בזיהוי גדולים יותר מאשר ב-PDF
    const phrases = [];
    for (const { w, str } of words) {
      const prev = phrases[phrases.length - 1];
      if (prev && /[א-ת]/.test(str) && /[א-ת]/.test(prev.str) && Math.abs(prev.b.x0 - w.bbox.x1) < size * 0.8) {
        prev.str += ' ' + str;
        prev.b = { x0: Math.min(prev.b.x0, w.bbox.x0), x1: Math.max(prev.b.x1, w.bbox.x1) };
      } else phrases.push({ str, b: { x0: w.bbox.x0, x1: w.bbox.x1 } });
    }
    const lb = line.baseline;
    for (const { str, b } of phrases) {
      // קו הבסיס של השורה, בנקודת האמצע של הביטוי (השורה יכולה להיות מעט עקומה בצילום)
      const cx = (b.x0 + b.x1) / 2;
      const baseline = lb.x1 !== lb.x0 ? lb.y0 + (lb.y1 - lb.y0) * (cx - lb.x0) / (lb.x1 - lb.x0) : line.bbox.y1;
      items.push(item(str, b, baseline, size));
    }
  }
  // סדר קריאה: מלמעלה למטה ומימין לשמאל
  return items.concat(nums).sort((a, b) => a.baseline - b.baseline || b.x - a.x);
}

/** תאריך יצירה/עדכון מהמטא-דאטה של PDF ("D:20260504153000+03'00'") */
function parsePdfDate(raw) {
  const m = /D:(\d{4})(\d{2})(\d{2})/.exec(String(raw || ''));
  if (!m) return null;
  const d = toDayNum(m[1] + '-' + m[2] + '-' + m[3]);
  return isFinite(d) ? d : null;
}

/**
 * יש קובצי PDF שבהם העברית שמורה הפוכה (סדר ויזואלי). מזהים לפי אותיות סופיות:
 * בטקסט תקין הן בסוף מילה, בטקסט הפוך – בתחילתה.
 */
function fixVisualOrder(s) {
  let atStart = 0, atEnd = 0;
  for (const w of s.match(/[א-ת]{2,}/g) || []) {
    if (/[ךםןףץ]/.test(w[0])) atStart++;
    if (/[ךםןףץ]/.test(w[w.length - 1])) atEnd++;
  }
  if (atStart <= atEnd) return s;
  return s.split('').reverse().join('')
    .replace(/[0-9A-Za-z:./-]+/g, m => m.split('').reverse().join(''))
    .replace(/[()]/g, c => c === '(' ? ')' : '(');
}

/* ---------- פירוק לאסימונים: שעות, תאריכים וטקסט ---------- */

const TIME_RE = /(?<![\d:./])(\d{1,2}):(\d{2})(?![\d:])/g;
const GREG_RE = /(?<!\d)(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/;
const HEB_MONTHS = [['מרחשון', CHESHVAN], ['חשוון', CHESHVAN], ['חשון', CHESHVAN], ['תשרי', TISHREI], ['כסליו', KISLEV], ['כסלו', KISLEV],
  ['טבת', TEVET], ['שבט', SHVAT], ['אדר שני', ADAR2], ['אדר ראשון', ADAR], ['אדר ב', ADAR2], ['אדר א', ADAR], ['אדר', ADAR],
  ['ניסן', NISAN], ['אייר', IYYAR], ['סיוון', SIVAN], ['סיון', SIVAN], ['תמוז', TAMUZ], ['אלול', ELUL], ['אב', AV]];
// אחרי שם החודש לא באה אות, כדי ש"רח' אברהם" לא ייקרא "ח' אב".
// השנה: "תשפ"ו", "ה'תשפ"ו" או בלי גרשיים ("תשפו"). קבוצה 3 – ה' שלפני השנה, קבוצה 4 – השנה
const HEB_DATE_RE = new RegExp('(?:^|\\s)([א-ת]{1,2}["\'״׳]?[א-ת]?)\\s+(?:ב|ל)?(' + HEB_MONTHS.map(m => m[0]).join('|') +
  ')[\'׳]?(?![א-ת])(?:\\s*[,.]?\\s+(ה[\'׳]?\\s*)?(ת[א-ת]{0,2}["״]?[א-ת])(?![א-ת]))?');
const isGregDate = s => { const m = GREG_RE.exec(s); return !!m && +m[1] >= 1 && +m[1] <= 31 && +m[3] >= 1 && +m[3] <= 12; };
const isHebDate = s => { const m = HEB_DATE_RE.exec(s); if (!m) return false; const d = gemValue(m[1]); return d >= 1 && d <= 30; };
// "רח' הרצל 3", "רחוב…", "שד' ירושלים", "כתובת: …"
const ADDRESS_RE = /(?:^|[^א-ת])ב?(?:רח['׳"]?|רחוב|שד['׳]|שדרות|סמ['׳]|סמטת|כיכר|ככר|כתובת)(?![א-ת])\s*:?\s*[א-ת]/;
// שורה שמתחילה ב"בית הכנסת …", "קהילת …", "ק"ק …". רק בתחילת שורה, כדי ש"אין להביא לשטח בית הכנסת מוצרים" לא ייתפס.
// "בית ה כנסת": בקובץ המילים נשמרות לפעמים בפריטים נפרדים
const SHUL_RE = /^(?:ב["״]ה\s+)?(?:ק["״]ק|קהילת|קהילה קדושה|ביהכנ["״]ס|בית\s*ה?\s*כנסת)(?![א-ת])\s*[-:–]?\s*(.+)$/;

let measureCtx;
function textWidth(s, size) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = size + 'px Arial';
  return measureCtx.measureText(s).width;
}

/**
 * מפרק כל פריט טקסט לאסימונים: שעה (time) או טקסט (text). כשבפריט אחד יש גם תווית וגם שעה
 * ("מנחה 17:40"), המיקום של השעה בתוך הפריט מוערך לפי רוחב התווים.
 */
export function tokenize(items) {
  const tokens = [];
  for (const raw of items) {
    const it = trimSeparators(raw);
    if (!it) continue;
    const matches = [...it.str.matchAll(TIME_RE)];
    if (!matches.length) { pushText(tokens, it); continue; }
    // הטקסט שבין השעות ("הדלקת נרות 18:24 | שקיעה 19:04") – כל קטע עם התיבה שלו, כדי שכל שעה תמצא את התווית שלידה
    const segs = [];
    let last = 0;
    for (const m of matches) {
      tokens.push({ ...it, ...subBox(it, m.index, m[0]), str: m[0], kind: 'time', minutes: +m[1] * 60 + +m[2] });
      segs.push([last, it.str.slice(last, m.index)]);
      last = m.index + m[0].length;
    }
    segs.push([last, it.str.slice(last)]);
    for (const [at, s] of segs) {
      const lead = /^[\s|:–-]*/.exec(s)[0].length;
      const txt = s.replace(/^[\s|:–-]+|[\s|:–-]+$/g, '');
      if (txt && /[א-תA-Za-z]/.test(txt)) tokens.push({ ...it, ...subBox(it, at + lead, txt), str: txt, kind: classifyText(txt), partOf: true });
    }
  }
  return joinParashaPairs(joinAddress(tokens));
}

/** כתובת שנשמרה בכמה פריטים ("רח' אברהם כחילה", "3", "גן חב"ד"): מצרפים את ההמשך שמשמאל באותה שורה */
function joinAddress(tokens) {
  const drop = new Set();
  for (const a of tokens) {
    if (a.kind !== 'address') continue;
    for (;;) {
      const next = tokens.find(t => t !== a && !drop.has(t) && t.kind === 'text' && sameLine(t, a) &&
        Math.abs(t.size - a.size) < a.size * 0.3 && a.x - (t.x + t.w) < a.size * 2.5 && t.x < a.x);
      if (!next) break;
      a.str = a.str + ' ' + next.str;
      a.w = a.x + a.w - next.x; a.x = next.x;
      drop.add(next);
    }
  }
  return tokens.filter(t => !drop.has(t));
}

/** המיקום המשוער של קטע טקסט בתוך פריט, לפי רוחב התווים */
function subBox(it, index, s) {
  const total = textWidth(it.str, it.size) || 1;
  const w = it.w * textWidth(s, it.size) / total;
  const before = textWidth(it.str.slice(0, index), it.size) / total;
  // בפריט מימין לשמאל, מה שבא קודם בטקסט נמצא מימין
  return { x: it.rtl ? it.x + it.w * (1 - before) - w : it.x + it.w * before, w };
}

/** שם פרשה בכתיב חסר או מלא: "נצבים" מתאים גם ל"ניצבים", "חוקת" ל"חקת" */
const spellings = name => [...name].map((c, i) => c === ' ' ? '\\s+' : i > 0 && /[יו]/.test(c) ? '' : c + '[יו]*').join('');
const NAMES = '(?:' + [...PARSHIYOT].sort((a, b) => b.length - a.length).map(spellings).join('|') + ')(?![א-ת])';
const PAIR = NAMES + '(?:\\s*[-–־]\\s*' + NAMES + ')?';
const PARASHA_RE = new RegExp('פרשת\\s+' + PAIR);
// "לשבת ניצבים-וילך", "שבת קודש וירא" – בלי המילה "פרשת". האזור כולל את "לשבת", שנשמר כטקסט קבוע לפני השם
const NAME_RE = new RegExp('(?:^|[^א-ת])(ל?שבת\\s+(?:קודש\\s+)?)(' + PAIR + ')');
const PREFIX_RE = /^ל?שבת(?:\s+קודש)?$/;
// המקף בקצה הפריט כבר הוסר ב-trimSeparators
const PAIR_TAIL_RE = new RegExp('^[-–־]?\\s*' + NAMES + '\\s*[-–־]?$');

// "שבת נחמו", "לשבת זכור", "פרשת שקלים" – שם של שבת מיוחדת, שמופיע רק בשבתות שיש להן שם כזה
const SPECIALS = 'שובה|שירה|שקלים|זכור|פרה|החודש|הגדול|חזון|נחמו';
const SPECIAL_RE = new RegExp('(?:^|[^א-ת])((?:ל?שבת|פרשת)\\s+(?:' + SPECIALS + '))(?![א-ת])');
const SPECIAL_WORD_RE = new RegExp('^(?:' + SPECIALS + ')$');

/** טקסט רגיל; אם יש בו פרשה באמצע שורה (למשל "זמני תפילות – פרשת וירא"), הפרשה הופכת לאזור נפרד */
function pushText(tokens, it) {
  // שבת מיוחדת הופכת לאזור נפרד, ומה שמשני צדדיה (למשל "שבת פרשת ואתחנן") נבדק בנפרד
  const sp = SPECIAL_RE.exec(it.str);
  if (sp) {
    const s = sp[1], at = sp.index + sp[0].length - s.length;
    tokens.push({ ...it, ...subBox(it, at, s), str: s, kind: 'special' });
    for (const [i, part] of [[0, it.str.slice(0, at)], [at + s.length, it.str.slice(at + s.length)]]) {
      const rest = /[א-ת]/.test(part) && trimSeparators({ ...it, ...subBox(it, i, part), str: part });
      if (rest) pushText(tokens, { ...rest, partOf: true });
    }
    return;
  }
  const kind = classifyText(it.str);
  let m = kind === 'text' && PARASHA_RE.exec(it.str), pk = 'parasha', at, s, prefix;
  if (m) { at = m.index; s = m[0]; }
  else if (kind === 'text' && (m = NAME_RE.exec(it.str))) {
    pk = 'parashaName'; s = m[1] + m[2]; at = m.index + m[0].length - s.length;
    prefix = m[1].replace(/\s+/g, ' ');
  }
  if (!m) { tokens.push({ ...it, kind }); return; }
  tokens.push({ ...it, ...subBox(it, at, s), str: s, kind: pk, ...(prefix ? { prefix } : {}) });
  const rest = (it.str.slice(0, at) + ' ' + it.str.slice(at + s.length)).replace(/[\s|–-]+/g, ' ').trim();
  if (/[א-ת]/.test(rest)) tokens.push({ ...it, ...restBox(it, at, s), str: rest, kind: 'text', partOf: true });
}

/** התיבה של מה שנשאר בפריט אחרי שהוצא ממנו קטע – הצד הגדול יותר */
function restBox(it, at, s) {
  const before = it.str.slice(0, at), after = it.str.slice(at + s.length);
  return before.trim().length >= after.trim().length ? subBox(it, 0, before) : subBox(it, at + s.length, after);
}

/** פרשות מחוברות שנשמרו בשני פריטים ("…ניצבים" ו"-וילך"): מחברים לאזור אחד */
function joinParashaPairs(tokens) {
  const drop = new Set();
  const absorb = (p, t) => {
    const x = Math.min(p.x, t.x);
    p.w = Math.max(p.x + p.w, t.x + t.w) - x; p.x = x;
    drop.add(t);
  };
  // שם פרשה בודד ("וילך") ש"לשבת" לפניו בפריט נפרד
  for (const t of tokens) {
    if (t.kind !== 'text' || !new RegExp('^' + PAIR + '$').test(t.str)) continue;
    const pre = tokens.find(x => x.kind === 'text' && !drop.has(x) && PREFIX_RE.test(x.str) && sameLine(x, t) &&
      x.x > t.x && x.x - (t.x + t.w) < t.size * 1.5);
    if (pre) { t.kind = 'parashaName'; t.prefix = pre.str.replace(/\s+/g, ' ') + ' '; t.str = pre.str + ' ' + t.str; absorb(t, pre); }
  }
  // "נחמו" בודד ש"שבת" לפניו בפריט נפרד
  for (const t of tokens) {
    if (t.kind !== 'text' || drop.has(t) || !SPECIAL_WORD_RE.test(t.str)) continue;
    const pre = tokens.find(x => x.kind === 'text' && !drop.has(x) && /^(?:ל?שבת|פרשת)$/.test(x.str) && sameLine(x, t) &&
      x.x > t.x && x.x - (t.x + t.w) < t.size * 1.5);
    if (pre) { t.kind = 'special'; t.str = pre.str + ' ' + t.str; absorb(t, pre); }
  }
  for (const p of tokens) {
    if (p.kind !== 'parasha' && p.kind !== 'parashaName') continue;
    if (new RegExp('[-–־]\\s*' + NAMES + '$').test(p.str)) continue;
    const tail = tokens.find(t => t.kind === 'text' && !drop.has(t) && PAIR_TAIL_RE.test(t.str) && sameLine(t, p) &&
      Math.abs(p.x - (t.x + t.w)) < p.size * 1.5 && Math.abs(t.x - p.x) > 1);
    if (!tail) continue;
    p.str = p.str + '-' + tail.str.replace(/^[-–־\s]+|[-–־\s]+$/g, '');
    absorb(p, tail);
  }
  return tokens.filter(t => !drop.has(t));
}

/** מסיר מפרידים (| • – ,) מקצות הפריט ומקטין את התיבה בהתאם */
function trimSeparators(it) {
  const m = /^([\s|•·–\-,]*)(.*?)([\s|•·–\-,]*)$/.exec(it.str);
  if (!m[2]) return null;
  if (!m[1] && !m[3]) return it;
  const total = textWidth(it.str, it.size) || 1;
  const lead = it.w * textWidth(m[1], it.size) / total, trail = it.w * textWidth(m[3], it.size) / total;
  // מימין לשמאל: ההתחלה בצד ימין והסוף בצד שמאל
  const x = it.rtl ? it.x + trail : it.x + lead;
  return { ...it, str: m[2], x, w: Math.max(1, it.w - lead - trail) };
}

function classifyText(s) {
  if (isGregDate(s)) return 'gregDate';
  if (isHebDate(s)) return 'hebDate';
  if (ADDRESS_RE.test(s)) return 'address';
  if (/^שבת\s+פרשת/.test(s)) return 'title';
  if (/^פרשת\s/.test(s)) return 'parasha';
  return 'text';
}

/* ---------- זיהוי התאריך של הלוח הישן ---------- */

const gemValue = s => [...s.replace(/["'״׳]/g, '')].reduce((a, c) => a + ({
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40,
  'נ': 50, 'ן': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400
}[c] || 0), 0);

/** תאריך עברי ← dayNum. "אדר ב'" בשנה פשוטה הוא אדר */
const hebDay = (y, m, d) => fromHebrew(y, m === ADAR2 && !isLeap(y) ? ADAR : m, d);

/**
 * התאריך העברי שבקובץ: { d, m, y } (y=null כשאין שנה), או null. מחפשים באזור תאריך עברי,
 * ואם אין – בשורות שלמות, כי לפעמים היום, החודש והשנה שמורים בפריטים נפרדים ("כ"ג", "אלול", "תשפ"ו").
 * תאריך עם שנה עדיף על תאריך בלי שנה.
 */
export function detectHebDate(tokens) {
  const strs = [...tokens.filter(t => t.kind === 'hebDate').map(t => t.str), ...textLines(tokens).map(l => l.str)];
  let noYear = null;
  for (const s of strs) {
    const m = HEB_DATE_RE.exec(s);
    const d = m && gemValue(m[1]);
    if (!m || d < 1 || d > 30) continue;
    const month = HEB_MONTHS.find(x => x[0] === m[2])[1];
    const y = m[4] ? 5000 + gemValue(m[4]) : null;
    if (y >= 5700 && y <= 5999) return { d, m: month, y };
    noYear = noYear || { d, m: month, y: null };
  }
  return noYear;
}

/** הימים שבהם חל תאריך עברי בלי שנה, בטווח השנים שבו מחפשים לוחות ישנים */
function hebCandidates(h) {
  const today = Math.floor(Date.now() / DAY_MS), y0 = toHebrew(today).y;
  const out = [];
  for (let y = y0 - 13; y <= y0 + 1; y++) {
    const d = hebDay(y, h.m, h.d);
    // ל' בחודש של 29 יום אינו קיים באותה שנה
    if (toHebrew(d).d === h.d && d >= today - 365 * 12 && d <= today + 120) out.push(d);
  }
  return out;
}

/**
 * מנסה למצוא בקובץ את תאריך הלוח: תאריך לועזי, או תאריך עברי עם שנה. תאריך עברי בלי שנה
 * נקבע לפי תאריך היצירה של הקובץ (docDayNum), אם הוא קרוב אליו. מחזיר dayNum או null
 */
export function detectDate(tokens, docDayNum) {
  for (const t of tokens) {
    const m = t.kind === 'gregDate' && GREG_RE.exec(t.str);
    if (m) {
      const y = m[4].length === 2 ? 2000 + +m[4] : +m[4];
      const d = toDayNum(y + '-' + String(m[3]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'));
      if (isFinite(d)) return d;
    }
  }
  const h = detectHebDate(tokens);
  if (!h) return null;
  if (h.y) return hebDay(h.y, h.m, h.d);
  if (docDayNum != null) {
    const near = hebCandidates(h).filter(d => d - docDayNum >= -7 && d - docDayNum <= 45);
    if (near.length === 1) return near[0];
  }
  return null;
}

/** שם הפרשה הקנוני (כמו ב-PARSHIYOT) שמתאים לטקסט שזוהה בקובץ ("לשבת ניצבים-וילך" וכו'), או null */
function canonicalParasha(text) {
  const cleaned = String(text || '').replace(/^ל?שבת\s+(?:קודש\s+)?/, '').replace(/^פרשת\s+/, '').trim();
  if (!cleaned) return null;
  for (let i = 0; i < PARSHIYOT.length; i++) {
    const pair = i + 1 < PARSHIYOT.length ? PARSHIYOT[i] + '-' + PARSHIYOT[i + 1] : null;
    if (pair && new RegExp('^' + spellings(pair) + '$').test(cleaned)) return pair;
    if (new RegExp('^' + spellings(PARSHIYOT[i]) + '$').test(cleaned)) return PARSHIYOT[i];
  }
  return null;
}

const parseHM = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
/** היום שאליו מתייחס אזור זמן לפי ה"מתי" שלו: ערב (כניסה), מוצאי (יציאה), או היום עצמו */
const dayForWhen = (occ, when) => when === 'כניסה' ? occ.erev : when === 'יציאה' ? occ.last : occ.first;

/**
 * ניחוש התאריך של לוח ישן בלי תאריך מפורש בקובץ, לפי שם הפרשה (name – הטקסט שזוהה באזור
 * הפרשה) והזמנים שכבר זוהו באזורי "זמן היום" (slots): מחפשים בטווח שנים את כל השבתות
 * שבהן חלה אותה פרשה, ובוחרים לפי ההתאמה הטובה ביותר בין הזמנים בקובץ לזמנים המחושבים
 * לאותה שבת. אם אין התאמה מספיק ברורה – לפי הקִרבה לתאריך היצירה של הקובץ (docDayNum),
 * רק אם הפער סביר (לוח נכתב בדרך כלל זמן קצר לפני השבת, לא חודשים לפני).
 * heb – תאריך עברי בלי שנה מהקובץ ({ d, m }), אם יש: מצמצם את השבתות לאלה שחלות בו
 * (או שערב השבת חל בו), וגם בלי שם פרשה אפשר לנחש לפיו.
 */
export function guessOldDay(name, slots, cfg, docDayNum, heb) {
  const target = canonicalParasha(name);
  if (!target && !heb) return null;
  const today = Math.floor(Date.now() / DAY_MS);
  const from = today - 365 * 12, to = today + 120;
  let occs = [];
  for (let d = from; target && d <= to;) {
    const occ = findOccasion(d, cfg.il, 1);
    if (!occ || occ.first > to) break;
    if (occ.days.some(x => x.parasha === target)) occs.push(occ);
    d = occ.last + 1;
  }
  if (heb) {
    const cands = hebCandidates(heb);
    const inHeb = occ => cands.some(c => c >= occ.erev && c <= occ.last);
    // פרשה ותאריך שלא מתאימים זה לזה (אחד מהם נקרא לא נכון): נשארים עם הפרשה
    if (target) { const f = occs.filter(inHeb); if (f.length) occs = f; }
    else for (const c of cands) { const occ = findOccasion(c, cfg.il, 1); if (occ && inHeb(occ)) occs.push(occ); }
  }
  if (!occs.length) return null;
  if (occs.length === 1) return occs[0].first;

  const anchors = (slots || []).filter(s => s.kind === 'zman' && parseHM(s.old) != null)
    .map(s => ({ min: parseHM(s.old), key: s.zman, when: s.when }));
  if (anchors.length) {
    const scored = occs.map(occ => {
      let total = 0, n = 0;
      for (const a of anchors) {
        const t = timesFor(cfg, dayForWhen(occ, a.when));
        const ms = t[a.key];
        if (ms == null) continue;
        const [h, m] = hm(ms, cfg.tz).split(':').map(Number);
        total += Math.abs(a.min - (h * 60 + m)); n++;
      }
      return { occ, avg: n ? total / n : null };
    }).filter(x => x.avg != null);
    scored.sort((a, b) => a.avg - b.avg);
    if (scored.length && scored[0].avg <= 5 && (scored.length < 2 || scored[1].avg - scored[0].avg >= 3)) return scored[0].occ.first;
  }

  if (docDayNum != null) {
    const near = occs.map(occ => ({ occ, diff: occ.first - docDayNum })).filter(x => x.diff >= -7 && x.diff <= 45)
      .sort((a, b) => a.diff - b.diff);
    if (near.length === 1 || (near.length > 1 && near[1].diff - near[0].diff >= 7)) return near[0].occ.first;
  }
  return null;
}

/** שורות הטקסט בעמוד: פריטים באותה שורה ובאותו גודל, מחוברים מימין לשמאל */
function textLines(tokens) {
  const lines = [];
  for (const t of tokens.filter(t => t.kind !== 'time').sort((a, b) => a.baseline - b.baseline)) {
    const l = lines.find(l => sameLine(l[0], t) && Math.abs(l[0].size - t.size) < l[0].size * 0.3);
    if (l) l.push(t); else lines.push([t]);
  }
  return lines.map(l => ({ str: l.sort((a, b) => b.x - a.x).map(t => t.str).join(' ').replace(/\s+/g, ' ').trim(), size: l[0].size }));
}

/**
 * שם בית הכנסת והכתובת מהקובץ הישן – הצעה שמוצגת למשתמש לאישור.
 * השם: משורה שמתחילה ב"בית הכנסת…" (בכל מקום בעמוד), ואם יש כמה – בגופן הגדול ביותר.
 */
export function detectShulAddress(tokens) {
  const addr = tokens.filter(t => t.kind === 'address').sort((a, b) => a.y - b.y)[0];
  let best = null;
  for (const l of textLines(tokens)) {
    const m = SHUL_RE.exec(l.str);
    const name = m && m[1].replace(/^["״'׳]+|["״'׳]+$/g, '').trim();
    if (!name || name.length > 40 || !/[א-ת]{2}/.test(name)) continue;
    if (!best || l.size > best.size) best = { name, size: l.size };
  }
  return { shul: best ? best.name : null, address: addr ? addr.str.trim() : null };
}

/** תבנית התאריך הלועזי כמו בקובץ הישן (מפריד, ספרות שנה, אפסים מובילים) */
export function gregFormat(str) {
  const m = GREG_RE.exec(str);
  if (!m) return { sep: '/', year: 4, pad: false };
  return { sep: m[2], year: m[4].length, pad: m[1].length === 2 && m[1][0] === '0' };
}

/* ---------- הסקת התפקיד של כל שעה ---------- */

const ZMAN_WORDS = [
  [/הדלק/, 'candles', 'כניסה'],
  [/(צאת|יציאת|מוצ).{0,6}(שבת|חג|ש"ק|השבת|החג)|^צאת ש/, 'havdalah', 'יציאה'],
  [/צאת הכוכבים|צה"כ/, 'tzeit', null],
  [/שקיע/, 'sunset', null],
  [/עלות/, 'alotHaShachar', 'כל יום'],
  [/נץ|זריחה/, 'sunrise', 'כל יום'],
  [/מג"?א|מגן אברהם/, 'sofZmanShmaMGA', 'כל יום'],
  [/סו"?ז|סוף זמן|גר"?א/, 'sofZmanShma', 'כל יום'],
  [/חצות/, 'chatzot', 'כל יום'],
  [/מנחה גדולה/, 'minchaGedola', 'כל יום'],
  [/פלג/, 'plagHaMincha', null]
];
const PRAYER_WORDS = /שחרית|מנחה|ערבית|מעריב|קבלת שבת|מוסף|שיעור|דף יומי|תהילים|לימוד|הלל|סליחות|ותיקין|אבות ובנים|תפילה|קריאת/;
const WHEN_WORDS = [
  ['יציאה', /מוצ|הבדלה|יציאת|צאת ה?(שבת|חג)/],
  ['כניסה', /ערב שבת|ערב חג|עש"ק|ערש"ק|ליל שבת|ליל חג|קבלת שבת|כניסת|יום ו|שישי/],
  ['כל יום', /יום שבת|שבת קודש|שבת בבוקר|בוקר|שחרית|מוסף|צהריים|יום החג|^שבת$|^חג$|יום השבת/]
];
const whenOf = s => { for (const [w, re] of WHEN_WORDS) if (re.test(s)) return w; return null; };
const isOnlyDayWord = s => !!whenOf(s) && !PRAYER_WORDS.test(s) && s.length < 16;

const BASE_BY_WHEN = {
  'כניסה': ['candles', 'sunset', 'plagHaMincha', 'tzeit'],
  'כל יום': ['sunrise', 'sofZmanShmaMGA', 'sofZmanShma', 'chatzot', 'minchaGedola', 'minchaKetana', 'plagHaMincha', 'sunset', 'tzeit'],
  'יציאה': ['havdalah', 'tzeit', 'sunset']
};
const BASE_LABEL = { candles: 'הדלקת נרות', sunset: 'שקיעה', tzeit: 'צאת הכוכבים', havdalah: 'צאת שבת/חג', alotHaShachar: 'עלות השחר',
  sunrise: 'הנץ', sofZmanShmaMGA: 'סו"ז ק"ש מג"א', sofZmanShma: 'סו"ז ק"ש גר"א', chatzot: 'חצות', minchaGedola: 'מנחה גדולה',
  minchaKetana: 'מנחה קטנה', plagHaMincha: 'פלג המנחה' };

const overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
const sameLine = (a, b) => Math.abs(a.baseline - b.baseline) < Math.max(a.size, b.size) * 0.45;

/** התווית של שעה: הטקסט הקרוב באותה שורה, קודם מימין (עברית) ואחר כך משמאל */
function labelFor(t, texts) {
  // פרשה, תאריך או כתובת באותה שורה אינם השם של השעה (למשל שעון בין הפרשה לתאריך)
  const line = texts.filter(x => !isFixedKind(x.kind) && sameLine(x, t));
  const right = line.filter(x => x.x >= t.x + t.w * 0.5).sort((a, b) => a.x - b.x)[0];
  const left = line.filter(x => x.x + x.w <= t.x + t.w * 0.5).sort((a, b) => (b.x + b.w) - (a.x + a.w))[0];
  if (right && left) {
    // אם שני הצדדים קרובים באותה מידה, בעברית התווית בדרך כלל מימין
    const dr = right.x - (t.x + t.w), dl = t.x - (left.x + left.w);
    return dl < dr * 0.5 ? left : right;
  }
  return right || left || null;
}

/** כותרות מעל השעה (באותה עמודה), מהקרובה לרחוקה */
function headersAbove(t, texts) {
  return texts.filter(x => x.baseline < t.baseline - t.size * 0.5 && overlapX(x, t) > -t.size)
    .sort((a, b) => b.baseline - a.baseline);
}

/** הבסיס המקובל לפי שם התפילה, אם הוא בטווח סביר */
const PREFER = [
  [/קבלת שבת/, ['candles', 'sunset']],
  [/מנחה(?! גדולה)/, ['sunset', 'candles']],
  [/ערבית|מעריב/, ['havdalah', 'tzeit', 'sunset']],
  [/ותיקין|כותיקין|נץ/, ['sunrise']]
];

const MIN_MS = 60000;
const toMinutes = (ms, tz) => { const [h, m] = hm(ms, tz).split(':').map(Number); return h * 60 + m; };
const fmtHM = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const BASE_KEY = Object.fromEntries(Object.entries(BASE_LABEL).map(([k, v]) => [v, k]));

/**
 * זמני היום שמודפסים בלוח עצמו (אזורי "זמן היום", למשל "שקיעה 19:04"), לפי ה"מתי" של כל אזור:
 * { [when]: { [מפתח הזמן]: דקות } }. בעזרתם אפשר להסיק כלל גם בלי לדעת את תאריך הלוח הישן.
 */
export function printedTimes(slots) {
  const out = {};
  for (const s of slots || []) {
    const m = s.kind === 'zman' ? parseHM(s.old) : null;
    if (m == null || !s.zman) continue;
    (out[s.when] = out[s.when] || {})[s.zman] = m;
  }
  return out;
}

/**
 * זמן היום k ביום של ctx: מהזמנים המחושבים (ctx.times, כשתאריך הלוח ידוע), ואם אין – מהזמן המודפס בלוח (ctx.printed).
 * מחזיר { min, at(הפרש, עיגול) → דקות, printed } או null.
 * כשהתאריך ידוע עדיפים הזמנים המחושבים: לפיהם ייכתבו השעות בשבתות הבאות, כך שהכלל ישחזר בדיוק את מה שהיה בלוח.
 */
function baseAt(k, ctx, tz) {
  const ms = ctx.times && ctx.times[k];
  const p = ctx.printed && ctx.printed[k];
  // זמנים משוערים (ctx.approx – מיום אחר שזמניו דומים) רק לזמן שלא מודפס בלוח
  if (ms != null && !(ctx.approx && p != null)) {
    return { min: toMinutes(ms, tz), ...(ctx.approx ? { approx: true } : {}), at: (off, round) => toMinutes(applyOffset(ms, off, round), tz) };
  }
  // בזמן מודפס אין שניות: העיגול ל-5 על דקות מתחילת היום זהה לעיגול על השעה
  if (p != null) return { min: p, printed: true, at: (off, round) => applyOffset(p * MIN_MS, off, round) / MIN_MS };
  return null;
}

/**
 * בלי תאריך ללוח הישן: מחפשים בשנה האחרונה שבוע שבו הזמנים המחושבים מתאימים לזמנים שמודפסים בלוח
 * (הדלקת נרות, צאת שבת…). הזמנים של אותו שבוע קרובים לזמנים של הלוח הישן, וכך אפשר להסיק כלל גם לפי זמן
 * שלא מודפס בו – למשל מנחה בשבת לפי השקיעה של יום השבת. days – לוח ימי חול (d0 הוא יום ראשון).
 * מחזיר את היום של השבת (בלוח ימי חול – של יום ראשון), או null כשאין התאמה.
 */
export function approxStart(slots, cfg, days) {
  const anchors = (slots || []).filter(s => s.kind === 'zman' && s.zman && parseHM(s.old) != null);
  if (!anchors.length) return null;
  const dayFor = (when, start) => days ? start + (+String(when).slice(1) || 0) : when === 'כניסה' ? start - 1 : start;
  // גם כמה שבועות קדימה: לוח שהוכן מראש לשבת הקרובה
  let start = Math.floor(Date.now() / DAY_MS) + 56;
  while (dow(start) !== (days ? 0 : 6)) start--;
  const cache = new Map();
  const times = d => { if (!cache.has(d)) cache.set(d, timesFor(cfg, d)); return cache.get(d); };
  let best = null;
  for (let w = 0; w < 61; w++) {
    const st = start - w * 7;
    let total = 0;
    for (const a of anchors) {
      const ms = times(dayFor(a.when, st))[a.zman];
      total += ms == null ? Infinity : Math.abs(parseHM(a.old) - toMinutes(ms, cfg.tz));
    }
    const avg = total / anchors.length;
    if (!best || avg < best.avg) best = { st, avg };
  }
  return best.avg <= 2 ? best.st : null;
}

/** השעה (בדקות) שכלל נותן ביום של ctx, או null אם הבסיס שלו לא ידוע ביום הזה */
function ruleMinutes(r, ctx, tz) {
  if (r.base === 'שעה קבועה') return parseHM(r.offset);
  const b = BASE_KEY[r.base] && baseAt(BASE_KEY[r.base], ctx, tz);
  return b ? b.at(Number(r.offset) || 0, r.round) : null;
}

/**
 * כל הכללים שמסבירים את השעה (בדקות) – הסביר ביותר ראשון, ואחריו חלופות (בסיס אחר, או שעה קבועה).
 * ctx: { when, times – זמני היום המחושבים (או null כשהתאריך לא ידוע), printed – זמני היום המודפסים בלוח לאותו יום }.
 * name – שם התפילה (לא חובה). כלל שהבסיס שלו נלקח מהזמן המודפס מסומן printed.
 */
export function ruleOptions(minutes, ctx, tz, name = '') {
  const when = BASE_BY_WHEN[ctx.when] ? ctx.when : 'כל יום';
  const near = BASE_BY_WHEN[when].map(k => ({ k, b: baseAt(k, ctx, tz) })).filter(x => x.b)
    .map(({ k, b }) => ({ k, ...b, diff: minutes - b.min })).filter(b => Math.abs(b.diff) <= 120);
  const fixed = { base: 'שעה קבועה', offset: fmtHM(minutes), round: 'ללא' };
  if (!near.length) return [fixed];
  const pref = when === 'כניסה' ? 'candles' : when === 'יציאה' ? 'havdalah' : null;
  const round5 = minutes % 5 === 0;
  near.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  const byName = (PREFER.find(p => p[0].test(name)) || [null, []])[1];
  // זמן שמודפס בלוח קודם לזמן משוער: "מנחה 10 דק׳ אחרי הדלקת הנרות שבלוח" ולא "28 דק׳ לפני שקיעה משוערת"
  const named = byName.map(k => near.find(b => b.k === k && Math.abs(b.diff) <= 90)).filter(Boolean)
    .sort((a, b) => !!a.approx - !!b.approx);
  const best = named[0] || near.find(b => b.k === pref && Math.abs(b.diff) <= 45) || near[0];
  const fit = b => {
    // בזמן משוער השעה יכולה לסטות בדקה, ולכן הפרש שקרוב בדקה למספר עגול ("39") הוא כנראה העגול ("40")
    const d = b.approx && Math.abs(b.diff - Math.round(b.diff / 5) * 5) <= 1 ? Math.round(b.diff / 5) * 5 : b.diff;
    const out = { base: BASE_LABEL[b.k], offset: String(d), round: 'ללא', ...(b.printed ? { printed: true } : {}), ...(b.approx ? { approx: true } : {}) };
    if (b.approx) return out;
    // אם השעה עגולה ל-5 והבסיס לא – מחפשים הפרש עגול עם עיגול שנותן בדיוק את השעה
    if (!round5 || b.min % 5 === 0) return out;
    const d5 = Math.round(b.diff / 5) * 5;
    for (const round of ['למטה ל-5', 'למעלה ל-5', 'לקרוב ל-5']) {
      for (const off of [d5, d5 - 5, d5 + 5]) {
        if (b.at(off, round) === minutes) return { ...out, offset: String(off), round };
      }
    }
    return out;
  };
  const rel = [best, ...near.filter(b => b !== best)].slice(0, 3).map(fit);
  // שעה עגולה בבוקר היא בדרך כלל שעה קבועה, והכללים נשארים כחלופה
  const fixedFirst = (minutes < 12 * 60 && minutes % 15 === 0) || (when === 'כל יום' && minutes < 12 * 60 && round5);
  return fixedFirst ? [fixed, ...rel] : [...rel, fixed];
}

/**
 * כשאותה תפילה מופיעה בלוח כמה פעמים (למשל מנחה בכל יום בלוח ימי חול), מחפשים כלל אחד שמסביר את כולן:
 * "15 דק׳ לפני השקיעה" שנותן בדיוק את השעה בכל יום עדיף על כלל נפרד לכל יום.
 * כל אזור של תפילה צריך options (מ-ruleOptions); ctxOf(s) – ה-ctx של היום של האזור.
 * האזורים שהכלל המשותף מסביר מקבלים אותו, והשאר נשארים עם הכלל שלהם.
 */
export function agreeRules(slots, ctxOf, tz) {
  const groups = new Map();
  for (const s of slots) {
    const name = String(s.name || '').trim();
    if (s.kind !== 'rule' || !name || !s.options || parseHM(s.old) == null) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(s);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const seen = new Set(), cands = [];
    const add = o => {
      const key = o.base + '|' + o.offset + '|' + o.round;
      if (!seen.has(key)) { seen.add(key); cands.push(o); }
    };
    for (const s of list) for (const o of s.options) {
      add(o);
      // "15 דק׳ לפני השקיעה" שנותן 18:05 ביום אחד יכול להיות "15 לפני, עיגול למטה" שמתאים לכל הימים
      if (o.base !== 'שעה קבועה' && o.round === 'ללא' && Number(o.offset) % 5 === 0) {
        for (const round of ['למטה ל-5', 'למעלה ל-5', 'לקרוב ל-5']) add({ ...o, round });
      }
    }
    const fits = (o, s) => ruleMinutes(o, ctxOf(s), tz) === parseHM(s.old);
    // בשוויון: הבסיס שהאזורים מדרגים גבוה יותר (למשל השקיעה שמודפסת בלוח ולא צאת הכוכבים המשוער), ואז בלי עיגול
    const baseRank = o => list.reduce((sum, s) => {
      const i = s.options.findIndex(x => x.base === o.base);
      return sum + (i < 0 ? s.options.length : i);
    }, 0);
    let best = null, bestKey = null;
    for (const o of cands) {
      const n = list.filter(s => fits(o, s)).length;
      if (n < 2) continue;
      const key = [-n, baseRank(o), o.round === 'ללא' ? 0 : 1];
      const i = bestKey ? key.findIndex((v, j) => v !== bestKey[j]) : 0;
      if (!bestKey || (i >= 0 && key[i] < bestKey[i])) { best = o; bestKey = key; }
    }
    if (!best) continue;
    for (const s of list) {
      if (!fits(best, s)) continue;
      Object.assign(s, { base: best.base, offset: best.offset, round: best.round });
      // הכלל המשותף מופיע ראשון ברשימת האפשרויות של האזור
      if (!s.options.some(o => o.base === best.base && o.offset === best.offset && o.round === best.round)) s.options = [best, ...s.options];
    }
  }
}

const DAY_WORDS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']
  .map((w, i) => [new RegExp('(^|[^א-ת])(' + w + '|יום ' + 'אבגדהו'[i] + '[\'׳]?)($|[^א-ת])'), i]);
/** היום בשבוע (0–5) שמוזכר בטקסט, או null */
export const dowOf = s => { for (const [re, i] of DAY_WORDS) if (re.test(s)) return i; return null; };

/**
 * הימים בשבוע (0–5) בשורה כמו "ימים: א'-ה'", "בימים ב', ד'", "ימים: שני וחמישי", או null.
 * רק כשמופיעה המילה "ימים", כדי שאות בודדת בתוך טקסט אחר לא תיקרא כיום.
 */
export function daysOf(s) {
  const m = /(?:^|[^א-ת])ב?ימים\s*:?\s*(.+)$/.exec(String(s || ''));
  if (!m) return null;
  let body = m[1];
  ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'].forEach((w, i) => { body = body.replace(new RegExp('ו?' + w + '(?![א-ת])', 'g'), 'אבגדהו'[i] + "'"); });
  const out = new Set();
  // אות עם גרש, אפשר עם ו' החיבור ("וה'"), ואפשר טווח ("א'-ה'", "א' עד ה'")
  for (const r of body.matchAll(/(?<![א-ת])ו?([א-ו])['׳"]?(?:\s*(?:[-–־]|עד)\s*ו?([א-ו])['׳"]?)?(?![א-ת])/g)) {
    const a = 'אבגדהו'.indexOf(r[1]), b = r[2] ? 'אבגדהו'.indexOf(r[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

/**
 * הצעה ראשונית לכל האזורים בתבנית.
 * day – יום השבת/החג של הלוח הישן (dayNum), או null אם לא ידוע.
 * period – בלוח של ימי חול: הלוח הישן (findPeriod), ואז כל שעה משויכת ליום (d0…d5) לפי הטקסט שלידה.
 */
export function suggestSlots(tokens, cfg, day, period) {
  const texts = tokens.filter(t => t.kind !== 'time');
  if (period && period.mode === 'days') return suggestDaySlots(tokens, texts, cfg, period);
  const slots = [];
  for (const t of tokens) {
    const box = boxOf(t);
    if (isFixedKind(t.kind)) { slots.push(fixedSlot(t, box)); continue; }
    if (t.kind !== 'time') continue;

    const lab = labelFor(t, texts);
    const labelBox = lab ? boxOf(lab) : null;
    const heads = headersAbove(t, texts);
    const rowLabel = lab ? lab.str : '';
    let label = rowLabel;
    // בטבלה שבה השורה היא היום והעמודה היא התפילה – השם בא מהכותרת שמעל
    if ((!label || isOnlyDayWord(label)) && heads.length) {
      const h = heads.find(x => PRAYER_WORDS.test(x.str) || ZMAN_WORDS.some(z => z[0].test(x.str)));
      if (h) label = h.str;
    }
    let when = whenOf(rowLabel) || whenOf(label);
    // שורה משותפת, למשל "הדלקת נרות 18:24 || שקיעה 19:04": השקיעה היא של ערב שבת
    for (const x of texts) {
      if (when) break;
      if (x !== lab && sameLine(x, t)) when = whenOf(x.str) || (ZMAN_WORDS.find(z => z[2] && z[0].test(x.str)) || [])[2] || null;
    }
    // כותרת מעל: בטבלה כל כותרת, ברשימה (לשעה יש תווית בשורה) רק כותרת קצרה של יום ("ערב שבת"), לא משפט
    for (const h of heads) { if (when) break; if (!lab || isOnlyDayWord(h.str)) when = whenOf(h.str); }
    // ערבית ביום השבת/החג היא של מוצאי שבת/חג
    if (!when) when = /ערבית|מעריב/.test(label) ? 'יציאה' : 'כל יום';

    const zm = !PRAYER_WORDS.test(label) && ZMAN_WORDS.find(z => z[0].test(label));
    const name = label.replace(/[:\-–|]+$/g, '').trim();
    if (zm) slots.push({ box, labelBox, kind: 'zman', zman: zm[1], when: zm[2] || when, old: t.str, label: name });
    else slots.push({ box, labelBox, kind: 'rule', when, name: name || 'תפילה', old: t.str, label: name });
  }
  // הכללים אחרי שכל זמני היום בלוח זוהו: בלי תאריך הם נשענים על הזמנים המודפסים ("מנחה 18:50" ליד "שקיעה 19:04")
  const printed = printedTimes(slots);
  // בלי תאריך: זמנים משוערים משבת שזמניה מתאימים לזמנים שבלוח
  const at = day != null ? day : approxStart(slots, cfg, false);
  const tErev = at != null ? timesFor(cfg, at - 1) : null;
  const tDay = at != null ? timesFor(cfg, at) : null;
  for (const s of slots) {
    if (s.kind !== 'rule') continue;
    const ctx = { when: s.when, times: s.when === 'כניסה' ? tErev : tDay, printed: printed[s.when], approx: day == null };
    const options = ruleOptions(parseHM(s.old), ctx, cfg.tz, s.label);
    Object.assign(s, options[0], { options });
  }
  return slots;
}

const boxOf = t => ({ x: t.x, y: t.y, w: t.w, h: t.h, baseline: t.baseline, size: t.size, font: t.font, ...(t.italic ? { italic: true } : {}) });
const isFixedKind = k => ['title', 'parasha', 'parashaName', 'special', 'hebDate', 'gregDate', 'address'].includes(k);
function fixedSlot(t, box) {
  if (t.kind === 'gregDate') return { box, kind: 'gregDate', old: t.str, fmt: gregFormat(t.str) };
  if (t.kind === 'address') return { box, kind: 'address', old: t.str };
  return { box, kind: t.kind, old: t.str, ...(t.prefix ? { prefix: t.prefix } : {}), ascii: /["']/.test(t.str) && !/[״׳]/.test(t.str),
    ...(t.kind === 'hebDate' ? hebDateFmt(t.str) : { noYear: false }) };
}

/** צורת התאריך העברי בקובץ הישן: בלי שנה, או עם ה' לפני השנה ("ה'תשפ"ו") */
function hebDateFmt(str) {
  const m = HEB_DATE_RE.exec(str);
  return { noYear: !m[4], hei: !!(m[4] && m[3]) };
}

/** כמו suggestSlots, ללוח של ימי חול: היום נקבע לפי שם היום בשורה או בכותרת שמעל */
function suggestDaySlots(tokens, texts, cfg, period) {
  const slots = [];
  for (const t of tokens) {
    const box = boxOf(t);
    if (isFixedKind(t.kind)) { slots.push(fixedSlot(t, box)); continue; }
    if (t.kind !== 'time') continue;

    const lab = labelFor(t, texts), heads = headersAbove(t, texts);
    const labelBox = lab ? boxOf(lab) : null;
    let label = lab ? lab.str : '';
    // בטבלה שבה השורה היא היום – שם התפילה בכותרת שמעל
    if ((!label || dowOf(label) != null) && heads.length) {
      const h = heads.find(x => PRAYER_WORDS.test(x.str) || ZMAN_WORDS.some(z => z[0].test(x.str)));
      if (h) label = h.str;
    }
    let w = null;
    for (const s of [lab ? lab.str : '', ...texts.filter(x => sameLine(x, t)).map(x => x.str), ...heads.map(h => h.str)]) {
      w = dowOf(s);
      if (w != null) break;
    }
    // "ימים: א'-ה'" בתווית של השעה או מעליה באותה עמודה (הקרוב ביותר): השעה חלה על כל הימים האלה.
    // לא כל טקסט באותה שורה – בלוח עם שתי עמודות השורה ממשיכה לעמודה השנייה
    let spec = null;
    for (const s of [lab ? lab.str : '', ...heads.map(h => h.str)]) {
      spec = daysOf(s);
      if (spec) break;
    }
    const specCols = spec ? period.days.filter(x => spec.includes(x.dow)) : [];
    const col = specCols[0] || period.days.find(x => x.dow === w) || period.days[0];
    const days = specCols.length > 1 ? { days: specCols.map(x => x.key) } : {};
    const zm = !PRAYER_WORDS.test(label) && ZMAN_WORDS.find(z => z[0].test(label));
    const name = label.replace(/[:\-–|]+$/g, '').trim();
    if (zm) slots.push({ box, labelBox, kind: 'zman', zman: zm[1], when: col.key, old: t.str, label: name });
    else slots.push({ box, labelBox, kind: 'rule', when: col.key, ...days, name: name || 'תפילה', old: t.str, label: name });
  }
  const printed = printedTimes(slots);
  // בלי תאריך: זמנים משוערים משבוע שזמניו מתאימים לזמנים שבלוח
  const sun = period.days.some(x => x.day != null) ? null : approxStart(slots, cfg, true);
  const ctxs = new Map();   // לפי יום בלוח: agreeRules בודק כל כלל מועמד מול כל אזור
  const ctxOf = s => {
    if (ctxs.has(s.when)) return ctxs.get(s.when);
    const c = period.days.find(x => x.key === s.when) || period.days[0];
    const d = c.day != null ? c.day : sun != null ? sun + c.dow : null;
    ctxs.set(s.when, { when: 'כל יום', times: d != null ? timesFor(cfg, d) : null, printed: printed[s.when], approx: c.day == null });
    return ctxs.get(s.when);
  };
  for (const s of slots) {
    if (s.kind !== 'rule') continue;
    const options = ruleOptions(parseHM(s.old), ctxOf(s), cfg.tz, s.label);
    Object.assign(s, options[0], { options });
  }
  // אותה תפילה בכמה ימים: כלל אחד שמסביר את כולם
  agreeRules(slots, ctxOf, cfg.tz);
  return slots;
}

/** טקסטים שאינם שעות ואינם מזוהים – אפשר ללחוץ עליהם ולהפוך אותם לאזור */
export function textCandidates(tokens) {
  // טקסט בלי מילה של שתי אותיות לפחות ("6", "ה") הוא בדרך כלל מספר עמוד, קישוט או שארית של לוגו
  return tokens.filter(t => t.kind === 'text' && /[א-תA-Za-z]{2}/.test(t.str)).map(t => ({ box: boxOf(t), old: t.str }));
}
