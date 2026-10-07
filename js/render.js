/** הצגת הלוח: HTML לתצוגה ולהדפסה. */

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- עריכת טקסט על הלוח ---------- */

/**
 * כל הטקסטים בלוח שאפשר לערוך, עם מפתח קבוע לכל אחד. שורות וזמנים מזוהים לפי השם שלהם,
 * כדי ששינוי בזמני התפילות לא יעביר טקסט ששונה לשורה אחרת.
 */
function fields(l) {
  const f = [];
  const add = (key, obj, prop) => f.push({ key, obj, prop });
  for (const k of ['shul', 'title', 'dates']) add(k, l, k);
  if (l.type === 'poster') add('body', l, 'body');
  if (l.type === 'days') {
    l.days.forEach((d, i) => { for (const k of ['name', 'date', 'special']) add('d' + i + '.' + k, d, k); });
    for (const [g, list] of [['r', l.rows], ['z', l.zmanim]]) for (const r of list) {
      r._k = r._k || g + ':' + r.name;
      add(r._k + '.name', r, 'name');
      r.cells.forEach((c, i) => add(r._k + '.' + i, r.cells, i));
    }
  } else l.sections.forEach((s, i) => {
    add('s' + i + '.title', s, 'title'); add('s' + i + '.date', s, 'date');
    for (const r of s.rows) { r._k = r._k || 's' + i + '.r:' + r.name; add(r._k + '.name', r, 'name'); add(r._k + '.text', r, 'text'); }
    s.zk = s.zk || s.zmanim.map(z => 's' + i + '.z:' + z[0]);
    s.zmanim.forEach((z, j) => { add(s.zk[j] + '.name', z, 0); add(s.zk[j] + '.val', z, 1); });
  });
  return f;
}

/**
 * עותק של הלוח עם הטקסטים שהגבאי שינה (מפתח ← טקסט): fixed – שינויים קבועים בתבנית, ו-edits – שינויים
 * בלוח הזה בלבד, שגוברים עליהם. l.edited – מפתחות ששונו בלוח הזה, l.fixed – מפתחות עם שינוי קבוע.
 * שורה שמחקו בה את כל הטקסט יורדת מהלוח.
 */
export function withEdits(l, edits, fixed = {}) {
  const { values, ...rest } = l;
  const out = JSON.parse(JSON.stringify(rest));
  out.values = values;
  out.edited = new Set();
  out.fixed = new Set();
  for (const x of fields(out)) {
    const once = x.key in edits;
    if (!once && !(x.key in fixed)) continue;
    const v = String(once ? edits[x.key] : fixed[x.key]);
    // תא ריק בטבלת ימי החול הוא null, כמו תפילה שלא חלה באותו יום
    x.obj[x.prop] = v === '' && Array.isArray(x.obj) && out.type === 'days' ? null : v;
    out[once ? 'edited' : 'fixed'].add(x.key);
  }
  if (out.type === 'days') {
    for (const g of ['rows', 'zmanim']) out[g] = out[g].filter(r => r.name || r.cells.some(c => c));
  } else for (const s of out.sections) {
    s.rows = s.rows.filter(r => r.name || r.text);
    const keep = s.zmanim.map(z => !!(z[0] || z[1]));
    s.zmanim = s.zmanim.filter((z, j) => keep[j]);
    s.zk = s.zk.filter((k, j) => keep[j]);
  }
  return out;
}

/** טקסט שאפשר לערוך: data-e הוא המפתח שלו. ed מסמן טקסט ששונה בלוח הזה, ו-fx טקסט עם שינוי קבוע */
function E(l, key, text, ph) {
  const cls = l.edited && l.edited.has(key) ? 'ed' : l.fixed && l.fixed.has(key) ? 'fx' : '';
  return '<span data-e="' + esc(key) + '"' + (cls ? ' class="' + cls + '"' : '') +
    (ph ? ' data-ph="' + esc(ph) + '"' : '') + '>' + esc(text) + '</span>';
}

/** טקסט עם ירידת שורה בין מילים (ההודעה מלוח הקידושים) */
export const multiline = s => /\S\s*\n\s*\S/.test(String(s ?? ''));

