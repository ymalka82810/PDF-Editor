/** עזרים לכלים: גרירת מלבן על עמוד */

import { normRect, rectToPdf, toView } from './coords';
import type { PagePointer } from './registry';
import type { Rect } from './types';

export interface DragOptions {
  /** מחלקת CSS למלבן הזמני */
  className?: string;
  /** גודל מינימלי בפיקסלים; קטן מזה – null (לחיצה בלי גרירה) */
  minSize?: number;
}

/**
 * גרירת מלבן מנקודת הלחיצה. מחזיר את המלבן בנקודות PDF, או null אם לא נגררה מספיק / בוטל (Escape).
 * שימוש: onPointerDown(p, api) { const r = await dragRect(p); if (r) api.store.addOp({...}) }
 */
export function dragRect(p: PagePointer, opts: DragOptions = {}): Promise<Rect | null> {
  const { view, event } = p;
  event.preventDefault();
  const box = view.overlay.getBoundingClientRect();
  const start = toView(view.geom, p.point);
  const ghost = document.createElement('div');
  ghost.className = 'drag-rect ' + (opts.className ?? '');
  view.overlay.appendChild(ghost);
  let cur = start;
  return new Promise((resolve) => {
    const move = (m: PointerEvent) => {
      cur = { x: Math.min(box.width, Math.max(0, m.clientX - box.left)), y: Math.min(box.height, Math.max(0, m.clientY - box.top)) };
      const r = normRect(start, cur);
      Object.assign(ghost.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    };
    const done = (ok: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      ghost.remove();
      const r = normRect(start, cur);
      resolve(ok && r.w >= (opts.minSize ?? 4) && r.h >= (opts.minSize ?? 4) ? rectToPdf(view.geom, r) : null);
    };
    const up = () => done(true);
    const cancel = () => done(false);
    const key = (k: KeyboardEvent) => k.key === 'Escape' && done(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
  });
}
