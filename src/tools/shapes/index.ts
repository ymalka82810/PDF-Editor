/**
 * צורות: מלבן, אליפסה, קו וחץ – ארבעה כפתורים, סוג פעולה אחד ('shape').
 * מלבן ואליפסה: גרירת מלבן. קו וחץ: גרירה מנקודה לנקודה; הקצוות נשמרים יחסית ל-rect (from/to ב-0..1),
 * כך שהזזה ושינוי גודל בשכבה הכללית ממשיכים לעבוד. הקו בתוך המלבן (לא חורג ממנו) גם בתצוגה וגם בייצוא.
 */

import { LineCapStyle } from 'pdf-lib';
import { normRect, rectToView, toPdf, toView, userSpace } from '../../core/coords';
import { dragRect } from '../../core/interaction';
import { hexColor } from '../../core/pdf-text';
import type { EditorApi, PagePointer, PageView, Tool } from '../../core/registry';
import type { Operation, Point, Rect } from '../../core/types';
import { shiftKeepsRatio } from '../../ui/widgets/aspect';
import { floatingBar, stepper, swatches, toggleButton } from '../../ui/widgets/controls';
import he from './locales/he.json';
import en from './locales/en.json';
import './style.css';

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';
export const SHAPE_OP = 'shape';

export interface ShapeData {
  kind: ShapeKind;
  stroke: string;
  /** מילוי (רק מלבן ואליפסה). בלי – שקוף */
  fill?: string;
  /** עובי הקו בנקודות */
  width: number;
  /** קו וחץ: הקצוות יחסית ל-rect – x משמאל, y מלמטה, 0..1 */
  from?: [number, number];
  to?: [number, number];
}

export const COLORS = ['#d64545', '#2f6fde', '#2d9b5a', '#e0a020', '#202a3f', '#000000'];
/** הצבע והעובי האחרונים – הצורה הבאה מקבלת אותם */
const last = { stroke: COLORS[0], width: 2 };

const dataOf = (op: Operation) => op.data as unknown as ShapeData;

/** הקצוות של קו או חץ בנקודות PDF (לפי rect) */
export function endpoints(d: ShapeData, r: Rect): [Point, Point] {
  const at = (q: [number, number] | undefined, def: [number, number]) => ({
    x: r.x + (q ?? def)[0] * r.w,
    y: r.y + (q ?? def)[1] * r.h,
  });
  return [at(d.from, [0, 0.5]), at(d.to, [1, 0.5])];
}

/** ראש החץ: הקצה, ושתי הפינות של המשולש. עובד בכל מערכת צירים */
export function arrowHead(from: Point, to: Point, len: number): [Point, Point, Point] {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  const p = (ang: number) => ({ x: to.x - len * Math.cos(ang), y: to.y - len * Math.sin(ang) });
  return [to, p(a - spread), p(a + spread)];
}

export const headLength = (width: number) => Math.max(6, width * 3.5);

/** גוון בהיר של צבע (למילוי) */
export function tint(hex: string, amount = 0.75) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return '#ffffff';
  const c = m.slice(1).map((h) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * amount));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/* ---------- יצירה ---------- */

/** גרירה מנקודה לנקודה (לקו ולחץ), עם תצוגה מקדימה. מחזיר את שתי הנקודות ב-PDF, או null */
function dragLine(p: PagePointer): Promise<[Point, Point] | null> {
  const { view, event } = p;
  event.preventDefault();
  const box = view.overlay.getBoundingClientRect();
  const start = toView(view.geom, p.point);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'shapes-ghost');
  const line = document.createElementNS(svg.namespaceURI, 'line');
  line.setAttribute('x1', String(start.x));
  line.setAttribute('y1', String(start.y));
  line.setAttribute('x2', String(start.x));
  line.setAttribute('y2', String(start.y));
  svg.appendChild(line);
  view.overlay.appendChild(svg);
  let end = start;
  return new Promise((resolve) => {
    const move = (m: PointerEvent) => {
      end = { x: m.clientX - box.left, y: m.clientY - box.top };
      line.setAttribute('x2', String(end.x));
      line.setAttribute('y2', String(end.y));
    };
    const done = (ok: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      svg.remove();
      const long = Math.hypot(end.x - start.x, end.y - start.y) >= 6;
      resolve(ok && long ? [toPdf(view.geom, start), toPdf(view.geom, end)] : null);
    };
    const up = () => done(true);
    const cancel = () => done(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });
}

