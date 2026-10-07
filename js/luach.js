/**
 * בניית לוח לשבת/חג: מציאת האירוע, חישוב הכללים, ומבנה נתונים לתצוגה.
 */

import { dow, hm, gDate, toYmd, toDayNum } from './dates.js';
import { yomTov, cholHamoed, parasha, hebDateString, toHebrew, fromHebrew, gematria, monthName, TISHREI } from './hebrew.js';
import { zmanim, roundZman } from './zmanim.js';
import { BASES, DAY_APPLIES, appliesOnDay, isBuiltin } from './config.js';
import { isMoed, specialDay, specialShabbat } from './moadim.js';

const MIN = 60000;

const isHoly = (d, il) => dow(d) === 6 || !!yomTov(d, il);

/**
 * השבת/החג הקרוב מהיום from והלאה (dir=1), או הקודם לפניו (dir=-1).
 * אם from נופל בתוך שבת/חג, מוחזר האירוע כולו מהיום הראשון שלו.
 */
export function findOccasion(from, il, dir = 1) {
  let d = from;
  for (let n = 0; n < 400 && !isHoly(d, il); n++) d += dir;
  if (!isHoly(d, il)) return null;
  let first = d, last = d;
  while (isHoly(first - 1, il)) first--;
  while (isHoly(last + 1, il)) last++;

  const days = [];
  for (let x = first; x <= last; x++) {
    const shabbat = dow(x) === 6;
    days.push({ day: x, shabbat, chag: yomTov(x, il), chol: shabbat ? cholHamoed(x, il) : null, parasha: shabbat ? parasha(x, il) : null,
      special: specialShabbat(x, il) });
  }

  return { mode: 'holy', id: first, erev: first - 1, first, last, days, title: holyTitle(days) };
}

/**
 * "שבת שמיני עצרת ושמחת תורה", "סוכות ושבת חול המועד", "שבת חול המועד פסח", "שבועות ושבת פרשת נשא", "שבת פרשת נח".
 * שבת שחלה בחג לא נבלעת בו: שם החג בא אחרי "שבת".
 */
function holyTitle(days) {
  const names = [], seen = new Set();
  const chag = days.some(x => x.chag);
  days.forEach(x => {
    if (x.chag) {
      // יום שני של חג שחל בשבת: "שבועות ושבת"
      if (seen.has(x.chag)) { if (x.shabbat) names.push('שבת'); return; }
      seen.add(x.chag);
      names.push((x.shabbat ? 'שבת ' : '') + x.chag);
    } else if (x.shabbat) {
      // בשבת חול המועד שצמודה לחג, שם החג כבר מופיע בכותרת
      names.push(x.chol ? 'שבת חול המועד' + (chag ? '' : ' ' + x.chol) : x.parasha ? 'שבת פרשת ' + x.parasha : 'שבת');
    }
  });
  return names.join(' ו');
}

/* ---------- ימות השבוע וחול המועד ---------- */

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const dm = d => { const [, m, x] = toYmd(d).split('-'); return +x + '.' + +m; };

/** הלוח של ימי החול שהיום d (לא שבת ולא חג) שייך אליו: כל חול המועד, או ימי החול של אותו שבוע */
function daysPeriodAt(d, il) {
  let list, kind, title;
  const chol = cholHamoed(d, il);
  if (chol) {
    const { y, m } = toHebrew(d);
    const from = fromHebrew(y, m, il ? 16 : 17), to = fromHebrew(y, m, m === TISHREI ? 21 : 20);
    list = [];
    for (let x = from; x <= to; x++) if (!isHoly(x, il)) list.push(x);
    kind = 'chol'; title = 'חול המועד ' + chol;
  } else {
    const sun = d - dow(d);
    list = [];
    for (let x = sun; x <= sun + 5; x++) if (!isHoly(x, il) && !cholHamoed(x, il)) list.push(x);
    const p = parasha(sun + 6, il);
    kind = 'week'; title = p ? 'שבוע פרשת ' + p : 'ימות השבוע';
  }
  const days = list.map((x, i) => ({ day: x, dow: dow(x), erev: isHoly(x + 1, il), key: 'd' + (kind === 'week' ? dow(x) : i),
    name: DAY_NAMES[dow(x)], date: dm(x), special: specialDay(x) }));
  const first = list[0], last = list[list.length - 1];
  return { mode: 'days', kind, id: first, first, last, days, title };
}

