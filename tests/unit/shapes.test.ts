import { beforeEach, describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { blankPage } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import type { DocState, Operation } from '../../src/core/types';
import tools, { arrowHead, endpoints, lineRect, SHAPE_OP, tint, type ShapeData } from '../../src/tools/shapes';

beforeEach(() => {
  registry.clear();
  registry.register(tools);
});

const op = (id: string, data: ShapeData, rect = { x: 100, y: 400, w: 200, h: 100 }): Operation => ({
  id,
  pageId: 'p1',
  type: SHAPE_OP,
  rect,
  data: data as unknown as Record<string, unknown>,
});
const stateOf = (ops: Operation[]): DocState => ({
  sources: {},
  pages: [{ ...blankPage(), id: 'p1' }],
  ops,
  formValues: {},
});

/** כל זרמי התוכן של העמוד הראשון, מפוענחים */
async function content(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const c = doc.getPage(0).node.Contents();
  const refs = c instanceof PDFArray ? c.asArray() : [];
  return refs
    .map((r) => doc.context.lookup(r))
    .map((s) => (s instanceof PDFRawStream ? Buffer.from(zlib.inflateSync(s.contents)).toString('latin1') : ''))
    .join('\n');
}

describe('shapes geometry', () => {
  it('a line keeps its direction relative to the rect, with a minimum size', () => {
    const { rect, from, to } = lineRect({ x: 300, y: 100 }, { x: 100, y: 200 });
    expect(rect).toEqual({ x: 100, y: 100, w: 200, h: 100 });
    expect(from).toEqual([1, 0]);
    expect(to).toEqual([0, 1]);
    // קו אופקי: גובה מינימלי, והקצוות באמצע
    const h = lineRect({ x: 10, y: 50 }, { x: 90, y: 50 });
    expect(h.rect.h).toBe(8);
    expect(h.from[1]).toBe(0.5);
  });

  it('endpoints follow the rect when it is moved or resized', () => {
    const d: ShapeData = { kind: 'line', stroke: '#000000', width: 1, from: [1, 0], to: [0, 1] };
    expect(endpoints(d, { x: 0, y: 0, w: 10, h: 10 })).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    expect(endpoints(d, { x: 50, y: 50, w: 20, h: 40 })).toEqual([
      { x: 70, y: 50 },
      { x: 50, y: 90 },
    ]);
  });

  it('the arrowhead points at the end', () => {
    const [tip, l, r] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(tip).toEqual({ x: 100, y: 0 });
    expect(l.x).toBeLessThan(100);
    expect(r.x).toBeLessThan(100);
    expect(l.y).toBeCloseTo(-r.y, 6);
  });

  it('tint lightens a color', () => {
    expect(tint('#000000', 0.5)).toBe('#808080');
    expect(tint('#ff0000', 1)).toBe('#ffffff');
  });
});

describe('shapes export', () => {
  it('the content stream gets each shape', async () => {
    const empty = await content(await exportPdf(stateOf([])));
    const out = await content(
      await exportPdf(
        stateOf([
          op('r', { kind: 'rect', stroke: '#ff0000', width: 2, fill: '#ffcccc' }),
          op('e', { kind: 'ellipse', stroke: '#00ff00', width: 3 }, { x: 50, y: 50, w: 100, h: 60 }),
          op(
            'l',
            { kind: 'line', stroke: '#0000ff', width: 4, from: [0, 0], to: [1, 1] },
            { x: 10, y: 10, w: 50, h: 50 },
          ),
          op(
            'a',
            { kind: 'arrow', stroke: '#000000', width: 2, from: [0, 0.5], to: [1, 0.5] },
            { x: 10, y: 300, w: 100, h: 8 },
          ),
        ]),
      ),
    );
    expect(out.length).toBeGreaterThan(empty.length);
    // מלבן: מילוי ומסגרת בצבעים, עם הקו בתוך המלבן (101,401 בגודל 198x98)
    expect(out).toMatch(/1 0.8 0.8 rg/);
    expect(out).toMatch(/1 0 0 RG/);
    expect(out).toMatch(/101 401 cm|0 0 198 98 re|198 98/);
    // אליפסה: עקומות
    expect(out).toMatch(/ c\n/);
    // קו: מ-10,10 עד 60,60 בעובי 4
    expect(out).toMatch(/4 w/);
    expect(out).toMatch(/10 10 m\s+60 60 l/);
    // חץ: משולש מלא (f)
    expect(out).toMatch(/\bf\b/);
  });

  it('no fill (empty string) is not filled', async () => {
    const out = await content(
      await exportPdf(stateOf([op('r', { kind: 'rect', stroke: '#ff0000', width: 2, fill: '' })])),
    );
    expect(out).not.toMatch(/ rg/);
  });
});
