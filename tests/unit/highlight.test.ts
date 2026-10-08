import { beforeEach, describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { stateFromBytes } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import type { Operation } from '../../src/core/types';
import tools, { MARK_OP, snapToLines, type MarkData } from '../../src/tools/highlight';
import { loadFixture, textOf } from '../helpers/pdf';

beforeEach(() => {
  registry.clear();
  registry.register(tools);
});

describe('snapToLines', () => {
  const lines = [
    { x: 100, y: 700, w: 300, h: 16 },
    { x: 120, y: 676, w: 280, h: 16 },
    { x: 100, y: 600, w: 200, h: 16 },
  ];

  it('a click inside a line takes the whole line', () => {
    expect(snapToLines(lines, { x: 200, y: 684, w: 0, h: 0 }, true)).toEqual([lines[1]]);
    expect(snapToLines(lines, { x: 50, y: 684, w: 0, h: 0 }, true)).toEqual([]);
  });

  it('a drag takes the lines it covers, clipped to the drag width', () => {
    expect(snapToLines(lines, { x: 150, y: 670, w: 100, h: 50 }, false)).toEqual([
      { x: 150, y: 700, w: 100, h: 16 },
      { x: 150, y: 676, w: 100, h: 16 },
    ]);
  });

  it('a line touched only at its edge is not taken', () => {
    expect(snapToLines(lines, { x: 100, y: 710, w: 100, h: 30 }, false)).toEqual([]);
  });
});

describe('highlight export', () => {
  const mark = (id: string, pageId: string, data: MarkData, rect = { x: 290, y: 695, w: 255, h: 18 }): Operation => ({
    id,
    pageId,
    type: MARK_OP,
    rect,
    data: data as unknown as Record<string, unknown>,
  });

  it('a translucent multiply rectangle and a strike line; the text is untouched', async () => {
    const state = await stateFromBytes('h.pdf', loadFixture('hebrew.pdf'));
    const pageId = state.pages[0].id;
    const out = await exportPdf({
      ...state,
      ops: [
        mark('h', pageId, { kind: 'highlight', color: '#ffe14d' }),
        mark('s', pageId, { kind: 'strike', color: '#d64545' }, { x: 300, y: 671, w: 245, h: 18 }),
      ],
    });
    expect((await textOf(out)).text).toBe((await textOf(loadFixture('hebrew.pdf'))).text);

    const doc = await PDFDocument.load(out);
    const page = doc.getPage(0);
    const gs = page.node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
    const states = gs.entries().map(([, v]) => doc.context.lookup(v) as PDFDict);
    expect(
      states.some(
        (s) => s.get(PDFName.of('BM'))?.toString() === '/Multiply' && s.get(PDFName.of('ca'))?.toString() === '0.35',
      ),
    ).toBe(true);

    const content = (page.node.Contents() as PDFArray)
      .asArray()
      .map((r) => doc.context.lookup(r))
      .map((s) => (s instanceof PDFRawStream ? Buffer.from(zlib.inflateSync(s.contents)).toString('latin1') : ''))
      .join('\n');
    // הדגשה: מלבן צהוב
    expect(content).toMatch(/1 0\.88\d* 0\.30\d* rg/);
    // קו חוצה באמצע הגובה: y = 671 + 9
    expect(content).toMatch(/300 680 m\s+545 680 l/);
  });
});
