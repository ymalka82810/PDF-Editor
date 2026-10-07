/** עזרי תאריך. יום = מספר ימים מאז 1970-01-01 (dayNum). */

export const DAY_MS = 86400000;

export function toDayNum(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function toYmd(dayNum) {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = ראשון ... 6 = שבת */
export function dow(dayNum) {
  return ((dayNum + 4) % 7 + 7) % 7;
}

/** התאריך של היום באזור הזמן הנתון */
export function todayIn(tz, now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return toDayNum(p);
}

const hmCache = {};
/** שעה:דקה באזור הזמן הנתון */
export function hm(ms, tz) {
  if (ms == null) return '—';
  const f = hmCache[tz] || (hmCache[tz] = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }));
  return f.format(new Date(ms));
}

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** "יום שישי, 16 באוקטובר" או עם שנה: "16 באוקטובר 2026" */
export function gDate(dayNum, withYear) {
  const x = new Date(dayNum * DAY_MS);
  const base = x.getUTCDate() + ' ב' + MONTHS[x.getUTCMonth()];
  return withYear ? base + ' ' + x.getUTCFullYear() : 'יום ' + DAYS[x.getUTCDay()] + ', ' + base;
}
