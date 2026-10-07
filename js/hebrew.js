/**
 * לוח עברי: המרת תאריכים, חגים ופרשות השבוע.
 * חודשים ממוספרים 1=ניסן ... 7=תשרי ... 12=אדר (אדר א׳ בשנה מעוברת), 13=אדר ב׳.
 * ימים מיוצגים כ-dayNum (ימים מאז 1970-01-01).
 */

import { dow } from './dates.js';

const EPOCH = -2092590; // 1 בתשרי שנה 1, כ-dayNum

export const NISAN = 1, IYYAR = 2, SIVAN = 3, TAMUZ = 4, AV = 5, ELUL = 6,
  TISHREI = 7, CHESHVAN = 8, KISLEV = 9, TEVET = 10, SHVAT = 11, ADAR = 12, ADAR2 = 13;

export const isLeap = y => (7 * y + 1) % 19 < 7;
const monthsInYear = y => isLeap(y) ? 13 : 12;

function elapsedDays(y) {
  const months = Math.floor((235 * y - 234) / 19);
  const parts = 12084 + 13753 * months;
  const day = months * 29 + Math.floor(parts / 25920);
  return (3 * (day + 1)) % 7 < 3 ? day + 1 : day;
}

const nyCache = {};
function newYear(y) {
  if (nyCache[y] != null) return nyCache[y];
  const ny0 = elapsedDays(y - 1), ny1 = elapsedDays(y), ny2 = elapsedDays(y + 1);
  const corr = ny2 - ny1 === 356 ? 2 : ny1 - ny0 === 382 ? 1 : 0;
  return (nyCache[y] = EPOCH + ny1 + corr);
}

const yearLength = y => newYear(y + 1) - newYear(y);

export function monthLength(y, m) {
  if (m === IYYAR || m === TAMUZ || m === ELUL || m === TEVET || m === ADAR2) return 29;
  if (m === ADAR) return isLeap(y) ? 30 : 29;
  if (m === CHESHVAN) return yearLength(y) % 10 === 5 ? 30 : 29;
  if (m === KISLEV) return yearLength(y) % 10 === 3 ? 29 : 30;
  return 30;
}

/** תאריך עברי ← dayNum */
export function fromHebrew(y, m, d) {
  let day = newYear(y) + d - 1;
  if (m < TISHREI) {
    for (let i = TISHREI; i <= monthsInYear(y); i++) day += monthLength(y, i);
    for (let i = NISAN; i < m; i++) day += monthLength(y, i);
  } else {
    for (let i = TISHREI; i < m; i++) day += monthLength(y, i);
  }
  return day;
}

/** dayNum ← {y, m, d} */
export function toHebrew(dayNum) {
  let y = Math.floor((dayNum - EPOCH) / 365.2468) + 1;
  while (newYear(y) > dayNum) y--;
  while (newYear(y + 1) <= dayNum) y++;
  let m = dayNum < fromHebrew(y, NISAN, 1) ? TISHREI : NISAN;
  while (dayNum > fromHebrew(y, m, monthLength(y, m))) m++;
  return { y, m, d: dayNum - fromHebrew(y, m, 1) + 1 };
}

/* ---------- כתיב עברי ---------- */

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

export function gematria(n) {
  let s = '';
  n %= 1000;
  while (n >= 400) { s += 'ת'; n -= 400; }
  if (n >= 100) { s += HUNDREDS[Math.floor(n / 100)]; n %= 100; }
  if (n === 15) s += 'טו';
  else if (n === 16) s += 'טז';
  else s += TENS[Math.floor(n / 10)] + ONES[n % 10];
  return s.length === 1 ? s + '׳' : s.slice(0, -1) + '״' + s.slice(-1);
}

export function monthName(y, m) {
  if (m === ADAR) return isLeap(y) ? 'אדר א׳' : 'אדר';
  return ['', 'ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול', 'תשרי', 'חשון', 'כסלו', 'טבת', 'שבט', '', 'אדר ב׳'][m];
}

/** "כ״ה תשרי תשפ״ז" */
export function hebDateString(dayNum) {
  const h = toHebrew(dayNum);
  return gematria(h.d) + ' ' + monthName(h.y, h.m) + ' ' + gematria(h.y);
}

/* ---------- חגים ---------- */

/** שם יום טוב, או null. il=true לארץ ישראל */
export function yomTov(dayNum, il) {
  const { m, d } = toHebrew(dayNum);
  if (m === TISHREI) {
    if (d === 1 || d === 2) return 'ראש השנה';
    if (d === 10) return 'יום כיפור';
    if (d === 15 || (d === 16 && !il)) return 'סוכות';
    if (d === 22) return il ? 'שמיני עצרת ושמחת תורה' : 'שמיני עצרת';
    if (d === 23 && !il) return 'שמחת תורה';
  } else if (m === NISAN) {
    if (d === 15 || (d === 16 && !il)) return 'פסח';
    if (d === 21) return 'שביעי של פסח';
    if (d === 22 && !il) return 'אחרון של פסח';
  } else if (m === SIVAN) {
    if (d === 6 || (d === 7 && !il)) return 'שבועות';
  }
  return null;
}

