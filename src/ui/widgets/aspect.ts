/** Shift בשינוי גודל: שומר על היחס של המלבן כפי שהיה בתחילת הגרירה (צורות, ציור) */

import { fitAspect, type Handle } from '../../core/coords';
import type { Operation, Rect } from '../../core/types';

export function shiftKeepsRatio(op: Operation, rect: Rect, handle: Handle, shift: boolean): Rect {
  if (!shift || !op.rect.w || !op.rect.h) return rect;
  return fitAspect(rect, handle, op.rect.w / op.rect.h);
}
