/**
 * עורך התבנית: מציג את העמוד מהקובץ הישן עם אזורים מסומנים, ומאפשר לקבוע
 * מה ייכתב בכל אזור (תפילה, זמן היום, כותרת, תאריך). במסמך סרוק מסמנים אזורים ידנית.
 */

import { BASES, TEXT_BASES, WHEN, WHEN_LABELS, ROUND, SIZES, DAY_APPLIES, appliesOnDay, prayerBases, designOf } from './config.js';
import { readFile, tokenize, detectDate, detectHebDate, detectShulAddress, suggestSlots, textCandidates, ruleOptions, agreeRules, printedTimes, approxStart, guessOldDay } from './template-read.js';
import { analyzeSlot, refineBox, inkLines, templateCanvas, specialHost, slotText, slotLook, wordLine, slotKey, slotRanks as pageRanks } from './template-render.js';
import { findOccasion, findPeriod, periodFor, buildLuach, buildDaysLuach, timesFor, dayPages } from './luach.js';
import { toDayNum, toYmd, todayIn, dow } from './dates.js';
import { esc } from './render.js';
import { fontsToFill, fontLabel, isUnnamed, canReadLocalFonts, isPhone, localFontsPermission, fillFromLocal, fillFromFile } from './font-fill.js';
import { openTextEdit } from './text-edit.js';
import { placer } from './template-place.js';

const $ = id => document.getElementById(id);
const KINDS = [['text', 'טקסט שכותבים כאן'], ['rule', 'תפילה או שיעור'], ['kiddush', 'קידוש (מלוח הקידושים)'], ['zman', 'זמן היום'], ['title', 'כותרת (שבת פרשת…)'], ['parasha', 'פרשת…'],
  ['parashaName', 'שם הפרשה בלבד'], ['special', 'שבת מיוחדת (נחמו, זכור…) – רק כשיש'], ['hebDate', 'תאריך עברי'], ['gregDate', 'תאריך לועזי'], ['address', 'כתובת בית הכנסת']];
const KIND_LABEL = Object.fromEntries(KINDS);
const BASE_LABELS = Object.keys(BASES);
const ZMANIM = BASE_LABELS.filter(l => BASES[l] !== 'fixed' && !TEXT_BASES.includes(BASES[l]));
const RULE_BASE_LABELS = BASE_LABELS.filter(l => BASES[l] !== 'kiddush');   // אירועים נשארים: שורת אירועים מהלוח יכולה להיות אזור בקובץ
const KIDDUSH_LABEL = BASE_LABELS.find(l => BASES[l] === 'kiddush');
const zmanKey = label => BASES[label];
const zmanLabel = key => ZMANIM.find(l => BASES[l] === key) || ZMANIM[0];
const opts = (list, v) => list.map(x => Array.isArray(x)
  ? '<option value="' + x[0] + '"' + (x[0] === v ? ' selected' : '') + '>' + esc(x[1]) + '</option>'
  : '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
/** אפשרויות "לפי": זמני היום, ואחריהם התפילות מהאזורים ומההגדרות */
const baseOpts = s => {
  const names = prayerBases(st.slots.filter(x => x.kind === 'rule').concat(st.cfg.rules || []), s);
  if (s.base && !(s.base in BASES) && names.indexOf(s.base) < 0) names.push(s.base);
  return opts(RULE_BASE_LABELS, s.base) + (names.length ? '<optgroup label="לפי תפילה">' + opts(names, s.base) + '</optgroup>' : '');
};
let kiddush = null;   // dateKey ← קידוש מאושר, לתצוגה המקדימה (מ-app.js)
export function setKiddush(map) { kiddush = map; }
const SAMPLE_KIDDUSH = { sponsorName: 'משפחת ישראלי שיחיו', occasion: 'לרגל בר המצווה של בנם', heading: 'קידוש לאחר התפילה', by: 'ע״י' };
const oldMinutes = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.old || ''); return m ? +m[1] * 60 + +m[2] : null; };
/** ערך מוחלט (בדקות) של הפרש האזור, להצגה בשדה המספר */
const offsetAbs = s => { const n = parseInt(s.offset, 10); return isNaN(n) ? '' : String(Math.abs(n)); };
/** כיוון הפרש האזור – "לפני" או "אחרי", להצגה בתיבת הבחירה */
const offsetDir = s => (parseInt(s.offset, 10) < 0 ? 'לפני' : 'אחרי');

const DOW_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const isDays = () => st.tpl.kind === 'days';
const isChol = () => st.period ? st.period.kind === 'chol' : st.tpl.id === 'chol';
/** אפשרויות "יום" בלוח של ימי חול: לפי היום בשבוע, ובחול המועד לפי המקום בלוח */
const dayOpts = () => DOW_LABELS.map((n, i) => ['d' + i, isChol() ? 'יום ' + (i + 1) + ' בלוח' : n]);

/*
 * st: { canvas, W, H, slots, candidates, fonts, day, cfg, name, onDone, drawing,
 *       tpl – התבנית שעורכים, cfgAll – כל ההגדרות, period – בלוח ימי חול: הלוח הישן }
 * st.cfg הוא ההגדרות עם זמני התפילות של התבנית.
 */
let st = null;
const openSlots = new WeakSet();   // אזורים שהשורה שלהם פתוחה לעריכה
let slotTexts = new WeakMap();     // הטקסט שנכתב בכל אזור בתצוגה האחרונה – למילים שבתיבות השורות
let slotEdited = new WeakSet();    // אזורים שהנוסח שלהם נערך לשבוע שבתצוגה האחרונה

/** העמודה (יום) של מפתח d0…d5 בלוח הישן. בלי תאריך: יום בשבוע לפי המפתח */
function colOf(key) {
  const hit = st.period && st.period.days.find(x => x.key === key);
  if (hit) return hit;
  const i = +String(key).slice(1) || 0;
  return { key, dow: i, erev: i === 5, day: st.day != null ? st.day + i : null };
}

/** הלוח הישן לפי יום: שבת/חג, או לוח ימי חול */
function setDay(d) {
  if (d == null) { st.day = null; st.period = null; return; }
  const o = findPeriod(st.tpl.kind, d, st.cfg.il);
  st.period = o && o.mode === 'days' ? o : null;
  st.day = o ? o.first : d;
}

/* ---------- פתיחה ---------- */

/** פתיחת העורך מקובץ חדש, לתבנית tpl */
export async function editFromFile(file, cfgAll, tpl, onDone, onStatus) {
  openRead(await readFile(file, onStatus), file.name, cfgAll, tpl, onDone);
}

/**
 * פתיחת העורך מלוח של המערכת (luachTextCanvas ב-image.js), כדי לערוך אותו כמו לוח שהועלה.
 * day – היום של הלוח. השעות בו מחושבות מזמני התפילות של התבנית, ולכן הכללים נשארים כמו שהם
 */
export function editFromBoard(read, name, cfgAll, tpl, onDone, day) {
  openRead(read, name, cfgAll, tpl, onDone, day);
}

function openRead({ canvas, items, fonts, docDayNum }, name, cfgAll, tpl, onDone, day = null) {
  const tokens = tokenize(items);
  const cfg = { ...cfgAll, rules: tpl.rules };
  const fit = x => ({ ...x, box: refineBox(canvas, x.box), ...(x.labelBox ? { labelBox: refineBox(canvas, x.labelBox) } : {}) });
  st = { canvas, W: canvas.width, H: canvas.height, cfg, cfgAll, tpl, name, onDone, fonts,
    candidates: textCandidates(tokens).map(fit), scanned: !items.length, detected: detectShulAddress(tokens) };
  setDay(day ?? detectDate(tokens, docDayNum));
  // לוח ימי חול בלי תאריך בקובץ: מזהים את הימים לפי שבוע כללי (ראשון–שישי). הכללים נשענים על זמני היום
  // שמודפסים בלוח, ובלעדיהם השעות נשמרות כשעה קבועה עד שבוחרים תאריך
  const week = { mode: 'days', days: [0, 1, 2, 3, 4, 5].map(i => colOf('d' + i)) };
  let slots = suggestSlots(tokens, cfg, st.day, st.period || (isDays() ? week : null));
  // אין תאריך מפורש בקובץ: מנסים לנחש אותו לפי שם הפרשה, התאריך העברי בלי שנה והזמנים שכבר זוהו
  if (st.day == null && !isDays()) {
    const nameSlot = slots.find(s => s.kind === 'parasha' || s.kind === 'parashaName');
    const heb = detectHebDate(tokens);
    const guessed = nameSlot || heb ? guessOldDay(nameSlot ? nameSlot.old : '', slots, cfg, docDayNum, heb) : null;
    if (guessed != null) {
      setDay(guessed);
      slots = suggestSlots(tokens, cfg, st.day, st.period);
      st.autoGuessed = true;
    }
  }
  st.slots = slots.map(fit);
  st.approx = approxStart(st.slots, cfg, isDays());
  if (day != null) keepRules();
  open();
}

/** אזורי התפילות לפי ההגדרה הנוכחית שלהן בתבנית, עם החלופות לכל כלל */
function keepRules() {
  const cfg = st.cfg;
  for (const s of st.slots) {
    if (s.kind !== 'rule') continue;
    const r = isDays() ? cfg.rules.find(x => x.name === s.name && appliesOnDay(x.applies, colOf(s.when)))
      : cfg.rules.find(x => x.name === s.name && x.when === s.when);
    if (r) Object.assign(s, { base: r.base, offset: r.offset, round: r.round });
    // אזור שנשמר לפני שקידוש היה סוג אזור נפרד: מעבר לסוג "קידוש"
    if (s.base && BASES[s.base] === 'kiddush') s.kind = 'kiddush';
    // החלופות לכלל, בלי לשנות את מה שכבר הוגדר
    const options = ruleOpts(s);
    if (options) s.options = options;
  }
}

/** פתיחת העורך לעיצוב הקיים של התבנית tplObj */
export async function editExisting(tplObj, cfgAll, onDone) {
  const tpl = designOf(cfgAll, tplObj), cfg = { ...cfgAll, rules: tplObj.rules };
  const img = new Image();
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = tpl.image; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  st = { canvas, W: canvas.width, H: canvas.height, cfg, cfgAll, tpl: tplObj, name: tpl.name, onDone, fonts: tpl.fonts || {},
    slots: JSON.parse(JSON.stringify(tpl.slots)), candidates: tpl.candidates || [], scanned: !(tpl.candidates || []).length };
  setDay(tpl.day ?? null);
  st.approx = approxStart(st.slots, cfg, isDays());
  keepRules();
  open();
}

function open() {
  $('tplTitle').textContent = 'עריכת הלוח – ' + st.tpl.name;
  $('tplDateLabel').textContent = isDays() ? 'תאריך מתוך הלוח הישן' : 'תאריך הלוח הישן';
  $('tplImg').src = st.canvas.toDataURL('image/png');
  $('tplImg').style.aspectRatio = st.W + ' / ' + st.H;
  $('tplDate').value = st.day != null ? toYmd(st.day) : '';
  $('tplScanHint').hidden = !st.scanned;
  $('tplPreviewWrap').hidden = true;
  st.drawing = false;
  $('tplDraw').setAttribute('aria-pressed', 'false');
  setMoving(false);
  renderOcc(); renderBoxes(); renderSlots();
  // העמוד שבעורך מוצג כמו שיודפס, עם אירוע לדוגמה (קידוש וכו')
  schedulePreviewRefresh();
  window.scrollTo(0, 0);
}

