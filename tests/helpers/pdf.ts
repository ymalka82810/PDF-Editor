// Test helpers for Vitest (node environment): load fixtures, extract text, inspect pages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface TextItem {
  str: string;
  /** Baseline origin in PDF user-space points (unrotated page coordinates). */
  x: number;
  y: number;
  /** Font size in points (scale of the text matrix). */
  size: number;
}

export interface PageText {
  items: TextItem[];
  /** All items joined; line breaks where pdf.js reports end-of-line. */
  text: string;
}

export interface PageInfo {
  width: number;
  height: number;
  /** /Rotate value normalized to 0, 90, 180 or 270. */
  rotation: number;
  mediaBox: { x: number; y: number; width: number; height: number };
  cropBox: { x: number; y: number; width: number; height: number };
}

/** Reads tests/fixtures/<name>. */
export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(root, 'tests', 'fixtures', name)));
}

/** Reads src/assets/fonts/<name>. */
export function fontBytes(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(root, 'src', 'assets', 'fonts', name)));
}

/** Extracts text items of one page with pdf.js. Does not mutate `bytes`. */
export async function textOf(bytes: Uint8Array, pageIndex = 0): Promise<PageText> {
  // pdf.js transfers (detaches) the buffer it is given, so pass a copy.
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    let text = '';
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const [a, b, , , e, f] = it.transform as number[];
      if (it.str !== '') items.push({ str: it.str, x: e, y: f, size: Math.hypot(a, b) });
      text += it.str + (it.hasEOL ? '\n' : '');
    }
    return { items, text };
  } finally {
    await task.destroy();
  }
}

/** Page count and per-page geometry, read with pdf-lib. */
export async function pageInfo(bytes: Uint8Array): Promise<{ pageCount: number; pages: PageInfo[] }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return {
      width,
      height,
      rotation: ((p.getRotation().angle % 360) + 360) % 360,
      mediaBox: p.getMediaBox(),
      cropBox: p.getCropBox(),
    };
  });
  return { pageCount: pages.length, pages };
}
