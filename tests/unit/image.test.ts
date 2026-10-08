import { beforeEach, describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { blankPage } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import type { DocState, Operation } from '../../src/core/types';
import tool, { fitRect, IMAGE_OP, type ImageData } from '../../src/tools/image';
import { getImage, putImage, sniff } from '../../src/tools/image/store';

/** PNG אפור קטן (בלי תלויות) */
function png(w: number, h: number, shade = 128): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  const raw = Buffer.alloc((w + 1) * h, shade);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

const op = (id: string, data: ImageData, rect = { x: 100, y: 400, w: 200, h: 100 }): Operation => ({
  id,
  pageId: 'p1',
  type: IMAGE_OP,
  rect,
  data: data as unknown as Record<string, unknown>,
});
const stateOf = (ops: Operation[]): DocState => ({
  sources: {},
  pages: [{ ...blankPage(), id: 'p1' }],
  ops,
  formValues: {},
});

/** XObjects מסוג תמונה בעמוד הראשון */
async function pageImages(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const xo = doc.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  // pdf-lib נותן שם חדש בכל ציור, אבל לאותו אובייקט – סופרים אובייקטים
  const refs = [...new Set((xo?.entries() ?? []).map(([, ref]) => ref))];
  return refs
    .map((ref) => doc.context.lookup(ref))
    .filter(
      (s): s is PDFRawStream => s instanceof PDFRawStream && s.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
    )
    .map((s) => ({
      w: Number(s.dict.get(PDFName.of('Width'))?.toString()),
      h: Number(s.dict.get(PDFName.of('Height'))?.toString()),
    }));
}

describe('image store', () => {
  it('detects PNG and JPEG and their size from the header', () => {
    expect(sniff(png(30, 20))).toEqual({ mime: 'image/png', width: 30, height: 20 });
    // SOI, APP0 קצר, SOF0 עם גובה 0x0102 ורוחב 0x0304
    const jpg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 1, 2, 3, 4, 3, 0, 0, 0, 0, 0,
    ]);
    expect(sniff(jpg)).toEqual({ mime: 'image/jpeg', width: 0x304, height: 0x102 });
    expect(sniff(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('the same bytes get the same id; the bytes are kept', () => {
    const a = png(4, 4, 10);
    const id = putImage(a);
    expect(putImage(a.slice())).toBe(id);
    expect(putImage(png(4, 4, 200))).not.toBe(id);
    expect(getImage(id)).toMatchObject({ mime: 'image/png', width: 4, height: 4 });
  });
});

describe('image export', () => {
  it('embeds the image as an XObject, once for two ops with the same image', async () => {
    const id = putImage(png(40, 20));
    const out = await exportPdf(
      stateOf([op('a', { imageId: id }), op('b', { imageId: id }, { x: 10, y: 10, w: 40, h: 20 })]),
    );
    expect(await pageImages(out)).toEqual([{ w: 40, h: 20 }]);
  });

  it('keeps the aspect ratio inside the rect', () => {
    expect(fitRect({ x: 0, y: 0, w: 200, h: 100 }, 40, 40)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(fitRect({ x: 10, y: 10, w: 100, h: 300 }, 20, 10)).toEqual({ x: 10, y: 135, w: 100, h: 50 });
  });

  it('draws the image with the fitted size (cm in the content stream)', async () => {
    const id = putImage(png(20, 10));
    const out = await exportPdf(stateOf([op('a', { imageId: id }, { x: 100, y: 400, w: 200, h: 200 })]));
    const doc = await PDFDocument.load(out);
    const content = (doc.getPage(0).node.Contents() as PDFArray)
      .asArray()
      .map((r) => doc.context.lookup(r))
      .map((s) => (s instanceof PDFRawStream ? Buffer.from(zlib.inflateSync(s.contents)).toString('latin1') : ''))
      .join('\n');
    // 200x100 ממורכז במלבן 200x200: y = 400 + 50
    expect(content).toMatch(/1 0 0 1 100 450 cm/);
    expect(content).toMatch(/200 0 0 100 0 0 cm/);
    expect(content).toMatch(/Do/);
  });

  it('a missing image is skipped without failing the export', async () => {
    await expect(exportPdf(stateOf([op('a', { imageId: 'img-missing' })]))).resolves.toBeInstanceOf(Uint8Array);
  });
});