/** קו: מלבן סביב שתי הנקודות (לפחות 8 נקודות בכל כיוון, כדי שיהיה אפשר לתפוס אותו) והקצוות היחסיים */
export function lineRect(a: Point, b: Point, min = 8): { rect: Rect; from: [number, number]; to: [number, number] } {
  let r = normRect(a, b);
  if (r.w < min) r = { ...r, x: r.x - (min - r.w) / 2, w: min };
  if (r.h < min) r = { ...r, y: r.y - (min - r.h) / 2, h: min };
  const rel = (p: Point): [number, number] => [(p.x - r.x) / r.w, (p.y - r.y) / r.h];
  return { rect: r, from: rel(a), to: rel(b) };
}

async function create(kind: ShapeKind, p: PagePointer, api: EditorApi) {
  const base = { kind, stroke: last.stroke, width: last.width };
  let rect: Rect;
  let data: ShapeData;
  if (kind === 'line' || kind === 'arrow') {
    const pts = await dragLine(p);
    if (!pts) return;
    const l = lineRect(pts[0], pts[1]);
    rect = l.rect;
    data = { ...base, from: l.from, to: l.to };
  } else {
    const r = await dragRect(p, { minSize: 4 });
    if (!r) return;
    rect = r;
    data = base;
  }
  const id = api.store.addOp<ShapeData>({ pageId: p.view.page.id, type: SHAPE_OP, rect, data });
  api.store.select(id);
}

/* ---------- תצוגה ---------- */

const NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function renderShape(op: Operation, el: HTMLElement, view: PageView, api: EditorApi) {
  const d = dataOf(op);
  const s = view.geom.scale;
  const ev = rectToView(view.geom, op.rect);
  const sw = d.width * s;
  const svg = svgEl('svg', { class: 'shapes-svg', width: ev.w, height: ev.h, viewBox: `0 0 ${ev.w} ${ev.h}` });
  const local = (q: Point) => {
    const v = toView(view.geom, q);
    return { x: v.x - ev.x, y: v.y - ev.y };
  };
  const paint = { stroke: d.stroke, 'stroke-width': sw, fill: d.fill || 'none' };
  if (d.kind === 'rect') {
    svg.appendChild(
      svgEl('rect', { x: sw / 2, y: sw / 2, width: Math.max(0, ev.w - sw), height: Math.max(0, ev.h - sw), ...paint }),
    );
  } else if (d.kind === 'ellipse') {
    svg.appendChild(
      svgEl('ellipse', {
        cx: ev.w / 2,
        cy: ev.h / 2,
        rx: Math.max(0, ev.w / 2 - sw / 2),
        ry: Math.max(0, ev.h / 2 - sw / 2),
        ...paint,
      }),
    );
  } else {
    const [a, b] = endpoints(d, op.rect).map(local);
    let end = b;
    if (d.kind === 'arrow') {
      const head = arrowHead(a, b, headLength(d.width) * s);
      // הקו נגמר בבסיס הראש, כדי שהקצה יהיה חד
      end = { x: (head[1].x + head[2].x) / 2, y: (head[1].y + head[2].y) / 2 };
      svg.appendChild(svgEl('polygon', { points: head.map((q) => `${q.x},${q.y}`).join(' '), fill: d.stroke }));
    }
    svg.appendChild(
      svgEl('line', {
        x1: a.x,
        y1: a.y,
        x2: end.x,
        y2: end.y,
        stroke: d.stroke,
        'stroke-width': sw,
        'stroke-linecap': 'round',
      }),
    );
  }
  el.classList.add('shapes-op');
  el.appendChild(svg);
  if (api.store.selected === op.id) propertiesBar(op, el, view, api);
}