/** לוח ימי חול: טבלה, שורה לכל תפילה ועמודה לכל יום */
function daysHtml(l, editing) {
  let h = '<div class="l-grid-wrap"><table class="l-grid"><thead><tr><th></th>' +
    l.days.map((d, i) => '<th>' + E(l, 'd' + i + '.name', d.name) + '<small>' + E(l, 'd' + i + '.date', d.date) + '</small>' +
      (d.special || editing ? '<small class="sp">' + E(l, 'd' + i + '.special', d.special) + '</small>' : '') + '</th>').join('') + '</tr></thead><tbody>';
  const row = (r, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + E(l, r._k + '.name', r.name) + '</th>' +
    r.cells.map((c, i) => '<td>' + E(l, r._k + '.' + i, c) + '</td>').join('') + '</tr>';
  h += l.rows.map(r => row(r)).join('') + l.zmanim.map((r, i) => row(r, i ? 'z' : 'z first')).join('');
  return h + '</tbody></table></div>';
}

/**
 * חלוקת הקטעים של לוח שבת/חג ל-n עמודות, לפי הסדר: עמודה ראשונה (מימין) מלמעלה למטה, ואחריה הבאה.
 * הקטעים מחולקים כך שהעמודה הארוכה תהיה קצרה ככל האפשר (לפי מספר השורות בכל קטע). מחזיר רשימה של עמודות
 */
export function splitColumns(sections, n) {
  n = Math.max(1, Math.min(n || 1, sections.length));
  const size = s => 2 + s.rows.length + (s.zmanim.length ? 1 : 0);
  // best(i, k) – החלוקה הטובה של הקטעים מ-i והלאה ל-k עמודות: [הגובה של הארוכה, רשימת נקודות החיתוך]
  const best = (i, k) => {
    if (k === 1) return [sections.slice(i).reduce((a, s) => a + size(s), 0), []];
    let out = null, h = 0;
    for (let j = i + 1; j <= sections.length - k + 1; j++) {
      h += size(sections[j - 1]);
      const [rest, cuts] = best(j, k - 1), m = Math.max(h, rest);
      if (!out || m < out[0]) out = [m, [j, ...cuts]];
    }
    return out;
  };
  const cuts = [0, ...best(0, n)[1], sections.length];
  return cuts.slice(1).map((c, i) => sections.slice(cuts[i], c));
}

/**
 * l – לוח אחרי withEdits. editing – מצב עריכה: מוצגים גם שדות ריקים (שם בית הכנסת) כדי שאפשר יהיה לכתוב בהם.
 * cols – מספר העמודות שהקטעים של לוח שבת/חג מחולקים ביניהן
 */
export function luachHtml(l, editing, cols = 1) {
  let h = '<div class="l-head"><div class="stripe"></div><div class="stripe s"></div><div class="stripe"></div>';
  if (l.shul || editing) h += '<div class="l-shul">' + E(l, 'shul', l.shul, 'שם בית הכנסת') + '</div>';
  h += '<h2 class="l-title">' + E(l, 'title', l.title) + '</h2><div class="l-dates">' + E(l, 'dates', l.dates) + '</div></div>';
  if (l.type === 'poster') {
    // מודעת אירוע: הפרטים בגוף המודעה
    if (l.body || editing) h += '<div class="l-poster">' + E(l, 'body', l.body, 'פרטי האירוע') + '</div>';
  } else if (l.type === 'days') h += daysHtml(l, editing);
  else {
    const sec = s => {
      const i = l.sections.indexOf(s);
      let t = '<table class="l-sec"><tr><th>' + E(l, 's' + i + '.title', s.title) + '</th><th class="d">' + E(l, 's' + i + '.date', s.date) + '</th></tr>';
      // הודעה של כמה שורות (הקידוש): לרוחב הקטע, בשורות כמו בלוח הקידושים. הכותרת שבה מחליפה את שם השורה
      for (const r of s.rows) t += multiline(r.text) ? '<tr><td colspan="2" class="k">' + E(l, r._k + '.text', r.text) + '</td></tr>'
        : '<tr><td>' + E(l, r._k + '.name', r.name) + '</td><td class="t">' + E(l, r._k + '.text', r.text) + '</td></tr>';
      if (s.zmanim.length) {
        t += '<tr><td colspan="2" class="z">' +
          s.zmanim.map((z, j) => '<span>' + E(l, s.zk[j] + '.name', z[0]) + ' <b>' + E(l, s.zk[j] + '.val', z[1]) + '</b></span>').join('') + '</td></tr>';
      }
      return t + '</table>';
    };
    const columns = splitColumns(l.sections, cols);
    h += columns.length > 1 ? '<div class="l-cols">' + columns.map(c => '<div class="l-col">' + c.map(sec).join('') + '</div>').join('') + '</div>'
      : l.sections.map(sec).join('');
  }
  return h;
}

