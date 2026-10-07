/** הגדרות: ברירות מחדל, ערים, ושמירה מקומית בדפדפן. */

export const CITIES = [
  // [מזהה, שם, קו רוחב, קו אורך, דקות הדלקת נרות]
  ['jerusalem', 'ירושלים', 31.7690, 35.2163, 40], ['bneibrak', 'בני ברק', 32.0840, 34.8340, 22],
  ['telaviv', 'תל אביב', 32.0809, 34.7806, 22], ['petach', 'פתח תקווה', 32.0871, 34.8875, 22],
  ['haifa', 'חיפה', 32.8184, 34.9885, 30], ['beitshemesh', 'בית שמש', 31.7470, 34.9881, 30],
  ['modiin', 'מודיעין', 31.8969, 35.0095, 22], ['elad', 'אלעד', 32.0523, 34.9513, 22],
  ['ashdod', 'אשדוד', 31.7921, 34.6497, 22], ['ashkelon', 'אשקלון', 31.6688, 34.5743, 22],
  ['beersheva', 'באר שבע', 31.2518, 34.7913, 22], ['netanya', 'נתניה', 32.3215, 34.8532, 22],
  ['rehovot', 'רחובות', 31.8928, 34.8113, 22], ['rishon', 'ראשון לציון', 31.9730, 34.7925, 22],
  ['safed', 'צפת', 32.9646, 35.4960, 30], ['tiberias', 'טבריה', 32.7922, 35.5312, 22],
  ['eilat', 'אילת', 29.5581, 34.9482, 22]
];

/** זמן בסיס לכלל: תווית בטופס ← מפתח פנימי */
export const BASES = {
  'הדלקת נרות': 'candles', 'שקיעה': 'sunset', 'צאת הכוכבים': 'tzeit',
  'צאת שבת/חג': 'havdalah', 'עלות השחר': 'alotHaShachar', 'הנץ': 'sunrise',
  'סו"ז ק"ש מג"א': 'sofZmanShmaMGA', 'סו"ז ק"ש גר"א': 'sofZmanShma',
  'חצות': 'chatzot', 'מנחה גדולה': 'minchaGedola', 'מנחה קטנה': 'minchaKetana',
  'פלג המנחה': 'plagHaMincha', 'שעה קבועה': 'fixed',
  'קידוש (מלוח הקידושים)': 'kiddush',
  'אירועים (מיומן הקהילה)': 'events',
};
/** בסיסים שהערך שלהם הוא טקסט מהקהילה ולא שעה: אין להם הפרש ועיגול, ותפילה אחרת לא יכולה להיות תלויה בהם */
export const TEXT_BASES = ['kiddush', 'events'];
export const WHEN = ['כניסה', 'כל יום', 'יציאה'];
/** תוויות ברורות לבחירת "מתי", לתפריטי הבחירה */
export const WHEN_LABELS = [['כניסה', 'כניסה – ערב שבת/חג'], ['כל יום', 'כל יום – יום השבת/החג עצמו'], ['יציאה', 'יציאה – מוצאי שבת/חג']];
export const APPLIES = ['שבת וחג', 'שבת בלבד', 'חג בלבד'];
export const ROUND = ['ללא', 'למטה ל-5', 'למעלה ל-5', 'לקרוב ל-5'];

/**
 * גופנים ללוח שהאתר מעצב (לא לעיצוב מלוח קיים): [מזהה, שם, גופן הכותרת, גופן הטקסט].
 * כל גופן: [שם ב-Google Fonts, משקלים זמינים, גופן חלופי].
 */
