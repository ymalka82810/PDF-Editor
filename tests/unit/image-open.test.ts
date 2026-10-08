import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { convertImage } from '../../src/tools/image-open/index';
import { readImage } from '../../src/pdf-read/image';

/** PNG מינימלי בגווני אפור (8 סיביות), כמו ב-scripts/make-fixtures.mjs */
function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const tinyPng = (w: number, h: number): Uint8Array => new Uint8Array(encodePng(w, h, Buffer.alloc(w * h, 128)));
const toFile = (bytes: Uint8Array, name: string, type: string) => new File([bytes as BlobPart], name, { type });

describe('readImage', () => {
  it('PNG עובר כמו שהוא', async () => {
    const bytes = tinyPng(8, 6);
    const file = toFile(bytes, 'tiny.png', 'image/png');
    const img = await readImage(file);
    expect(img.format).toBe('png');
    expect(img.bytes).toEqual(new Uint8Array(bytes));
  });

  it('מזהה PNG גם לפי סיומת כשאין MIME type', async () => {
    const bytes = tinyPng(4, 4);
    const file = toFile(bytes, 'scan.PNG', '');
    expect((await readImage(file)).format).toBe('png');
  });
});

describe('convertImage (image-open)', () => {
  it('יוצר PDF של עמוד אחד בגודל התמונה (בנקודות = פיקסלים)', async () => {
    const width = 120;
    const height = 80;
    const file = toFile(tinyPng(width, height), 'photo.png', 'image/png');

    const out = await convertImage(file);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    const size = doc.getPage(0).getSize();
    expect(size).toEqual({ width, height });
  });
});