/* ---------- השלמת אותיות חסרות בגופן מהקובץ ---------- */

/** הגופנים של האזורים הכחולים: בשאר הגופנים לא נכתב טקסט חדש, וגם הם לא נשמרים בתבנית */
const slotFonts = () => Object.fromEntries(st.slots.map(s => s.box.font).filter(k => st.fonts[k]).map(k => [k, st.fonts[k]]));

/** הודעה כשבגופן המוטמע חסרות אותיות, עם אפשרות להשלים אותן מהמחשב או מקובץ גופן */
function renderFontFill(done) {
  const need = fontsToFill(slotFonts()), phone = isPhone();
  const box = $('tplFontFill');
  box.hidden = !need.length && !done;
  if (box.hidden) return;
  // האותיות החסרות לכל גופן בנפרד: "David: צ ץ; Arial: ף"
  const byFamily = new Map();
  for (const [, f, m] of need) byFamily.set(fontLabel(f), new Set([...(byFamily.get(fontLabel(f)) || []), ...m]));
  const list = [...byFamily].map(([name, m]) => name + ': ' + [...m].join(' ')).join('; ');
  $('tplFontMsg').textContent = (done ? done + ' ' : '') + (need.length
    ? 'בגופנים שבקובץ חסרות אותיות (' + list + '), ולכן הן ייכתבו בגופן דומה. ' +
      (need.some(([, f]) => isUnnamed(f) && !f.realName)
        ? 'כשהקובץ לא שומר את שם הגופן, האתר מזהה אותו לפי צורת האותיות. ' : '') +
      // בטלפון אין גישה לגופנים שבמכשיר, ולרוב גם אין קובץ גופן להעלות – רק מפנים למחשב
      (phone
        ? 'אם הגופן מותקן במחשב, כדאי להשלים ממנו את האותיות: פותחים את "עריכת התבנית" במחשב עם Chrome או Edge ' +
          'ולוחצים "השלמה מהגופנים שבמחשב". אחרי השמירה הלוח ייראה תקין בכל מכשיר.'
        : canReadLocalFonts()
          ? 'אם הגופן מותקן במחשב שלך או שיש לך קובץ שלו, אפשר להשלים ממנו את האותיות ולשמור אותן בתבנית.'
          : 'אפשר להשלים אותן מקובץ של הגופן, או בקלות יותר בדפדפן Chrome או Edge במחשב שהגופן מותקן בו: ' +
            'פותחים שם את "עריכת התבנית" ולוחצים "השלמה מהגופנים שבמחשב".')
    : '');
  $('tplFontLocal').hidden = !need.length || phone || !canReadLocalFonts();
  $('tplFontUpload').hidden = !need.length || phone;
}

/**
 * הדפדפן מבקש אישור לגופנים שבמחשב בחלון משלו, שאי אפשר לעצב. לכן לפני הבקשה מסבירים בהודעה של האתר מה עומד לקרות,
 * וכשהגישה נחסמה – מסבירים איך לאשר אותה, בלי לפנות לדפדפן שוב. מחזיר true אם אפשר לבקש את הגופנים
 */
async function askLocalFonts() {
  const state = await localFontsPermission();
  if (state === 'granted') return true;
  if (state === 'denied') {
    await SiteDialog.alert('הגישה לגופנים שבמחשב חסומה בדפדפן. כדי לאשר אותה: לוחצים על הסמל שמשמאל לכתובת האתר, ' +
      'בוחרים "הגדרות אתר" ומאשרים "גופנים". אפשר גם להעלות קובץ גופן.');
    return false;
  }
  return SiteDialog.confirm('כדי להשלים את האותיות, האתר צריך לקרוא את הגופנים שמותקנים במחשב. ' +
    'הדפדפן יבקש עכשיו אישור – לוחצים "אישור" או "Allow". הגופנים נקראים רק במחשב שלך, ורק האותיות החסרות נשמרות בתבנית.',
  { ok: 'המשך' });
}

$('tplFontLocal').onclick = async () => {
  const btn = $('tplFontLocal');
  let res;
  if (!(await askLocalFonts())) return;
  // זיהוי גופן בלי שם סורק את כל הגופנים שבמחשב, וזה לוקח כמה שניות
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'מחפש את הגופנים במחשב…';
  try { res = await fillFromLocal(slotFonts()); }
  catch (e) {
    console.warn('אין גישה לגופנים שבמחשב', e);
    SiteDialog.alert('לא התקבלה גישה לגופנים שבמחשב. אפשר לאשר את הגישה בהגדרות האתר בדפדפן, או להעלות קובץ גופן.');
    return;
  } finally { btn.disabled = false; btn.textContent = label; }
  // הסבר נפרד לכל סיבה: לא נמצא, נמצא בפורמט שלא נקרא (Type 1 ב-Linux), בלי עברית, או בלי חיבור
  const WHY = {
    format: x => 'הגופן ' + x.family + ' נמצא במחשב (' + x.file + '), אבל הוא שמור בפורמט ישן שהאתר לא יודע לקרוא. אפשר להעלות קובץ ‎.ttf או ‎.otf שלו.',
    noHebrew: x => 'הגופן ' + x.file + ' שנמצא במחשב לא כולל אותיות עבריות.',
    network: () => 'לא ניתן לטעון את רכיב קריאת הגופנים. בדקו את החיבור לאינטרנט ונסו שוב.'
  };
  const problems = [...new Set([
    ...[...new Set(res.notFound)].map(n => 'הגופן ' + n + ' לא נמצא במחשב. אפשר להעלות קובץ גופן.'),
    ...[...new Set(res.unknown)].map(n => 'לא נמצא במחשב גופן שהאותיות שלו זהות ל' + n + '. אפשר להעלות קובץ גופן.'),
    ...res.failed.map(x => (WHY[x.why] || WHY.format)(x))
  ])];
  // העמוד בעורך מצויר מחדש, כדי שהאותיות שהושלמו ייראו מיד
  if (res.filled.length) { renderFontFill('הושלמו האותיות מהגופן ' + [...new Set(res.filled)].join(', ') + '.'); schedulePreviewRefresh(); }
  if (problems.length) SiteDialog.alert(problems.join('\n'));
};
$('tplFontUpload').onclick = () => {
  // באפליקציה ה-accept הופך לסוגי MIME, ובהרבה מכשירים קובצי גופן מסומנים application/octet-stream ולא מופיעים לבחירה.
  // סוג הקובץ נבדק ממילא בקריאת הגופן (fillFromFile).
  if (window.NativeFiles && NativeFiles.isApp()) $('tplFontFile').removeAttribute('accept');
  $('tplFontFile').click();
};
$('tplFontFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    renderFontFill('הושלמו האותיות מהגופן ' + (await fillFromFile(slotFonts(), file)).join(', ') + '.');
    schedulePreviewRefresh();
  }
  catch (err) { SiteDialog.alert(err.message || 'לא ניתן לקרוא את קובץ הגופן.'); }
};

function close(result) {
  const done = st.onDone;
  st = null;
  done(result);
}

/* ---------- תאריך הלוח הישן ---------- */

function renderOcc() {
  const o = st.period || (st.day != null ? findOccasion(st.day, st.cfg.il) : null);
  const byPrinted = st.slots && st.slots.some(s => s.options && s.options.some(x => x.printed || x.approx));
  $('tplOcc').textContent = !o ? (byPrinted
    ? 'הכללים זוהו לפי זמני היום שמודפסים בלוח (כלל שמסומן "משוער" – לפי זמנים קרובים לאלה שבלוח). ' +
      'בחירת התאריך של הלוח הישן תאפשר לזהות את הכללים בדיוק.'
    : 'בחרו את התאריך של הלוח הישן כדי שהאתר יזהה את הכללים.')
    : 'הלוח הישן: ' + o.title + (st.autoGuessed ? ' (זוהה אוטומטית לפי הפרשה והזמנים – אפשר לתקן)' : '');
}

$('tplDate').addEventListener('change', () => {
  if (!st) return;
  const v = $('tplDate').value;
  if (!v) return;
  let d = toDayNum(v);
  if (dow(d) === 5 && !isDays()) d++;          // יום שישי ← השבת שאחריו
  st.autoGuessed = false;
  setDay(d);
  reinferAll();
  renderOcc(); renderSlots();
});

/**
 * היום של אזור תפילה להסקת הכלל: הזמנים המחושבים (כשתאריך הלוח ידוע, ואם לא – משוערים לפי st.approx)
 * והזמנים שמודפסים בלוח לאותו יום
 */
function ruleCtx(s) {
  const printed = printedTimes(st.slots)[s.when];
  if (isDays()) {
    const c = colOf(s.when);
    const d = c.day != null ? c.day : st.approx != null ? st.approx + c.dow : null;
    return { when: 'כל יום', times: d != null ? timesFor(st.cfg, d) : null, printed, approx: c.day == null };
  }
  const at = st.day != null ? st.day : st.approx;
  return { when: s.when, times: at != null ? timesFor(st.cfg, s.when === 'כניסה' ? at - 1 : at) : null, printed, approx: st.day == null };
}

/** האפשרויות לכלל של האזור לפי השעה בקובץ, היום והמתי */
function ruleOpts(s) {
  const m = oldMinutes(s);
  return s.kind === 'rule' && m != null ? ruleOptions(m, ruleCtx(s), st.cfg.tz, s.name) : null;
}

/** חישוב מחדש של הכלל לפי השעה בקובץ, היום והמתי */
function reinfer(s) {
  const options = ruleOpts(s);
  if (!options) return;
  s.options = options;
  // בלי תאריך ובלי זמנים מודפסים יש רק "שעה קבועה" – לא דורסים כלל שהמשתמש הגדיר
  if (options.length > 1 || st.day != null) Object.assign(s, pickRule(options[0]));
}

/** כל האזורים מחדש, ובלוח ימי חול – כלל אחד לתפילה שמופיעה בכמה ימים */
function reinferAll() {
  st.slots.forEach(reinfer);
  if (!isDays()) return;
  // agreeRules בודק כל כלל מועמד מול כל אזור – היום של כל אזור מחושב פעם אחת
  const ctxs = new Map();
  agreeRules(st.slots, s => { if (!ctxs.has(s.when)) ctxs.set(s.when, ruleCtx(s)); return ctxs.get(s.when); }, st.cfg.tz);
}

const pickRule = o => ({ base: o.base, offset: o.offset, round: o.round });
const sameRule = (a, b) => a.base === b.base && String(a.offset) === String(b.offset) && a.round === b.round;

/** תיאור קצר של כלל: "15 דק׳ לפני שקיעה", "בשעה 08:00" */
function ruleText(r) {
  if (r.base === 'שעה קבועה') return 'בשעה ' + (r.offset || '');
  const n = parseInt(r.offset, 10) || 0;
  return (n ? Math.abs(n) + ' דק׳ ' + (n < 0 ? 'לפני ' : 'אחרי ') : '') + r.base + (r.round && r.round !== 'ללא' ? ', עיגול ' + r.round : '');
}

/* ---------- האזורים על העמוד ---------- */