/** לוח ימי החול שמכיל את from, או הקרוב אחריו (dir=1) או לפניו (dir=-1) */
function findDays(from, il, dir = 1) {
  let d = from;
  for (let n = 0; n < 30 && isHoly(d, il); n++) d += dir;
  return isHoly(d, il) ? null : daysPeriodAt(d, il);
}

/** הלוח שמכיל את היום from או הקרוב אליו. mode: holy – שבתות וחגים, days – ימות השבוע */
export function findPeriod(mode, from, il, dir = 1) {
  return mode === 'days' ? findDays(from, il, dir) : findOccasion(from, il, dir);
}

/* ---------- חג שצמוד לשבת: לוח משולב או לוחות נפרדים ---------- */

/**
 * אירוע שיש בו גם חג וגם שבת עם פרשה (בימים צמודים), ולכן אפשר להציג אותו בלוח אחד או בשניים.
 * שבת בלי פרשה (שחלה בחג או בחול המועד) היא חלק מהחג, ומוצגת תמיד בלוח אחד איתו.
 */
export const isMixed = occ => occ.mode === 'holy' && occ.days.some(d => d.chag) && occ.days.some(d => d.shabbat && d.parasha);

/** חלק מאירוע: ימי החג בלבד או ימי השבת בלבד. הערב שלו הוא היום שלפניו, גם כשהוא שייך לחלק השני */
function partOf(days, occ, title) {
  const first = days[0].day;
  return { mode: 'holy', id: first, erev: first - 1, first, last: days[days.length - 1].day, days,
    title, mixed: true, occId: occ.id };
}

/**
 * הלוחות של האירוע. חג שצמוד לשבת עם פרשה מוצג בברירת מחדל בשני לוחות נפרדים –
 * אחד לחג ואחד לשבת – אלא אם הגבאי בחר לשלב אותם ללוח אחד (merged[id] של האירוע, לשבת הזאת בלבד).
 */
export function occasionParts(occ, merged) {
  const mixed = isMixed(occ);
  if (!mixed || (merged && merged[occ.id])) return [{ ...occ, mixed, occId: occ.id }];
  const chag = occ.days.filter(d => d.chag);
  const shabbat = occ.days.filter(d => d.shabbat);
  // לשבת יש לוח משלה, ולכן הכותרת של לוח החג היא שם החג בלבד ("סוכות", ולא "סוכות ושבת")
  return [[chag, holyTitle(chag.map(d => ({ ...d, shabbat: false })))], [shabbat, holyTitle(shabbat)]]
    .sort((a, b) => a[0][0].day - b[0][0].day).map(([days, title]) => partOf(days, occ, title));
}

/** הלוחות מהיום from והלאה (dir=1) או לפניו (dir=-1), לפי הסדר */
function* periods(cfg, kind, from, dir) {
  let d = from;
  for (let n = 0; n < 120; n++) {
    if (kind === 'days') {
      const p = findDays(d, cfg.il, dir);
      if (!p) return;
      yield p;
      d = dir > 0 ? p.last + 1 : p.first - 1;
    } else {
      const occ = findOccasion(d, cfg.il, dir);
      if (!occ) return;
      const list = occasionParts(occ, cfg.merged);
      for (const p of dir > 0 ? list : [...list].reverse()) yield p;
      d = dir > 0 ? occ.last + 1 : occ.first - 1;
    }
  }
}

/**
 * הלוח הקרוב שמוצג בתבנית t: מהיום from והלאה (dir=1) או לפניו (dir=-1).
 * strict – רק לוח שמתחיל אחרי from (או מסתיים לפניו), למעבר ללוח הבא או הקודם.
 */
export function periodFor(cfg, t, from, dir = 1, strict = false) {
  for (const p of periods(cfg, t.kind, from, dir)) {
    if (strict && (dir > 0 ? p.first < from : p.last > from)) continue;
    if (templateFor(cfg, p) === t || (joinedTemplates(cfg, p) || []).includes(t)) return p;
  }
  return null;
}

/**
 * התבניות שהלוח p שייך לכולן, ומוצגות לכן כלשונית אחת ("שבתות וחגים"): שבת שחלה בחג או בחול המועד
 * (בלי פרשה) היא גם שבת וגם חג, וכך גם חג ושבת עם פרשה שהגבאי שילב ללוח אחד. הלוח נבנה בתבנית הראשונה.
 * בכל לוח אחר – null.
 */
