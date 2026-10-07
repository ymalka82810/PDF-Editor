import { afterAll, describe, expect, it } from 'vitest';
import { getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { rectToPdf, rectToView, toPdf, toView, userSpace, viewSize, type ViewGeom } from '../../src/core/coords';
import { readSource } from '../../src/core/document';
import type { Point, Rotation } from '../../src/core/types';
import { loadFixture } from '../helpers/pdf';

const SCALE = 1.5;
const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const FIXTURES = ['hebrew.pdf', 'english.pdf', 'multipage.pdf', 'form.pdf', 'scanned.pdf', 'cropbox.pdf'];

const open: PDFDocumentLoadingTask[] = [];
afterAll(async () => {
  await Promise.all(open.map((t) => t.destroy()));
});

/** נקודות בדיקה במערכת של המודל (יחסית לפינת ה-CropBox) */
function samplePoints(w: number, h: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: 0, y: h },
    { x: w, y: h },
    { x: 37.5, y: 112.25 },
    { x: w * 0.7, y: h * 0.2 },
  ];
}

describe.each(FIXTURES)('coords vs pdf.js: %s', (name) => {
  it('matches pdf.js viewports for every page and rotation', async () => {
    const bytes = loadFixture(name);
    const { pages } = await readSource(name, bytes);
    const task = getDocument({ data: bytes.slice(), verbosity: 0 });
    open.push(task);
    const doc = await task.promise;
    expect(pages).toHaveLength(doc.numPages);

    for (const ref of pages) {
      const page = await doc.getPage(ref.sourceIndex + 1);
      // הסיבוב והגודל שקוראים מ-pdf-lib תואמים את pdf.js
      expect(ref.rotation).toBe(page.rotate);
      const [x0, y0, x1, y1] = page.view;
      expect(ref.origin).toEqual({ x: x0, y: y0 });
      expect(ref.width).toBeCloseTo(x1 - x0, 6);
      expect(ref.height).toBeCloseTo(y1 - y0, 6);

      for (const rotation of ROTATIONS) {
        const geom: ViewGeom = { width: ref.width, height: ref.height, rotation, scale: SCALE };
        const vp = page.getViewport({ scale: SCALE, rotation });
        const size = viewSize(geom);
        const ctx = `${name} page ${ref.sourceIndex + 1} rot ${rotation}`;
        expect(size.w, ctx).toBeCloseTo(vp.width, 6);
        expect(size.h, ctx).toBeCloseTo(vp.height, 6);

        for (const p of samplePoints(ref.width, ref.height)) {
          const [ex, ey] = vp.convertToViewportPoint(p.x + ref.origin.x, p.y + ref.origin.y);
          const v = toView(geom, p);
          expect(v.x, `${ctx} toView.x ${JSON.stringify(p)}`).toBeCloseTo(ex, 6);
          expect(v.y, `${ctx} toView.y ${JSON.stringify(p)}`).toBeCloseTo(ey, 6);

          const [px, py] = vp.convertToPdfPoint(ex, ey);
          const back = toPdf(geom, v);
          expect(back.x, `${ctx} toPdf.x`).toBeCloseTo(px - ref.origin.x, 6);
          expect(back.y, `${ctx} toPdf.y`).toBeCloseTo(py - ref.origin.y, 6);
        }

        const r = { x: 20, y: 30, w: 100, h: 50 };
        const [ax, ay] = vp.convertToViewportPoint(r.x + ref.origin.x, r.y + ref.origin.y);
        const [bx, by] = vp.convertToViewportPoint(r.x + r.w + ref.origin.x, r.y + r.h + ref.origin.y);
        const rv = rectToView(geom, r);
        expect(rv.x, ctx).toBeCloseTo(Math.min(ax, bx), 6);
        expect(rv.y, ctx).toBeCloseTo(Math.min(ay, by), 6);
        expect(rv.w, ctx).toBeCloseTo(Math.abs(bx - ax), 6);
        expect(rv.h, ctx).toBeCloseTo(Math.abs(by - ay), 6);
      }
    }
  });
});

describe('round trips', () => {
  const geoms: ViewGeom[] = ROTATIONS.flatMap((rotation) =>
    [1, 1.5, 0.37].map((scale) => ({ width: 612, height: 792, rotation, scale })),
  );

  it.each(geoms)('toPdf(toView(p)) == p  (rot $rotation, scale $scale)', (g) => {
    for (const p of samplePoints(g.width, g.height)) {
      const back = toPdf(g, toView(g, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it.each(geoms)('rectToPdf(rectToView(r)) == r  (rot $rotation, scale $scale)', (g) => {
    const r = { x: 12.5, y: 300, w: 140, h: 22 };
    const back = rectToPdf(g, rectToView(g, r));
    expect(back.x).toBeCloseTo(r.x, 9);
    expect(back.y).toBeCloseTo(r.y, 9);
    expect(back.w).toBeCloseTo(r.w, 9);
    expect(back.h).toBeCloseTo(r.h, 9);
  });

  it('rectToView keeps width/height swapped on 90/270', () => {
    const r = { x: 0, y: 0, w: 100, h: 20 };
    expect(rectToView({ width: 612, height: 792, rotation: 90, scale: 2 }, r)).toMatchObject({ w: 40, h: 200 });
    expect(rectToView({ width: 612, height: 792, rotation: 270, scale: 2 }, r)).toMatchObject({ w: 40, h: 200 });
  });
});

describe('userSpace', () => {
  it('adds the CropBox origin', async () => {
    const { pages } = await readSource('cropbox.pdf', loadFixture('cropbox.pdf'));
    expect(pages[0].origin).toEqual({ x: 100, y: 100 });
    expect(userSpace(pages[0], { x: 20, y: 670, w: 50, h: 10 })).toEqual({ x: 120, y: 770, w: 50, h: 10 });
  });

  it('is the identity for pages at 0,0', () => {
    const r = { x: 1, y: 2, w: 3, h: 4 };
    expect(userSpace({ origin: { x: 0, y: 0 } }, r)).toEqual(r);
  });
});
