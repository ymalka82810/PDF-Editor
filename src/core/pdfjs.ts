/** טעינת pdf.js (נטען בפעם הראשונה שצריך אותו) */

import type * as PdfjsLib from 'pdfjs-dist';

let lib: Promise<typeof PdfjsLib> | null = null;

export function pdfjs(): Promise<typeof PdfjsLib> {
  if (!lib) {
    lib = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
      m.GlobalWorkerOptions.workerSrc = worker.default;
      return m;
    });
    lib.catch(() => (lib = null));
  }
  return lib;
}

/** פתיחת מסמך. הבתים מועתקים כי pdf.js מעביר אותם ל-worker */
export async function openPdfjs(bytes: Uint8Array) {
  const m = await pdfjs();
  return m.getDocument({ data: bytes.slice(), fontExtraProperties: true }).promise;
}