/** 'סוכות' / 'פסח' אם היום הוא חול המועד, אחרת null */
export function cholHamoed(dayNum, il) {
  const { m, d } = toHebrew(dayNum);
  const first = il ? 16 : 17;
  if (m === TISHREI && d >= first && d <= 21) return 'סוכות';
  if (m === NISAN && d >= first && d <= 20) return 'פסח';
  return null;
}

/* ---------- פרשת השבוע ---------- */

export const PARSHIYOT = [
  'בראשית', 'נח', 'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי',
  'שמות', 'וארא', 'בא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא', 'ויקהל', 'פקודי',
  'ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'קדושים', 'אמור', 'בהר', 'בחוקותי',
  'במדבר', 'נשא', 'בהעלותך', 'שלח', 'קרח', 'חוקת', 'בלק', 'פינחס', 'מטות', 'מסעי',
  'דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים', 'כי תצא', 'כי תבוא', 'נצבים', 'וילך', 'האזינו'
];
// פרשות שיכולות להתחבר (האינדקס של הראשונה בזוג)
const VAYAKHEL = 21, TAZRIA = 26, ACHAREI = 28, BEHAR = 31, CHUKAT = 38, MATOT = 41, NITZAVIM = 50;

/**
 * לוח הפרשות של מחזור הקריאה שמתחיל בשמחת תורה של שנה y.
 * מחזיר Map מ-dayNum של שבת למערך אינדקסים ב-PARSHIYOT (שניים = פרשות מחוברות).
 *
 * השיטה: השבתות הפנויות (לא יום טוב ולא חול המועד) מתחלקות לקטעים לפי
 * הכללים בשו"ע או"ח תכח: צו (בשנה מעוברת מצורע) לפני פסח, במדבר לפני שבועות,
 * דברים לפני תשעה באב, נצבים לפני ראש השנה. בכל קטע מחברים זוגות לפי סדר עדיפות
 * כמה שצריך. אם יש יותר שבתות מפרשות (בארץ, כשיום טוב שני של גלויות חל בשבת),
 * ממשיכים לקרוא קדימה והקטע הבא מתחבר פחות.
 */
function buildSchedule(y, il) {
  const start = fromHebrew(y, TISHREI, il ? 22 : 23) + 1;
  const end = fromHebrew(y + 1, TISHREI, 15);
  const slots = [];
  for (let d = start + (6 - dow(start)); d < end; d += 7) {
    if (!yomTov(d, il) && !cholHamoed(d, il)) slots.push(d);
  }
  const leap = isLeap(y);
  const rh = fromHebrew(y + 1, TISHREI, 1);
  const tishreiSlots = slots.filter(d => d >= rh).length;
  const segments = [
    { end: fromHebrew(y, NISAN, 15), last: leap ? 27 : 24, pairs: leap ? [VAYAKHEL, TAZRIA] : [VAYAKHEL] },
    { end: fromHebrew(y, SIVAN, 6), last: 33, pairs: [TAZRIA, ACHAREI, BEHAR] },
    { end: fromHebrew(y, AV, 9) + 1, last: 43, pairs: [MATOT, CHUKAT] },
    { end: rh, last: tishreiSlots > 1 ? 50 : 51, pairs: [NITZAVIM] },
    { end: end, last: 52, pairs: [] }
  ];

  const map = new Map();
  let p = 0, i = 0;
  for (const seg of segments) {
    const segSlots = [];
    while (i < slots.length && slots[i] < seg.end) segSlots.push(slots[i++]);
    const need = seg.last - p + 1 - segSlots.length;
    const join = new Set(seg.pairs.filter(x => x >= p && x + 1 <= seg.last).slice(0, Math.max(0, need)));
    for (const d of segSlots) {
      if (p >= PARSHIYOT.length) break;
      if (join.has(p)) { map.set(d, [p, p + 1]); p += 2; } else { map.set(d, [p]); p += 1; }
    }
  }
  return map;
}

const schedCache = {};
function schedule(y, il) {
  const k = y + (il ? 'i' : 'd');
  return schedCache[k] || (schedCache[k] = buildSchedule(y, il));
}

/** שם הפרשה לשבת dayNum ("נח", "תזריע-מצורע"), או null אם אין (חג) */
export function parasha(dayNum, il) {
  const { y } = toHebrew(dayNum);
  for (const yy of [y, y - 1]) {
    const hit = schedule(yy, il).get(dayNum);
    if (hit) return hit.map(n => PARSHIYOT[n]).join('-');
  }
  return null;
}

/** לבדיקות: מערך האינדקסים של הפרשה */
export function parashaIndices(dayNum, il) {
  const { y } = toHebrew(dayNum);
  for (const yy of [y, y - 1]) {
    const hit = schedule(yy, il).get(dayNum);
    if (hit) return hit;
  }
  return null;
}