const pct = (v, total) => (v / total * 100).toFixed(3) + '%';
function boxStyle(b) {
  return 'right:' + pct(st.W - b.x - b.w, st.W) + ';top:' + pct(b.y, st.H) + ';width:' + pct(b.w, st.W) + ';height:' + pct(b.h, st.H);
}

/** מספור האזורים לפי מיקומם בעמוד (שורה עליונה למטה, בכל שורה מימין לשמאל) ולא לפי סדר ההוספה */
const slotRanks = () => pageRanks(st.slots);

function unionBox(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * איפה האזור מוצג על העמוד שבעורך: העמוד מצויר מחדש עם הטקסט החדש, ושורות שנפתחו או נסגרו מזיזות את מה שמתחתיהן.
 * { box, label } – המקום שבו נכתב הטקסט (בגודל שלו), ושל השם שליד השעה. אזור שעוד לא צויר – רק מוזז עם השורות
 */
function shownBox(s) {
  const v = st.view, e = v && v.slots.get(s);
  const moved = b => b && v ? { ...b, y: v.toView(b.y) } : b;
  if (!e || (resize && resize.s === s) || (move && move.s === s)) return { box: moved(s.box), label: moved(s.labelBox) };
  // מסגרת קצת רחבה מהדיו, כדי שיהיה נוח ללחוץ עליה
  const pad = b => { const k = Math.max(2, Math.min(b.h, b.w) * 0.12); return { x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k }; };
  return { box: e.ink ? pad(e.ink) : e.box, label: e.labelInk ? pad(e.labelInk) : e.labelBox };
}

function renderBoxes() {
  const ranks = slotRanks();
  let h = '';
  const same = (a, b) => a && a.x === b.x && a.y === b.y;
  st.candidates.forEach((c, i) => {
    if (st.slots.some(s => same(s.box, c.box) || same(s.labelBox, c.box) || covers(s.box, c.box) || movedFrom(s, c.box))) return;
    const b = (st.view && st.view.candidates[i]) || c.box;
    h += '<button type="button" class="tb cand" data-c="' + i + '" style="' + boxStyle(b) + '" title="' + esc(c.old) + '" aria-label="הוספת אזור: ' + esc(c.old) + '"></button>';
  });
  const shown = st.slots.map(shownBox);
  st.slots.forEach((s, i) => {
    // שעה עם השם שלידה: מסגרת אחת לשניהם, ובתוכה מסומן המקום שבו תיכתב השעה החדשה
    const { box, label } = shown[i];
    const lb = (s.kind === 'rule' || s.kind === 'zman') && label;
    const outer = lb ? unionBox(box, lb) : box;
    h += '<button type="button" class="tb slot' + (i === st.sel ? ' sel' : '') + '" data-s="' + i + '" style="' + boxStyle(outer) +
      '" aria-label="אזור ' + ranks[i] + '" title="' + (st.moving ? 'גרירה – הזזה למקום אחר בעמוד' : 'לחיצה – עריכת האזור') + '"><span>' + ranks[i] + '</span></button>';
    if (lb) h += '<div class="tb val" style="' + boxStyle(box) + '"></div>';
  });
  if (move && move.ghost) h += '<div class="tb slot drag ghost" style="' + boxStyle(move.ghost) + '"></div>';
  const sel = st.slots[st.sel];
  if (sel && !st.drawing) {
    // ידיות למתיחת האזור הנבחר
    const b = shown[st.sel].box, at = (right, top) => 'right:' + pct(right, st.W) + ';top:' + pct(top, st.H);
    for (const [edge, r, t, label] of [['r', st.W - b.x - b.w, b.y + b.h / 2, 'שמאל'], ['l', st.W - b.x, b.y + b.h / 2, 'ימין'],
      ['t', st.W - b.x - b.w / 2, b.y, 'למעלה'], ['b', st.W - b.x - b.w / 2, b.y + b.h, 'למטה']]) {
      h += '<div class="rh rh-' + edge + '" data-edge="' + edge + '" style="' + at(r, t) + '" title="מתיחת האזור ' + label + '"></div>';
    }
  }
  $('tplBoxes').innerHTML = h;
}

/** האם מרכז התיבה b נמצא בתוך a */
const covers = (a, b) => {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx > a.x && cx < a.x + a.w && cy > a.y && cy < a.y + a.h;
};
/** טקסט מהקובץ במקום שממנו האזור s הוזז – נמחק בציור */
const movedFrom = (s, b) => !!s.origin && (covers(s.origin.box, b) || (!!s.origin.labelBox && covers(s.origin.labelBox, b)));

/**
 * אזור של פרשה שנמתח על טקסט שלפניו ("לשבת", "זמני התפילות לשבת"): הטקסט המכוסה נשמר
 * כטקסט שלפני הפרשה ונכתב מחדש יחד איתה. nameBox – האזור לפני המתיחה הראשונה
 */
function stretchPrefix(s) {
  const edge = s.nameBox.x + s.nameBox.w - 2;
  const words = st.candidates.filter(c => covers(s.box, c.box) && c.box.x + c.box.w / 2 > edge)
    .sort((a, b) => b.box.x - a.box.x).map(c => c.old);
  const all = [...words, (s.autoPrefix || '').trim()].filter(Boolean);
  s.prefix = all.length ? all.join(' ') + ' ' : '';
}

/** שתי תיבות טקסט של אותו קטע: באותה שורה זו ליד זו, או בשורות סמוכות זו מתחת לזו */
function sameBlock(a, b) {
  const size = Math.max(a.size || a.h * 0.72, b.size || b.h * 0.72);
  if (Math.abs((a.size || a.h) - (b.size || b.h)) > size * 0.2) return false;
  const dy = Math.abs(lineBase(a) - lineBase(b));
  const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  if (dy < size * 0.45) return gap < size * 1.5;
  const aligned = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < size * 1.5 || Math.abs(a.x + a.w - b.x - b.w) < size || Math.abs(a.x - b.x) < size;
  return dy < size * 1.8 && gap < 0 && aligned;
}
const lineBase = b => b.baseline ?? (b.y + b.h * 0.78);

/**
 * קידוש כמו בקובץ הישן: האזור מתרחב לשורות הסמוכות של אותו קטע (grow), מספר השורות, קו הבסיס
 * והריווח ביניהן נלקחים מהקובץ. כל הטקסט שבאזור מוחלף בהודעה בנוסח שהגבאי קבע בלוח הקידושים.
 * במסמך סרוק השורות נספרות לפי הפיקסלים שבאזור
 */
function fitKiddush(s, grow) {
  // האזור מותאם מחדש לטקסט שבקובץ – גם המראה נמדד מחדש
  delete s.style;
  const taken = c => st.slots.some(o => (o !== s && covers(o.box, c.box)) || (o.labelBox && covers(o.labelBox, c.box)));
  const parts = st.candidates.filter(c => covers(s.box, c.box) && !taken(c));
  for (let added = grow && parts.length > 0; added;) {
    added = false;
    for (const c of st.candidates) {
      if (parts.includes(c) || taken(c) || !parts.some(p => sameBlock(p.box, c.box))) continue;
      parts.push(c); added = true;
    }
  }
  let lines;
  if (parts.length) {
    lines = [];
    for (const c of parts.sort((a, b) => lineBase(a.box) - lineBase(b.box))) {
      const size = c.box.size || c.box.h * 0.72;
      const ln = lines.find(l => Math.abs(l.baseline - lineBase(c.box)) < Math.max(l.size, size) * 0.45);
      if (ln) ln.parts.push(c); else lines.push({ baseline: lineBase(c.box), size, parts: [c] });
    }
    const box = parts.reduce((b, c) => unionBox(b, c.box), parts[0].box);
    s.box = { ...s.box, ...box };
    // עברית: בכל שורה מימין לשמאל
    const text = lines.map(l => l.parts.sort((a, b) => b.box.x - a.box.x).map(c => c.old).join(' ')).join(' ');
    s.old = text;
  } else {
    lines = inkLines(st.canvas, s.box).map(b => ({ size: (b.bottom - b.top + 1) * 0.95, baseline: b.top + (b.bottom - b.top + 1) * 0.8 }));
    if (!lines.length) return;
  }
  const n = lines.length, was = s.srcLines;
  s.srcLines = n;
  // השורות נכתבות סביב קו הבסיס האמצעי
  const size = lines.reduce((t, l) => t + l.size, 0) / n;
  s.box = { ...s.box, size, baseline: lines.reduce((t, l) => t + l.baseline, 0) / n };
  if (n < 2) { if (was > 1) s.wrap = false; return; }
  const gap = (lines[n - 1].baseline - lines[0].baseline) / (n - 1);
  const pct = gap / (size * 1.15) * 100;
  Object.assign(s, { wrap: true, lineCount: n, lineHeightPct: SIZES.reduce((a, b) => Math.abs(b - pct) < Math.abs(a - pct) ? b : a) });
  delete s.lines;
}

$('tplBoxes').addEventListener('click', e => {
  if (!st || st.drawing) return;
  const b = e.target.closest('.tb');
  if (!b) return;
  // סוף גרירה של אזור אינו לחיצה עליו
  if (Date.now() - (st.movedAt || 0) < 400) return;
  if (st.textEditing) {
    if (b.dataset.s != null) {
      const s = st.slots[+b.dataset.s];
      if (s.kind === 'text') { editSlotText(s); return; }
    } else { editCandidateText(+b.dataset.c); return; }
  }
  if (b.dataset.s != null) { focusSlot(+b.dataset.s); return; }
  const c = st.candidates[+b.dataset.c];
  st.slots.push({ box: c.box, kind: 'text', text: c.old, old: c.old });
  renderBoxes(); focusSlot(st.slots.length - 1);
});

/** יצירת אזור טקסט קבוע, בלחיצה על טקסט אפור שזוהה במצב "עריכת טקסט" */
function editCandidateText(i) {
  const c = st.candidates[i];
  openTextEdit({
    text: c.old,
    onSave: text => {
      if (!text) return;
      st.slots.push({ box: c.box, kind: 'text', text, old: c.old });
      renderBoxes(); renderSlots(); schedulePreviewRefresh();
    }
  });
}

/** עריכת אזור טקסט קיים במצב "עריכת טקסט": לתמיד (בתבנית עצמה), או רק לשבוע שבתצוגה המקדימה */
function editSlotText(s) {
  const idx = st.slots.indexOf(s), built = builtSlots(), b = built[idx], k = slotKey(b), host = specialHost(built);
  const canWeek = !!st.previewData;
  let weekOverridden = false;
  if (canWeek) {
    const edits = weekEditsFor(weekKey());
    weekOverridden = Object.keys(edits).some(key => key.replace(/^p\d+\|/, '') === k);
  }
  openTextEdit({
    text: s.text || '',
    weekLabel: canWeek && st.weekShown ? weekLabel(st.weekShown) : null,
    hasOverride: !!s.text || weekOverridden,
    onSave: (text, scope) => {
      if (scope === 'week' && canWeek) saveWeekText(b, k, host, text);
      else {
        s.text = text;
        if (!s.text) { st.slots.splice(idx, 1); st.sel = null; }
      }
      renderSlots(); renderBoxes(); schedulePreviewRefresh();
    },
    onDelete: () => {
      if (weekOverridden) resetWeek(s);
      else { st.slots.splice(idx, 1); st.sel = null; }
      renderSlots(); renderBoxes(); schedulePreviewRefresh();
    }
  });
}

/** שמירת טקסט לשבוע שבתצוגה המקדימה בלבד, כמו saveWeekLine אבל בלי פיצול לשורות */
function saveWeekText(b, k, host, text) {
  const { values, pages } = st.previewData;
  const plain = slotText(b, { ...values, edits: null }, host);
  const edits = weekEditsFor(weekKey());
  const hit = pages.map((v, i) => i).filter(i => { const t = slotText(b, { ...pages[i], edits: null }, host); return t != null && t === plain; });
  for (const i of hit.length ? hit : [0]) {
    if (text === plain || !text) delete edits['p' + i + '|' + k];
    else edits['p' + i + '|' + k] = text;
  }
}

function focusSlot(i) {
  const s = st.slots[i];
  if (!s) return;
  openSlots.add(s);
  st.sel = i;
  renderBoxes(); renderSlots();
  const ed = document.querySelector('.slot-ed[data-i="' + i + '"]');
  if (!ed) return;
  document.querySelectorAll('.slot-ed.sel').forEach(x => x.classList.remove('sel'));
  ed.classList.add('sel');
  ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  (ed.querySelector('[data-k="text"]') || ed.querySelector('select')).focus({ preventScroll: true });
}

/* סימון אזור חדש בגרירה (למסמך סרוק, או לטקסט שלא זוהה) */
$('tplDraw').onclick = () => {
  st.drawing = !st.drawing;
  $('tplDraw').setAttribute('aria-pressed', String(st.drawing));
  $('tplPage').classList.toggle('drawing', st.drawing);
  if (st.drawing) setMoving(false);
};

/* הזזת אזורים וטקסט אפור בגרירה: רק כשהכפתור לחוץ, כדי שאזורים לא יזוזו בטעות */
function setMoving(on) {
  st.moving = on;
  $('tplMove').setAttribute('aria-pressed', String(on));
  $('tplPage').classList.toggle('moving', on);
}
$('tplMove').onclick = () => {
  setMoving(!st.moving);
  if (st.moving && st.drawing) $('tplDraw').click();
  renderBoxes();
};

/* עריכת טקסט בלחיצה: על טקסט שזוהה אוטומטית (יוצר אזור טקסט קבוע), או על אזור טקסט קיים */
$('tplEditText').onclick = () => {
  st.textEditing = !st.textEditing;
  $('tplEditText').setAttribute('aria-pressed', String(st.textEditing));
  $('tplPage').classList.toggle('text-editing', st.textEditing);
};
let drag = null;
const toImg = (e) => {
  const r = $('tplPage').getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * st.W, y: (e.clientY - r.top) / r.height * st.H };
};
/** גובה בעמוד שבעורך ← הגובה המתאים בקובץ, לפני שהשורות זזו בכתיבה מחדש */
const toSrcY = y => st.view ? st.view.toSrc(y) : y;
let resize = null;
$('tplPage').addEventListener('pointerdown', e => {
  const h = st && !st.drawing && e.target.closest('.rh');
  if (h) {
    e.preventDefault();
    $('tplPage').setPointerCapture(e.pointerId);
    const s = st.slots[st.sel];
    slotStyle(s);   // המראה נמדד לפני המתיחה, על הטקסט המקורי
    s.box = { ...s.box };   // אזור שנוצר מטקסט בדף חולק איתו את אותה תיבה
    if (!s.nameBox) { s.nameBox = { ...s.box }; s.autoPrefix = s.prefix || ''; }
    resize = { s, edge: h.dataset.edge };
    return;
  }
  const tb = st && st.moving && !st.drawing && e.button === 0 && e.target.closest('.tb.slot, .tb.cand');
  if (tb) { move = { i: tb.dataset.s != null ? +tb.dataset.s : null, c: tb.dataset.c, cx: e.clientX, cy: e.clientY, start: toImg(e) }; return; }
  if (!st || !st.drawing) return;
  e.preventDefault();
  $('tplPage').setPointerCapture(e.pointerId);
  drag = { start: toImg(e), el: document.createElement('div') };
  drag.el.className = 'tb slot drag';
  $('tplBoxes').appendChild(drag.el);
});
$('tplPage').addEventListener('pointermove', e => {
  if (resize) {
    const p = toImg(e), b = resize.s.box, MIN = 8;
    p.y = toSrcY(p.y);
    const r = b.x + b.w, bot = b.y + b.h;
    if (resize.edge === 'l') { b.x = Math.min(p.x, r - MIN); b.w = r - b.x; }
    if (resize.edge === 'r') b.w = Math.max(MIN, p.x - b.x);
    if (resize.edge === 't') { b.y = Math.min(p.y, bot - MIN); b.h = bot - b.y; }
    if (resize.edge === 'b') b.h = Math.max(MIN, p.y - b.y);
    renderBoxes();
    return;
  }
  if (move) {
    // תזוזה קטנה היא עדיין לחיצה על האזור
    if (!move.s && Math.hypot(e.clientX - move.cx, e.clientY - move.cy) < 6) return;
    e.preventDefault();
    if (!move.s) { $('tplPage').setPointerCapture(e.pointerId); startMove(); }
    move.p = toImg(e);
    if (!move.frame) move.frame = requestAnimationFrame(stepMove);
    return;
  }
  if (!drag) return;
  const p = toImg(e), s = drag.start;
  drag.box = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
  drag.el.setAttribute('style', boxStyle(drag.box));
});
$('tplPage').addEventListener('pointerup', () => {
  if (move) { endMove(); return; }
  if (resize) {
    const s = resize.s, b = s.box;
    resize = null;
    // קו הבסיס של הכתיבה נשאר, אלא אם האזור זז ממנו
    if (b.baseline != null && (b.baseline < b.y || b.baseline > b.y + b.h)) b.baseline = b.y + b.h * 0.78;
    if (s.kind === 'parasha' || s.kind === 'parashaName') stretchPrefix(s);
    if (s.kind === 'kiddush') fitKiddush(s, false);
    // עד שהעמוד יצויר מחדש, המסגרת נשארת כפי שנמתחה ולא חוזרת למקום הטקסט הקודם
    if (st.view) st.view.slots.delete(s);
    schedulePreviewRefresh();
    renderBoxes(); renderSlots();
    return;
  }
  if (!drag) return;
  let b = drag.box;
  drag.el.remove(); drag = null;
  if (!b || b.w < 8 || b.h < 8) return;
  // המסגרת סומנה על העמוד שבעורך – נשמרת במקום המתאים בקובץ
  const top = toSrcY(b.y);
  b = { ...b, y: top, h: Math.max(8, toSrcY(b.y + b.h) - top) };
  st.slots.push({ box: b, kind: 'rule', when: isDays() ? 'd0' : 'כל יום', name: '', base: 'שקיעה', offset: '0', round: 'ללא', old: '' });
  st.drawing = false;
  $('tplDraw').setAttribute('aria-pressed', 'false');
  $('tplPage').classList.remove('drawing');
  renderBoxes(); focusSlot(st.slots.length - 1);
});
// גלילה בטלפון שהתחילה על אזור: הגרירה מתבטלת והאזור חוזר למקומו
$('tplPage').addEventListener('pointercancel', () => {
  if (!move) return;
  const m = move;
  move = null;
  cancelAnimationFrame(m.frame);
  if (m.s) { m.s.box = m.base.box; m.s.labelBox = m.base.label; renderBoxes(); }
});

