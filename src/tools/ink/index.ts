/**
 * ציור חופשי: עכבר, מגע ועט (pointer events). כל משיכה היא פעולה נפרדת.
 * הנקודות נשמרות יחסית ל-rect (0..1, y מלמטה), כך ששינוי גודל מותח את הציור. דילול (Douglas-Peucker)
 * והחלקה: עקומות ריבועיות דרך אמצעי הקטעים – אותו מסלול על המסך ובייצוא.
 */

import { LineCapStyle } from 'pdf-lib';
import { rectToView, toPdf, toView, userSpace } from '../../core/coords';
import { hexColor } from '../../core/pdf-text';
import type { EditorApi, ExportCtx, PagePointer, PageView, Tool } from '../../core/registry';
import type { Operation, Point, Rect } from '../../core/types';
import { floatingBar, stepper, swatches } from '../../ui/widgets/controls';
import he from './locales/he.json';
import en from './locales/en.json';
import './style.css';

export const INK_OP = 'ink';

export interface InkData {
  /** הנקודות יחסית ל-rect: [x משמאל, y מלמטה], 0..1 */
  points: [number, number][];
  color: string;
  /** עובי בנקודות */
  width: number;
}

export const COLORS = ['#1e3a63', '#000000', '#d64545', '#2d9b5a', '#2f6fde'];
const last = { color: COLORS[0], width: 2 };

const dataOf = (op: Operation) => op.data as unknown as InkData;

/** דילול: Douglas-Peucker בסבלנות tol */
export function simplify(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a];
    const B = pts[b];
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let max = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((B.x - A.x) * (A.y - pts[i].y) - (A.x - pts[i].x) * (B.y - A.y)) / len;
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (max > tol && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** מסלול SVG מוחלק: קו לאמצע הקטע הראשון, ועקומות ריבועיות דרך כל נקודה לאמצע הקטע הבא */
export function smoothPath(pts: Point[], fmt = (n: number) => +n.toFixed(2)): string {
  const p = (q: Point) => `${fmt(q.x)} ${fmt(q.y)}`;
  if (pts.length === 1) return `M ${p(pts[0])} L ${p(pts[0])}`;
  if (pts.length === 2) return `M ${p(pts[0])} L ${p(pts[1])}`;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M ${p(pts[0])} L ${p(mid(pts[0], pts[1]))}`;
  for (let i = 1; i < pts.length - 1; i++) d += ` Q ${p(pts[i])} ${p(mid(pts[i], pts[i + 1]))}`;
  return d + ` L ${p(pts[pts.length - 1])}`;
}

/** נקודות ב-PDF ← rect (עם שוליים לעובי הקו) ונקודות יחסיות */
export function toStroke(pts: Point[], width: number): { rect: Rect; points: [number, number][] } {
  const pad = width / 2 + 1;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const rect = { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
  return { rect, points: pts.map((q) => [(q.x - rect.x) / rect.w, (q.y - rect.y) / rect.h]) };
}

/** הנקודות של פעולה ב-PDF, לפי ה-rect הנוכחי שלה */
export const absolute = (d: InkData, r: Rect): Point[] =>
  d.points.map(([u, v]) => ({ x: r.x + u * r.w, y: r.y + v * r.h }));

/** משיכה אחת. מגע שני (צביטה לזום) מבטל אותה */
function draw(p: PagePointer, api: EditorApi) {
  const { view, event } = p;
  event.preventDefault();
  const id = event.pointerId;
  const box = view.overlay.getBoundingClientRect();
  const s = view.geom.scale;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ink-live');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('stroke', last.color);
  path.setAttribute('stroke-width', String(last.width * s));
  svg.appendChild(path);
  view.overlay.appendChild(svg);
  const pts: Point[] = [{ x: event.clientX - box.left, y: event.clientY - box.top }];
  const redraw = () => path.setAttribute('d', smoothPath(pts));
  redraw();

  const move = (m: PointerEvent) => {
    if (m.pointerId !== id) return;
    // אירועים שהדפדפן איחד (עט מהיר) – כולם
    for (const e of m.getCoalescedEvents?.() ?? [m]) pts.push({ x: e.clientX - box.left, y: e.clientY - box.top });
    redraw();
  };
  const finish = (ok: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('pointerdown', second, true);
    svg.remove();
    if (!ok || pts.length < 2) return;
    const pdf = simplify(
      pts.map((q) => toPdf(view.geom, q)),
      0.4,
    );
    const { rect, points } = toStroke(pdf, last.width);
    api.store.addOp<InkData>({
      pageId: view.page.id,
      type: INK_OP,
      rect,
      data: { points, color: last.color, width: last.width },
    });
  };
  const up = (e: PointerEvent) => e.pointerId === id && finish(true);
  const cancel = (e: PointerEvent) => e.pointerId === id && finish(false);
  const second = (e: PointerEvent) => e.pointerId !== id && finish(false);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('pointerdown', second, true);
}

function renderInk(op: Operation, el: HTMLElement, view: PageView, api: EditorApi) {
  const d = dataOf(op);
  const ev = rectToView(view.geom, op.rect);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ink-svg');
  const path = document.createElementNS(NS, 'path');
  const local = absolute(d, op.rect).map((q) => {
    const v = toView(view.geom, q);
    return { x: v.x - ev.x, y: v.y - ev.y };
  });
  path.setAttribute('d', smoothPath(local));
  path.setAttribute('stroke', d.color);
  path.setAttribute('stroke-width', String(d.width * view.geom.scale));
  svg.appendChild(path);
  el.classList.add('ink-op');
  el.appendChild(svg);
  if (api.store.selected === op.id) {
    const bar = floatingBar(el, ev);
    swatches(bar, COLORS, d.color, (color) => {
      last.color = color;
      api.store.updateOp(op.id, { data: { color } });
    });
    stepper(bar, d.width, { step: 0.5, min: 0.5, max: 20 }, (width) => {
      last.width = width;
      api.store.updateOp(op.id, { data: { width } });
    });
  }
}

export function exportInk(op: Operation, ctx: ExportCtx) {
  const d = dataOf(op);
  const r = userSpace(ctx.page, op.rect);
  // drawSvgPath הופך את y (ב-SVG למטה) – לכן -y וממקמים ב-0,0
  const path = smoothPath(absolute(d, r).map((q) => ({ x: q.x, y: -q.y })));
  ctx.pdfPage.drawSvgPath(path, {
    x: 0,
    y: 0,
    borderColor: hexColor(d.color),
    borderWidth: d.width,
    borderLineCap: LineCapStyle.Round,
  });
}

const tool: Tool = {
  id: 'ink',
  icon: '✍',
  group: 'insert',
  shortcut: 'p',
  opTypes: [INK_OP],
  locales: { he, en },
  onPointerDown: draw,
  renderOp: renderInk,
  exportOp: exportInk,
};

export default tool;
