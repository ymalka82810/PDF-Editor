/**
 * טפסים: קריאת שדות AcroForm עם pdf-lib (סוג, אפשרויות וערך התחלתי), תצוגת שדות HTML מעל העמוד
 * (ב-view.overlay, במיקום לפי rectToView), ומילוי/שיטוח בייצוא.
 * השדות עצמם לא חלק משכבת ה-ops; stopPropagation ב-pointerdown כדי שלא יתחילו בחירה/גרירה.
 */

import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFField,
} from 'pdf-lib';
import { rectToView } from '../../core/coords';
import type { DocExportCtx, EditorApi, PageView, Tool } from '../../core/registry';
import type { Rect } from '../../core/types';
import { confirmDialog } from '../../ui/dialog';
import en from './locales/en.json';
import he from './locales/he.json';
import './forms.css';

type Kind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list';

interface WidgetInfo {
  sourceIndex: number;
  /** בנקודות PDF, יחסית למקור העמוד (MediaBox) - לפני הפחתת ה-origin של ה-CropBox */
  rect: Rect;
  /** רק עבור radio: הערך של הכפתור הספציפי הזה */
  onValue?: string;
}

interface FieldInfo {
  name: string;
  kind: Kind;
  options: string[];
  multiline: boolean;
  readOnly: boolean;
  widgets: WidgetInfo[];
}

/** מפתח מיוחד ב-formValues (לא שם שדה אמיתי) לדגל "שיטוח בשמירה" */
export const FLATTEN_KEY = '__forms_flatten__';

let sourceId: string | null = null;
let fields: FieldInfo[] = [];

function kindOf(field: PDFField): Kind | null {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'list';
  return null;
}

function initialValue(field: PDFField, kind: Kind): string | boolean | string[] {
  switch (kind) {
    case 'checkbox':
      return (field as PDFCheckBox).isChecked();
    case 'radio':
      return (field as PDFRadioGroup).getSelected() ?? '';
    case 'dropdown':
      return (field as PDFDropdown).getSelected()[0] ?? '';
    case 'list':
      return (field as PDFOptionList).getSelected();
    default:
      return (field as PDFTextField).getText() ?? '';
  }
}

/** קורא את מבנה הטופס מהקובץ המקורי עם pdf-lib, וממלא ערכי התחלה ב-formValues (אם עדיין לא נקבעו) */
async function indexForms(api: EditorApi) {
  fields = [];
  sourceId = null;
  const state = api.store.get();
  const srcId = state.pages.find((p) => p.sourceId)?.sourceId;
  if (!srcId) return;
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(state.sources[srcId].bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return;
  }
  const form = doc.getForm();
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref, i]));
  for (const field of form.getFields()) {
    const kind = kindOf(field);
    if (!kind) continue;
    const widgets: WidgetInfo[] = [];
    for (const w of field.acroField.getWidgets()) {
      const ref = w.P();
      const idx = ref ? pageIndex.get(ref) : undefined;
      if (idx === undefined) continue;
      const r = w.getRectangle();
      widgets.push({
        sourceIndex: idx,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        onValue: kind === 'radio' ? w.getOnValue()?.decodeText() : undefined,
      });
    }
    if (!widgets.length) continue;
    const info: FieldInfo = {
      name: field.getName(),
      kind,
      options:
        kind === 'dropdown'
          ? (field as PDFDropdown).getOptions()
          : kind === 'list'
            ? (field as PDFOptionList).getOptions()
            : [],
      multiline: kind === 'text' && (field as PDFTextField).isMultiline(),
      readOnly: field.isReadOnly(),
      widgets,
    };
    fields.push(info);
    if (api.store.get().formValues[info.name] === undefined) {
      api.store.setFormValue(info.name, initialValue(field, kind), { record: false });
    }
  }
  sourceId = srcId;
}

function place(el: HTMLElement, r: Rect) {
  el.style.position = 'absolute';
  el.style.left = r.x + 'px';
  el.style.top = r.y + 'px';
  el.style.width = r.w + 'px';
  el.style.height = r.h + 'px';
}

function fillControl(el: HTMLElement) {
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.boxSizing = 'border-box';
  el.style.font = 'inherit';
}