/*
 * גרירת אזור למקום אחר בעמוד. המסגרת המקווקוות עוקבת אחרי הסמן, והאזור עצמו מוצג במקום שבו יונח:
 * המקום הקרוב שבו הוא לא עולה על טקסט אחר, ועדיף מיושר לשורה או לעמודה של הטקסט שסביבו (template-place.js).
 * המקום המקורי בקובץ נשמר ב-s.origin, כדי שהטקסט הישן יימחק ממנו בציור
 */
let move = null;   // { i, cx, cy, start, s, base, place, p, ghost, frame }
const shiftBox = (b, dx, dy) => b && { ...b, x: b.x + dx, y: b.y + dy, ...(b.baseline != null ? { baseline: b.baseline + dy } : {}) };
const toView = y => st.view ? st.view.toView(y) : y;

function startMove() {
  // טקסט מהקובץ שעוד אינו אזור: נגרר כאזור של טקסט קבוע
  if (move.i == null) {
    const c = st.candidates[+move.c];
    st.slots.push({ box: c.box, kind: 'text', text: c.old, old: c.old });
    move.i = st.slots.length - 1;
  }
  const s = move.s = st.slots[move.i];
  const bg = slotStyle(s).bg;   // המראה נמדד על הטקסט המקורי, לפני שהאזור זז ממנו
  move.base = { box: s.box, label: s.labelBox };
  const home = o => (o.origin && o.origin.box) || o.box;
  const others = st.slots.filter(o => o !== s);
  const taken = others.flatMap(o => [o.box, o.labelBox]).filter(Boolean);
  // טקסט מהקובץ שנשאר בעמוד כמו שהוא: לא מכוסה באזור, ולא במקום שממנו אזור הוזז
  const kept = st.candidates.map(c => c.box).filter(b => !st.slots.some(o => covers(o.box, b) || (o.labelBox && covers(o.labelBox, b)) || movedFrom(o, b)));
  move.place = placer(st.canvas, {
    bg,
    // הטקסט באזורים נכתב מחדש, והשם של האזור שנגרר עובר איתו – הדיו הישן שם לא תופס מקום
    erased: [...st.slots.map(home), (s.origin && s.origin.labelBox) || s.labelBox].filter(Boolean),
    taken,
    refs: [...taken, ...kept, home(s)]
  });
}

function stepMove() {
  move.frame = 0;
  const { s, base, start, p } = move;
  const g = base.label ? unionBox(base.box, base.label) : base.box;
  // הסמן זז על העמוד שבעורך; המקום בקובץ מחושב לפי השורות שנפתחו או נסגרו בו
  const vy = p.y - start.y, dx = p.x - start.x, dy = toSrcY(toView(base.box.y) + vy) - base.box.y;
  move.ghost = { ...g, x: g.x + dx, y: toView(g.y) + vy };
  const best = move.place(base.box, base.label, dx, dy);
  s.box = shiftBox(base.box, best.dx, best.dy);
  s.labelBox = shiftBox(base.label, best.dx, best.dy);
  renderBoxes();
}

function endMove() {
  const m = move;
  move = null;
  if (!m.s) return;
  cancelAnimationFrame(m.frame);
  if (m.p) { move = m; stepMove(); move = null; }
  const s = m.s, dx = s.box.x - m.base.box.x, dy = s.box.y - m.base.box.y;
  st.movedAt = Date.now();
  if (dx || dy) {
    if (!s.origin) s.origin = { box: m.base.box, ...(m.base.label ? { labelBox: m.base.label } : {}) };
    // הוחזר בדיוק למקום המקורי – אין מה למחוק
    else if (s.box.x === s.origin.box.x && s.box.y === s.origin.box.y) delete s.origin;
    if (s.nameBox) s.nameBox = shiftBox(s.nameBox, dx, dy);
    if (st.view) st.view.slots.delete(s);
    schedulePreviewRefresh();
  }
  st.sel = m.i;
  renderBoxes(); renderSlots();
}

/* ---------- רשימת האזורים ---------- */

