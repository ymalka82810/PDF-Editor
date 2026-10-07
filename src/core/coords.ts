/**
 * המרה בין נקודות PDF (ראשית למטה-שמאל, לפני סיבוב) לפיקסלים על המסך (ראשית למעלה-שמאל, אחרי סיבוב וזום).
 * זה המקום היחיד שמכיר את הסיבוב – כלים לא מחשבים סיבוב בעצמם.
 */

import type { Point, Rect, Rotation } from './types';

/** תצוגה של עמוד: הגודל המקורי, הסיבוב והזום (פיקסלים לנקודה) */
export interface ViewGeom {
  width: number;
  height: number;
  rotation: Rotation;
  scale: number;
}

/** גודל העמוד על המסך בפיקסלים */
export function viewSize(g: ViewGeom) {
  const swap = g.rotation === 90 || g.rotation === 270;
  return { w: (swap ? g.height : g.width) * g.scale, h: (swap ? g.width : g.height) * g.scale };
}

/** נקודת PDF ← פיקסל במסך */
export function toView(g: ViewGeom, p: Point): Point {
  const { width: W, height: H, scale: s } = g;
  switch (g.rotation) {
    case 0:
      return { x: p.x * s, y: (H - p.y) * s };
    case 90:
      return { x: p.y * s, y: p.x * s };
    case 180:
      return { x: (W - p.x) * s, y: p.y * s };
    case 270:
      return { x: (H - p.y) * s, y: (W - p.x) * s };
  }
}

/** פיקסל במסך ← נקודת PDF */
export function toPdf(g: ViewGeom, v: Point): Point {
  const { width: W, height: H, scale: s } = g;
  const x = v.x / s,
    y = v.y / s;
  switch (g.rotation) {
    case 0:
      return { x, y: H - y };
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: W - x, y };
    case 270:
      return { x: W - y, y: H - x };
  }
}

/** מלבן PDF ← מלבן במסך ({x,y} למעלה-שמאל) */
export function rectToView(g: ViewGeom, r: Rect): Rect {
  return normRect(toView(g, { x: r.x, y: r.y }), toView(g, { x: r.x + r.w, y: r.y + r.h }));
}

/** מלבן במסך ← מלבן PDF */
export function rectToPdf(g: ViewGeom, r: Rect): Rect {
  return normRect(toPdf(g, { x: r.x, y: r.y }), toPdf(g, { x: r.x + r.w, y: r.y + r.h }));
}

/** מלבן משתי פינות כלשהן */
export function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** מלבן מהמודל ← מלבן במערכת הקואורדינטות של pdf-lib לעמוד (מוסיף את origin) */
export function userSpace(page: { origin: Point }, r: Rect): Rect {
  return { x: r.x + page.origin.x, y: r.y + page.origin.y, w: r.w, h: r.h };
}
