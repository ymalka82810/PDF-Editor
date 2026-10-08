/**
 * הדגשה (צבע שקוף במצב multiply) וקו חוצה – שני כפתורים, סוג פעולה אחד ('highlight').
 * לחיצה על שורת טקסט: נצמד לשורה (visualLines מ-pdf-read/text.ts). גרירה מעל טקסט: פעולה לכל שורה,
 * חתוכה לרוחב הגרירה – ב-undo אחד. גרירה בלי טקסט (סרוק, ציור): המלבן כמו שהוא.
 */

import { BlendMode } from 'pdf-lib';
import { rectToView, toView, userSpace } from '../../core/coords';
import { dragRect } from '../../core/interaction';
import { uid } from '../../core/model';
import { hexColor } from '../../core/pdf-text';
import type { EditorApi, ExportCtx, PagePointer, PageView, Tool } from '../../core/registry';
import type { Operation, Rect } from '../../core/types';
import { textItemsOf, visualLines } from '../../pdf-read/text';
import { floatingBar, swatches } from '../../ui/widgets/controls';
import he from './locales/he.json';
import en from './locales/en.json';
import './style.css';

export type MarkKind = 'highlight' | 'strike';
export const MARK_OP = 'highlight';

export interface MarkData {
  kind: MarkKind;
  color: string;
}

export const OPACITY = 0.35;
const COLORS: Record<MarkKind, string[]> = {
  highlight: ['#ffe14d', '#7ee08a', '#7cc7ff', '#ff9ec7', '#ffb35c'],
  strike: ['#d64545', '#202a3f', '#2f6fde'],
};
const last: Record<MarkKind, string> = { highlight: COLORS.highlight[0], strike: COLORS.strike[0] };

const dataOf = (op: Operation) => op.data as unknown as MarkData;

/**
 * המלבנים להדגשה: השורות שהגרירה (או הלחיצה) נוגעת בהן, חתוכות לרוחב הגרירה.
 * שורה נחשבת אם לפחות חצי מגובהה בתוך הגרירה, או שהלחיצה בתוכה.
 */
export function snapToLines(lines: Rect[], area: Rect, click: boolean): Rect[] {
  const out: Rect[] = [];
  for (const l of lines) {
    if (click) {
      const inside = area.x >= l.x && area.x <= l.x + l.w && area.y >= l.y && area.y <= l.y + l.h;
      if (inside) return [l];
      continue;
    }
    const overlapY = Math.min(l.y + l.h, area.y + area.h) - Math.max(l.y, area.y);
    const x0 = Math.max(l.x, area.x);
    const x1 = Math.min(l.x + l.w, area.x + area.w);
    if (overlapY >= l.h * 0.5 && x1 - x0 > 1) out.push({ x: x0, y: l.y, w: x1 - x0, h: l.h });
  }
  return out;
}

async function create(kind: MarkKind, p: PagePointer, api: EditorApi) {
  const dragged = await dragRect(p, { minSize: 3, className: 'highlight-ghost' });
  const lines = visualLines(await textItemsOf(api, p.view.page).catch(() => [])).map((l) => l.rect);
  const area = dragged ?? { ...p.point, w: 0, h: 0 };
  let rects = snapToLines(lines, area, !dragged);
  if (!rects.length) {
    if (!dragged) return;
    rects = [dragged];
  }
  const data: MarkData = { kind, color: last[kind] };
  const ops = rects.map((rect) => ({ id: uid('op'), pageId: p.view.page.id, type: MARK_OP, rect, data }));
  // כמה שורות – רשומה אחת בהיסטוריה
  api.store.update((s) => ({ ...s, ops: [...s.ops, ...(ops as unknown as Operation[])] }));
  api.store.select(ops[ops.length - 1].id);
}

function renderMark(op: Operation, el: HTMLElement, view: PageView, api: EditorApi) {
  const d = dataOf(op);
  el.classList.add('highlight-op', 'highlight-' + d.kind);
  if (d.kind === 'highlight') {
    const fill = document.createElement('div');
    fill.className = 'highlight-fill';
    fill.style.background = d.color;
    el.appendChild(fill);
  } else {
    // הקו באמצע הגובה של השורה, בכיוון הטקסט (במערכת של העמוד) – גם בעמוד מסובב
    const ev = rectToView(view.geom, op.rect);
    const a = toView(view.geom, { x: op.rect.x, y: op.rect.y + op.rect.h / 2 });
    const b = toView(view.geom, { x: op.rect.x + op.rect.w, y: op.rect.y + op.rect.h / 2 });
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'highlight-svg');
    const line = document.createElementNS(NS, 'line');
    for (const [k, v] of Object.entries({ x1: a.x - ev.x, y1: a.y - ev.y, x2: b.x - ev.x, y2: b.y - ev.y }))
      line.setAttribute(k, String(v));
    line.setAttribute('stroke', d.color);
    line.setAttribute('stroke-width', String(strikeWidth(op.rect) * view.geom.scale));
    svg.appendChild(line);
    el.appendChild(svg);
  }
  if (api.store.selected === op.id) {
    const bar = floatingBar(el, rectToView(view.geom, op.rect));
    swatches(bar, COLORS[d.kind], d.color, (color) => {
      last[d.kind] = color;
      api.store.updateOp(op.id, { data: { color } });
    });
  }
}

/** עובי הקו החוצה לפי גובה השורה */
export const strikeWidth = (r: Rect) => Math.max(0.75, r.h * 0.07);

export function exportMark(op: Operation, ctx: ExportCtx) {
  const d = dataOf(op);
  const r = userSpace(ctx.page, op.rect);
  if (d.kind === 'highlight') {
    ctx.pdfPage.drawRectangle({
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      color: hexColor(d.color),
      opacity: OPACITY,
      blendMode: BlendMode.Multiply,
      borderWidth: 0,
    });
  } else {
    const y = r.y + r.h / 2;
    ctx.pdfPage.drawLine({
      start: { x: r.x, y },
      end: { x: r.x + r.w, y },
      thickness: strikeWidth(r),
      color: hexColor(d.color),
    });
  }
}

const tools: Tool[] = (['highlight', 'strike'] as const).map((kind, i) => ({
  id: kind,
  icon: ['🖍', 'S̶'][i],
  group: 'edit',
  shortcut: ['h', 'k'][i],
  opTypes: i === 0 ? [MARK_OP] : [],
  locales: {
    he: (he as Record<string, Record<string, string>>)[kind],
    en: (en as Record<string, Record<string, string>>)[kind],
  },
  onPointerDown: (p: PagePointer, api: EditorApi) => void create(kind, p, api),
  ...(i === 0 ? { renderOp: renderMark, exportOp: exportMark } : {}),
}));

export default tools;
