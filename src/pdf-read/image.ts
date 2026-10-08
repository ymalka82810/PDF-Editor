/**
 * קריאת קובץ תמונה לבייטים שאפשר להטביע עם pdf-lib (embedPng/embedJpg).
 * PNG ו-JPEG עוברים כמו שהם. פורמטים אחרים (WebP, HEIC וכו') מומרים ל-PNG בעזרת canvas,
 * אם יש createImageBitmap בדפדפן (אין ב-Node, ולכן אין בדיקת יחידה לנתיב הזה).
 */

export interface ImageBytes {
  bytes: Uint8Array;
  format: 'png' | 'jpg';
}

const PNG_RE = /\.png$/i;
const JPG_RE = /\.jpe?g$/i;

export async function readImage(file: File): Promise<ImageBytes> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/^image\/png$/i.test(file.type) || PNG_RE.test(file.name)) return { bytes, format: 'png' };
  if (/^image\/jpe?g$/i.test(file.type) || JPG_RE.test(file.name)) return { bytes, format: 'jpg' };
  return { bytes: await toPng(file), format: 'png' };
}

async function toPng(file: File): Promise<Uint8Array> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('פורמט התמונה לא נתמך בדפדפן הזה');
  }
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('יצירת PNG מהתמונה נכשלה'));
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, 'image/png');
  });
}
