/**
 * הבתים של התמונות שנוספו, לפי hash. op.data מחזיק רק imageId – כך ההיסטוריה (undo/redo) לא מכפילה תמונות.
 * המאגר לא מתרוקן: פעולה שנמחקה וחזרה ב-undo עדיין מוצאת את התמונה שלה.
 */

export type ImageMime = 'image/png' | 'image/jpeg';

export interface StoredImage {
  bytes: Uint8Array;
  mime: ImageMime;
  /** גודל בפיקסלים */
  width: number;
  height: number;
}

const images = new Map<string, StoredImage>();
const urls = new Map<string, string>();

/** FNV-1a 64 ביט – מספיק לזיהוי כפילויות, ומהיר וסינכרוני */
function hash(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < bytes.length; i++) h = BigInt.asUintN(64, (h ^ BigInt(bytes[i])) * 0x100000001b3n);
  return h.toString(36) + '-' + bytes.length.toString(36);
}

/** שומר תמונה (PNG או JPEG) ומחזיר את המזהה שלה. אותה תמונה פעמיים – אותו מזהה */
export function putImage(bytes: Uint8Array): string {
  const info = sniff(bytes);
  if (!info) throw new Error('לא PNG ולא JPEG');
  const id = 'img-' + hash(bytes);
  if (!images.has(id)) images.set(id, { bytes, ...info });
  return id;
}

export function getImage(id: string): StoredImage | undefined {
  return images.get(id);
}

/** כתובת להצגה בדפדפן (נוצרת פעם אחת) */
export function imageUrl(id: string): string | undefined {
  let u = urls.get(id);
  const img = images.get(id);
  if (!u && img) urls.set(id, (u = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.mime }))));
  return u;
}

/** סוג וגודל לפי הכותרת של הקובץ (בלי לפענח את התמונה) */
export function sniff(b: Uint8Array): { mime: ImageMime; width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { mime: 'image/png', width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    // מחפשים את ה-SOF (גודל התמונה) בין המקטעים
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { mime: 'image/jpeg', height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

/** קובץ תמונה מהמשתמש ← מזהה במאגר. פורמט שאינו PNG/JPEG (webp, gif, bmp…) מומר ל-PNG דרך canvas */
export async function putImageFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniff(bytes)) return putImage(bytes);
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!png) throw new Error('המרת התמונה נכשלה');
  return putImage(new Uint8Array(await png.arrayBuffer()));
}
