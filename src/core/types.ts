/**
 * החוזים המשותפים לכל המודולים. שינוי כאן משפיע על כל הסשנים – רק בתיאום.
 *
 * מערכת הקואורדינטות של כל הפעולות: נקודות PDF (1/72 אינץ') של העמוד המקורי, לפני סיבוב,
 * עם ראשית בפינה השמאלית התחתונה של האזור הנראה של העמוד (CropBox, page.view ב-pdf.js).
 * בייצוא עם pdf-lib מוסיפים את PageRef.origin (userSpace ב-coords.ts) – ברוב הקבצים הוא 0,0.
 * ההמרה למסך ובחזרה רק דרך core/coords.ts.
 */

/** מלבן בנקודות PDF: x,y הפינה השמאלית התחתונה */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** קובץ מקור שנפתח או מוזג. הבתים לא משתנים לעולם */
export interface Source {
  id: string;
  name: string;
  bytes: Uint8Array;
}

/** עמוד במסמך. הסדר במערך DocState.pages הוא סדר העמודים */
export interface PageRef {
  id: string;
  /** null – עמוד ריק חדש */
  sourceId: string | null;
  /** אינדקס העמוד בקובץ המקור (מ-0) */
  sourceIndex: number;
  /** הסיבוב המוחלט של העמוד (כולל /Rotate המקורי) */
  rotation: Rotation;
  /** גודל העמוד בנקודות, לפני סיבוב */
  width: number;
  height: number;
  /** הפינה השמאלית התחתונה של האזור הנראה במערכת הקואורדינטות של ה-PDF (בדרך כלל 0,0) */
  origin: Point;
}

/**
 * עריכה אחת על עמוד. type הוא ה-id של הכלי שמטפל בה (Tool.opTypes).
 * data – נתונים ספציפיים לכלי, חייבים להיות ניתנים להעתקה (structuredClone), בלי פונקציות ו-DOM.
 */
export interface Operation<D = Record<string, unknown>> {
  id: string;
  pageId: string;
  type: string;
  rect: Rect;
  data: D;
}

export interface DocState {
  sources: Record<string, Source>;
  pages: PageRef[];
  ops: Operation[];
  /** שם שדה הטופס ← ערך */
  formValues: Record<string, string | boolean | string[]>;
}

/**
 * פריט טקסט שזוהה בעמוד – מ-pdf.js (סשן A) או מ-OCR (סשן D). אותו מבנה לשניהם.
 * rect בנקודות PDF של העמוד (לפני סיבוב).
 */
export interface TextItem {
  pageId: string;
  str: string;
  rect: Rect;
  /** קו הבסיס, בנקודות PDF */
  baseline: number;
  /** גודל הגופן בנקודות */
  size: number;
  rtl: boolean;
  /** שם הגופן ב-pdf.js (מפתח לגופנים המוטמעים), או undefined ב-OCR */
  fontName?: string;
  /** צבע הטקסט כ-#rrggbb, אם ידוע */
  color?: string;
  italic?: boolean;
  /** מקור הפריט */
  origin: 'pdf' | 'ocr';
}
