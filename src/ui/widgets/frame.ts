/**
 * תוכן שצריך להיראות ישר למשתמש גם בעמוד מסובב (טקסט, תמונה, חתימה).
 * data.rotate – זווית ה"מסגרת" של התוכן ביחס ל-PDF, במעלות עם כיוון השעון (כמו CSS ו-/Rotate של PDF).
 * ביצירה: rotate = -page.rotation, כך שעל המסך הוא ישר. אם העמוד מסובב אחר כך – התוכן מסתובב איתו, כמו דף נייר.
 * op.rect נשאר תמיד במערכת של העמוד (לפני סיבוב), כמו כל פעולה.
 */

import { concatTransformationMatrix, popGraphicsState, pushGraphicsState, type PDFPage } from 'pdf-lib';
import type { PageView } from '../../core/registry';
import type { Rect } from '../../core/types';

const norm = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

/** הרוחב והגובה של המסגרת (בכיוון שלה) למלבן בעמוד */
export function frameSize(rect: Rect, rotate = 0) {
  const swap = norm(rotate) % 180 !== 0;
  return swap ? { w: rect.h, h: rect.w } : { w: rect.w, h: rect.h };
}

/**
 * ממקם את child (absolute) בתוך האלמנט של הפעולה – שממוקם כבר לפי rectToView(op.rect) – כך שהוא בגודל המסגרת
 * ומסובב בזווית שבה המסגרת נראית על המסך.
 */
export function placeFrame(child: HTMLElement, view: PageView, rect: Rect, rotate = 0) {
  const s = view.geom.scale;
  const { w, h } = frameSize(rect, rotate);
  const onScreen = norm(view.geom.rotation + rotate);
  Object.assign(child.style, {
    position: 'absolute',
    width: w * s + 'px',
    height: h * s + 'px',
    left: '50%',
    top: '50%',
    transform: `translate(-50%, -50%)${onScreen ? ` rotate(${onScreen}deg)` : ''}`,
  });
}

/**
 * ציור בתוך המסגרת: draw מקבל מלבן במערכת של המסגרת (userSpace, ללא סיבוב), והציור מסובב סביב מרכז r.
 * r – המלבן של הפעולה ב-userSpace.
 */
export function drawInFrame(page: PDFPage, r: Rect, rotate: number | undefined, draw: (inner: Rect) => void) {
  const a = norm(-(rotate ?? 0)); // pdf-lib: נגד כיוון השעון
  if (!a) return draw(r);
  const { w, h } = frameSize(r, a);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rad = (a * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy),
  );
  draw({ x: cx - w / 2, y: cy - h / 2, w, h });
  page.pushOperators(popGraphicsState());
}
