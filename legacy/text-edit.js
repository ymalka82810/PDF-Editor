/**
 * חלונית לעריכת טקסט בלוח: משותפת לעריכת הלוח של האתר (js/app.js) ולעורך התבנית מקובץ (js/template-ui.js).
 * מציגה שדה טקסט, ואם ניתן – בררה "רק השבוע הזה" מול "לתמיד", וכפתור מחיקה כשכבר יש עריכה קודמת.
 */

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let styled = false;
const CSS = `
.te{border:0;border-radius:18px;padding:0;width:min(380px,calc(100vw - 32px));max-width:none;background:#fffdf9;color:#202a3f;box-shadow:0 18px 40px rgba(24,32,54,.22);font-family:"Assistant",Arial,sans-serif;direction:rtl}
.te::backdrop{background:rgba(10,16,32,.5)}
.te[open]{animation:te-in .16s ease-out}
@keyframes te-in{from{opacity:0;transform:translateY(8px) scale(.98)}}
.te-body{padding:20px 20px 4px}
.te-body h3{margin:0 0 12px;font-size:1.05rem}
.te-field{display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:10px 12px;border:1px solid #e2dcc9;border-radius:10px;background:#fff;color:inherit;font:inherit;font-size:1.05rem;resize:vertical}
.te-scope{display:flex;flex-direction:column;gap:6px;margin-top:14px;font-size:.95rem}
.te-scope label{display:flex;align-items:center;gap:6px}
.te-actions{display:flex;flex-wrap:wrap;gap:8px;padding:16px 20px 20px}
.te-actions button{min-width:80px;padding:10px 16px;border-radius:12px;font:inherit;font-weight:700;font-size:1rem;cursor:pointer}
.te-ok{border:1px solid #1e3a63;background:#1e3a63;color:#fff}
.te-ok:hover{background:#35588f;border-color:#35588f}
.te-del{border:1px solid #a33a3a;background:none;color:#a33a3a;margin-inline-start:auto}
.te-del:hover{background:#a33a3a;color:#fff}
.te-cancel{border:1px solid #e2dcc9;background:none;color:#3c4863}
.te-cancel:hover{background:#efe8d6}
.te button:focus-visible{outline:3px solid #ab7f2e;outline-offset:2px}
:root[data-theme="dark"] .te{background:#161d30;color:#e9ecf5;box-shadow:0 18px 40px rgba(0,0,0,.5)}
:root[data-theme="dark"] .te-field{background:#0f1526;border-color:#2a3252}
:root[data-theme="dark"] .te-ok{background:#8fb0ec;border-color:#8fb0ec;color:#0c1120}
:root[data-theme="dark"] .te-ok:hover{background:#b6cdf5;border-color:#b6cdf5}
:root[data-theme="dark"] .te-del{border-color:#f08c80;color:#f08c80}
:root[data-theme="dark"] .te-del:hover{background:#f08c80;color:#0c1120}
:root[data-theme="dark"] .te-cancel{border-color:#2a3252;color:#c3cadf}
:root[data-theme="dark"] .te button:focus-visible{outline-color:#dfb564}
@media print{.te{display:none!important}}
`;

/**
 * פתיחת חלונית עריכת טקסט. opts:
 *   text – הטקסט הנוכחי להצגה בשדה
 *   multiline – textarea במקום input
 *   weekLabel – תווית השבוע המוצג (למשל "שבת פרשת בראשית"); בלי זה אין בררת שבוע, וחוסכים תמיד "לתמיד"
 *   weekFirst – true כדי שהבררה "רק השבוע הזה" תסומן כברירת מחדל (אחרת "לתמיד")
 *   hasOverride – יש כבר עריכה קודמת לטקסט הזה, אז מוצג כפתור מחיקה
 *   onSave(text, scope) – scope הוא 'week' או 'always'
 *   onDelete() – מוחקת את העריכה הקיימת (חוזר לערך הרגיל)
 */
export function openTextEdit(opts) {
  if (!styled) {
    styled = true;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const dlg = document.createElement('dialog');
  dlg.className = 'te';
  const field = document.createElement(opts.multiline ? 'textarea' : 'input');
  field.className = 'te-field';
  field.value = opts.text || '';
  field.dir = 'auto';
  if (opts.multiline) field.rows = 3;
  else field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  dlg.innerHTML = '<div class="te-body"><h3>עריכת טקסט</h3></div><div class="te-actions">' +
    '<button type="button" class="te-ok">שמירה</button>' +
    (opts.hasOverride ? '<button type="button" class="te-del">מחיקה</button>' : '') +
    '<button type="button" class="te-cancel">ביטול</button></div>';
  const body = dlg.querySelector('.te-body');
  body.appendChild(field);
  if (opts.weekLabel) {
    body.insertAdjacentHTML('beforeend', '<div class="te-scope">' +
      '<label><input type="radio" name="teScope" value="week"' + (opts.weekFirst !== false ? ' checked' : '') + '> רק השבוע הזה (' + esc(opts.weekLabel) + ')</label>' +
      '<label><input type="radio" name="teScope" value="always"' + (opts.weekFirst === false ? ' checked' : '') + '> לתמיד</label></div>');
  }
  document.body.appendChild(dlg);

  const close = () => dlg.close();
  function save() {
    const scope = dlg.querySelector('input[name="teScope"]:checked');
    opts.onSave(field.value, scope ? scope.value : 'always');
    close();
  }
  dlg.querySelector('.te-ok').onclick = save;
  dlg.querySelector('.te-cancel').onclick = close;
  const del = dlg.querySelector('.te-del');
  if (del) del.onclick = () => { opts.onDelete(); close(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  field.focus();
  field.select();
}
