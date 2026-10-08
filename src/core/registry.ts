/**
 * החוזה של כלי. כל יכולת בעורך היא כלי בתיקייה src/tools/<name>/index.ts שמייצא default: Tool או Tool[].
 * הכלים נטענים אוטומטית (ui/load-tools.ts) – אין רשימה משותפת לערוך.
 */

import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Handle, ViewGeom } from './coords';
import type { Store } from './model';
import type { DocState, Operation, PageRef, Point, Rect } from './types';

/** מילון תרגום של כלי: מפתח ← טקסט. המפתחות מקבלים קידומת אוטומטית "<tool id>." */
export type Locale = Record<string, string>;

/** עמוד מוצג על המסך */
export interface PageView {
  page: PageRef;
  geom: ViewGeom;
  /** האלמנט של העמוד (position:relative). שכבת הפעולות בתוכו */
  el: HTMLElement;
  /** השכבה שבה מוצגות הפעולות. כלי יכול להוסיף לה אלמנטים זמניים (למשל מלבן בזמן גרירה) */
  overlay: HTMLElement;
}

export interface PagePointer {
  view: PageView;
  /** הנקודה בקואורדינטות PDF של העמוד */
  point: Point;
  event: PointerEvent;
}

/** מה שהכלים מקבלים מהעורך */
export interface EditorApi {
  store: Store;
  /** תרגום. מפתחות של כלי: '<tool id>.<key>' */
  t(key: string, vars?: Record<string, string | number>): string;
  lang(): 'he' | 'en';
  activeTool(): string | null;
  setActiveTool(id: string | null): void;
  /** העמודים שמוצגים כרגע (רק אלה שכבר נבנו) */
  views(): PageView[];
  viewOf(pageId: string): PageView | undefined;
  /** מסמך pdf.js של קובץ מקור (נטען פעם אחת ונשמר) */
  pdfjsDoc(sourceId: string): Promise<PDFDocumentProxy>;
  /** פתיחת קובץ (מחליף את המסמך הנוכחי) */
  openFile(file: File): Promise<void>;
  /** הוספת קובץ כמקור נוסף בלי לגעת בעמודים; מחזיר את ה-id שלו ואת העמודים שלו (לא מוכנסים) */
  addSource(name: string, bytes: Uint8Array): Promise<{ sourceId: string; pages: PageRef[] }>;
  /** ייצוא המסמך כ-PDF */
  exportPdf(): Promise<Uint8Array>;
  /** הודעה קצרה למשתמש */
  toast(message: string, kind?: 'info' | 'error'): void;
}

/** מה שמקבל exportOp */
export interface ExportCtx {
  pdf: PDFDocument;
  /** העמוד ב-pdf-lib */
  pdfPage: PDFPage;
  page: PageRef;
  state: DocState;
  /** גופן מוטמע (עם cache). name – שם מ-fonts.ts; בלי – גופן ברירת המחדל (עברית + לטינית) */
  font(name?: string): Promise<PDFFont>;
  /** הטמעת גופן מבתים (גופן מוטמע מהקובץ המקורי וכו'), עם cache לפי key */
  embedFontBytes(key: string, bytes: Uint8Array): Promise<PDFFont>;
}

/** הקשר לייצוא ברמת המסמך (טפסים וכו') – אחרי שכל העמודים והפעולות נכתבו */
export interface DocExportCtx extends Omit<ExportCtx, 'pdfPage' | 'page'> {
  /** העמוד ב-pdf-lib ← ה-PageRef שלו, לפי הסדר */
  pages: { page: PageRef; pdfPage: PDFPage }[];
}