function mountWidget(info: FieldInfo, widget: WidgetInfo, view: PageView, api: EditorApi) {
  const rect: Rect = {
    x: widget.rect.x - view.page.origin.x,
    y: widget.rect.y - view.page.origin.y,
    w: widget.rect.w,
    h: widget.rect.h,
  };
  const wrap = document.createElement('div');
  wrap.className = 'forms-field forms-field-' + info.kind;
  place(wrap, rectToView(view.geom, rect));
  wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
  const value = api.store.get().formValues[info.name];

  if (info.kind === 'checkbox') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
    input.disabled = info.readOnly;
    input.onchange = () => api.store.setFormValue(info.name, input.checked);
    wrap.appendChild(input);
  } else if (info.kind === 'radio') {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'form-' + info.name;
    input.checked = value === widget.onValue;
    input.disabled = info.readOnly;
    input.onchange = () => api.store.setFormValue(info.name, widget.onValue ?? '');
    wrap.appendChild(input);
  } else if (info.kind === 'dropdown' || info.kind === 'list') {
    const select = document.createElement('select');
    select.dir = 'auto';
    select.multiple = info.kind === 'list';
    select.disabled = info.readOnly;
    fillControl(select);
    for (const opt of info.options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    }
    const sel = Array.isArray(value) ? value : value != null ? [String(value)] : [];
    for (const o of select.options) o.selected = sel.includes(o.value);
    select.onchange = () => {
      const picked = [...select.selectedOptions].map((o) => o.value);
      api.store.setFormValue(info.name, info.kind === 'list' ? picked : (picked[0] ?? ''));
    };
    wrap.appendChild(select);
  } else {
    const field: HTMLInputElement | HTMLTextAreaElement = info.multiline
      ? document.createElement('textarea')
      : document.createElement('input');
    if (field instanceof HTMLInputElement) field.type = 'text';
    field.dir = 'auto';
    field.disabled = info.readOnly;
    field.value = typeof value === 'string' ? value : '';
    fillControl(field);
    field.oninput = () => api.store.setFormValue(info.name, field.value);
    wrap.appendChild(field);
  }

  view.overlay.appendChild(wrap);
}

function renderFields(view: PageView, api: EditorApi) {
  for (const el of [...view.overlay.querySelectorAll(':scope > .forms-field')]) el.remove();
  if (!sourceId || view.page.sourceId !== sourceId) return;
  for (const info of fields) {
    for (const widget of info.widgets) {
      if (widget.sourceIndex === view.page.sourceIndex) mountWidget(info, widget, view, api);
    }
  }
}

/** שדות על עמודים שהוסרו מהמסמך (לא מופיעים יותר ב-pages הסופי) נשארים ב-AcroForm - מסירים אותם */
function cleanOrphanFields(ctx: DocExportCtx) {
  const form = ctx.pdf.getForm();
  const keptRefs = new Set(ctx.pages.map((p) => p.pdfPage.ref));
  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    const toRemove: number[] = [];
    widgets.forEach((w, i) => {
      const p = w.P();
      if (p && !keptRefs.has(p)) toRemove.push(i);
    });
    if (widgets.length > 0 && toRemove.length === widgets.length) {
      form.removeField(field);
    } else {
      for (let i = toRemove.length - 1; i >= 0; i--) field.acroField.removeWidget(toRemove[i]);
    }
  }
}

const tool: Tool = {
  id: 'forms',
  toolbar: false,
  locales: { he, en },

  async onDocumentOpened(api) {
    await indexForms(api);
    for (const view of api.views()) renderFields(view, api);
  },

  onPageRendered(view, api) {
    renderFields(view, api);
  },

  panel: {
    side: 'end',
    mount(el, api) {
      el.innerHTML =
        '<label class="forms-flatten"><input type="checkbox"> <span data-t="forms.flatten"></span></label>';
      const input = el.querySelector('input')!;
      input.checked = !!api.store.get().formValues[FLATTEN_KEY];
      input.onchange = async () => {
        if (input.checked) {
          const ok = await confirmDialog(api, { message: api.t('forms.flattenConfirm'), danger: true });
          if (!ok) {
            input.checked = false;
            return;
          }
        }
        api.store.setFormValue(FLATTEN_KEY, input.checked);
      };
    },
  },

  async exportDocument(ctx) {
    const form = ctx.pdf.getForm();
    cleanOrphanFields(ctx);
    for (const field of form.getFields()) {
      const value = ctx.state.formValues[field.getName()];
      if (value === undefined) continue;
      try {
        if (field instanceof PDFTextField) field.setText(typeof value === 'string' ? value : '');
        else if (field instanceof PDFCheckBox) {
          if (value) field.check();
          else field.uncheck();
        } else if (field instanceof PDFRadioGroup) {
          if (typeof value === 'string' && value) field.select(value);
        } else if (field instanceof PDFDropdown) {
          if (typeof value === 'string') field.select(value);
        } else if (field instanceof PDFOptionList) {
          field.select(Array.isArray(value) ? value.map(String) : value ? [String(value)] : []);
        }
      } catch (err) {
        console.warn('שדה טופס לא עודכן: ' + field.getName(), err);
      }
    }
    // עברית: ה-appearance נכתב עם הגופן המוטמע (כבר ב-ltr בכתיבה, ראו core/pdf-text.ts)
    form.updateFieldAppearances(await ctx.font());
    if (ctx.state.formValues[FLATTEN_KEY]) form.flatten();
  },
};

export default tool;
