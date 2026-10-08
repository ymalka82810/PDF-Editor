/**
 * מיפוי מילים שזוהו ב-OCR (בפיקסלים של התמונה שנשלחה לזיהוי) ל-TextItem בנקודות PDF,
 * יחסית לפינה השמאלית התחתונה של העמוד (לפני סיבוב) – כמו כל TextItem אחר (core/types.ts).
 * פונקציה טהורה, בלי תלות ב-tesseract עצמו – כך אפשר לבדוק אותה בלי להריץ זיהוי אמיתי.
 */

import { joinFragments } from '../../pdf-read/text';
import type { TextItem } from '../../core/types';

export interface OcrWord {
  text: string;
  /** 0–100 */
  confidence: number;
  /** בפיקסלים של התמונה שנשלחה לזיהוי, ראשית בפינה השמאלית העליונה */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface MapOptions {
  pageId: string;
  /** פיקסלים לנקודת PDF: רוחב התמונה שנשלחה לזיהוי ÷ רוחב העמוד בנקודות */
  scale: number;
  /** גובה העמוד בנקודות PDF (CropBox, לפני סיבוב) */
  pageHeight: number;
  /** מילים עם ביטחון נמוך מזה מתעלמים מהן */
  minConfidence?: number;
}

const RTL_CHAR = /[֐-׿]/;

/** מילים בודדות ← TextItem[], עם איחוד מילים סמוכות על אותה שורה (joinFragments) */
export function wordsToItems(words: readonly OcrWord[], opts: MapOptions): TextItem[] {
  const { pageId, scale, pageHeight, minConfidence = 40 } = opts;
  const items: TextItem[] = [];
  for (const w of words) {
    const str = w.text.trim();
    if (!str || w.confidence < minConfidence) continue;
    const { x0, y0, x1, y1 } = w.bbox;
    if (!(x1 > x0) || !(y1 > y0)) continue;
    const width = (x1 - x0) / scale;
    const height = (y1 - y0) / scale;
    // התיבה ב-OCR נמדדת מלמעלה; ב-PDF הראשית למטה - y של התחתית הוא pageHeight פחות המרחק מלמעלה לתחתית התיבה
    const bottom = pageHeight - y1 / scale;
    items.push({
      pageId,
      str,
      rect: { x: x0 / scale, y: bottom, w: width, h: height },
      // קירוב: אין מידע על ה-baseline האמיתי, לכן תחתית התיבה
      baseline: bottom,
      size: height,
      rtl: RTL_CHAR.test(str),
      origin: 'ocr',
    });
  }
  return joinFragments(items);
}