const F = {
  frank: ['Frank Ruhl Libre', '400;700;900', 'serif'], assistant: ['Assistant', '400;600;700;800', 'sans-serif'],
  heebo: ['Heebo', '400;700;900', 'sans-serif'], rubik: ['Rubik', '400;700;900', 'sans-serif'],
  notoSerif: ['Noto Serif Hebrew', '400;700;900', 'serif'], notoSans: ['Noto Sans Hebrew', '400;700;900', 'sans-serif'],
  david: ['David Libre', '400;700', 'serif'], alef: ['Alef', '400;700', 'sans-serif'],
  varela: ['Varela Round', '400', 'sans-serif'], secular: ['Secular One', '400', 'sans-serif'],
  suez: ['Suez One', '400', 'serif'], bellefair: ['Bellefair', '400', 'serif']
};
export const FONTS = [
  ['classic', 'קלאסי – Frank Ruhl וטקסט Assistant', F.frank, F.assistant],
  ['assistant', 'Assistant', F.assistant, F.assistant],
  ['heebo', 'Heebo', F.heebo, F.heebo],
  ['rubik', 'Rubik', F.rubik, F.rubik],
  ['notoSans', 'Noto Sans Hebrew', F.notoSans, F.notoSans],
  ['frank', 'Frank Ruhl Libre', F.frank, F.frank],
  ['notoSerif', 'Noto Serif Hebrew', F.notoSerif, F.notoSerif],
  ['david', 'David Libre', F.david, F.david],
  ['alef', 'Alef', F.alef, F.alef],
  ['varela', 'Varela Round', F.varela, F.varela],
  ['secular', 'כותרת Secular One וטקסט Assistant', F.secular, F.assistant],
  ['suez', 'כותרת Suez One וטקסט Assistant', F.suez, F.assistant],
  ['bellefair', 'כותרת Bellefair וטקסט Heebo', F.bellefair, F.heebo]
];

/** { title, body } – ערכי font-family לגופן שנבחר */
export function fontFamilies(key) {
  const f = FONTS.find(x => x[0] === key) || FONTS[0];
  const css = ([name, , generic]) => '"' + name + '", ' + (generic === 'serif' ? 'Georgia, ' : 'Arial, ') + generic;
  return { title: css(f[2]), body: css(f[3]), names: [f[2][0], f[3][0]] };
}

/**
 * ערכות צבע מוכנות ללוח שהאתר מעצב (לא לעיצוב מלוח קיים): [מזהה, שם, צבעים].
 * ink – טקסט, blue – צבע הדגשה (פסים וקווים), line/soft/note – מסגרות ורקעים, muted – טקסט משני, paper – רקע הלוח.
 */
export const THEMES = [
  ['classic', 'כחול קלאסי', { ink: '#1d2b45', blue: '#2c4a7c', line: '#c9d5e6', soft: '#e3e9f2', muted: '#5d6b82', note: '#eef3fa', paper: '#ffffff' }],
  ['wine', 'בורדו', { ink: '#3a1f22', blue: '#7c2c3f', line: '#e6c9d0', soft: '#f2e3e8', muted: '#8a5d63', note: '#faeef1', paper: '#ffffff' }],
  ['olive', 'ירוק זית', { ink: '#20301f', blue: '#3f6b34', line: '#cbdcc5', soft: '#e4eee0', muted: '#5f6f57', note: '#eef4ea', paper: '#ffffff' }],
  ['gold', 'זהב חגיגי', { ink: '#332615', blue: '#a67c1e', line: '#e8d9b0', soft: '#f5edd8', muted: '#8a7550', note: '#faf3e0', paper: '#fffdf7' }],
  ['slate', 'אפור מינימלי', { ink: '#26282c', blue: '#54606e', line: '#d7dbe0', soft: '#eceef1', muted: '#767d87', note: '#f2f3f5', paper: '#ffffff' }],
  ['mono', 'שחור-לבן', { ink: '#111111', blue: '#111111', line: '#cccccc', soft: '#eeeeee', muted: '#555555', note: '#f4f4f4', paper: '#ffffff' }]
];

/** תבניות תצוגה ללוח שהאתר מעצב (לא לעיצוב מלוח קיים): [מזהה, שם, תיאור קצר] */
export const LAYOUTS = [
  ['classic', 'קלאסי', 'פסים בראש הלוח וכותרת במרכז'],
  ['banner', 'פס צבעוני', 'כותרת בתוך פס צבעוני, ושורות בצבעים מתחלפים'],
  ['framed', 'מסגרת מעוטרת', 'מסגרת כפולה סביב הלוח וקישוט מתחת לכותרת'],
  ['minimal', 'נקי ומודרני', 'כותרת בצד, בלי פסים וקישוטים'],
  // אלה מוצגות רק אחרי לחיצה על "הצג עוד תבניות" (LAYOUTS_SHOWN)
  ['cards', 'כרטיסים', 'כל קטע בכרטיס צבעוני משלו'],
  ['dark', 'כותרת כהה', 'כותרת רחבה בצבע כהה, וכותרות קטעים צבועות'],
  ['pills', 'שעות מודגשות', 'השעות בתוך תגיות צבעוניות, בלי קווים בין השורות'],
  ['outline', 'מסגרת מעוגלת', 'מסגרת עבה ומעוגלת, ושם כל קטע בתוך תגית']
];
/** כמה תבניות תצוגה מוצגות תמיד, לפני "הצג עוד תבניות" */
export const LAYOUTS_SHOWN = 4;

