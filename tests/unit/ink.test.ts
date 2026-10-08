import { beforeEach, describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { blankPage } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import type { DocState, Operation } from '../../src/core/types';
import tool, { absolute, INK_OP, simplify, smoothPath, toStroke, type InkData } from '../../src/tools/ink';

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

describe('ink geometry', () => {
  it('simplify drops points on a straight line and keeps corners', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i * 2 }));
    expect(simplify(line, 0.4)).toEqual([line[0], line[19]]);
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(simplify(corner, 0.4)).toEqual([corner[0], corner[2], corner[4]]);
  });

  it('smoothPath: quadratic curves through the middle points', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(d).toBe('M 0 0 L 5 0 Q 10 0 10 5 L 10 10');
    expect(smoothPath([{ x: 1, y: 1 }])).toBe('M 1 1 L 1 1');
  });

  it('toStroke: rect with room for the line width, relative points that follow resizing', () => {
    const { rect, points } = toStroke(
      [
        { x: 10, y: 20 },
        { x: 30, y: 60 },
      ],
      4,
    );
    expect(rect).toEqual({ x: 7, y: 17, w: 26, h: 46 });
    const d: InkData = { points, color: '#000000', width: 4 };
    expect(absolute(d, rect)).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 60 },
    ]);
    // פי 2 ברוחב: x נמתח, y לא
    const wide = absolute(d, { ...rect, w: rect.w * 2 });
    expect(wide[1].x - wide[0].x).toBeCloseTo(40, 6);
    expect(wide[1].y - wide[0].y).toBeCloseTo(40, 6);
  });
});

describe('ink export', () => {
  it('draws a stroked path in the content stream, at the right place', async () => {
    const { rect, points } = toStroke(
      [
        { x: 100, y: 500 },
        { x: 150, y: 520 },
        { x: 200, y: 480 },
      ],
      3,
    );
    const op: Operation = {
      id: 'i1',
      pageId: 'p1',
      type: INK_OP,
      rect,
      data: { points, color: '#d64545', width: 3 } as unknown as Record<string, unknown>,
    };
    const state: DocState = { sources: {}, pages: [{ ...blankPage(), id: 'p1' }], ops: [op], formValues: {} };
    const doc = await PDFDocument.load(await exportPdf(state));
    const content = (doc.getPage(0).node.Contents() as PDFArray)
      .asArray()
      .map((r) => doc.context.lookup(r))
      .map((s) => (s instanceof PDFRawStream ? Buffer.from(zlib.inflateSync(s.contents)).toString('latin1') : ''))
      .join('\n');
    expect(content).toMatch(/0\.839\d* 0\.27\d* 0\.27\d* RG/);
    expect(content).toMatch(/3 w/);
    expect(content).toMatch(/1 J/); // קצוות מעוגלים
    // עקומה (pdf-lib כותב ריבועית כ-v), קו בלבד (S), בלי מילוי
    expect(content).toMatch(/ [cvy]\n/);
    expect(content).toMatch(/\bS\b/);
    expect(content).not.toMatch(/\bf\b/);
    // pdf-lib הופך את y של SVG (1 0 0 -1), והמסלול מתחיל ב-100,-500 – כלומר בנקודה 100,500 בעמוד
    expect(content).toMatch(/1 0 0 -1 0 0 cm/);
    expect(content).toMatch(/100 -500 m/);
  });
});