function slotFields(s) {
  if (s.kind === 'text') {
    return '<div class="rgrid"><div class="wide"><label>הטקסט באזור</label><input data-k="text" dir="auto" value="' + esc(s.text) +
      '" placeholder="ריק – האזור יימחק מהלוח"></div></div>';
  }
  if (s.kind === 'rule') {
    const fixed = s.base === 'שעה קבועה';
    return '<div class="rgrid">' +
      '<div class="wide"><label>שם</label><input data-k="name" value="' + esc(s.name) + '" placeholder="למשל: מנחה"></div>' +
      (isDays() ? dayChecks(s)
        : '<div><label>מתי</label><select data-k="when">' + opts(WHEN_LABELS, s.when) + '</select></div>') +
      '<div><label>לפי</label><select data-k="base">' + baseOpts(s) + '</select></div>' +
      (fixed
        ? '<div><label>שעה</label><input data-k="offset" dir="ltr" value="' + esc(s.offset) + '"></div>'
        : '<div><label>הפרש (דקות)</label><div class="offset-pair"><input data-k="offsetAbs" type="number" min="0" inputmode="numeric" dir="ltr" value="' +
          esc(offsetAbs(s)) + '" placeholder="20"><select data-k="offsetDir">' + opts(['אחרי', 'לפני'], offsetDir(s)) + '</select></div></div>') +
      '<div><label>עיגול</label><select data-k="round"' + (fixed ? ' disabled' : '') + '>' + opts(ROUND, s.round) + '</select></div>' +
      ruleChoices(s) + '</div>';
  }
  if (s.kind === 'kiddush') {
    return '<div class="rgrid">' +
      '<div class="wide"><label>שם</label><input data-k="name" value="' + esc(s.name) + '" placeholder="למשל: קידוש"></div>' +
      (isDays() ? dayChecks(s)
        : '<div><label>מתי</label><select data-k="when">' + opts(WHEN_LABELS, s.when) + '</select></div>') +
      '</div>' +
      '<p class="hint">האזור יתמלא בהודעה בנוסח שהגבאי קבע בלוח הקידושים של הקהילה – השורה הראשונה, "ע״י", ' +
      'בעל הקידוש והסיבה – לפי מי שאושר לקידוש בתאריך הזה. בלי קידוש מאושר, האזור לא יתמלא. ' +
      'כאן בעורך, כשאין קידוש מאושר, מוצג קידוש לדוגמה.</p>';
  }
  if (s.kind === 'parasha' || s.kind === 'parashaName') {
    return '<div class="rgrid"><div class="wide"><label>טקסט לפני הפרשה</label><input data-k="prefix" value="' + esc(s.prefix || '') +
      '" placeholder="למשל: לשבת"></div></div>';
  }
  if (s.kind === 'zman') {
    return '<div class="rgrid">' +
      '<div><label>איזה זמן</label><select data-k="zman">' + opts(ZMANIM, zmanLabel(s.zman)) + '</select></div>' +
      '<div><label>של איזה יום</label><select data-k="when">' + opts(isDays() ? dayOpts() : [['כניסה', 'ערב שבת/חג'], ['כל יום', 'שבת/חג'], ['יציאה', 'מוצאי שבת/חג']], s.when) + '</select></div></div>';
  }
  return '';
}

/**
 * הכללים שמסבירים את השעה שבקובץ (למשל "15 דק׳ לפני שקיעה" או "שעה קבועה"), לבחירה בלחיצה.
 * הכלל שנבחר ייקבע את השעה בשאר השבתות.
 */
function ruleChoices(s) {
  if (!s.options || s.options.length < 2) return '';
  return '<div class="wide"><label>כללים שמתאימים ל-' + esc(s.old) + ' בקובץ</label><div class="rule-opts">' +
    s.options.map((o, j) => '<button type="button" class="chip" data-opt="' + j + '" aria-pressed="' + sameRule(o, s) + '">' +
      esc(ruleText(o)) + (o.printed ? ' <small>(לפי הזמן שבלוח)</small>' : o.approx ? ' <small>(משוער)</small>' : '') + '</button>').join('') +
    '</div></div>';
}

/** הרווחים לפני פסקה ואחריה, באחוזים מגובה הטקסט */
const SPACES = [[0, 'ללא'], [25, 'רבע שורה'], [50, 'חצי שורה'], [75, '¾ שורה'], [100, 'שורה'], [150, 'שורה וחצי'], [200, 'שתי שורות']];

/**
 * הפסקה של האזור: צירוף לפסקה של האזור שלפניו בעמוד, והרווח לפני הפסקה ואחריה.
 * הרווח לפני נקבע באזור הראשון בפסקה, והרווח אחרי – באחרון. order – סדר האזורים בעמוד (אינדקסים ב-st.slots)
 */
function paraFields(s, i, order, ranks) {
  const pos = order.indexOf(i), prev = order[pos - 1], next = st.slots[order[pos + 1]];
  const joined = !!s.joinPrev && prev != null;
  // האזורים שבפסקה: מהראשון (שלא מצורף לקודם) עד האחרון (שהבא אחריו לא מצורף אליו)
  let a = pos, z = pos;
  while (a > 0 && st.slots[order[a]].joinPrev) a--;
  while (z < order.length - 1 && st.slots[order[z + 1]].joinPrev) z++;
  const spaceOpts = v => '<option value=""' + (v == null ? ' selected' : '') + '>אוטומטי</option>' +
    SPACES.map(([n, t]) => '<option value="' + n + '"' + (n === v ? ' selected' : '') + '>' + t + '</option>').join('');
  const where = a === z ? '' : ' (הפסקה: אזורים ' + ranks[order[a]] + '–' + ranks[order[z]] + ')';
  return '<div class="rgrid">' +
    (prev != null ? '<div class="wide"><label class="check"><input type="checkbox" data-k="joinPrev"' + (joined ? ' checked' : '') +
      '> באותה פסקה עם האזור שלפניו (' + ranks[prev] + ')</label></div>' : '') +
    (joined ? '' : '<div><label>רווח לפני הפסקה' + where + '</label><select data-k="spaceBefore">' + spaceOpts(s.spaceBefore) + '</select></div>') +
    (next && next.joinPrev ? '' : '<div><label>רווח אחרי הפסקה' + where + '</label><select data-k="spaceAfter">' + spaceOpts(s.spaceAfter) + '</select></div>') +
    '<p class="hint wide">הרווח נמדד מהשורה הסמוכה, ביחס לגובה הטקסט. אוטומטי – כמו בקובץ (טקסט של כמה שורות מקבל רווח מעט גדול מהרווח שבין שורותיו). ' +
    'כדי לצרף לפסקה שורה שאין בה זמן, לחצו עליה בדף והיא תהפוך לאזור של טקסט קבוע.</p></div>';
}

/** גודל הטקסט, הדגשה, נטייה וריווח השורות באזור, בנפרד מהאזורים האחרים */
function sizeFields(s) {
  const sizeOpts = v => SIZES.map(n => '<option value="' + n + '"' + (n === (v || 100) ? ' selected' : '') + '>' + n + '%</option>').join('');
  const look = lookOf(s);
  const lookBtn = (k, text, label) => '<button type="button" class="chip look-' + k + '" data-look="' + k + '" aria-pressed="' + look[k] +
    '" title="' + label + '" aria-label="' + label + '">' + text + '</button>';
  return '<div class="rgrid"><div><label>גודל הטקסט באזור</label><select data-k="sizePct">' + sizeOpts(s.sizePct) + '</select></div>' +
    '<div><label>עיצוב הטקסט</label><div class="look-btns">' + lookBtn('bold', 'B', 'הדגשה') + lookBtn('italic', 'I', 'נטוי') + '</div></div>' +
    (s.wrap ? '<div><label>ריווח בין השורות</label><select data-k="lineHeightPct">' + sizeOpts(s.lineHeightPct) + '</select></div>' +
      '<div><label>מספר שורות</label><select data-k="lineCount">' +
      [2, 3, 4, 5, 6].map(n => '<option value="' + n + '"' + (n === (s.lineCount || 2) ? ' selected' : '') + '>' + n + '</option>').join('') +
      '</select></div>' : '') +
    '<div class="wide"><label class="check"><input type="checkbox" data-k="wrap"' + (s.wrap ? ' checked' : '') +
    '> לאפשר גלישה לכמה שורות אם הטקסט ארוך מדי</label></div>' +
    (s.wrap ? '<div class="wide wrap-lines">' + wrapLines(s) + '</div>' : '') + '</div>';
}

/**
 * תיבה לכל שורה, עם המילים של הטקסט שבתצוגה. לחיצה על מילה מעבירה אותה לשורה הבאה,
 * ומהשורה האחרונה – חזרה לראשונה. כל עוד כל המילים בשורה הראשונה, החלוקה נקבעת לפי האורך.
 */
function wrapLines(s) {
  const text = slotTexts.get(s);
  if (!text || !text.trim()) return '<p class="hint">המילים יופיעו כאן אחרי שהתצוגה תתעדכן.</p>';
  const { words, lines, own, fixed, count } = lineWords(s);
  const box = n => lineEdit && lineEdit.s === s && lineEdit.n === n ? lineEditor(s, n) :
    '<div class="wrap-line"><span class="wrap-no">שורה ' + (n + 1) + '</span>' +
    words.map((w, i) => lines[i] !== n ? '' : fixed ? '<span class="chip">' + esc(w) + '</span>'
      : '<button type="button" class="chip" data-word="' + i + '">' + esc(w) + '</button>').join('') +
    '<button type="button" class="wrap-edit" data-edit-line="' + n + '" title="עריכת הנוסח בשורה ' + (n + 1) +
    '" aria-label="עריכת הנוסח בשורה ' + (n + 1) + '">✎</button></div>';
  const week = st.weekShown ? ' (' + esc(weekLabel(st.weekShown)) + ')' : '';
  return Array.from({ length: count }, (x, n) => box(n)).join('') + '<p class="hint">' +
    (own ? 'הנוסח נערך במיוחד לשבוע שבתצוגה' + week + ', והשורות בו לפי העריכה. ' +
      '<button type="button" class="linkish" data-week-reset>ביטול העריכה לשבוע הזה</button>'
      : fixed ? 'השורות כמו בהודעה בלוח הקידושים: הכותרת, "ע״י" ובעל הקידוש, והסיבה.'
      : 'לחצו על מילה כדי להעביר אותה לשורה הבאה' +
        (lines.some(Boolean) ? '' : ' (כל עוד כל המילים בשורה הראשונה, הטקסט מתחלק לפי האורך)') + '.') +
    ' לשינוי הנוסח עצמו – לחצו על ✎ שבצד השורה.' +
    (s.rewords && s.rewords.length ? ' <button type="button" class="linkish" data-reword-reset>חזרה לנוסח המקורי בכל השבועות</button>' : '') + '</p>';
}

let lineEdit = null;   // { s, n } – השורה שהנוסח שלה נערך כרגע

/**
 * המילים שבתצוגה, השורה של כל אחת ומספר השורות. השורות נקבעות לפי ירידות השורה שבטקסט (fixed) כשהנוסח נערך
 * לשבוע שבתצוגה (own), ובהודעה מלוח הקידושים – הכותרת / ע״י ובעל הקידוש / הסיבה, בכל שבוע לפי אורך השמות שבו.
 * אחרת – לפי המילים שהגבאי העביר בין השורות (s.lines)
 */
