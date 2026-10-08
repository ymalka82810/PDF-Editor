/**
 * ניהול עמודים: פאנל תמונות מוקטנות (src/ui/thumbnails) ופקודות על העמודים הנבחרים –
 * סיבוב, מחיקה, שכפול, הוספת עמוד ריק, מיזוג קובץ, חילוץ ופיצול.
 * הבחירה (PageSelection) היא state מקומי של הכלי, לא חלק מ-DocState.
 *
 * קובץ התרגום מכיל מפתח לכל id של כלי במודול הזה (כולל 'pages' המשותף לפאנל ולהודעות שגיאה),
 * כי registry מוסיף קידומת לפי tool.id של כל כלי בנפרד.
 */

import { blankPage, normRotation } from '../../core/document';
import type { EditorApi, Locale, Tool } from '../../core/registry';
import type { PageRef } from '../../core/types';
import { editedName, saveBytes } from '../../ui/save';
import { mountThumbnails } from '../../ui/thumbnails';
import { duplicatePages } from './duplicate';
import { pageSelection } from './selection';
import en from './locales/en.json';
import he from './locales/he.json';

// pdf-lib נטען רק כשמייצאים (כמו ב-ui/app.ts) – ייבוא רגיל היה מחזיר אותו ל-bundle הראשי
const exportPdf: typeof import('../../core/export').exportPdf = async (...args) =>
  (await import('../../core/export')).exportPdf(...args);

type Dict = Record<string, Locale>;
const dicts = { he: he as Dict, en: en as Dict };
const localesOf = (id: string) => ({ he: dicts.he[id] ?? {}, en: dicts.en[id] ?? {} });

/** המקור לבסיס שם קובץ (לחילוץ/פיצול) */
function baseName(api: EditorApi): string {
  const s = api.store.get();
  const srcId = s.pages.find((p) => p.sourceId)?.sourceId;
  return srcId ? s.sources[srcId].name : 'document.pdf';
}

/** אינדקס ההכנסה: אחרי העמוד האחרון הנבחר, או בסוף אם אין בחירה */
function insertAfterSelection(pages: PageRef[]): number {
  const sel = new Set(pageSelection.get());
  if (!sel.size) return pages.length;
  let idx = -1;
  pages.forEach((p, i) => {
    if (sel.has(p.id)) idx = i;
  });
  return idx === -1 ? pages.length : idx + 1;
}

const panel: Tool = {
  id: 'pages',
  toolbar: false,
  locales: localesOf('pages'),
  panel: {
    side: 'start',
    mount(el, api) {
      mountThumbnails(el, api, pageSelection);
    },
  },
};

const rotateLeft: Tool = {
  id: 'pages-rotate-left',
  icon: '↺',
  group: 'page',
  locales: localesOf('pages-rotate-left'),
  run(api) {
    const sel = new Set(pageSelection.get());
    if (!sel.size) return api.toast(api.t('pages.noSelection'), 'error');
    api.store.setPages(
      api.store.get().pages.map((p) => (sel.has(p.id) ? { ...p, rotation: normRotation(p.rotation - 90) } : p)),
    );
  },
};

const rotateRight: Tool = {
  id: 'pages-rotate-right',
  icon: '↻',
  group: 'page',
  locales: localesOf('pages-rotate-right'),
  run(api) {
    const sel = new Set(pageSelection.get());
    if (!sel.size) return api.toast(api.t('pages.noSelection'), 'error');
    api.store.setPages(
      api.store.get().pages.map((p) => (sel.has(p.id) ? { ...p, rotation: normRotation(p.rotation + 90) } : p)),
    );
  },
};

const duplicate: Tool = {
  id: 'pages-duplicate',
  icon: '⧉',
  group: 'page',
  locales: localesOf('pages-duplicate'),
  run(api) {
    const sel = pageSelection.get();
    if (!sel.length) return api.toast(api.t('pages.noSelection'), 'error');
    const newIds = duplicatePages(api.store, sel);
    pageSelection.only(newIds[0]);
    for (const id of newIds.slice(1)) pageSelection.toggle(id);
  },
};

const deletePages: Tool = {
  id: 'pages-delete',
  icon: '🗑',
  group: 'page',
  locales: localesOf('pages-delete'),
  run(api) {
    const sel = new Set(pageSelection.get());
    if (!sel.size) return api.toast(api.t('pages.noSelection'), 'error');
    api.store.setPages(api.store.get().pages.filter((p) => !sel.has(p.id)));
    pageSelection.clear();
  },
};

const insertBlank: Tool = {
  id: 'pages-insert-blank',
  icon: '＋',
  group: 'page',
  locales: localesOf('pages-insert-blank'),
  run(api) {
    const pages = api.store.get().pages;
    const ref = pages.find((p) => pageSelection.has(p.id)) ?? pages[pages.length - 1];
    const blank = ref ? blankPage(ref.width, ref.height) : blankPage();
    const next = [...pages];
    next.splice(insertAfterSelection(pages), 0, blank);
    api.store.setPages(next);
    pageSelection.only(blank.id);
  },
};

const addFile: Tool = {
  id: 'pages-add-file',
  icon: '📂',
  group: 'page',
  locales: localesOf('pages-add-file'),
  run(api) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { pages: added } = await api.addSource(file.name, bytes);
        const pages = api.store.get().pages;
        const next = [...pages];
        next.splice(insertAfterSelection(pages), 0, ...added);
        api.store.setPages(next);
        pageSelection.only(added[0].id);
        for (const p of added.slice(1)) pageSelection.toggle(p.id);
      } catch (err) {
        console.error(err);
        api.toast(api.t('openFailed'), 'error');
      }
    };
    input.click();
  },
};

const extractSelected: Tool = {
  id: 'pages-extract',
  icon: '⇩',
  group: 'page',
  locales: localesOf('pages-extract'),
  async run(api) {
    const sel = pageSelection.get();
    if (!sel.length) return api.toast(api.t('pages.noSelection'), 'error');
    const bytes = await exportPdf(api.store.get(), { pageIds: sel });
    await saveBytes(editedName(baseName(api)), bytes);
  },
};

const splitAll: Tool = {
  id: 'pages-split-all',
  icon: '✂',
  group: 'page',
  locales: localesOf('pages-split-all'),
  async run(api) {
    const state = api.store.get();
    const name = baseName(api).replace(/\.[^.]+$/, '');
    for (let i = 0; i < state.pages.length; i++) {
      const bytes = await exportPdf(state, { pageIds: [state.pages[i].id] });
      await saveBytes(`${name}-${i + 1}.pdf`, bytes);
      // מרווח קטן בין הורדות, כדי שהדפדפן לא יחסום אותן
      await new Promise((r) => setTimeout(r, 150));
    }
  },
};

export default [
  panel,
  rotateLeft,
  rotateRight,
  duplicate,
  deletePages,
  insertBlank,
  addFile,
  extractSelected,
  splitAll,
] satisfies Tool[];
