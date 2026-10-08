/**
 * תיבת טקסט חדשה: גרירה או לחיצה ליצירה, עריכה במקום (textarea), ופס מאפיינים צף (גודל/צבע/מודגש/יישור).
 * סיבוב: data.rotate שמור בכיוון עם-השעון (כמו CSS rotate) – הפוך ל-pdf-lib (נגד-השעון) בייצוא.
 */

import { concatTransformationMatrix, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import { rectToView, userSpace } from '../../core/coords';
import { dragRect } from '../../core/interaction';
import { isRtl, type BoxStyle, drawTextBox } from '../../core/pdf-text';
import type { Tool } from '../../core/registry';
import type { EditorApi, PageView } from '../../core/registry';
import { floatingBar, segmented, stepper, swatches, toggleButton } from '../../ui/widgets/controls';
import './style.css';
import he from './locales/he.json';
import en from './locales/en.json';

export interface TextData {
  text: string;
  size: number;
  color: string;
  font: 'default' | 'default-bold';
  align: 'start' | 'end' | 'center';
  /** זווית פיצוי לסיבוב העמוד, במעלות עם כיוון השעון (כמו CSS); 0 – עמוד לא מסובב */
  rotate?: number;
}

const COLORS = ['#202a3f', '#a33a3a', '#1e3a63', '#2d9b5a', '#ab7f2e'];
const editing = new Set<string>();

const data = (op: { data: unknown }) => op.data as TextData;

function startEdit(id: string, view: PageView, api: EditorApi) {
  if (editing.has(id)) return;
  const op = api.store.get().ops.find((o) => o.id === id);
  if (!op) return;
  editing.add(id);
  api.store.select(id);
  const original = data(op).text;
  const ta = document.createElement('textarea');
  ta.className = 'add-text-editor';
  ta.value = original;
  ta.dir = 'auto';
  const place = () => {
    const r = rectToView(view.geom, op.rect);
    Object.assign(ta.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', fontSize: data(op).size * view.geom.scale + 'px' });
  };
  place();
  view.overlay.appendChild(ta);
  ta.focus();
  ta.select();

  const commit = (cancel: boolean) => {
    if (!editing.has(id)) return;
    editing.delete(id);
    ta.remove();
    const text = (cancel ? original : ta.value).trim() ? (cancel ? original : ta.value) : '';
    if (!text) api.store.removeOp(id);
    else api.store.updateOp(id, { data: { text } });
  };
  ta.addEventListener('blur', () => commit(false));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ta.blur();
    }
  });
}

function physicalAlign(align: TextData['align'], rtl: boolean): 'left' | 'right' | 'center' {
  if (align === 'center') return 'center';
  if (align === 'start') return rtl ? 'right' : 'left';
  return rtl ? 'left' : 'right';
}

const tool: Tool = {
  id: 'add-text',
  icon: 'T',
  group: 'insert',
  shortcut: 't',
  locales: { he, en },

  async onPointerDown(p, api) {
    const dragged = await dragRect(p, { minSize: 8 });
    const rect = dragged ?? { x: p.point.x, y: p.point.y - 24, w: 180, h: 28 };
    const id = api.store.addOp<TextData>({
      pageId: p.view.page.id,
      type: 'add-text',
      rect,
      data: { text: '', size: 16, color: '#202a3f', font: 'default', align: 'start', rotate: -p.view.page.rotation },
    });
    startEdit(id, p.view, api);
  },

  editOp(op, view, api) {
    startEdit(op.id, view, api);
  },

  renderOp(op, el, view, api) {
    const d = data(op);
    el.classList.add('add-text-op');
    if (!editing.has(op.id)) {
      const box = document.createElement('div');
      box.className = 'add-text-content';
      const rtl = isRtl(d.text);
      box.dir = rtl ? 'rtl' : 'ltr';
      box.style.textAlign = physicalAlign(d.align, rtl);
      box.style.color = d.color;
      box.style.fontWeight = d.font === 'default-bold' ? '700' : '400';
      box.style.fontSize = d.size * view.geom.scale + 'px';
      box.textContent = d.text;
      if (d.rotate) {
        box.style.width = op.rect.w * view.geom.scale + 'px';
        box.style.height = op.rect.h * view.geom.scale + 'px';
        box.style.left = '50%';
        box.style.top = '50%';
        box.style.transform = `translate(-50%, -50%) rotate(${d.rotate}deg)`;
      }
      el.appendChild(box);
    }
    if (api.store.selected === op.id && !editing.has(op.id)) {
      const bar = floatingBar(el, rectToView(view.geom, op.rect));
      stepper(bar, d.size, { step: 1, min: 6, max: 96 }, (n) => api.store.updateOp(op.id, { data: { size: n } }));
      swatches(bar, COLORS, d.color, (c) => api.store.updateOp(op.id, { data: { color: c } }));
      toggleButton(bar, api.t('add-text.bold'), d.font === 'default-bold', () =>
        api.store.updateOp(op.id, { data: { font: d.font === 'default-bold' ? 'default' : 'default-bold' } }),
      );
      segmented(
        bar,
        [
          { value: 'start', label: api.t('add-text.alignStart') },
          { value: 'center', label: api.t('add-text.alignCenter') },
          { value: 'end', label: api.t('add-text.alignEnd') },
        ],
        d.align,
        (v) => api.store.updateOp(op.id, { data: { align: v } }),
      );
    }
  },

  async exportOp(op, ctx) {
    const d = data(op);
    if (!d.text) return;
    const r = userSpace(ctx.page, op.rect);
    const font = await ctx.font(d.font);
    const style: BoxStyle = { font, size: d.size, color: d.color, align: d.align };
    const rotate = d.rotate ?? 0;
    if (rotate) {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rad = (-rotate * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      ctx.pdfPage.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(1, 0, 0, 1, cx, cy),
        concatTransformationMatrix(cos, sin, -sin, cos, 0, 0),
        concatTransformationMatrix(1, 0, 0, 1, -cx, -cy),
      );
    }
    drawTextBox(ctx.pdfPage, d.text, r, style);
    if (rotate) ctx.pdfPage.pushOperators(popGraphicsState());
  },
};

export default tool;