export interface Tool {
  /** מזהה ייחודי, גם קידומת המפתחות בתרגום */
  id: string;
  /** מפתח התרגום לשם הכלי (בלי קידומת), ברירת מחדל 'label' */
  label?: string;
  /** תו או SVG קצר לכפתור */
  icon?: string;
  /** קבוצה בסרגל הכלים */
  group?: 'edit' | 'insert' | 'page' | 'form' | 'other';
  /** קיצור מקלדת למצב הכלי, למשל 't' */
  shortcut?: string;
  /** false – אין כפתור בסרגל (כלי שרק מטפל בסוג פעולה או מוסיף פאנל) */
  toolbar?: boolean;
  /** סוגי הפעולות שהכלי מצייר ומייצא. ברירת מחדל [id] */
  opTypes?: string[];
  /** תרגומים */
  locales?: { he: Locale; en: Locale };

  /** כלי פקודה (לא מצב): נקרא בלחיצה על הכפתור, במקום להפוך לכלי הפעיל */
  run?(api: EditorApi): void | Promise<void>;
  /** כשהכלי הופך לפעיל / מפסיק להיות פעיל */
  activate?(api: EditorApi): void;
  deactivate?(api: EditorApi): void;
  /** לחיצה על עמוד כשהכלי פעיל (לא על פעולה קיימת) */
  onPointerDown?(p: PagePointer, api: EditorApi): void;
  /** מילוי האלמנט של פעולה על המסך. el כבר ממוקם וממדיו לפי op.rect */
  renderOp?(op: Operation, el: HTMLElement, view: PageView, api: EditorApi): void;
  /** לחיצה כפולה על פעולה (עריכה) */
  editOp?(op: Operation, view: PageView, api: EditorApi): void;
  /** האם אפשר להזיז/לשנות גודל בשכבה הכללית. ברירת מחדל true */
  movable?: boolean;
  /**
   * תיקון המלבן בזמן שינוי גודל בשכבה הכללית (למשל שמירת יחס בתמונה). לא נקרא בהזזה.
   * rect ו-handle במערכת של העמוד (נקודות PDF, n = למעלה ב-PDF) – הסיבוב כבר מטופל (pdfHandle ב-coords.ts).
   * shift – המשתמש מחזיק Shift. בלי הפונקציה המלבן נשאר כמו שהוא.
   */
  constrainRect?(op: Operation, rect: Rect, handle: Handle, shift: boolean): Rect;
  /** כתיבת הפעולה לעמוד ב-PDF */
  exportOp?(op: Operation, ctx: ExportCtx): void | Promise<void>;
  /** שלב ייצוא ברמת המסמך, אחרי כל העמודים (טפסים, שכבת טקסט וכו') */
  exportDocument?(ctx: DocExportCtx): void | Promise<void>;

  /** אחרי שנפתח מסמך חדש */
  onDocumentOpened?(api: EditorApi): void | Promise<void>;
  /** אחרי שעמוד צויר על המסך (למשל להוסיף שדות טופס או שכבת טקסט) */
  onPageRendered?(view: PageView, api: EditorApi): void;
  /** המרת קובץ שאינו PDF (תמונה וכו') ל-PDF בפתיחה. null – לא מטפל בקובץ הזה */
  convertFile?(file: File): Promise<Uint8Array | null>;
  /** פאנל צד (תמונות מוקטנות וכו') */
  panel?: { side: 'start' | 'end'; mount(el: HTMLElement, api: EditorApi): void };
}

class Registry {
  private tools: Tool[] = [];

  register(t: Tool | Tool[]) {
    for (const tool of Array.isArray(t) ? t : [t]) {
      if (this.tools.some((x) => x.id === tool.id)) throw new Error('כלי כפול: ' + tool.id);
      this.tools.push(tool);
    }
  }

  all(): readonly Tool[] {
    return this.tools;
  }

  get(id: string) {
    return this.tools.find((t) => t.id === id);
  }

  /** הכלי שמטפל בסוג פעולה */
  forOp(type: string) {
    return this.tools.find((t) => (t.opTypes ?? [t.id]).includes(type));
  }

  /** לבדיקות */
  clear() {
    this.tools = [];
  }
}

export const registry = new Registry();
