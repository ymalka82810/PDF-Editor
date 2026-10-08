import { describe, expect, it } from 'vitest';
import { fitAspect, pdfHandle, toPdf, type Handle, type ViewGeom } from '../../src/core/coords';
import type { Operation, Rotation } from '../../src/core/types';
import { shiftKeepsRatio } from '../../src/ui/widgets/aspect';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

describe('pdfHandle', () => {
  it.each(ROTATIONS)('matches the real direction on a page rotated %i', (rotation) => {
    const g: ViewGeom = { width: 600, height: 800, rotation, scale: 1.5 };
    const c = { x: 300, y: 300 };
    for (const h of HANDLES) {
      // הכיוון של הידית על המסך (y למטה), דרך toPdf
      const v = {
        x: (h.includes('e') ? 10 : h.includes('w') ? -10 : 0) + c.x,
        y: (h.includes('s') ? 10 : h.includes('n') ? -10 : 0) + c.y,
      };
      const a = toPdf(g, c);
      const b = toPdf(g, v);
      const dx = Math.round(b.x - a.x);
      const dy = Math.round(b.y - a.y);
      const want = (dy > 0 ? 'n' : dy < 0 ? 's' : '') + (dx > 0 ? 'e' : dx < 0 ? 'w' : '');
      expect(pdfHandle(h, rotation), `${h} @ ${rotation}`).toBe(want);
    }
  });
});

describe('fitAspect', () => {
  const r = { x: 100, y: 100, w: 300, h: 100 };

  it('corner ne: the bottom-left corner stays, the larger direction wins', () => {
    expect(fitAspect(r, 'ne', 2)).toEqual({ x: 100, y: 100, w: 300, h: 150 });
    expect(fitAspect({ ...r, h: 200 }, 'ne', 2)).toEqual({ x: 100, y: 100, w: 400, h: 200 });
  });

  it('corner sw: the top-right corner stays', () => {
    const out = fitAspect(r, 'sw', 2);
    expect(out.x + out.w).toBe(400);
    expect(out.y + out.h).toBe(200);
    expect(out.w / out.h).toBe(2);
  });

  it('edge handles keep the center of the other axis', () => {
    expect(fitAspect(r, 'e', 2)).toEqual({ x: 100, y: 75, w: 300, h: 150 });
    expect(fitAspect(r, 'n', 2)).toEqual({ x: 150, y: 100, w: 200, h: 100 });
  });

  it('shiftKeepsRatio: only with Shift, with the ratio from the start of the drag', () => {
    const op = { rect: { x: 0, y: 0, w: 40, h: 20 } } as Operation;
    const rect = { x: 0, y: 0, w: 100, h: 30 };
    expect(shiftKeepsRatio(op, rect, 'ne', false)).toBe(rect);
    expect(shiftKeepsRatio(op, rect, 'ne', true)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
});
