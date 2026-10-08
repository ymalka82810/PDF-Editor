/**
 * טעינת Tesseract.js מה-CDN (לא תלות ב-package.json - נטען מהרשת בפעם הראשונה בלבד, ונשמר בדפדפן).
 * זיהוי heb+eng במעבר אחד, במצב טקסט מפוזר (SPARSE_TEXT) - מתאים לדפים סרוקים שאינם פסקאות רצופות.
 */

import type { OcrWord } from './map';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface TesseractLine {
  words: TesseractWord[];
}
interface TesseractParagraph {
  lines: TesseractLine[];
}
interface TesseractBlock {
  paragraphs: TesseractParagraph[];
}
interface TesseractModule {
  createWorker(lang: string, oem: number, options?: Record<string, unknown>): Promise<TesseractWorker>;
  PSM: Record<string, string>;
}
interface TesseractWorker {
  setParameters(params: Record<string, unknown>): Promise<void>;
  recognize(
    image: unknown,
    opts?: Record<string, unknown>,
    output?: Record<string, unknown>,
  ): Promise<{ data: { blocks?: TesseractBlock[] | null } }>;
  terminate(): Promise<void>;
}

let modP: Promise<TesseractModule> | null = null;
function loadTesseract(): Promise<TesseractModule> {
  if (!modP)
    modP = import(/* @vite-ignore */ TESSERACT_URL).then(
      (m) => (m as { default: TesseractModule }).default ?? (m as unknown as TesseractModule),
    );
  return modP;
}

/** מריץ OCR על canvas, ומחזיר את כל המילים שזוהו (בלי סינון - הסינון לפי ביטחון ב-map.ts) */
export async function recognizeCanvas(canvas: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<OcrWord[]> {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('heb+eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs)
        for (const line of para.lines)
          for (const w of line.words) words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox });
    return words;
  } finally {
    await worker.terminate();
  }
}