export function joinedTemplates(cfg, p) {
  if (!p || p.mode !== 'holy') return null;
  const own = templateFor(cfg, p);
  let list;
  if (p.mixed) {
    if (!(cfg.merged || {})[p.occId]) return null;
    list = [own, ...occasionParts(findOccasion(p.occId, cfg.il), {}).map(x => templateFor(cfg, x))];
  } else {
    if (!p.days.some(d => d.shabbat) || !p.days.some(d => d.chag || d.chol)) return null;
    list = [own, cfg.templates.find(t => t.id === (own.id === 'shabbat' ? 'chag' : 'shabbat'))];
  }
  list = [...new Set(list.filter(Boolean))];
  return list.length > 1 ? list : null;
}

/* ---------- בחירת התבנית ---------- */

/**
 * התבנית של הלוח: תבנית של המשתמש שאחד המועדים שלה חל בלוח, ואם אין – התבנית הקבועה
 * (חגים / שבתות / חול המועד / ימות השבוע).
 */
export function templateFor(cfg, p) {
  const days = p.days.map(x => x.day);
  const own = cfg.templates.find(t => !isBuiltin(t) && t.kind === p.mode &&
    (t.moadim || []).some(id => days.some(d => isMoed(id, d, cfg.il))));
  if (own) return own;
  const id = p.mode === 'days' ? p.kind : p.days.some(x => x.chag) ? 'chag' : 'shabbat';
  return cfg.templates.find(t => t.id === id);
}

/* ---------- זמנים ---------- */

function dayTimes(cfg, d) {
  const z = zmanim(d, cfg.lat, cfg.lng);
  const out = {};
  for (const k in z) out[k] = roundZman(k, z[k]);
  const hav = String(cfg.havdalah) === '8.5' ? z.tzeit
    : (z.sunset == null ? null : z.sunset + Number(cfg.havdalah) * MIN);
  out.havdalah = roundZman('havdalah', hav);
  return out;
}

/** הדלקת נרות ביום d לקראת היום הבא: לפני השקיעה, או ביציאת יום קדוש לחג שאחריו */
function candlesOn(cfg, d, t, il) {
  if (!isHoly(d + 1, il)) return null;
  if (isHoly(d, il) && dow(d + 1) !== 6) return t.havdalah;
  return t.sunset == null ? null : t.sunset - cfg.candle * MIN;
}

/**
 * שעת כלל. הבסיס הוא זמן היום, שעה קבועה, או שם של תפילה אחרת (ואז השעה נגזרת ממנה).
 * ctx: { cfg, when, day, t }. seen – הגנה מפני תלות מעגלית.
 */
function ruleTime(rule, ctx, seen = new Set()) {
  const { cfg, t } = ctx;
  const offset = String(rule.offset || '').trim();
  const base = BASES[rule.base];
  if (base === 'fixed') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(offset);
    if (!m) return null;
    return { text: ('0' + m[1]).slice(-2) + ':' + m[2], key: +m[1] * 60 + +m[2] };
  }
  if (base === 'kiddush') return kiddushRow(rule, ctx);
  if (base === 'events') return eventsRow(rule, ctx);
  if (!base && String(rule.base || '').trim()) {
    const p = parentTime(rule, ctx, seen);
    if (!p) return null;
    if (p.ms != null) return fromMs(applyOffset(p.ms, offset, rule.round), cfg.tz);
    // תפילה בשעה קבועה: חישוב בדקות מתחילת היום
    const x = Math.round(applyOffset(p.key * MIN, offset, rule.round) / MIN), key = (x % 1440 + 1440) % 1440;
    return { text: ('0' + Math.floor(key / 60)).slice(-2) + ':' + ('0' + key % 60).slice(-2), key };
  }
  const k = base || 'sunset';
  const b = k === 'candles' ? (t.candles ?? (t.sunset == null ? null : t.sunset - cfg.candle * MIN)) : t[k];
  if (b == null) return null;
  return fromMs(applyOffset(b, offset, rule.round), cfg.tz);
}

/**
 * ערך "קידוש": הטקסט של הכלל הזה לא זמן, אלא ההודעה בנוסח שהגבאי קבע בלוח הקידושים –
 * השורה הראשונה, "ע״י", בעל הקידוש והסיבה – לפי מי שאושר לקידוש בתאריך של היום הזה.
 * השורות כמו בלוח הקידושים, עם ירידת שורה ביניהן: הכותרת / "ע״י" ובעל הקידוש / הסיבה.
 * אין אישור קידוש לתאריך – אין ערך.
 */
