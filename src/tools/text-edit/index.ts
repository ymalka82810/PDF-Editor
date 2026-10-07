/**
 * עריכת טקסט קיים: כשהכלי פעיל מסומנים פריטי הטקסט בעמוד, לחיצה על פריט פותחת עריכה במקום.
 * השמירה יוצרת פעולת text-edit (ראו export.ts). מחיקה = טקסט ריק. הזזה ושינוי גודל – דרך השכבה הכללית.
 * עובד גם על פריטים ממקורות אחרים (OCR) – registerTextSource ב-pdf-read/text.ts.
 */

import { rectToView } from '../../core/coords';
import type { EditorApi, PageView, Tool } from '../../core/registry';
import type { Operation, Rect, TextItem } from '../../core/types';
import { place } from '../../ui/viewer';
import { clearFonts, fontKey, getFont, missingChars } from '../../pdf-read/fonts';
import { clearTextCache, onTextItems, textItemsOf } from '../../pdf-read/text';
import { baselineOffset, coverRect, dataOf, exportTextEdit, OP_TYPE, type TextEditData } from './export';
import { analyzeInk } from './ink';
import he from './locales/he.json';
import en from './locales/en.json';
import './text-edit.css';

let active = false;
let unsubs: (() => void)[] = [];
/** העורך הפתוח (אחד לכל היותר) */
let editor: { pageId: string; scale: number; close(commit: boolean): void } | null = null;

/** מזהה של פריט מקורי, כדי לא לסמן פריט שכבר נערך */
const itemKey = (it: TextItem) => [it.pageId, it.rect.x.toFixed(2), it.baseline.toFixed(2), it.str].join('|');

const editedKeys = (api: EditorApi) =>
  new Set(
    api.store
      .get()
      .ops.filter((o) => o.type === OP_TYPE)
      .map((o) => itemKey(dataOf(o).original)),
  );

/* ---------- סימון הפריטים ---------- */

async function showFrames(view: PageView, api: EditorApi) {
  const items = await textItemsOf(api, view.page).catch(() => []);
  for (const el of view.overlay.querySelectorAll(':scope > .text-edit-frame')) el.remove();
  if (!active) return;
  const edited = editedKeys(api);
  for (const it of items) {
    if (edited.has(itemKey(it))) continue;
    const el = document.createElement('div');
    el.className = 'text-edit-frame';
    place(el, rectToView(view.geom, it.rect));
    view.overlay.appendChild(el);
  }
}

function clearAllFrames() {
  for (const el of document.querySelectorAll('.text-edit-frame')) el.remove();
}

/* ---------- תצוגה ---------- */

