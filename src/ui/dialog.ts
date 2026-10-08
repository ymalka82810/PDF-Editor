/**
 * דיאלוג משותף (alert/confirm/prompt) בעיצוב שלנו, במקום את אלה של הדפדפן.
 * כלים של סשנים אחרים משתמשים ב-confirmDialog/alertDialog/promptDialog.
 */

import type { EditorApi } from '../core/registry';

export interface DialogOptions {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  /** כפתור האישור בצבע אזהרה (למשל מחיקה) */
  danger?: boolean;
}

export interface PromptOptions extends DialogOptions {
  value?: string;
  multiline?: boolean;
  placeholder?: string;
}

function open(api: EditorApi, opts: DialogOptions, withCancel: boolean, field?: HTMLInputElement | HTMLTextAreaElement): Promise<boolean> {
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg';
  dlg.innerHTML = `
    <form method="dialog" class="dlg-form">
      ${opts.title ? `<h2 class="dlg-title"></h2>` : ''}
      <p class="dlg-body"></p>
      <div class="dlg-actions">
        ${withCancel ? `<button type="button" class="dlg-cancel"></button>` : ''}
        <button type="submit" class="dlg-ok primary"></button>
      </div>
    </form>`;
  if (opts.title) dlg.querySelector<HTMLElement>('.dlg-title')!.textContent = opts.title;
  dlg.querySelector<HTMLElement>('.dlg-body')!.textContent = opts.message;
  if (field) dlg.querySelector('.dlg-body')!.after(field);
  const ok = dlg.querySelector<HTMLButtonElement>('.dlg-ok')!;
  ok.textContent = opts.okLabel ?? api.t('dialog.ok');
  if (opts.danger) ok.classList.add('danger');
  const cancel = dlg.querySelector<HTMLButtonElement>('.dlg-cancel');
  if (cancel) cancel.textContent = opts.cancelLabel ?? api.t('dialog.cancel');

  document.body.appendChild(dlg);
  return new Promise<boolean>((resolve) => {
    let result = false;
    dlg.querySelector('form')!.onsubmit = (e) => {
      e.preventDefault();
      result = true;
      dlg.close();
    };
    cancel?.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.showModal();
    if (field) {
      field.focus();
      if (field instanceof HTMLInputElement) field.select();
    } else (opts.danger && cancel ? cancel : ok).focus();
  });
}

/** חלון הודעה עם כפתור אישור אחד */
export function alertDialog(api: EditorApi, opts: DialogOptions): Promise<void> {
  return open(api, opts, false).then(() => undefined);
}

/** חלון אישור/ביטול. מחזיר true אם אושר */
export function confirmDialog(api: EditorApi, opts: DialogOptions): Promise<boolean> {
  return open(api, opts, true);
}

/** חלון עם שדה טקסט. מחזיר את הטקסט, או null בביטול */
export function promptDialog(api: EditorApi, opts: PromptOptions): Promise<string | null> {
  const field = document.createElement(opts.multiline ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
  field.className = 'dlg-field';
  field.value = opts.value ?? '';
  field.dir = 'auto';
  if (opts.placeholder) field.placeholder = opts.placeholder;
  if (field instanceof HTMLTextAreaElement) field.rows = 3;
  return open(api, opts, true, field).then((ok) => (ok ? field.value : null));
}