function kiddushRow(rule, ctx) {
  const info = ctx.kiddush && ctx.kiddush.get(toYmd(ctx.day.day));
  if (!info) return null;
  const line = (...parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  // שורת הסיבה כבר כוללת את הסוג: "לרגל בר המצווה", "לעילוי נשמת … ז״ל"
  const text = [line(info.heading), line(info.by, info.sponsorName), line(info.occasion)].filter(Boolean).join('\n');
  return { text, key: 9998 };
}

/**
 * ערך "אירועים": האירועים מיומן הקהילה שהגבאי בחר להציג כשורה בלוח, בתאריך של הקטע –
 * ב"כניסה" היום שלפני השבת/החג, ובשאר הקטעים היום עצמו. ctx.kiddush.events: dateKey ← [{ title, details }].
 * אין אירוע – אין ערך, והשורה לא מופיעה.
 */
function eventsRow(rule, ctx) {
  const d = ctx.day.day - (ctx.when === 'כניסה' ? 1 : 0);
  const list = ctx.kiddush && ctx.kiddush.events && ctx.kiddush.events.get(toYmd(d));
  if (!list || !list.length) return null;
  return { text: list.map(e => e.details ? e.title + ' – ' + e.details : e.title).join(' · '), key: 9997 };
}

function fromMs(ms, tz) {
  const text = hm(ms, tz), p = text.split(':');
  return { text, key: +p[0] * 60 + +p[1], ms };
}

/** שעת התפילה שהכלל תלוי בה: עדיפות לתפילה באותו קטע (מתי) שחלה באותו יום */
function parentTime(rule, ctx, seen) {
  if (seen.has(rule)) return null;
  seen.add(rule);
  const name = String(rule.base).trim();
  const list = (ctx.cfg.rules || []).filter(r => r && r !== rule && String(r.name || '').trim() === name);
  const parent = list.find(r => r.when === ctx.when && applies(r, ctx.day)) || list.find(r => r.when === ctx.when) || list[0];
  return parent ? ruleTime(parent, ctx, seen) : null;
}

function applies(rule, day) {
  if (DAY_APPLIES.indexOf(rule.applies) >= 0) return day.dow != null && appliesOnDay(rule.applies, day);
  return !rule.applies || rule.applies === 'שבת וחג' ||
    (rule.applies === 'שבת בלבד' && day.shabbat) || (rule.applies === 'חג בלבד' && !!day.chag);
}

function rowsFor(cfg, when, day, t, kiddush) {
  return (cfg.rules || [])
    .filter(r => r && String(r.name || '').trim() && r.when === when && applies(r, day))
    .map(r => [r, ruleTime(r, { cfg, when, day, t, kiddush })])
    // שורת אירועים בלי אירוע ביום הזה לא מופיעה
    .filter(([r, v]) => v || BASES[r.base] !== 'events')
    .map(([r, v]) => Object.assign({ name: String(r.name).trim() }, v || { text: '—', key: 9999 }))
    .map(({ ms, ...r }) => r)
    .sort((a, b) => a.key - b.key);
}

/**
 * הלוח המלא לאירוע: כותרת ורשימת קטעים (ערב, כל יום, מוצאי).
 * כל קטע: { title, date, rows:[{name,text}], zmanim:[[תווית, 'HH:MM']] }
 */
export function buildLuach(cfg, occ, kiddush) {
  const il = cfg.il, tz = cfg.tz;
  // שבת שחלה בחג: "ערב שבת וחג", "מוצאי שבת וחג"
  const kind = d => d.chag ? (d.shabbat ? 'שבת וחג' : 'חג') : 'שבת';
  const first = occ.days[0], last = occ.days[occ.days.length - 1];
  const times = d => { const t = dayTimes(cfg, d); t.candles = candlesOn(cfg, d, t, il); return t; };
  const zlist = list => list.filter(x => x[1] != null).map(x => [x[0], hm(x[1], tz)]);
  const sections = [];

  const te = times(occ.erev);
  sections.push({
    title: 'ערב ' + kind(first), date: gDate(occ.erev),
    rows: rowsFor(cfg, 'כניסה', first, te, kiddush),
    zmanim: zlist([['הדלקת נרות', te.candles], ['שקיעה', te.sunset]])
  });

  occ.days.forEach((d, i) => {
    const t = times(d.day);
    const label = d.chag ? (d.shabbat ? 'שבת ' : '') + d.chag : (d.chol ? 'שבת חול המועד' : d.special || (occ.days.length > 1 ? 'שבת' : 'יום השבת'));
    const z = [['סו"ז ק"ש מג"א', t.sofZmanShmaMGA], ['סו"ז ק"ש גר"א', t.sofZmanShma], ['שקיעה', t.sunset]];
    if (i < occ.days.length - 1) z.push(['הדלקת נרות', t.candles]);
    sections.push({ title: label, date: gDate(d.day), rows: rowsFor(cfg, 'כל יום', d, t, kiddush), zmanim: zlist(z) });
  });

  const tl = times(last.day);
  sections.push({
    title: 'מוצאי ' + kind(last), date: gDate(last.day),
    rows: rowsFor(cfg, 'יציאה', last, tl, kiddush),
    zmanim: zlist([['צאת ' + kind(last).split(' ו').map(w => 'ה' + w).join(' ו'), tl.havdalah]])
  });

  // ערכים לתבנית מקובץ: זמני היום וזמני התפילות לפי "מתי", והטקסטים של הכותרת
  const t1 = times(first.day);
  const texts = t => { const o = {}; for (const k in t) if (t[k] != null) o[k] = hm(t[k], tz); return o; };
  const rules = {};
  const addRows = (when, rows) => rows.forEach(r => { rules[when + '|' + r.name] = r.text; });
  addRows('כניסה', sections[0].rows);
  addRows('כל יום', sections[1].rows);
  addRows('יציאה', sections[sections.length - 1].rows);

  // שבת בלי פרשה (חג או חול המועד): שם המועד במקום שם הפרשה, כדי ש"לשבת …" לא ייצא "לשבת שבת"
  const noParasha = first.chag || (first.chol ? 'חול המועד ' + first.chol : occ.title);
  return {
    shul: String(cfg.shul || '').trim(),
    title: occ.title,
    dates: hebDateString(first.day) + ', ' + gDate(first.day, true),
    sections,
    values: {
      address: String(cfg.address || '').trim(),
      zmanim: { 'כניסה': texts(te), 'כל יום': texts(t1), 'יציאה': texts(tl) },
      rules,
      title: occ.title,
      parasha: first.parasha ? 'פרשת ' + first.parasha : noParasha,
      parashaName: first.parasha || noParasha,
      // בשבת בלי שם מיוחד – ריק, כדי ש"שבת נחמו" מהלוח הישן לא יופיע בה
      special: occ.days.map(d => d.special).find(Boolean) || '',
      hebDay: first.day,
      firstDay: first.day,
      multiDay: occ.days.length > 1
    }
  };
}

/**
 * ערכים לעיצוב מקובץ, עמוד לכל יום של שבת/חג רב-יומי: כל יום מחושב כמו לוח של יום אחד,
 * שהערב שלו הוא היום שלפניו (ביום השני – הדלקת הנרות ממוצאי היום הראשון), והמוצאי שלו הוא צאת אותו יום.
 */
export function dayPages(cfg, occ, kiddush) {
  return occ.days.map((d, i) => buildLuach(cfg, { ...occ, erev: i ? occ.days[i - 1].day : occ.erev,
    first: d.day, last: d.day, days: [d], title: holyTitle([d]) }, kiddush).values);
}

/** "כ״ז תשרי – ב׳ חשון תשפ״ז · 18.10–23.10.2026" */
function rangeDates(first, last) {
  const a = toHebrew(first), b = toHebrew(last);
  const heb = first === last ? hebDateString(first)
    : gematria(a.d) + (a.m === b.m ? '' : ' ' + monthName(a.y, a.m)) + (a.y === b.y ? '' : ' ' + gematria(a.y)) + ' – ' + hebDateString(last);
  // LRI … PDI: הטווח הלועזי נשאר משמאל לימין בתוך טקסט עברי
  return heb + ' · ⁦' + (first === last ? '' : dm(first) + '–') + dm(last) + '.' + toYmd(last).slice(0, 4) + '⁩';
}

/**
 * לוח של ימי חול (שבועי או חול המועד): טבלה שבה כל עמודה היא יום.
 * { days, rows:[{name, cells}], zmanim:[{name, cells}] } – תא ריק (null) כשהתפילה לא חלה באותו יום.
 */
export function buildDaysLuach(cfg, p, kiddush) {
  const tz = cfg.tz;
  const cols = p.days.map(x => ({ ...x, t: timesFor(cfg, x.day) }));
  const rules = (cfg.rules || []).filter(r => r && String(r.name || '').trim());
  const names = [...new Set(rules.map(r => String(r.name).trim()))];
  const rows = names.map(name => {
    let key = 9999;
    const cells = cols.map(c => {
      // כשכמה כללים של אותה תפילה חלים ביום, הספציפי גובר (למשל "ראשון" על "כל הימים")
      const r = rules.filter(x => String(x.name).trim() === name && applies(x, c))
        .sort((a, b) => DAY_APPLIES.indexOf(b.applies) - DAY_APPLIES.indexOf(a.applies))[0];
      if (!r) return null;
      const v = ruleTime(r, { cfg, when: 'כל יום', day: c, t: c.t, kiddush });
      // אירועים: תא ריק ביום בלי אירוע, וכשאין אירוע באף יום השורה לא מופיעה
      if (!v && BASES[r.base] === 'events') return null;
      if (v) key = Math.min(key, v.key);
      return v ? v.text : '—';
    });
    return { name, cells, key };
  }).filter(r => r.cells.some(c => c != null)).sort((a, b) => a.key - b.key).map(({ key, ...r }) => r);
  const zmanim = [['הנץ', 'sunrise'], ['סו"ז ק"ש גר"א', 'sofZmanShma'], ['שקיעה', 'sunset']]
    .map(([name, k]) => ({ name, cells: cols.map(c => c.t[k] == null ? null : hm(c.t[k], tz)) }));

  // ערכים לתבנית מקובץ: לפי היום בלוח (d0…d5)
  const texts = t => { const o = {}; for (const k in t) if (t[k] != null) o[k] = hm(t[k], tz); return o; };
  const values = { zmanim: {}, rules: {} };
  cols.forEach((c, i) => {
    values.zmanim[c.key] = texts(c.t);
    rows.forEach(r => { if (r.cells[i] != null) values.rules[c.key + '|' + r.name] = r.cells[i]; });
  });
  const first = p.days[0], shabbat = p.kind === 'week' ? parasha(first.day - first.dow + 6, cfg.il) : null;
  Object.assign(values, {
    address: String(cfg.address || '').trim(),
    title: p.title, parasha: shabbat ? 'פרשת ' + shabbat : p.title, parashaName: shabbat || p.title,
    special: p.kind === 'week' ? specialShabbat(first.day - first.dow + 6, cfg.il) : '',
    hebDay: first.day, firstDay: first.day, multiDay: false
  });

  return {
    type: 'days',
    shul: String(cfg.shul || '').trim(),
    title: p.title,
    dates: rangeDates(first.day, p.days[p.days.length - 1].day),
    days: p.days.map(({ name, date, special }) => ({ name, date, special })),
    rows, zmanim,
    values
  };
}

/* ---------- מודעת אירוע ---------- */

/**
 * מודעה לאירוע מיומן הקהילה (ev: { dateKey, title, details }): כותרת האירוע, היום והתאריך העברי והלועזי,
 * והפרטים בגוף המודעה. { type: 'poster', shul, title, dates, body } – בלי קטעים, כדי שעריכת הטקסט תעבוד כמו בלוח.
 */
export function buildPoster(cfg, ev) {
  const d = toDayNum(ev.dateKey), il = cfg.il, p = dow(d) === 6 ? parasha(d, il) : null;
  const day = yomTov(d, il) || (dow(d) === 6 ? (p ? 'שבת פרשת ' + p : 'שבת') : 'יום ' + DAY_NAMES[dow(d)]);
  return {
    type: 'poster',
    shul: String(cfg.shul || '').trim(),
    title: ev.title,
    dates: day + ', ' + hebDateString(d) + ' · ' + gDate(d, true),
    body: String(ev.details || '').trim(),
    sections: [],
    values: {}
  };
}

/** זמני היום (במילישניות) ליום נתון, כולל הדלקת נרות – לזיהוי כללים מלוח ישן */
export function timesFor(cfg, d) {
  const t = dayTimes(cfg, d);
  t.candles = candlesOn(cfg, d, t, cfg.il);
  return t;
}

/** הוספת הפרש בדקות ועיגול ל-5 לפי כלל */
export function applyOffset(ms, offset, round) {
  let x = ms + (Number(offset) || 0) * MIN;
  const r = 5 * MIN;
  if (round === 'למטה ל-5') x = Math.floor(x / r) * r;
  if (round === 'למעלה ל-5') x = Math.ceil(x / r) * r;
  if (round === 'לקרוב ל-5') x = Math.round(x / r) * r;
  return x;
}
