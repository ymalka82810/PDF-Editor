/**
 * כלי דוגמה – מלבן צבעוני. מדגים את כל החוזה של כלי מקצה לקצה:
 * כפתור בסרגל, גרירה על העמוד (dragRect), תצוגה (renderOp), עריכה בלחיצה כפולה (editOp) וייצוא (exportOp).
 * כלי חדש: מעתיקים את התיקייה, משנים id וסוג – והוא נטען לבד.
 */

import { userSpace } from '../../core/coords';
import { dragRect } from '../../core/interaction';
import { hexColor } from '../../core/pdf-text';
import type { Tool } from '../../core/registry';
import he from './locales/he.json';
import en from './locales/en.json';

interface RectData {
  color: string;
}

const COLORS = ['#2f6fde', '#d64545', '#2d9b5a', '#e0a020'];

const tool: Tool = {
  id: 'example-rect',
  icon: '▭',
  group: 'insert',
  shortcut: 'r',
  locales: { he, en },

  async onPointerDown(p, api) {
    const rect = await dragRect(p);
    if (!rect) return;
    const id = api.store.addOp<RectData>({ pageId: p.view.page.id, type: 'example-rect', rect, data: { color: COLORS[0] } });
    api.store.select(id);
  },

  renderOp(op, el) {
    const { color } = op.data as unknown as RectData;
    el.style.border = `2px solid ${color}`;
  },

  /** לחיצה כפולה – הצבע הבא */
  editOp(op, _view, api) {
    const { color } = op.data as unknown as RectData;
    api.store.updateOp(op.id, { data: { color: COLORS[(COLORS.indexOf(color) + 1) % COLORS.length] } });
  },

  exportOp(op, ctx) {
    const r = userSpace(ctx.page, op.rect);
    ctx.pdfPage.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: hexColor((op.data as unknown as RectData).color), borderWidth: 1.5 });
  },
};

export default tool;
