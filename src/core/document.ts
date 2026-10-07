/** קריאת קובץ PDF למודל: המקור והעמודים שלו (גודל, CropBox, סיבוב) */

import { PDFDocument } from 'pdf-lib';
import { uid } from './model';
import type { DocState, PageRef, Rotation, Source } from './types';

export const normRotation = (deg: number): Rotation => ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;

/** קורא את העמודים של קובץ. ignoreEncryption – קבצים "מוגנים" רק בהרשאות עדיין נפתחים */
export async function readSource(name: string, bytes: Uint8Array): Promise<{ source: Source; pages: PageRef[] }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const source: Source = { id: uid('src'), name, bytes };
  const pages = doc.getPages().map((p, i): PageRef => {
    const box = p.getCropBox();
    return {
      id: uid('page'),
      sourceId: source.id,
      sourceIndex: i,
      rotation: normRotation(p.getRotation().angle),
      width: box.width,
      height: box.height,
      origin: { x: box.x, y: box.y },
    };
  });
  return { source, pages };
}

/** מסמך חדש מקובץ אחד */
export async function stateFromBytes(name: string, bytes: Uint8Array): Promise<DocState> {
  const { source, pages } = await readSource(name, bytes);
  return { sources: { [source.id]: source }, pages, ops: [], formValues: {} };
}

/** עמוד ריק (ברירת מחדל A4 לאורך) */
export function blankPage(width = 595.28, height = 841.89): PageRef {
  return { id: uid('page'), sourceId: null, sourceIndex: 0, rotation: 0, width, height, origin: { x: 0, y: 0 } };
}