/** צבעי ערכת הצבעים שנבחרה */
export function themeColors(key) {
  const t = THEMES.find(x => x[0] === key) || THEMES[0];
  return t[2];
}

/** כתובת ה-CSS של Google Fonts לגופן שנבחר */
export function fontsHref(key) {
  const f = FONTS.find(x => x[0] === key) || FONTS[0];
  const fams = [...new Map([f[2], f[3]].map(x => [x[0], x])).values()];
  return 'https://fonts.googleapis.com/css2?' +
    fams.map(([name, w]) => 'family=' + name.replace(/ /g, '+') + ':wght@' + w).join('&') + '&display=swap';
}

/** ימים בלוח של ימות השבוע ובחול המועד ("חל על") */
export const DAY_APPLIES = ['כל הימים', 'חוץ מערב שבת וחג', 'ערב שבת וחג', 'א׳–ה׳', 'ב׳ וה׳',
  'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const DOW_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

/** האם כלל של ימי חול חל על היום. day: { dow, erev } – erev: מחר שבת או חג */
export function appliesOnDay(applies, day) {
  switch (applies) {
    case 'חוץ מערב שבת וחג': return !day.erev;
    case 'ערב שבת וחג': return !!day.erev;
    case 'א׳–ה׳': return day.dow <= 4;
    case 'ב׳ וה׳': return day.dow === 1 || day.dow === 4;
    default: { const i = DOW_NAMES.indexOf(applies); return i < 0 || i === day.dow; }
  }
}

/**
 * התבניות הקבועות. כל תבנית: זמני תפילות (rules) ועיצוב מלוח קיים (design).
 * kind: holy – לוח שבת/חג (ערב, יום, מוצאי); days – לוח של כמה ימי חול בטבלה.
 * תבנית שהמשתמש מוסיף חלה על המועדים שבחר (moadim) וגוברת על התבנית הקבועה.
 */
export const BUILTIN = [
  { id: 'shabbat', name: 'שבתות', kind: 'holy', about: 'שבת רגילה, וגם שבת חול המועד. שבת שחלה בחג או בחול המועד מוצגת בלשונית משותפת לשבתות ולחגים.' },
  { id: 'chag', name: 'חגים', kind: 'holy', about: 'ימים טובים, כולל חג שחל בשבת או שצמוד לה.' },
  { id: 'chol', name: 'חול המועד', kind: 'days', about: 'ימי החול של חול המועד סוכות ופסח, בלוח אחד.' },
  { id: 'week', name: 'ימות השבוע', kind: 'days', about: 'לוח שבועי מיום ראשון עד שישי.' }
];
export const isBuiltin = t => BUILTIN.some(b => b.id === t.id);

const HOLY_RULES = [
  { name: 'מנחה וקבלת שבת', when: 'כניסה', applies: 'שבת וחג', base: 'הדלקת נרות', offset: '15', round: 'ללא' },
  { name: 'שחרית', when: 'כל יום', applies: 'שבת וחג', base: 'שעה קבועה', offset: '08:00', round: 'ללא' },
  { name: 'מנחה', when: 'כל יום', applies: 'שבת וחג', base: 'שקיעה', offset: '-40', round: 'למטה ל-5' },
  { name: 'ערבית', when: 'יציאה', applies: 'שבת וחג', base: 'צאת שבת/חג', offset: '0', round: 'ללא' }
];
const dayRule = (name, applies, base, offset, round = 'ללא') => ({ name, when: 'כל יום', applies, base, offset, round });
const DEFAULT_RULES = {
  shabbat: HOLY_RULES,
  chag: HOLY_RULES,
  chol: [dayRule('שחרית', 'כל הימים', 'שעה קבועה', '07:30'), dayRule('מנחה', 'חוץ מערב שבת וחג', 'שקיעה', '-15', 'למטה ל-5'),
    dayRule('ערבית', 'חוץ מערב שבת וחג', 'צאת הכוכבים', '0')],
  week: [dayRule('שחרית', 'כל הימים', 'שעה קבועה', '06:30'), dayRule('מנחה', 'חוץ מערב שבת וחג', 'שקיעה', '-15', 'למטה ל-5'),
    dayRule('ערבית', 'חוץ מערב שבת וחג', 'צאת הכוכבים', '0')]
};

/**
 * גדלי הטקסט בלוח שהאתר מעצב, באחוזים מהגודל הרגיל: [מפתח, שם].
 * לא משפיעים על עיצוב מלוח קיים, שבו הגודל נלקח מהקובץ.
 */
export const SIZE_PARTS = [['title', 'כותרת'], ['name', 'שמות התפילות'], ['time', 'שעות התפילות'], ['zman', 'זמני היום']];
export const SIZES = [70, 80, 90, 100, 110, 120, 130, 140, 150, 160];
export const DEFAULT_SIZES = { title: 100, name: 100, time: 100, zman: 100 };

/** גודל הדף בהדפסה וב-PDF: [מפתח, רוחב, גובה] במ"מ, לאורך */
export const PAPERS = [['A4', 210, 297], ['A3', 297, 420]];
export const ORIENTS = [['portrait', 'לאורך'], ['landscape', 'לרוחב']];
/** מספר העמודות שהקטעים של לוח שבת/חג מחולקים ביניהן (splitColumns ב-render.js) */
export const COLUMNS = [1, 2, 3];

/**
 * הדף של התבנית t: size – הערך ל-@page, w ו-h – המידות במ"מ לפי הכיוון,
 * k – היחס לרוחב של A4 (בדף גדול יותר הלוח מודפס מוגדל באותו יחס)
 */
export function pageOf(t) {
  const [size, a, b] = PAPERS.find(p => p[0] === t.paper) || PAPERS[0], landscape = t.orient === 'landscape';
  return { size: size + (landscape ? ' landscape' : ''), landscape, w: landscape ? b : a, h: landscape ? a : b, k: a / PAPERS[0][1] };
}

const clone = o => JSON.parse(JSON.stringify(o));
// הגופן והגדלים נקבעים ב-normalize: הגופן הכללי מגרסה קודמת, או classic
const builtinTemplate = b => ({ id: b.id, name: b.name, kind: b.kind, rules: clone(DEFAULT_RULES[b.id]), design: null });

export const DEFAULT_CONFIG = {
  version: 3,
  shul: '', address: '', city: 'jerusalem', lat: 31.769, lng: 35.2163, tz: 'Asia/Jerusalem', il: true,
  candle: 40, havdalah: '8.5',
  templates: BUILTIN.map(builtinTemplate),
  merged: {},
  edits: {}
};

/** תבנית חדשה של המשתמש. rules – זמני התפילות להתחלה */
export function newTemplate(name, kind, rules) {
  return { id: 'u' + Date.now().toString(36), name, kind, moadim: [], rules: clone(rules || []), design: null,
    font: 'classic', theme: 'classic', layout: 'classic', sizes: { ...DEFAULT_SIZES }, paper: 'A4', orient: 'portrait', cols: 1 };
}

/** העיצוב של התבנית. { ref } – העיצוב של תבנית אחרת (למשל חגים שמשתמשים בעיצוב של שבתות) */
export function designOf(cfg, t) {
  const d = t && t.design;
  if (d && d.ref) { const o = cfg.templates.find(x => x.id === d.ref); return o && o.design && !o.design.ref ? o.design : null; }
  return d || null;
}

const KEY = 'zmanim.config';

/** רק השדות שהם טקסט (טקסטים ששונו על הלוח: מפתח ← טקסט) */
function strings(o) {
  const out = {};
  if (o && typeof o === 'object') for (const k in o) if (typeof o[k] === 'string') out[k] = o[k];
  return out;
}

/** משלים שדות חסרים (הגדרות ישנות או קובץ מיובא) */
export function normalize(c) {
  const cfg = Object.assign(clone(DEFAULT_CONFIG), c || {});
  if (c && !Array.isArray(c.templates)) migrate(cfg, c);
  delete cfg.rules; delete cfg.template;
  cfg.templates = cfg.templates.filter(t => t && typeof t === 'object' && t.id);
  BUILTIN.forEach((b, i) => {
    const t = cfg.templates.find(x => x.id === b.id);
    if (!t) cfg.templates.splice(i, 0, builtinTemplate(b));
    else t.kind = b.kind;
  });
  for (const t of cfg.templates) {
    if (!Array.isArray(t.rules)) t.rules = [];
    if (t.kind !== 'days') t.kind = 'holy';
    t.name = String(t.name || '').trim() || 'תבנית';
    if (!isBuiltin(t) && !Array.isArray(t.moadim)) t.moadim = [];
    if (t.design === undefined) t.design = null;
    // טקסט שהגבאי שינה על הלוח כשינוי קבוע, בכל הלוחות של התבנית: מפתח ← טקסט
    t.edits = strings(t.edits);
    // עד גרסה 2 הגופן היה אחד לכל הלוחות (cfg.font), ועכשיו הוא עובר לכל תבנית
    if (!FONTS.some(f => f[0] === t.font)) t.font = FONTS.some(f => f[0] === cfg.font) ? cfg.font : 'classic';
    if (!THEMES.some(x => x[0] === t.theme)) t.theme = 'classic';
    if (!LAYOUTS.some(x => x[0] === t.layout)) t.layout = 'classic';
    if (!PAPERS.some(x => x[0] === t.paper)) t.paper = 'A4';
    if (!ORIENTS.some(x => x[0] === t.orient)) t.orient = 'portrait';
    if (COLUMNS.indexOf(t.cols) < 0) t.cols = 1;
    const sizes = t.sizes && typeof t.sizes === 'object' ? t.sizes : {};
    t.sizes = {};
    for (const [k] of SIZE_PARTS) t.sizes[k] = SIZES.indexOf(Number(sizes[k])) >= 0 ? Number(sizes[k]) : 100;
  }
  delete cfg.font;
  // חג שצמוד לשבת שהגבאי בחר להציג בלוח אחד: היום הראשון של האירוע ← true
  const merged = cfg.merged && typeof cfg.merged === 'object' ? cfg.merged : {};
  cfg.merged = {};
  for (const k in merged) if (merged[k] && /^\d+$/.test(k)) cfg.merged[k] = true;
  // טקסט שהגבאי שינה על לוח מסוים בלבד: "תבנית:היום הראשון" ← { מפתח ← טקסט }
  const edits = cfg.edits && typeof cfg.edits === 'object' ? cfg.edits : {};
  cfg.edits = {};
  for (const k in edits) {
    const out = strings(edits[k]);
    if (/^.+:\d+$/.test(k) && Object.keys(out).length) cfg.edits[k] = out;
  }
  cfg.version = DEFAULT_CONFIG.version;
  cfg.lat = Number(cfg.lat); cfg.lng = Number(cfg.lng);
  cfg.candle = Number(cfg.candle) || 0;
  cfg.havdalah = String(cfg.havdalah || '8.5');
  cfg.il = cfg.il !== false;
  return cfg;
}

/**
 * הגדרות מגרסה 1 (רשימת תפילות אחת ועיצוב אחד): התפילות עוברות לתבניות שבתות וחגים
 * כך שהלוחות נשארים כמו שהיו, והעיצוב עובר לשבתות ומשמש גם לחגים.
 */
function migrate(cfg, old) {
  const rules = Array.isArray(old.rules) ? old.rules : HOLY_RULES;
  cfg.templates = BUILTIN.map(builtinTemplate);
  const [shabbat, chag] = cfg.templates;
  shabbat.rules = clone(rules.filter(r => r && r.applies !== 'חג בלבד'));
  chag.rules = clone(rules);
  if (old.template) { shabbat.design = old.template; chag.design = { ref: 'shabbat', enabled: old.template.enabled !== false }; }
}

/** העיצוב של התבנית אם הוא מופעל ("להשתמש בעיצוב מהקובץ"), אחרת null */
export function activeDesign(cfg, t) {
  const d = designOf(cfg, t);
  if (!d) return null;
  return (t.design.ref ? t.design.enabled !== false : d.enabled) ? d : null;
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { cfg: normalize(JSON.parse(raw)), saved: true };
  } catch (e) { /* אין גישה לאחסון, או נתונים פגומים */ }
  return { cfg: normalize(null), saved: false };
}

export function saveConfig(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; }
  catch (e) { return false; }
}

export function clearConfig() {
  try { localStorage.removeItem(KEY); } catch (e) { /* אין גישה לאחסון */ }
}

/** שמות תפילות שאפשר לגזור מהן שעה (לבסיס "לפי"), בלי השם של הכלל עצמו */
export function prayerBases(rules, self) {
  const own = String(self && self.name || '').trim(), out = [];
  for (const r of rules || []) {
    const n = String(r && r.name || '').trim();
    if (n && n !== own && !(n in BASES) && !TEXT_BASES.includes(BASES[r.base]) && out.indexOf(n) < 0) out.push(n);
  }
  return out;
}