function propertiesBar(op: Operation, el: HTMLElement, view: PageView, api: EditorApi) {
  const d = dataOf(op);
  const bar = floatingBar(el, rectToView(view.geom, op.rect));
  const set = (patch: Partial<ShapeData>) => {
    if (patch.stroke) last.stroke = patch.stroke;
    if (patch.width) last.width = patch.width;
    // מילוי עוקב אחרי צבע הקו
    if (patch.stroke && d.fill) patch.fill = tint(patch.stroke);
    api.store.updateOp(op.id, { data: patch });
  };
  swatches(bar, COLORS, d.stroke, (stroke) => set({ stroke }));
  stepper(bar, d.width, { step: 0.5, min: 0.5, max: 20 }, (width) => set({ width }));
  if (d.kind === 'rect' || d.kind === 'ellipse')
    toggleButton(bar, api.t('shape-rect.fill'), !!d.fill, () => {
      // updateOp ממזג data – לכן "בלי מילוי" נכתב כמחרוזת ריקה ולא כ-undefined
      api.store.updateOp(op.id, { data: { fill: d.fill ? '' : tint(d.stroke) } });
    });
}

/* ---------- ייצוא ---------- */

export function exportShape(op: Operation, ctx: Parameters<NonNullable<Tool['exportOp']>>[1]) {
  const d = dataOf(op);
  const r = userSpace(ctx.page, op.rect);
  const page = ctx.pdfPage;
  const stroke = hexColor(d.stroke);
  const fill = d.fill ? hexColor(d.fill) : undefined;
  const bw = d.width;
  if (d.kind === 'rect') {
    page.drawRectangle({
      x: r.x + bw / 2,
      y: r.y + bw / 2,
      width: Math.max(0, r.w - bw),
      height: Math.max(0, r.h - bw),
      borderColor: stroke,
      borderWidth: bw,
      color: fill,
    });
  } else if (d.kind === 'ellipse') {
    page.drawEllipse({
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      xScale: Math.max(0, r.w / 2 - bw / 2),
      yScale: Math.max(0, r.h / 2 - bw / 2),
      borderColor: stroke,
      borderWidth: bw,
      color: fill,
    });
  } else {
    const [a, b] = endpoints(d, r);
    let end = b;
    if (d.kind === 'arrow') {
      const head = arrowHead(a, b, headLength(bw));
      end = { x: (head[1].x + head[2].x) / 2, y: (head[1].y + head[2].y) / 2 };
      // drawSvgPath הופך את y (SVG – למטה); לכן מעבירים -y וממקמים ב-0,0
      const path = 'M ' + head.map((q) => `${q.x} ${-q.y}`).join(' L ') + ' Z';
      page.drawSvgPath(path, { x: 0, y: 0, color: stroke, borderWidth: 0 });
    }
    page.drawLine({ start: a, end, thickness: bw, color: stroke, lineCap: LineCapStyle.Round });
  }
}

/* ---------- הכלים ---------- */

const tools: Tool[] = (['rect', 'ellipse', 'line', 'arrow'] as const).map((kind, i) => ({
  id: 'shape-' + kind,
  icon: ['▭', '◯', '╱', '➚'][i],
  group: 'insert',
  shortcut: ['b', 'o', 'l', 'a'][i],
  // הכלי הראשון מצייר ומייצא את כל הצורות
  opTypes: i === 0 ? [SHAPE_OP] : [],
  locales: {
    he: (he as Record<string, Record<string, string>>)[kind],
    en: (en as Record<string, Record<string, string>>)[kind],
  },
  onPointerDown: (p: PagePointer, api: EditorApi) => void create(kind, p, api),
  ...(i === 0 ? { renderOp: renderShape, exportOp: exportShape, constrainRect: shiftKeepsRatio } : {}),
}));

export default tools;