/** משפחת הגופן להצגה על המסך (הגופן המוטמע עצמו לא שמיש בדפדפן – האותיות שלו בקודים פרטיים) */
function cssFont(d: TextEditData, scale: number) {
  const ef = d.fontKey ? getFont(d.fontKey) : undefined;
  const generic = ef?.serif ? 'serif' : 'sans-serif';
  const family = ef?.family ? `"${ef.family}", ${generic}` : generic;
  return `${d.italic || ef?.italic ? 'italic ' : ''}${d.bold ? 'bold ' : ''}${d.size * scale}px ${family}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** גובה האותיות מעל קו הבסיס ומתחתיו, בפיקסלים, לפי הגופן בדפדפן */
function metrics(font: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return { ascent: 0, descent: 0 };
  measureCtx.font = font;
  const m = measureCtx.measureText('Hgאל');
  return { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
}

/**
 * תיבה בכיוון של העמוד המקורי (לפני סיבוב) בתוך אלמנט שממוקם לפי rectToView(rect):
 * בעמוד מסובב הטקסט מסתובב יחד עם העמוד.
 */
function pageBox(view: PageView, rect: Rect) {
  const s = view.geom.scale;
  const vr = rectToView(view.geom, rect);
  const box = document.createElement('div');
  box.className = 'text-edit-box';
  const w = rect.w * s;
  const h = rect.h * s;
  Object.assign(box.style, {
    width: w + 'px',
    height: h + 'px',
    left: (vr.w - w) / 2 + 'px',
    top: (vr.h - h) / 2 + 'px',
    transform: view.geom.rotation ? `rotate(${view.geom.rotation}deg)` : '',
  });
  return box;
}

/** אלמנט שורת הטקסט בתוך pageBox, כשקו הבסיס במקום של קו הבסיס ב-PDF */
function lineEl(tag: 'div' | 'span', d: TextEditData, rect: Rect, scale: number): HTMLElement {
  const el: HTMLElement = document.createElement(tag);
  const font = cssFont(d, scale);
  const { ascent, descent } = metrics(font);
  const baseFromTop = (rect.h - baselineOffset(d)) * scale;
  Object.assign(el.style, {
    font,
    color: d.color,
    direction: d.original.rtl ? 'rtl' : 'ltr',
    lineHeight: ascent + descent + 'px',
    top: baseFromTop - ascent + 'px',
    [d.original.rtl ? 'right' : 'left']: '0',
  });
  return el;
}

function renderOp(op: Operation, el: HTMLElement, view: PageView) {
  const d = dataOf(op);
  const s = view.geom.scale;
  el.classList.add('text-edit-op');
  const ev = rectToView(view.geom, op.rect);
  const cv = rectToView(view.geom, coverRect(d));
  const cover = document.createElement('div');
  cover.className = 'text-edit-cover';
  place(cover, { x: cv.x - ev.x, y: cv.y - ev.y, w: cv.w, h: cv.h });
  cover.style.background = d.bg;
  const box = pageBox(view, op.rect);
  if (d.text) {
    const line = lineEl('span', d, op.rect, s);
    line.className = 'text-edit-text';
    line.textContent = d.text;
    box.appendChild(line);
  } else el.classList.add('text-edit-deleted');
  el.append(cover, box);
}

/* ---------- עריכה במקום ---------- */

/** נתוני פעולה חדשה מפריט: הגופן מהמאגר, וצבעי הדיו והרקע מה-canvas של העמוד */
function newData(view: PageView, item: TextItem): TextEditData {
  const key = item.fontName && view.page.sourceId ? fontKey(view.page.sourceId, item.fontName) : undefined;
  const ef = key ? getFont(key) : undefined;
  let ink = { fg: '#000000', bg: '#ffffff' };
  const canvas = view.el.querySelector('canvas');
  if (canvas && view.el.clientWidth) {
    const k = canvas.width / view.el.clientWidth;
    const r = rectToView(view.geom, item.rect);
    ink = analyzeInk(canvas, { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
  }
  return {
    original: item,
    text: item.str,
    ...(ef ? { fontKey: key } : {}),
    size: item.size,
    color: item.color ?? ink.fg,
    bg: ink.bg,
    ...(ef?.bold ? { bold: true } : {}),
    ...(item.italic ? { italic: true } : {}),
  };
}

/** הרוחב החדש של המלבן, כשהעיגון נשאר בצד של תחילת השורה (ימין בעברית) */
function resized(rect: Rect, w: number, rtl: boolean): Rect {
  if (!(w > 1)) return rect;
  return rtl ? { ...rect, x: rect.x + rect.w - w, w } : { ...rect, w };
}

function startEdit(view: PageView, api: EditorApi, target: { item: TextItem } | { op: Operation }) {
  editor?.close(true);
  const op = 'op' in target ? target.op : null;
  const d = op ? dataOf(op) : newData(view, (target as { item: TextItem }).item);
  const rect = op ? op.rect : d.original.rect;
  const s = view.geom.scale;

  const wrap = document.createElement('div');
  wrap.className = 'text-edit-editor';
  place(wrap, rectToView(view.geom, rect));
  const box = pageBox(view, rect);
  const input = lineEl('div', d, rect, s);
  input.className = 'text-edit-input';
  input.contentEditable = 'true';
  input.spellcheck = false;
  input.dir = d.original.rtl ? 'rtl' : 'ltr';
  input.style.minWidth = rect.w * s + 'px';
  input.style.background = d.bg;
  input.textContent = d.text;
  box.appendChild(input);
  wrap.appendChild(box);
  view.overlay.appendChild(wrap);
  if (op) view.overlay.querySelector<HTMLElement>(`.op[data-op-id="${op.id}"]`)?.classList.add('text-edit-hidden');

  let done = false;
  const close = (commit: boolean) => {
    if (done) return;
    done = true;
    editor = null;
    const text = (input.textContent ?? '').replace(/\s*\n\s*/g, ' ');
    const width = input.scrollWidth / s;
    wrap.remove();
    view.overlay.querySelector('.text-edit-hidden')?.classList.remove('text-edit-hidden');
    if (!commit) return;
    const newRect = text.trim() ? resized(rect, width, d.original.rtl) : rect;
    if (op) {
      if (text !== d.text) api.store.updateOp(op.id, { data: { text }, rect: newRect });
    } else if (text !== d.original.str) {
      const id = api.store.addOp<TextEditData>({
        pageId: view.page.id,
        type: OP_TYPE,
        rect: newRect,
        data: { ...d, text },
      });
      api.store.select(id);
    }
    const ef = d.fontKey ? getFont(d.fontKey) : undefined;
    const missing = ef?.data ? missingChars(ef, text) : [];
    if (missing.length) api.toast(api.t('text-edit.missing', { chars: missing.join(' ') }));
  };
  editor = { pageId: view.page.id, scale: s, close };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    }
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain').replace(/\s*\n\s*/g, ' ') ?? '';
    document.execCommand('insertText', false, text);
  });
  input.addEventListener('blur', () => close(true));
  wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
  wrap.addEventListener('dblclick', (e) => e.stopPropagation());

  input.focus();
  const sel = getSelection();
  sel?.selectAllChildren(input);
}

/** הפריט שבנקודה (הקטן ביותר, אם יש כמה) */
function hit(items: TextItem[], p: { x: number; y: number }, skip: Set<string>) {
  const tol = 1;
  let best: TextItem | null = null;
  for (const it of items) {
    const r = it.rect;
    if (skip.has(itemKey(it))) continue;
    if (p.x < r.x - tol || p.x > r.x + r.w + tol || p.y < r.y - tol || p.y > r.y + r.h + tol) continue;
    if (!best || r.w * r.h < best.rect.w * best.rect.h) best = it;
  }
  return best;
}

const tool: Tool = {
  id: 'text-edit',
  icon: '✎',
  group: 'edit',
  shortcut: 'e',
  opTypes: [OP_TYPE],
  locales: { he, en },

  activate(api) {
    active = true;
    unsubs = [
      api.store.subscribe((s, prev) => {
        if (s.ops !== prev.ops) for (const v of api.views()) void showFrames(v, api);
      }),
      onTextItems((pageId) => {
        const v = api.viewOf(pageId);
        if (v) void showFrames(v, api);
      }),
    ];
    for (const v of api.views()) void showFrames(v, api);
  },

  deactivate() {
    active = false;
    editor?.close(true);
    for (const u of unsubs) u();
    unsubs = [];
    clearAllFrames();
  },

  onPageRendered(view, api) {
    // אחרי זום העורך כבר לא במקום – שומרים אותו
    if (editor?.pageId === view.page.id && editor.scale !== view.geom.scale) editor.close(true);
    if (active) void showFrames(view, api);
  },

  onDocumentOpened() {
    clearTextCache();
    clearFonts();
  },

  onPointerDown(p, api) {
    // בלי זה הלחיצה מעבירה את המיקוד לגוף הדף וסוגרת את העורך מיד אחרי שנפתח
    p.event.preventDefault();
    void (async () => {
      const items = await textItemsOf(api, p.view.page);
      if (!items.length) return api.toast(api.t('text-edit.noText'));
      const item = hit(items, p.point, editedKeys(api));
      if (item) startEdit(p.view, api, { item });
    })();
  },

  renderOp(op, el, view) {
    renderOp(op, el, view);
  },

  editOp(op, view, api) {
    startEdit(view, api, { op });
  },

  exportOp: exportTextEdit,
};

export default tool;
