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

/** ידית של שינוי גודל. n – למעלה, e – ימינה */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** כיוון האות על המסך ← הכיוון בעמוד, לפי סיבוב התצוגה (עם כיוון השעון) */
const TURN: Record<Rotation, Record<string, string>> = {
  0: { n: 'n', e: 'e', s: 's', w: 'w' },
  90: { n: 'w', e: 'n', s: 'e', w: 's' },
  180: { n: 's', e: 'w', s: 'n', w: 'e' },
  270: { n: 'e', e: 's', s: 'w', w: 'n' },
};

/**
 * ידית על המסך ← אותה ידית במערכת של העמוד (n = הצד העליון ב-PDF, y גדול; e = x גדול).
 * כך כלי שמחשב מלבן (constrainRect) לא צריך לדעת על סיבוב.
 */
export function pdfHandle(handle: Handle, rotation: Rotation): Handle {
  const letters = [...handle].map((c) => TURN[rotation][c]);
  const v = letters.find((c) => c === 'n' || c === 's') ?? '';
  const h = letters.find((c) => c === 'e' || c === 'w') ?? '';
  return (v + h) as Handle;
}

/**
 * מלבן ביחס רוחב/גובה ratio, כשהצד שמול הידית נשאר במקום (בידית אמצעית – גם המרכז של הצד השני).
 * בפינה: לפי הכיוון שבו הגרירה גדולה יותר. handle – במערכת של העמוד (pdfHandle).
 */
export function fitAspect(rect: Rect, handle: Handle, ratio: number): Rect {
  const corner = handle.length === 2;
  let w = rect.w;
  let h = rect.h;
  if (corner) {
    if (w / ratio >= h) h = w / ratio;
    else w = h * ratio;
  } else if (handle === 'e' || handle === 'w') h = w / ratio;
  else w = h * ratio;
  const x = handle.includes('e') ? rect.x : handle.includes('w') ? rect.x + rect.w - w : rect.x + (rect.w - w) / 2;
  const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.h - h : rect.y + (rect.h - h) / 2;
  return { x, y, w, h };
}
