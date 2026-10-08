/**
 * תיבת טקסט חדשה: גרירה או לחיצה ליצירה, עריכה במקום (textarea), ופס מאפיינים צף (גודל/צבע/מודגש/יישור).
 * הכתיבה ל-PDF דרך drawTextBox (bidi ושבירת שורות של core/pdf-text.ts).
 * בעמוד מסובב הטקסט ישר למשתמש: data.rotate (ראו ui/widgets/frame.ts).
 */

import { rectToPdf, rectToView, userSpace } from '../../core/coords';
import { dragRect } from '../../core/interaction';
import { drawTextBox, isRtl } from '../../core/pdf-text';
import type { EditorApi, PageView, Tool } from '../../core/registry';
import type { Operation, Point, Rect } from '../../core/types';
import { floatingBar, segmented, stepper, swatches, toggleButton } from '../../ui/widgets/controls';
import { drawInFrame, placeFrame } from '../../ui/widgets/frame';
import he from './locales/he.json';
import en from './locales/en.json';
import './style.css';

export interface TextData {
  text: string;
  size: number;
  color: string;
  font: 'default' | 'default-bold';
  align: 'start' | 'end' | 'center';
  /** זווית המסגרת ביחס לעמוד (מעלות, עם כיוון השעון). ביצירה: -page.rotation */
  rotate?: number;
}

export const COLORS = ['#202a3f', '#000000', '#a33a3a', '#1e3a63', '#2d9b5a', '#ab7f2e'];
/** הפעולות שנערכות עכשיו (לא מציגים את התוכן שלהן, רק את ה-textarea) */
const editing = new Set<string>();

const dataOf = (op: Operation) => op.data as unknown as TextData;

function physicalAlign(align: TextData['align'], rtl: boolean): 'left' | 'right' | 'center' {
  if (align === 'center') return 'center';
  if (align === 'start') return rtl ? 'right' : 'left';
  return rtl ? 'left' : 'right';
}

/** עיצוב משותף לתצוגה ולעורך – כדי שהטקסט לא יקפוץ כשנכנסים לעריכה */
function styleBox(el: HTMLElement, d: TextData, scale: number) {
  const rtl = isRtl(d.text);
  el.dir = d.text ? (rtl ? 'rtl' : 'ltr') : 'auto';
  Object.assign(el.style, {
    textAlign: physicalAlign(d.align, rtl),
    color: d.color,
    fontWeight: d.font === 'default-bold' ? '700' : '400',
    fontSize: d.size * scale + 'px',
  });
}

function startEdit(id: string, view: PageView, api: EditorApi) {
  const op = api.store.get().ops.find((o) => o.id === id);
  if (!op || editing.has(id)) return;
  editing.add(id);
  api.store.select(id);
  const d = dataOf(op);
  const ta = document.createElement('textarea');
  ta.className = 'add-text-editor';
  ta.value = d.text;
  styleBox(ta, d, view.geom.scale);
  ta.dir = 'auto';
  // בתוך האלמנט של הפעולה, כדי שיזוז ויסתובב איתו
  const el = view.overlay.querySelector<HTMLElement>(`.op[data-op-id="${id}"]`);
  if (el) {
    el.querySelector('.add-text-content')?.remove();
    el.querySelector('.widget-bar')?.remove();
    placeFrame(ta, view, op.rect, d.rotate);
    el.appendChild(ta);
  } else {
    const r = rectToView(view.geom, op.rect);
    Object.assign(ta.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    view.overlay.appendChild(ta);
  }
  ta.addEventListener('pointerdown', (e) => e.stopPropagation());
  ta.addEventListener('dblclick', (e) => e.stopPropagation());
  ta.focus();
  ta.select();

  let done = false;
  const commit = (cancel: boolean) => {
    if (done) return;
    done = true;
    editing.delete(id);
    ta.remove();
    const text = cancel ? d.text : ta.value;
    if (!text.trim()) api.store.removeOp(id);
    else if (text !== d.text) api.store.updateOp(id, { data: { text } });
    else {
      // בלי שינוי: מציירים מחדש את התוכן שהוסר מהמסך
      api.store.select(null);
      api.store.select(id);
    }
  };
  ta.addEventListener('blur', () => commit(false));
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ta.blur();
    }
  });
}

function propertiesBar(op: Operation, el: HTMLElement, view: PageView, api: EditorApi) {
  const d = dataOf(op);
  const bar = floatingBar(el, rectToView(view.geom, op.rect));
  const set = (data: Partial<TextData>) => api.store.updateOp(op.id, { data });
  stepper(bar, d.size, { step: 1, min: 6, max: 96 }, (size) => set({ size }));
  swatches(bar, COLORS, d.color, (color) => set({ color }));
  toggleButton(bar, api.t('add-text.bold'), d.font === 'default-bold', () =>
    set({ font: d.font === 'default-bold' ? 'default' : 'default-bold' }),
  );
  segmented(
    bar,
    [
      { value: 'start', label: api.t('add-text.alignStart') },
      { value: 'center', label: api.t('add-text.alignCenter') },
      { value: 'end', label: api.t('add-text.alignEnd') },
    ],
    d.align,
    (align) => set({ align }),
  );
}

/**
 * לחיצה בלי גרירה: תיבה בגודל ברירת מחדל במערכת המסך (כך שהיא ישרה גם בעמוד מסובב).
 * בממשק עברי התיבה נפתחת שמאלה מהנקודה, כי הטקסט מתחיל מימין.
 */
function clickRect(view: PageView, point: Point, size: number): Rect {
  const s = view.geom.scale;
  const v = rectToView(view.geom, { ...point, w: 0, h: 0 });
  const w = 200 * s;
  const h = size * 1.6 * s;
  const rtl = document.documentElement.dir === 'rtl';
  return rectToPdf(view.geom, { x: rtl ? v.x - w : v.x, y: v.y - h / 2, w, h });
}

const tool: Tool = {
  id: 'add-text',
  icon: 'T',
  group: 'insert',
  shortcut: 't',
  locales: { he, en },

  async onPointerDown(p, api) {
    const size = 16;
    const rect = (await dragRect(p, { minSize: 8 })) ?? clickRect(p.view, p.point, size);
    const id = api.store.addOp<TextData>({
      pageId: p.view.page.id,
      type: 'add-text',
      rect,
      data: { text: '', size, color: COLORS[0], font: 'default', align: 'start', rotate: -p.view.page.rotation },
    });
    startEdit(id, p.view, api);
  },

  editOp(op, view, api) {
    startEdit(op.id, view, api);
  },

  renderOp(op, el, view, api) {
    const d = dataOf(op);
    el.classList.add('add-text-op');
    if (editing.has(op.id)) return;
    const box = document.createElement('div');
    box.className = 'add-text-content';
    styleBox(box, d, view.geom.scale);
    placeFrame(box, view, op.rect, d.rotate);
    box.textContent = d.text;
    el.appendChild(box);
    if (api.store.selected === op.id) propertiesBar(op, el, view, api);
  },

  async exportOp(op, ctx) {
    const d = dataOf(op);
    if (!d.text.trim()) return;
    const font = await ctx.font(d.font);
    drawInFrame(ctx.pdfPage, userSpace(ctx.page, op.rect), d.rotate, (r) =>
      drawTextBox(ctx.pdfPage, d.text, r, { font, size: d.size, color: d.color, align: d.align }),
    );
  },
};

export default tool;
