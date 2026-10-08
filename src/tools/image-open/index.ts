/**
 * פתיחת קובץ תמונה (PNG/JPEG/WebP/HEIC) כ-PDF של עמוד אחד בגודל התמונה.
 * כלי בלי כפתור: רק מטפל ב-convertFile כשפותחים קובץ שאינו PDF.
 */

import { PDFDocument } from 'pdf-lib';
import { readImage } from '../../pdf-read/image';
import type { Tool } from '../../core/registry';

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|heic|heif|gif|bmp)$/i;

export async function convertImage(file: File): Promise<Uint8Array> {
  const { bytes, format } = await readImage(file);
  const doc = await PDFDocument.create();
  const image = format === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return doc.save();
}

const tool: Tool = {
  id: 'image-open',
  toolbar: false,

  async convertFile(file) {
    if (!/^image\//i.test(file.type) && !IMAGE_EXT_RE.test(file.name)) return null;
    return convertImage(file);
  },
};

export default tool;