function lineWords(s) {
  const text = (slotTexts.get(s) || '').trim();
  if (text.includes('\n')) {
    const words = [], lines = [], rows = text.split('\n').filter(ln => ln.trim());
    rows.forEach((ln, n) => ln.trim().split(/\s+/).forEach(w => { words.push(w); lines.push(n); }));
    const own = slotEdited.has(s);
    return { words, lines, count: own ? Math.max(s.lineCount || 2, rows.length) : rows.length, own, fixed: true };
  }
  const words = text ? text.split(/\s+/) : [], count = s.lineCount || 2;
  return { words, lines: words.map((w, i) => wordLine(s.lines, i, count)), count, own: false, fixed: false };
}

const lineText = (s, n) => { const { words, lines } = lineWords(s); return words.filter((w, i) => lines[i] === n).join(' '); };

/** "שבת פרשת נח · 17.10" */
const weekLabel = p => { const [, m, d] = toYmd(p.first).split('-'); return (p.title || '') + ' · ' + +d + '.' + +m; };

/** השבתות/החגים (או שבועות ימי החול) הקרובים שהלוח שלהם נבנה לפי התבנית, לבחירת השבוע בעריכת הנוסח */
function upcomingWeeks() {
  const out = [];
  let from = todayIn(st.cfgAll.tz);
  for (let k = 0; k < 16; k++) {
    const p = periodFor(st.cfgAll, st.tpl, from, 1, k > 0) || findPeriod(st.tpl.kind, from, st.cfg.il);
    if (!p || out.some(x => x.first === p.first)) break;
    out.push(p);
    from = p.last + 1;
  }
  const cur = st.weekShown;
  if (cur && !out.some(x => x.first === cur.first)) out.unshift(cur);
  return out;
}

/** עורך הנוסח של שורה n: בחירת השבוע, מה שיודפס באותו שבוע, והנוסח החדש – לשבוע הזה או לכל השבועות */
function lineEditor(s, n) {
  const weeks = st.weeks || (st.weeks = upcomingWeeks());
  const cur = st.weekShown, own = lineWords(s).own;
  const full = lineWords(s), count = full.count;
  const shown = Array.from({ length: count }, (x, k) => full.words.filter((w, i) => full.lines[i] === k).join(' ')).filter(Boolean);
  const kd = s.kind === 'kiddush' && cur ? (hasKiddush(cur) ? 'קידוש מאושר מלוח הקידושים של הקהילה.' : 'אין קידוש מאושר לשבוע הזה – מוצג קידוש לדוגמה.') : '';
  return '<div class="wrap-line line-ed"><span class="wrap-no">שורה ' + (n + 1) + '</span><div class="line-ed-body">' +
    '<label>לאיזה שבוע?</label><select data-week>' + weeks.map((p, i) =>
      '<option value="' + i + '"' + (cur && p.first === cur.first ? ' selected' : '') + '>' + esc(weekLabel(p)) + '</option>').join('') + '</select>' +
    '<div class="line-ed-week"><b>מה יודפס באזור בשבוע הזה:</b>' + shown.map((ln, k) => '<div>' + esc(ln) + '</div>').join('') +
    (kd ? '<small>' + kd + '</small>' : '') + '</div>' +
    '<label>הנוסח בשורה ' + (n + 1) + '</label><input data-line-text value="' + esc(lineText(s, n)) + '">' +
    '<div class="line-ed-scope"><label class="check"><input type="radio" name="lineScope" value="week" checked> רק בשבוע הזה</label>' +
    '<label class="check"><input type="radio" name="lineScope" value="all"' + (own ? ' disabled' : '') + '> בכל השבועות (נוסח קבוע)</label></div>' +
    (own ? '<p class="hint">הנוסח כבר נערך לשבוע הזה. כדי לשנות לכל השבועות, בטלו קודם את העריכה לשבוע הזה.</p>' : '') +
    '<div class="line-ed-btns"><button type="button" class="primary" data-line-save>שמירה</button>' +
    '<button type="button" data-line-cancel>ביטול</button></div></div></div>';
}

const hasKiddush = p => !!kiddush && p.days.some(d => kiddush.get(toYmd(d.day)));

/** פתיחת עורך הנוסח לשורה n. התצוגה עוברת לשבוע שנבחר, כדי שהגבאי יראה את מה שיודפס בו */
function editLine(s, n) {
  lineEdit = { s, n };
  if (!st.previewData) schedulePreviewRefresh();
  refreshWrapLines();
  const input = document.querySelector('.line-ed [data-line-text]');
  if (input) input.focus();
}

/** שמירת הנוסח שנכתב לשורה, לפי מה שנבחר: לשבוע שבתצוגה בלבד, או לכל השבועות */
function saveLine(s, n, typed, scope) {
  const to = typed.replace(/\s+/g, ' ').trim();
  lineEdit = null;
  if (scope === 'all') rewordAll(s, n, to);
  else if (st.previewData) saveWeekLine(s, n, to);
  refreshWrapLines();
  schedulePreviewRefresh();
}

/** המפתח של הלוח שבתצוגה בשינויים לשבוע מסוים (כמו editKey ב-app.js) */
const weekKey = () => st.tpl.id + ':' + st.weekShown.first;

/**
 * שינוי לשבוע שבתצוגה בלבד: הטקסט של האזור כולו, עם ירידת שורה בין השורות, נשמר בשינויים של אותו לוח
 * (cfg.edits) לכל עמוד שבו האזור נכתב באותו טקסט. עד שמירת התבנית השינויים ממתינים ב-st.weekEdits
 */
function saveWeekLine(s, n, to) {
  const { words, lines, count } = lineWords(s);
  const rows = Array.from({ length: count }, (x, k) => words.filter((w, i) => lines[i] === k).join(' '));
  rows[n] = to;
  const text = rows.filter(Boolean).join('\n');
  const built = builtSlots(), b = built[st.slots.indexOf(s)], k = slotKey(b), host = specialHost(built);
  const { values, pages } = st.previewData;
  const plain = slotText(b, { ...values, edits: null }, host);
  const edits = weekEditsFor(weekKey());
  const hit = pages.map((v, i) => i).filter(i => { const t = slotText(b, { ...pages[i], edits: null }, host); return t != null && t === plain; });
  for (const i of hit.length ? hit : [0]) {
    if (!text || text === plain || text.replace(/\n/g, ' ') === plain) delete edits['p' + i + '|' + k];
    else edits['p' + i + '|' + k] = text;
  }
}

/** השינויים לשבוע key: מה שכבר נשמר בהגדרות, עם מה שנערך עכשיו */
function weekEditsFor(key) {
  if (!st.weekEdits) st.weekEdits = {};
  if (!st.weekEdits[key]) st.weekEdits[key] = { ...((st.cfgAll.edits || {})[key] || {}) };
  return st.weekEdits[key];
}

/** ביטול העריכה של האזור s בשבוע שבתצוגה */
function resetWeek(s) {
  const k = slotKey(builtSlots()[st.slots.indexOf(s)]), edits = weekEditsFor(weekKey());
  for (const key of Object.keys(edits)) if (key.replace(/^p\d+\|/, '') === k) delete edits[key];
  schedulePreviewRefresh();
}

/**
 * שינוי הנוסח של שורה n בכל השבועות: המילים שבשורה מוחלפות בטקסט שנכתב, והמילים החדשות נשארות באותה שורה.
 * נשמר כהחלפה (s.rewords), ולא כטקסט קבוע, כדי שמה שמשתנה בשאר השורות ימשיך להתעדכן
 */
function rewordAll(s, n, to) {
  const { words, lines, fixed } = lineWords(s);
  const idx = lines.map((l, i) => l === n ? i : -1).filter(i => i >= 0);
  const first = idx.length ? idx[0] : lines.filter(l => l < n).length, last = idx.length ? idx[idx.length - 1] : first - 1;
  if (idx.length && last - first + 1 !== idx.length) {
    SiteDialog.alert('המילים בשורה הזו לא רצופות בטקסט. החזירו אותן לסדר (בלחיצה על המילים) ונסו שוב.');
    return;
  }
  const from = words.slice(first, last + 1).join(' ');
  if (to === from) return;
  if (!from) {
    // שורה ריקה: המילים נוספות אחרי המילה האחרונה שבשורות שלפניה
    if (!to) return;
    const before = words.slice(0, first).join(' ');
    if (!before) { SiteDialog.alert('אפשר להוסיף מילים לשורה ריקה רק אחרי שיש מילים בשורה שלפניה.'); return; }
    addReword(s, before, before + ' ' + to);
  } else addReword(s, from, to);
  // בהודעה מלוח הקידושים השורות נקבעות לפי ההודעה עצמה, ולא לפי מספר המילים
  if (!fixed) {
    const added = to ? to.split(' ').length : 0;
    s.lines = [...lines.slice(0, first), ...Array(added).fill(n), ...lines.slice(last + 1)];
    if (!s.lines.some(Boolean)) delete s.lines;
  }
  schedulePreviewRefresh();
}

/** מוסיף החלפה. עריכה נוספת של אותן מילים מעדכנת את ההחלפה הקודמת במקום להוסיף עוד אחת */
function addReword(s, from, to) {
  const list = s.rewords || [];
  const prev = list.find(p => p[1] === from && p[1]);
  if (prev) prev[1] = to; else list.push([from, to]);
  s.rewords = list.filter(([a, b]) => a !== b);
  if (!s.rewords.length) delete s.rewords;
}

/**
 * הימים שבהם שעה בלוח ימי חול חלה. s.when – היום שהערך שלו נכתב באזור;
 * s.days – כשהשעה חלה על כמה ימים ("ימים: א'-ה'"), כל הימים.
 */
const slotDays = s => (s.days && s.days.length ? s.days : [s.when]);

function dayChecks(s) {
  const on = new Set(slotDays(s));
  return '<div class="wide"><label>ימים</label><div class="day-checks">' + dayOpts().map(([k, n]) =>
    '<label class="check"><input type="checkbox" data-k="day" value="' + k + '"' + (on.has(k) ? ' checked' : '') + '> ' + esc(n) + '</label>').join('') +
    '</div></div>';
}

function daysLabel(s) {
  const d = slotDays(s);
  return d.length > 1 ? d.map(whenLabel).join(', ') : whenLabel(s.when);
}

/** תרגום "מתי" למילה בעברית: בלוח ימי חול s.when הוא מפתח (d0…d5) */
function whenLabel(w) {
  if (!isDays()) return w;
  const hit = dayOpts().find(([k]) => k === w);
  return hit ? hit[1] : w;
}

/** הכותרת לשורה הסגורה: שם התפילה, או סוג האזור לשאר הסוגים */
const slotLabel = s => (s.kind === 'rule' || s.kind === 'kiddush') ? (s.name || 'תפילה חדשה') : (KIND_LABEL[s.kind] || s.kind);

/** תקציר לשורה הסגורה: מתי ולפי מה, ומה היה בקובץ הישן */
function slotSum(s) {
  const parts = [];
  if (s.kind === 'rule') {
    parts.push(daysLabel(s), ruleText(s));
  } else if (s.kind === 'kiddush') {
    parts.push(daysLabel(s));
  } else if (s.kind === 'zman') {
    parts.push(zmanLabel(s.zman), whenLabel(s.when));
  } else if (s.kind === 'text' && s.text) {
    parts.push(s.text);
  }
  if (s.old) parts.push('בקובץ: ' + s.old + (s.label && s.kind !== 'rule' ? ' (' + s.label + ')' : ''));
  return parts.filter(Boolean).join(' · ');
}

