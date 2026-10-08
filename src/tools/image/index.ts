/**
 * הוספת תמונה: בחירת קובץ, והנחה במרכז העמוד שהמשתמש רואה. הזזה ושינוי גודל – דרך השכבה הכללית.
 * התמונה תמיד שומרת על היחס שלה: היא ממלאת את המלבן ככל האפשר וממורכזת בו (גם בתצוגה וגם בייצוא).
 * הבתים במאגר (store.ts); op.data רק imageId. גם החתימה (signature) מניחה תמונות דרך placeImage.
 */

import type { PDFDocument, PDFImage } from 'pdf-lib';
import { fitAspect, userSpace } from '../../core/coords';
import type { EditorApi, ExportCtx, Tool } from '../../core/registry';
import type { Operation, Rect } from '../../core/types';
import { drawInFrame, frameSize, placeFrame } from '../../ui/widgets/frame';
import { centeredRect, currentView } from '../../ui/widgets/placement';
import { getImage, imageUrl, putImageFile } from './store';
import he from './locales/he.json';
import en from './locales/en.json';
import './style.css';

export const IMAGE_OP = 'image';

export interface ImageData {
  imageId: string;
  /** זווית המסגרת ביחס לעמוד (ראו ui/widgets/frame.ts) */
  rotate?: number;
}

const dataOf = (op: Operation) => op.data as unknown as ImageData;

/**
 * מניח תמונה מהמאגר במרכז העמוד הנוכחי. width – הרוחב הרצוי בנקודות; ברירת מחדל: הגודל הטבעי ב-96dpi.
 * מחזיר את מזהה הפעולה, או null אם אין עמוד.
 */
export function placeImage(api: EditorApi, imageId: string, width?: number): string | null {
  const img = getImage(imageId);
  const view = currentView(api);
  if (!img || !view) return null;
  const w = width ?? img.width * 0.75;
  const h = (w * img.height) / img.width;
  const id = api.store.addOp<ImageData>({
    pageId: view.page.id,
    type: IMAGE_OP,
    rect: centeredRect(view, w, h),
    data: { imageId, rotate: -view.page.rotation },
  });
  api.store.select(id);
  return id;
}

/** בחירת קובץ תמונה מהמחשב או מהטלפון */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** המלבן שהתמונה תופסת בתוך box, לפי היחס שלה, ממורכז */
export function fitRect(box: Rect, width: number, height: number): Rect {
  const k = Math.min(box.w / width, box.h / height);
  const w = width * k;
  const h = height * k;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

const embedded = new WeakMap<PDFDocument, Map<string, Promise<PDFImage>>>();
/** הטמעה פעם אחת לכל תמונה בכל ייצוא (אותה תמונה כמה פעמים – XObject אחד) */
function embed(pdf: PDFDocument, imageId: string): Promise<PDFImage> | null {
  const img = getImage(imageId);
  if (!img) return null;
  let m = embedded.get(pdf);
  if (!m) embedded.set(pdf, (m = new Map()));
  let p = m.get(imageId);
  if (!p) m.set(imageId, (p = img.mime === 'image/png' ? pdf.embedPng(img.bytes) : pdf.embedJpg(img.bytes)));
  return p;
}

export async function exportImage(op: Operation, ctx: ExportCtx) {
  const d = dataOf(op);
  const img = embed(ctx.pdf, d.imageId);
  if (!img) return console.warn('תמונה חסרה במאגר', d.imageId);
  const image = await img;
  drawInFrame(ctx.pdfPage, userSpace(ctx.page, op.rect), d.rotate, (r) => {
    const f = fitRect(r, image.width, image.height);
    ctx.pdfPage.drawImage(image, { x: f.x, y: f.y, width: f.w, height: f.h });
  });
}

const tool: Tool = {
  id: 'image',
  icon: '🖼',
  group: 'insert',
  shortcut: 'i',
  opTypes: [IMAGE_OP],
  locales: { he, en },

  async run(api) {
    const file = await pickImageFile();
    if (!file) return;
    try {
      const id = await putImageFile(file);
      if (!placeImage(api, id)) api.toast(api.t('image.noPage'), 'error');
    } catch (err) {
      console.error(err);
      api.toast(api.t('image.failed'), 'error');
    }
  },

  renderOp(op, el, view) {
    const d = dataOf(op);
    el.classList.add('image-op');
    const img = document.createElement('img');
    img.className = 'image-content';
    img.alt = '';
    img.draggable = false;
    const url = imageUrl(d.imageId);
    if (url) img.src = url;
    placeFrame(img, view, op.rect, d.rotate);
    el.appendChild(img);
  },

  /** שינוי גודל שומר תמיד על היחס של התמונה (במסגרת מסובבת – היחס ההפוך במערכת של העמוד) */
  constrainRect(op, rect, handle) {
    const d = dataOf(op);
    const img = getImage(d.imageId);
    if (!img) return rect;
    const f = frameSize({ x: 0, y: 0, w: img.width, h: img.height }, d.rotate);
    return fitAspect(rect, handle, f.w / f.h);
  },

  exportOp: exportImage,
};

export default tool;
