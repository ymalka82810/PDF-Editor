/* חלון הודעה ואישור משותף לכל דפי האתר, במקום alert ו-confirm של הדפדפן.
 * SiteDialog.confirm(text, {ok, cancel, danger}) מחזיר Promise<boolean>.
 * SiteDialog.alert(text, {ok}) מחזיר Promise שמתממש כשסוגרים את החלון.
 * SiteDialog.prompt(text, {value, multiline, ok, cancel}) מחזיר Promise עם הטקסט שנכתב, או null בביטול.
 * החלון הוא <dialog> מודאלי, כך שהוא מופיע גם מעל חלונות אחרים שפתוחים בדף.
 * עם {within: אלמנט} ההודעה מוצגת בתוך האלמנט במקום התוכן שלו (למשל בתוך מגירה שכבר פתוחה),
 * ולא כחלון נוסף מעליו. כשעונים, התוכן חוזר כמו שהיה.
 */
(function(){
"use strict";
const css = `
.sd{border:0;border-radius:18px;padding:0;width:min(400px,calc(100vw - 32px));max-width:none;max-height:none;background:#fffdf9;color:#202a3f;box-shadow:0 18px 40px rgba(24,32,54,.22);font-family:"Assistant",Arial,sans-serif;direction:rtl}
.sd::backdrop{background:rgba(10,16,32,.5)}
.sd[open]{animation:sd-in .16s ease-out}
@keyframes sd-in{from{opacity:0;transform:translateY(8px) scale(.98)}}
.sd-body{padding:22px 22px 6px;font-size:1.05rem;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere}
.sd-field{display:block;box-sizing:border-box;width:calc(100% - 44px);margin:10px 22px 0;padding:10px 12px;border:1px solid #e2dcc9;border-radius:10px;background:#fff;color:inherit;font:inherit;font-size:1.05rem;resize:vertical}
.sd-actions{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:8px;padding:16px 22px 20px}
.sd-actions button{min-width:88px;padding:10px 18px;border-radius:12px;font:inherit;font-weight:700;font-size:1rem;cursor:pointer}
.sd-ok{border:1px solid #1e3a63;background:#1e3a63;color:#fff}
.sd-ok:hover{background:#35588f;border-color:#35588f}
.sd-ok.sd-danger{background:#a33a3a;border-color:#a33a3a}
.sd-ok.sd-danger:hover{background:#8c2f2f;border-color:#8c2f2f}
.sd-cancel{border:1px solid #e2dcc9;background:none;color:#3c4863}
.sd-cancel:hover{background:#efe8d6}
.sd button:focus-visible{outline:3px solid #ab7f2e;outline-offset:2px}
.sd-inplace>:not(.sd-panel){display:none!important}
.sd-panel{font-family:"Assistant",Arial,sans-serif;direction:rtl;animation:sd-in .16s ease-out}
.sd-panel .sd-body{padding:8px 2px 4px}
.sd-panel .sd-actions{padding:18px 2px 4px}
:root[data-theme="dark"] .sd{background:#161d30;color:#e9ecf5;box-shadow:0 18px 40px rgba(0,0,0,.5)}
:root[data-theme="dark"] .sd-ok{background:#8fb0ec;border-color:#8fb0ec;color:#0c1120}
:root[data-theme="dark"] .sd-ok:hover{background:#b6cdf5;border-color:#b6cdf5}
:root[data-theme="dark"] .sd-ok.sd-danger{background:#f08c80;border-color:#f08c80;color:#0c1120}
:root[data-theme="dark"] .sd-field{background:#0f1526;border-color:#2a3252}
:root[data-theme="dark"] .sd-cancel{border-color:#2a3252;color:#c3cadf}
:root[data-theme="dark"] .sd-cancel:hover{background:#202a48}
:root[data-theme="dark"] .sd button:focus-visible{outline-color:#dfb564}
@media print{.sd{display:none!important}}
`;
let styled = false;

function open(text, opts, withCancel){
  if (!styled){
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    styled = true;
  }
  const host = opts.within && opts.within.isConnected && opts.within.getClientRects().length ? opts.within : null;
  const dlg = document.createElement(host ? 'div' : 'dialog');
  dlg.className = host ? 'sd-panel' : 'sd';
  if (host) dlg.setAttribute('role', 'alertdialog');
  dlg.innerHTML = '<div class="sd-body"></div><div class="sd-actions"><button type="button" class="sd-ok"></button></div>';
  dlg.querySelector('.sd-body').textContent = text;
  if (opts.field) dlg.querySelector('.sd-body').after(opts.field);
  const ok = dlg.querySelector('.sd-ok');
  ok.textContent = opts.ok || 'אישור';
  if (opts.danger) ok.classList.add('sd-danger');
  let cancel = null;
  if (withCancel){
    cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'sd-cancel';
    cancel.textContent = opts.cancel || 'ביטול';
    dlg.querySelector('.sd-actions').appendChild(cancel);
  }
  if (host) return inPlace(host, dlg, ok, cancel, opts);
  document.body.appendChild(dlg);

  return new Promise(resolve => {
    let result = false;
    ok.onclick = () => { result = true; dlg.close(); };
    if (cancel) cancel.onclick = () => dlg.close();
    // Escape סוגר את החלון, וזה נחשב ביטול
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    // בפעולה שמוחקת משהו הפוקוס על "ביטול", כדי ש-Enter לא ימחק בטעות
    if (opts.field) { opts.field.focus(); opts.field.select(); }
    else (opts.danger && cancel ? cancel : ok).focus();
  });
}

function prompt(text, opts){
  opts = opts || {};
  const field = document.createElement(opts.multiline ? 'textarea' : 'input');
  field.className = 'sd-field';
  field.value = opts.value || '';
  field.dir = 'auto';
  if (opts.multiline) field.rows = 3;
  // Enter באותו שדה של שורה אחת מאשר
  else field.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); field.closest('.sd').querySelector('.sd-ok').click(); }
  });
  return open(text, { ...opts, within: null, field }, true).then(ok => ok ? field.value : null);
}

function inPlace(host, panel, ok, cancel, opts){
  host.classList.add('sd-inplace');
  host.appendChild(panel);
  host.scrollTop = 0;
  return new Promise(resolve => {
    let done = false;
    function finish(result){
      if (done) return;
      done = true;
      observer.disconnect();
      document.removeEventListener('keydown', onKey, true);
      panel.remove();
      host.classList.remove('sd-inplace');
      resolve(result);
    }
    function onKey(e){ if (e.key === 'Escape'){ e.stopPropagation(); finish(false); } }
    // אם הדף בונה מחדש את התוכן בזמן שההודעה פתוחה, ההודעה נעלמת וזה נחשב ביטול
    const observer = new MutationObserver(() => { if (!panel.isConnected || panel.parentNode !== host) finish(false); });
    observer.observe(host, { childList: true });
    ok.onclick = () => finish(true);
    if (cancel) cancel.onclick = () => finish(false);
    document.addEventListener('keydown', onKey, true);
    (opts.danger && cancel ? cancel : ok).focus();
  });
}

window.SiteDialog = {
  confirm: (text, opts) => open(text, opts || {}, true),
  alert: (text, opts) => open(text, opts || {}, false).then(() => {}),
  prompt
};
})();