function renderSlots() {
  // אזור שנוסף או הוסר משנה את הגופנים שכותבים בהם
  renderFontFill();
  if (!st.slots.length) {
    $('tplSlots').innerHTML = '<p class="hint">לא זוהו אזורים. ' + (st.scanned ? 'לחצו "סימון אזור" וגררו על כל שעה בדף.' : '') + '</p>';
    return;
  }
  const ranks = slotRanks();
  // מוצגים לפי המספור בעמוד; data-i שומר את האינדקס המקורי ב-st.slots
  const order = st.slots.map((s, i) => i).sort((a, b) => ranks[a] - ranks[b]);
  $('tplSlots').innerHTML = order.map(i => [st.slots[i], i]).map(([s, i]) =>
    '<details class="rule slot-ed" data-i="' + i + '"' + (openSlots.has(s) ? ' open' : '') + '>' +
    '<summary><span class="num">' + ranks[i] + '</span><b class="rule-name">' + esc(slotLabel(s)) + '</b>' +
    '<span class="rule-sum">' + esc(slotSum(s)) + '</span></summary>' +
    '<div class="slot-top"><select data-k="kind" aria-label="מה יופיע באזור ' + ranks[i] + '">' + opts(KINDS, s.kind) + '</select>' +
    '<button type="button" class="del" data-del="' + i + '">הסרה</button></div>' + slotFields(s) + sizeFields(s) + paraFields(s, i, order, ranks) + '</details>'
  ).join('') + specialHint();
}

/** הודעה כשאין בקובץ אזור לשם של שבת מיוחדת (זכור, נחמו…) */
function specialHint() {
  if (isChol() || st.slots.some(s => s.kind === 'special')) return '';
  const host = specialHost(st.slots);
  return '<p class="hint">' + (host
    ? 'אין בקובץ אזור לשבת מיוחדת: בשבתות כמו זכור או נחמו השם יתווסף ל' + (host === 'title' ? 'כותרת' : 'פרשה') +
      '. אפשר גם לסמן לו אזור משלו ("סימון אזור") ולבחור "שבת מיוחדת".'
    : 'אין בקובץ אזור לשבת מיוחדת או לכותרת, ולכן בשבתות כמו זכור או נחמו השם לא יופיע. ' +
      'כדי שיופיע, לחצו "סימון אזור", גררו על מקום פנוי ובחרו "שבת מיוחדת".') + '</p>';
}
$('tplSlots').addEventListener('toggle', e => {
  const s = st.slots[+e.target.getAttribute('data-i')];
  if (s) e.target.open ? openSlots.add(s) : openSlots.delete(s);
}, true);

$('tplSlots').addEventListener('input', e => {
  const ed = e.target.closest('.slot-ed'), k = e.target.dataset.k;
  if (!ed || !k) return;
  const s = st.slots[+ed.dataset.i], v = e.target.value;
  if (k === 'kind') {
    s.kind = v;
    const when0 = isDays() ? 'd0' : 'כל יום';
    if (v === 'rule' && !s.base) { Object.assign(s, { when: s.when || when0, name: s.label || '', base: 'שקיעה', offset: '0', round: 'ללא' }); reinfer(s); }
    if (v === 'kiddush' && !s.name) Object.assign(s, { when: s.when || when0, name: s.label || 'קידוש' });
    if (v === 'kiddush') { fitKiddush(s, true); schedulePreviewRefresh(); }
    if (v === 'zman' && !s.zman) Object.assign(s, { zman: 'sunset', when: s.when || when0 });
    if (v === 'gregDate' && !s.fmt) s.fmt = { sep: '/', year: 4, pad: false };
    if (v === 'text' && s.text == null) s.text = s.old || '';
    focusSlot(+ed.dataset.i); return;
  }
  if (k === 'sizePct' || k === 'lineHeightPct') { s[k] = Number(v); schedulePreviewRefresh(); return; }
  if (k === 'spaceBefore' || k === 'spaceAfter') { if (v === '') delete s[k]; else s[k] = Number(v); schedulePreviewRefresh(); return; }
  if (k === 'joinPrev') { if (e.target.checked) s.joinPrev = true; else delete s.joinPrev; renderSlots(); schedulePreviewRefresh(); return; }
  if (k === 'lineCount') { s.lineCount = Number(v); ed.querySelector('.wrap-lines').innerHTML = wrapLines(s); schedulePreviewRefresh(); return; }
  if (k === 'wrap') { s.wrap = e.target.checked; renderSlots(); schedulePreviewRefresh(); return; }
  if (k === 'day') {
    const keys = [...ed.querySelectorAll('input[data-k="day"]:checked')].map(x => x.value);
    // לפחות יום אחד
    if (!keys.length) { e.target.checked = true; return; }
    if (keys.length > 1) s.days = keys; else delete s.days;
    const when = keys[0];
    if (when !== s.when) { s.when = when; if (s.kind === 'rule') reinfer(s); }
    renderSlots(); return;
  }
  if (k === 'zman') s.zman = zmanKey(v);
  else if (k === 'offsetAbs' || k === 'offsetDir') {
    const abs = k === 'offsetAbs' ? v.replace(/[^0-9]/g, '') : offsetAbs(s);
    const dir = k === 'offsetDir' ? v : offsetDir(s);
    s.offset = abs === '' ? '' : String(dir === 'לפני' ? -Math.abs(+abs) : +abs);
    // המשתמש קבע הפרש בעצמו – הצעות הכללים כבר לא רלוונטיות. מסירים רק אותן, בלי לרנדר מחדש, כדי לא לאבד את המיקוד בשדה
    if (s.options) {
      delete s.options;
      const chips = ed.querySelector('.rule-opts');
      if (chips) chips.parentElement.remove();
    }
  } else s[k] = v;
  if (k === 'when' && s.kind === 'rule') { reinfer(s); renderSlots(); return; }
  if (k === 'base') {
    if (v === 'שעה קבועה' && s.offset.indexOf(':') < 0) s.offset = s.old && s.old.includes(':') ? s.old : '08:00';
    if (v !== 'שעה קבועה' && s.offset.indexOf(':') >= 0) s.offset = '0';
    renderSlots(); return;
  }
  ed.querySelector('.rule-name').textContent = slotLabel(s);
  ed.querySelector('.rule-sum').textContent = slotSum(s);
  // הטקסט השתנה – המילים בתיבות השורות מתעדכנות עם התצוגה. בקידוש רואים מיד את הנוסח החדש
  if (s.wrap || s.kind === 'kiddush') schedulePreviewRefresh();
});
// בחירת השבוע בעורך הנוסח: התצוגה והשורות מתעדכנות לפי מה שיודפס באותו שבוע
$('tplSlots').addEventListener('change', e => {
  const sel = e.target.closest('[data-week]');
  if (!sel || !st.weeks) return;
  st.week = st.weeks[+sel.value];
  schedulePreviewRefresh();
});
$('tplSlots').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('[data-line-text]')) return;
  e.preventDefault();
  e.target.closest('.line-ed').querySelector('[data-line-save]').click();
});
$('tplSlots').addEventListener('click', async e => {
  const lookBtn = e.target.closest('[data-look]');
  if (lookBtn) {
    const s = st.slots[+lookBtn.closest('.slot-ed').dataset.i], k = lookBtn.dataset.look;
    s[k] = !lookOf(s)[k];
    lookBtn.setAttribute('aria-pressed', String(s[k]));
    schedulePreviewRefresh();
    return;
  }
  const word = e.target.closest('[data-word]');
  if (word) {
    const s = st.slots[+word.closest('.slot-ed').dataset.i], i = +word.dataset.word;
    const n = slotTexts.get(s).trim().split(/\s+/).length;
    const count = s.lineCount || 2;
    const lines = Array.from({ length: n }, (x, j) => wordLine(s.lines, j, count));
    lines[i] = (lines[i] + 1) % count;
    s.lines = lines;
    word.closest('.wrap-lines').innerHTML = wrapLines(s);
    schedulePreviewRefresh();
    return;
  }
  const lineEd = e.target.closest('[data-edit-line]');
  if (lineEd) {
    editLine(st.slots[+lineEd.closest('.slot-ed').dataset.i], +lineEd.dataset.editLine);
    return;
  }
  if (e.target.closest('[data-line-save]') && lineEdit) {
    const box = e.target.closest('.line-ed');
    saveLine(lineEdit.s, lineEdit.n, box.querySelector('[data-line-text]').value, box.querySelector('[name="lineScope"]:checked').value);
    return;
  }
  if (e.target.closest('[data-line-cancel]')) {
    lineEdit = null;
    refreshWrapLines();
    return;
  }
  const weekReset = e.target.closest('[data-week-reset]');
  if (weekReset) {
    resetWeek(st.slots[+weekReset.closest('.slot-ed').dataset.i]);
    return;
  }
  const reset = e.target.closest('[data-reword-reset]');
  if (reset) {
    const s = st.slots[+reset.closest('.slot-ed').dataset.i];
    delete s.rewords; delete s.lines;
    schedulePreviewRefresh();
    return;
  }
  const opt = e.target.closest('[data-opt]');
  if (opt) {
    const s = st.slots[+opt.closest('.slot-ed').dataset.i];
    Object.assign(s, pickRule(s.options[+opt.dataset.opt]));
    renderSlots();
    return;
  }
  const i = e.target.dataset.del;
  if (i == null) return;
  if (!await SiteDialog.confirm('להסיר את האזור מהתבנית?', { ok: 'הסרה', danger: true })) return;
  st.slots.splice(+i, 1);
  st.sel = null;
  renderBoxes(); renderSlots();
});

/* ---------- שמירה ---------- */

/** הכללים מהאזורים, כרשימת כללים להגדרות */
function slotRules() {
  return isDays() ? daySlotRules() : holySlotRules();
}

function holySlotRules() {
  const seen = new Set(), out = [];
  for (const s of st.slots) {
    if ((s.kind !== 'rule' && s.kind !== 'kiddush') || !String(s.name).trim()) continue;
    const key = s.when + '|' + s.name.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const kd = s.kind === 'kiddush';
    out.push({ name: s.name.trim(), when: s.when, applies: 'שבת וחג', base: kd ? KIDDUSH_LABEL : s.base, offset: kd ? '' : s.offset, round: kd ? 'ללא' : s.round });
  }
  return out;
}

/**
 * בלוח של ימי חול: אזורים של אותה תפילה עם אותו כלל מתאחדים לכלל אחד,
 * ו"חל על" נבחר לפי הימים שבהם הם מופיעים (כל הימים, א׳–ה׳ וכו'), או כלל לכל יום.
 */
