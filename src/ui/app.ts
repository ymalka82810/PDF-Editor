/**
 * מעטפת האפליקציה: סרגל עליון, סרגל כלים מה-registry, פאנלים, תצוגת העמודים, פתיחה/שמירה, קיצורי מקלדת.
 * (סשן E אחראי לעיצוב ולהרחבות; החוזה מול הכלים הוא EditorApi ב-core/registry.ts)
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { CapacitorShareTarget } from '@capgo/capacitor-share-target';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { registerSW } from 'virtual:pwa-register';
import { rectToPdf, rectToView } from '../core/coords';
import { readSource, stateFromBytes } from '../core/document';
import { initialLang, lang, onLangChange, setLang, t } from '../core/i18n';
import { Store } from '../core/model';
import { openPdfjs } from '../core/pdfjs';
import { registry, type EditorApi, type Tool } from '../core/registry';
import { confirmDialog } from './dialog';
import { loadTools } from './load-tools';
import { editedName, saveBytes } from './save';
import { initialTheme, onThemeChange, setTheme, theme, type Theme } from './theme';
import { Viewer } from './viewer';

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
const THEME_CYCLE: Theme[] = ['system', 'light', 'dark'];
const ARROWS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
};

export function startApp(root: HTMLElement) {
  setLang(initialLang());
  setTheme(initialTheme());
  loadTools();

  const store = new Store();
  const docs = new Map<string, Promise<PDFDocumentProxy>>();
  let active: string | null = null;

  root.innerHTML = `
    <header class="topbar">
      <h1 class="brand" data-t="app.title"></h1>
      <div class="actions">
        <button type="button" data-cmd="open" data-t="open"></button>
        <button type="button" data-cmd="undo" data-t="undo" disabled></button>
        <button type="button" data-cmd="redo" data-t="redo" disabled></button>
        <span class="zoom">
          <button type="button" data-cmd="zoomOut" data-t-title="zoomOut">−</button>
          <output class="zoom-value">100%</output>
          <button type="button" data-cmd="zoomIn" data-t-title="zoomIn">+</button>
          <button type="button" data-cmd="fitWidth" data-t="fitWidth"></button>
        </span>
        <button type="button" class="primary" data-cmd="save" data-t="save" disabled></button>
        <button type="button" data-cmd="theme" data-t-title="theme"></button>
        <button type="button" data-cmd="help" data-t-title="help">?</button>
        <button type="button" data-cmd="lang" data-t="language"></button>
      </div>
      <input type="file" class="file-input" accept="application/pdf,.pdf,image/*" hidden>
    </header>
    <nav class="toolbar" role="toolbar"></nav>
    <div class="workspace">
      <aside class="panel panel-start" hidden></aside>
      <main class="scroller"><p class="empty" data-t="dropHint"></p></main>
      <aside class="panel panel-end" hidden></aside>
    </div>
    <div class="drawer-backdrop"></div>
    <div class="toasts" aria-live="polite"></div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const scroller = $<HTMLElement>('.scroller');
  const fileInput = $<HTMLInputElement>('.file-input');
  const toolbar = $<HTMLElement>('.toolbar');

  const api: EditorApi = {
    store,
    t,
    lang,
    activeTool: () => active,
    setActiveTool,
    views: () => viewer.views(),
    viewOf: (id) => viewer.viewOf(id),
    pdfjsDoc(sourceId) {
      let d = docs.get(sourceId);
      if (!d) {
        const src = store.get().sources[sourceId];
        if (!src) return Promise.reject(new Error('אין מקור ' + sourceId));
        docs.set(sourceId, (d = openPdfjs(src.bytes)));
        d.catch(() => docs.delete(sourceId));
      }
      return d;
    },
    openFile,
    async addSource(name, bytes) {
      const { source, pages } = await readSource(name, bytes);
      store.update((s) => ({ ...s, sources: { ...s.sources, [source.id]: source } }), { record: false });
      return { sourceId: source.id, pages };
    },
    exportPdf: async () => (await import('../core/export')).exportPdf(store.get()),
    toast,
  };

  const viewer = new Viewer(scroller, api);

  /* ---------- סרגל הכלים ---------- */

  const toolButtons = new Map<string, HTMLButtonElement>();
  const GROUPS: Tool['group'][] = ['edit', 'insert', 'page', 'form', 'other'];
  for (const group of GROUPS) {
    const tools = registry.all().filter((tl) => tl.toolbar !== false && (tl.group ?? 'other') === group);
    if (!tools.length) continue;
    const g = document.createElement('div');
    g.className = 'tool-group';
    for (const tool of tools) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.dataset.tool = tool.id;
      if (!tool.run) b.setAttribute('aria-pressed', 'false');
      b.onclick = () => (tool.run ? tool.run(api) : setActiveTool(active === tool.id ? null : tool.id));
      g.appendChild(b);
      toolButtons.set(tool.id, b);
    }
    toolbar.appendChild(g);
  }

  for (const tool of registry.all()) {
    if (!tool.panel) continue;
    const aside = $<HTMLElement>(tool.panel.side === 'start' ? '.panel-start' : '.panel-end');
    const box = document.createElement('section');
    box.className = 'panel-section panel-' + tool.id;
    aside.appendChild(box);
    aside.hidden = false;
    tool.panel.mount(box, api);
  }

  const backdrop = $<HTMLElement>('.drawer-backdrop');
  const actions = $<HTMLElement>('.actions');
  for (const side of ['start', 'end'] as const) {
    const aside = $<HTMLElement>('.panel-' + side);
    if (aside.hidden) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drawer-toggle';
    btn.dataset.cmd = 'drawer-' + side;
    btn.textContent = side === 'start' ? '☰' : '▤';
    btn.setAttribute('data-t-title', 'panels');
    actions.insertBefore(btn, actions.firstChild);
  }
  function closeDrawers() {
    for (const aside of root.querySelectorAll<HTMLElement>('.panel')) aside.classList.remove('open');
    backdrop.classList.remove('open');
  }
  function toggleDrawer(side: 'start' | 'end') {
    const aside = $<HTMLElement>('.panel-' + side);
    const opening = !aside.classList.contains('open');
    closeDrawers();
    if (opening) {
      aside.classList.add('open');
      backdrop.classList.add('open');
    }
  }
  backdrop.onclick = closeDrawers;

  function setActiveTool(id: string | null) {
    if (id === active) return;
    const prev = active ? registry.get(active) : undefined;
    prev?.deactivate?.(api);
    active = id;
    for (const [tid, b] of toolButtons) if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(tid === id));
    root.dataset.tool = id ?? '';
    if (id) registry.get(id)?.activate?.(api);
  }

  /* ---------- טקסטים ---------- */

  function translate() {
    document.title = t('app.title');
    for (const el of root.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = t(el.dataset.t!);
    for (const el of root.querySelectorAll<HTMLElement>('[data-t-title]')) el.title = el.ariaLabel = t(el.dataset.tTitle!);
    $<HTMLButtonElement>('[data-cmd=theme]').textContent = t('theme.' + theme());
    for (const [id, b] of toolButtons) {
      const tool = registry.get(id)!;
      const label = t(id + '.' + (tool.label ?? 'label'));
      b.innerHTML = tool.icon ? `<span class="icon" aria-hidden="true">${tool.icon}</span><span class="label"></span>` : '<span class="label"></span>';
      b.querySelector('.label')!.textContent = label;
      b.title = tool.shortcut ? `${label} (${tool.shortcut.toUpperCase()})` : label;
    }
  }
  translate();
  onLangChange(translate);

  /* ---------- פקודות ---------- */

  const commands: Record<string, () => void> = {
    open: () => fileInput.click(),
    undo: () => store.undo(),
    redo: () => store.redo(),
    zoomIn: () => viewer.setZoom(viewer.getZoom() * 1.2),
    zoomOut: () => viewer.setZoom(viewer.getZoom() / 1.2),
    fitWidth: () => viewer.fitWidth(),
    save: () => void save(),
    lang: () => setLang(lang() === 'he' ? 'en' : 'he'),
    theme: () => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme()) + 1) % THEME_CYCLE.length]),
    help: () => showHelp(),
    'drawer-start': () => toggleDrawer('start'),
    'drawer-end': () => toggleDrawer('end'),
  };
  onThemeChange(translate);
  root.addEventListener('click', (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]')?.dataset.cmd;
    if (cmd) commands[cmd]?.();
  });

  const refresh = () => {
    const s = store.get();
    $<HTMLButtonElement>('[data-cmd=undo]').disabled = !store.canUndo();
    $<HTMLButtonElement>('[data-cmd=redo]').disabled = !store.canRedo();
    $<HTMLButtonElement>('[data-cmd=save]').disabled = !s.pages.length;
    $<HTMLElement>('.empty').hidden = s.pages.length > 0;
    $<HTMLElement>('.zoom-value').textContent = Math.round(viewer.getZoom() * 100) + '%';
  };
  store.subscribe((s, prev) => {
    // מקורות שהוסרו – משחררים את המסמך של pdf.js
    for (const id of Object.keys(prev.sources))
      if (!s.sources[id]) {
        docs.get(id)?.then((d) => d.loadingTask.destroy());
        docs.delete(id);
      }
    refresh();
  });
  viewer.onZoom = refresh;

  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) void openFile(f);
  };

  /* ---------- גרירת קובץ ---------- */

  root.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      root.classList.add('dragging');
    }
  });
  root.addEventListener('dragleave', (e) => {
    if (e.target === root || !root.contains(e.relatedTarget as Node)) root.classList.remove('dragging');
  });
  root.addEventListener('drop', (e) => {
    root.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      e.preventDefault();
      void openFile(f);
    }
  });

  /* ---------- מקלדת ---------- */

  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) store.undo();
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) store.redo();
    else if (mod && k === 's') void save();
    else if (mod && k === 'o') fileInput.click();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selected) store.removeOp(store.selected);
    else if (e.key === 'Escape') {
      if (store.selected) store.select(null);
      else setActiveTool(null);
    } else if (mod && (k === '=' || k === '+')) viewer.setZoom(viewer.getZoom() * 1.2);
    else if (mod && k === '-') viewer.setZoom(viewer.getZoom() / 1.2);
    else if (!mod && e.key === '?') showHelp();
    else if (!mod && !e.altKey && store.selected && ARROWS[k]) moveSelected(ARROWS[k], e.shiftKey);
    else if (!mod && !e.altKey) {
      const tool = registry.all().find((tl) => tl.shortcut?.toLowerCase() === k);
      if (!tool) return;
      if (tool.run) void tool.run(api);
      else setActiveTool(active === tool.id ? null : tool.id);
    } else return;
    e.preventDefault();
  });

  /** הזזת הפעולה הנבחרת בחיצים, בפיקסלים קבועים על המסך (עובר דרך geom העמוד, לפי הסיבוב) */
  function moveSelected([dx, dy]: [number, number], big: boolean) {
    const op = store.get().ops.find((o) => o.id === store.selected);
    const view = op && viewer.viewOf(op.pageId);
    if (!op || !view) return;
    const step = big ? 10 : 1;
    const r = rectToView(view.geom, op.rect);
    r.x += dx * step;
    r.y += dy * step;
    store.updateOp(op.id, { rect: rectToPdf(view.geom, r) });
  }

  async function showHelp() {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';
    const rows: [string, string][] = [
      ['Ctrl+Z', t('help.undo')],
      ['Ctrl+Y', t('help.redo')],
      ['Ctrl+S', t('help.save')],
      ['Ctrl+O', t('help.open')],
      ['Delete', t('help.delete')],
      ['Escape', t('help.escape')],
      ['Ctrl+ +/-', t('help.zoomIn') + ' / ' + t('help.zoomOut')],
      ['↑↓←→', t('help.move')],
      ['?', t('help.toggle')],
    ];
    for (const tool of registry.all()) if (tool.shortcut) rows.push([tool.shortcut.toUpperCase(), t(tool.id + '.' + (tool.label ?? 'label'))]);
    dlg.innerHTML = `
      <form method="dialog" class="dlg-form">
        <h2 class="dlg-title"></h2>
        <dl class="help-list">${rows.map(() => `<dt><kbd></kbd></dt><dd></dd>`).join('')}</dl>
        <div class="dlg-actions"><button type="submit" class="dlg-ok primary"></button></div>
      </form>`;
    dlg.querySelector('.dlg-title')!.textContent = t('help.title');
    dlg.querySelector('.dlg-ok')!.textContent = t('dialog.ok');
    const kbds = dlg.querySelectorAll('kbd');
    const dds = dlg.querySelectorAll('dd');
    rows.forEach(([k2, v], i) => {
      kbds[i].textContent = k2;
      dds[i].textContent = v;
    });
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }

  /* ---------- פתיחה ושמירה ---------- */

  async function openFile(file: File) {
    try {
      let bytes: Uint8Array | null = null;
      if (isPdf(file)) bytes = new Uint8Array(await file.arrayBuffer());
      else
        for (const tool of registry.all()) {
          bytes = (await tool.convertFile?.(file)) ?? null;
          if (bytes) break;
        }
      if (!bytes) return toast(t('unsupportedFile'), 'error');
      const name = isPdf(file) ? file.name : file.name.replace(/\.[^.]+$/, '') + '.pdf';
      const state = await stateFromBytes(name, bytes);
      for (const d of docs.values()) void d.then((x) => x.loadingTask.destroy());
      docs.clear();
      setActiveTool(null);
      store.reset(state);
      viewer.fitWidth();
      for (const tool of registry.all()) await tool.onDocumentOpened?.(api);
    } catch (err) {
      console.error(err);
      toast(t('openFailed'), 'error');
    }
  }

  /* ---------- Android: קבלת PDF מ"שיתוף" מאפליקציה אחרת ----------
   * "פתח עם" (ACTION_VIEW) דורש טיפול נוסף בצד android/ (MainActivity.getIntent()) -
   * לא נבדק כאן כי אין Android SDK בסביבה הזו. */
  if (Capacitor.isNativePlatform()) {
    void CapacitorShareTarget.addListener('shareReceived', (event) => {
      const shared = event.files.find((f) => f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (!shared) return;
      void Filesystem.readFile({ path: shared.uri })
        .then(({ data }) => {
          if (typeof data !== 'string') throw new Error('תוצאה לא צפויה מ-Filesystem.readFile');
          return openFile(new File([base64ToBytes(data) as BlobPart], shared.name || 'shared.pdf', { type: 'application/pdf' }));
        })
        .catch((err: unknown) => {
          console.error(err);
          toast(t('openFailed'), 'error');
        });
    });
  }

  async function save() {
    const s = store.get();
    if (!s.pages.length) return;
    const btn = $<HTMLButtonElement>('[data-cmd=save]');
    btn.disabled = true;
    try {
      const { exportPdf } = await import('../core/export');
      const bytes = await exportPdf(s);
      const first = s.pages.find((p) => p.sourceId)?.sourceId;
      await saveBytes(editedName(first ? s.sources[first].name : 'document.pdf'), bytes);
    } catch (err) {
      console.error(err);
      toast(t('saveFailed'), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function toast(message: string, kind: 'info' | 'error' = 'info') {
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.textContent = message;
    $<HTMLElement>('.toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  refresh();

  /* ---------- PWA: עדכון גרסה ---------- */

  if ('serviceWorker' in navigator) {
    const updateSW = registerSW({
      onNeedRefresh() {
        void confirmDialog(api, { title: t('update.title'), message: t('update.message'), okLabel: t('update.reload') }).then((ok) => {
          if (ok) void updateSW(true);
        });
      },
    });
  }

  // לבדיקות e2e ולדיבאג
  (window as unknown as { editor: EditorApi }).editor = api;
  return api;
}
