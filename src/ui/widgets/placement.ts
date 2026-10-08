/** מיקום תוכן חדש: העמוד שהמשתמש רואה עכשיו, ומלבן במרכזו – ישר על המסך גם בעמוד מסובב */

import { rectToPdf, viewSize } from '../../core/coords';
import type { EditorApi, PageView } from '../../core/registry';
import type { Rect } from '../../core/types';

/** העמוד שהכי קרוב למרכז החלון */
export function currentView(api: EditorApi): PageView | undefined {
  const views = api.views();
  const mid = window.innerHeight / 2;
  let best: PageView | undefined;
  let dist = Infinity;
  for (const v of views) {
    const r = v.el.getBoundingClientRect();
    const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (d < dist) {
      dist = d;
      best = v;
    }
  }
  return best;
}

/**
 * מלבן בנקודות PDF במרכז העמוד, שעל המסך רוחבו w וגובהו h נקודות (כלומר לפני הסיבוב של העמוד – בכיוון שהמשתמש רואה).
 * גדול מדי – מוקטן באותו יחס לחצי מהעמוד.
 */
export function centeredRect(view: PageView, w: number, h: number): Rect {
  const s = view.geom.scale;
  const page = viewSize({ ...view.geom, scale: 1 });
  const k = Math.min(1, (page.w * 0.6) / w, (page.h * 0.6) / h);
  const vw = w * k * s;
  const vh = h * k * s;
  const full = viewSize(view.geom);
  return rectToPdf(view.geom, { x: (full.w - vw) / 2, y: (full.h - vh) / 2, w: vw, h: vh });
}