function daySlotRules() {
  const cols = st.period ? st.period.days : [0, 1, 2, 3, 4, 5].map(i => colOf('d' + i));
  const groups = new Map();
  for (const s of st.slots) {
    const name = String(s.name || '').trim();
    if ((s.kind !== 'rule' && s.kind !== 'kiddush') || !name) continue;
    const kd = s.kind === 'kiddush';
    const base = kd ? KIDDUSH_LABEL : s.base, round = kd ? 'ללא' : s.round, offset = kd ? '' : s.offset;
    const k = [name, base, offset, round].join('|');
    if (!groups.has(k)) groups.set(k, { name, base, offset, round, keys: new Set(), byDays: false });
    for (const d of slotDays(s)) groups.get(k).keys.add(colOf(d).key);
    if (s.days) groups.get(k).byDays = true;
  }
  const out = [];
  for (const g of groups.values()) {
    const want = cols.filter(c => g.keys.has(c.key)).map(c => c.key).join();
    // ימים שנכתבו במפורש בלוח ("ימים: א'-ה'"): קודם לפי הימים בשבוע, ולא לפי ערב שבת וחג
    const order = g.byDays ? ['כל הימים', 'א׳–ה׳', 'ב׳ וה׳'] : DAY_APPLIES.slice(0, 5);
    const applies = order.find(a => cols.filter(c => appliesOnDay(a, c)).map(c => c.key).join() === want);
    const rule = a => ({ name: g.name, when: 'כל יום', applies: a, base: g.base, offset: g.offset, round: g.round });
    if (applies) out.push(rule(applies));
    else for (const key of g.keys) out.push(rule(DOW_LABELS[colOf(key).dow]));
  }
  return out;
}

/**
 * מיזוג הכללים מהתבנית עם ההגדרות: replace=true מחליף את כולם, אחרת רק מוסיף חסרים.
 * בשבת/חג תפילה מזוהה לפי שם ומתי, ובימי חול לפי שם וחל על.
 */
export function mergeRules(rules, fromTpl, replace, kind) {
  if (replace) return fromTpl.map(r => ({ ...r }));
  const same = kind === 'days' ? (a, b) => a.name === b.name && a.applies === b.applies : (a, b) => a.name === b.name && a.when === b.when;
  const out = rules.map(r => ({ ...r }));
  for (const r of fromTpl) if (!out.some(x => same(x, r))) out.push({ ...r });
  return out;
}

/** האזורים כפי שנשמרים בתבנית, באותו סדר כמו st.slots (לפני סינון תפילות בלי שם) */
function builtSlots() {
  return st.slots.map(s => {
    const c = { box: s.box, kind: s.kind, old: s.old || '' };
    if (s.labelBox) Object.assign(c, { labelBox: s.labelBox, labelStyle: analyzeSlot(st.canvas, (s.origin && s.origin.labelBox) || s.labelBox), ...(s.label ? { label: s.label } : {}) });
    if (s.origin) c.origin = s.origin;
    if ((s.kind === 'parasha' || s.kind === 'parashaName') && s.prefix && s.prefix.trim()) c.prefix = s.prefix.trim() + ' ';
    if (s.kind === 'rule' || s.kind === 'kiddush') Object.assign(c, { name: String(s.name).trim(), when: s.when, ...(s.days ? { days: s.days } : {}) });
    if (s.kind === 'zman') Object.assign(c, { zman: s.zman, when: s.when });
    if (s.kind === 'hebDate') Object.assign(c, { ascii: !!s.ascii, noYear: !!s.noYear, ...(s.hei ? { hei: true } : {}) });
    if (s.kind === 'gregDate') c.fmt = s.fmt;
    if (s.kind === 'text') c.text = String(s.text ?? '').trim();
    c.sizePct = s.sizePct || 100;
    // הדגשה ונטייה נשמרות רק כשהגבאי בחר בהן. בלי בחירה – כמו בקובץ
    if (s.bold != null) c.bold = s.bold;
    if (s.italic != null) c.italic = s.italic;
    // ריווח הפסקה נשמר רק כשהגבאי קבע אותו. בלי – כמו בקובץ
    if (s.joinPrev) c.joinPrev = true;
    if (s.spaceBefore != null) c.spaceBefore = s.spaceBefore;
    if (s.spaceAfter != null) c.spaceAfter = s.spaceAfter;
    c.wrap = !!s.wrap;
    if (c.wrap) {
      c.lineHeightPct = s.lineHeightPct || 100;
      c.lineCount = s.lineCount || 2;
      if (s.srcLines > 1) c.srcLines = s.srcLines;
      if (s.lines && s.lines.some(Boolean)) c.lines = s.lines;
    }
    if (s.rewords && s.rewords.length) c.rewords = s.rewords;
    c.style = slotStyle(s);
    return c;
  });
}

/** מספר השימושים בכל גופן, והגופן הנפוץ בשעות – שבו נכתב אזור שסומן ידנית */
function fontUse(slots) {
  const count = {};
  for (const s of slots) if (s.box.font && st.fonts[s.box.font]) count[s.box.font] = (count[s.box.font] || 0) + (s.kind === 'rule' || s.kind === 'kiddush' || s.kind === 'zman' ? 2 : 1);
  return { count, mainFont: Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null };
}

/** ההדגשה והנטייה שבהן האזור ייכתב, כמו בציור */
function lookOf(s) {
  const f = st.fonts[s.box.font] || st.fonts[fontUse(st.slots).mainFont];
  return slotLook(s, f, slotStyle(s));
}

/**
 * צבע הרקע, צבע הטקסט והעובי של אזור. בטקסט שזוהה בקובץ (box.size) הם נמדדים פעם אחת, על הטקסט המקורי:
 * עובי הקו נמדד ביחס לגובה האזור, וכותרת שמותחים או מכווצים לא צריכה לאבד את ההדגשה או לקבל צבע אחר
 */
function slotStyle(s) {
  // אזור שהוזז: המראה נמדד במקום המקורי שלו בקובץ, ולא במקום החדש (שבו אין את הטקסט שלו)
  if (!s.box.size && !s.origin) return analyzeSlot(st.canvas, s.box);
  if (!s.style) s.style = analyzeSlot(st.canvas, s.origin ? s.origin.box : s.box);
  return s.style;
}

function buildTemplate(built = builtSlots()) {
  const slots = built.filter(s => (s.kind !== 'rule' && s.kind !== 'kiddush') || s.name);
  // רק הגופנים שבשימוש נשמרים – גם של השם שליד השעה, שנכתב מחדש כשמשנים את גודל האזור
  const { count, mainFont } = fontUse(slots);
  const used = new Set([...Object.keys(count), ...slots.map(s => s.labelBox && s.labelBox.font).filter(k => k && st.fonts[k])]);
  const fonts = Object.fromEntries([...used].map(k => [k, st.fonts[k]]));
  return { enabled: true, name: st.name, day: st.day, image: st.canvas.toDataURL('image/jpeg', 0.88),
    slots, candidates: st.candidates, fonts, mainFont };
}

/** המילים בתיבות השורות לפי הטקסט שבתצוגה, בלי לבנות מחדש את כל הרשימה */
function refreshWrapLines() {
  for (const el of $('tplSlots').querySelectorAll('.wrap-lines')) {
    const s = st.slots[+el.closest('.slot-ed').dataset.i];
    if (s) el.innerHTML = wrapLines(s);
  }
}

async function renderTemplatePreview() {
  const built = builtSlots(), tpl = buildTemplate(built);
  const cfg = { ...st.cfg, rules: mergeRules(st.cfg.rules, slotRules(), $('tplRules').checked, st.tpl.kind) };
  const today = todayIn(cfg.tz);
  // השבוע שנבחר בעורך הנוסח, או הלוח הקרוב
  const occ = st.week || periodFor(st.cfgAll, st.tpl, today) || findPeriod(st.tpl.kind, today, cfg.il);
  st.weekShown = occ;
  // בעורך רואים איך הקידוש ייראה גם בלי קידוש מאושר לתאריך – עם תורם לדוגמה. בלוח עצמו אין דוגמה
  const kd = { get: k => (kiddush && kiddush.get(k)) || { ...SAMPLE_KIDDUSH, ...(kiddush && kiddush.wording) } };
  const base = occ.mode === 'days' ? buildDaysLuach(cfg, occ, kd).values : buildLuach(cfg, occ, kd).values;
  const pages = base.multiDay ? dayPages(cfg, occ, kd) : [base];
  st.previewData = { values: base, pages };
  // הנוסח שנערך לשבוע הזה: מהעמוד הראשון שבו האזור נערך
  const once = weekEditsFor(weekKey()), edits = {};
  for (const key of Object.keys(once).sort()) {
    const k = key.replace(/^p\d+\|/, '');
    if (!(k in edits)) edits[k] = once[key];
  }
  const values = { ...base, edits };
  const canvas = await templateCanvas(tpl, values);
  // המקום של כל אזור בתמונה שנכתבה, לפי האזור שבעורך
  const at = canvas.layout;
  canvas.view = { ...at, slots: new Map(st.slots.map((s, i) => [s, at.slots.get(built[i])]).filter(e => e[1])) };
  const host = specialHost(tpl.slots);
  slotTexts = new WeakMap(st.slots.map((s, i) => [s, slotText(built[i], values, host) ?? '']));
  slotEdited = new WeakSet(st.slots.filter((s, i) => slotKey(built[i]) in edits));
  refreshWrapLines();
  $('tplPreviewTitle').textContent = 'תצוגה מקדימה – ' + occ.title;
  $('tplPreviewImg').src = canvas.toDataURL('image/png');
  return canvas;
}

$('tplPreview').onclick = async () => {
  await renderTemplatePreview();
  $('tplPreviewWrap').hidden = false;
  $('tplPreviewWrap').scrollIntoView({ behavior: 'smooth' });
};

/* שינוי גודל טקסט מצויר מיד על העמוד שבעורך (ובתצוגה המקדימה), בלי לחכות לשמירה */
let previewTimer, previewSeq = 0;
function schedulePreviewRefresh() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const seq = ++previewSeq, cur = st;
    const canvas = await renderTemplatePreview();
    if (seq !== previewSeq || cur !== st) return;
    $('tplImg').src = canvas.toDataURL('image/png');
    // המסגרות עוברות למקום שבו הטקסט נכתב בתמונה החדשה (לא באמצע גרירה – היא מצוירת בתוך המסגרות)
    st.view = canvas.view;
    if (!drag && !resize && !(move && move.s)) renderBoxes();
  }, 200);
}

$('tplSave').onclick = () => {
  const bad = st.slots.find(s => (s.kind === 'rule' || s.kind === 'kiddush') && !String(s.name).trim());
  if (bad) { focusSlot(st.slots.indexOf(bad)); SiteDialog.alert('יש אזור של תפילה בלי שם. כתבו שם או הסירו את האזור.'); return; }
  // הנוסח שנערך לשבועות מסוימים נשמר בשינויים של אותם לוחות
  if (st.weekEdits) {
    if (!st.cfgAll.edits) st.cfgAll.edits = {};
    for (const [key, e] of Object.entries(st.weekEdits)) {
      if (Object.keys(e).length) st.cfgAll.edits[key] = e; else delete st.cfgAll.edits[key];
    }
  }
  close({ tpl: st.tpl, template: buildTemplate(), rules: slotRules(), replace: $('tplRules').checked, detected: st.detected });
};
$('tplCancel').onclick = async () => {
  if (!await SiteDialog.confirm('לבטל את עיצוב התבנית? השינויים לא יישמרו.', { ok: 'ביטול העיצוב', cancel: 'המשך עריכה', danger: true })) return;
  close(null);
};
