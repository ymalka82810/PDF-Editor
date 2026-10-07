/**
 * פאנל תמונות מוקטנות: ציור עצלני לפי pdfjsDoc, מספור, מעבר לעמוד, בחירה מרובה (Ctrl/Shift)
 * וסידור מחדש בגרירה (pointer events – עובד גם במגע).
 */

import type { ViewGeom } from '../../core/coords';
import { viewSize } from '../../core/coords';
import type { EditorApi } from '../../core/registry';
import type { PageRef } from '../../core/types';
import type { PageSelection } from '../../tools/pages/selection';
import './thumbnails.css';

const THUMB_WIDTH = 120;

interface Entry {
  page: PageRef;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  numEl: HTMLElement;
  drawn: string;
  visible: boolean;
}

export interface ThumbnailsHandle {
  destroy(): void;
}

export function mountThumbnails(root: HTMLElement, api: EditorApi, selection: PageSelection): ThumbnailsHandle {
  root.classList.add('pages-panel');
  const nav = document.createElement('div');
  nav.className = 'pages-nav';
  const list = document.createElement('div');
  list.className = 'pages-list';
  root.append(nav, list);

  const entries = new Map<string, Entry>();
  let order: string[] = [];
  const io = new IntersectionObserver((hits) => onIntersect(hits), { root, rootMargin: '400px 0px' });

  let dragging: { id: string; startY: number; moved: boolean; tx: ReturnType<EditorApi['store']['begin']> } | null =
    null;

  function geomOf(p: PageRef): ViewGeom {
    const swap = p.rotation === 90 || p.rotation === 270;
    const base = swap ? p.height : p.width;
    return { width: p.width, height: p.height, rotation: p.rotation, scale: THUMB_WIDTH / base };
  }

  function syncList() {
    const state = api.store.get();
    selection.prune(new Set(state.pages.map((p) => p.id)));
    const ids = new Set(state.pages.map((p) => p.id));
    for (const [id, e] of entries) {
      if (ids.has(id)) continue;
      io.unobserve(e.el);
      e.el.remove();
      entries.delete(id);
    }
    state.pages.forEach((p, i) => {
      let e = entries.get(p.id);
      if (!e) e = create(p);
      else if (e.page !== p) {
        const changed =
          e.page.rotation !== p.rotation || e.page.sourceId !== p.sourceId || e.page.sourceIndex !== p.sourceIndex;
        e.page = p;
        if (changed) e.drawn = '';
        layout(e);
      }
      e.numEl.textContent = String(i + 1);
      e.el.setAttribute('aria-label', api.t('page', { n: i + 1 }));
      if (list.children[i] !== e.el) list.insertBefore(e.el, list.children[i] ?? null);
    });
    order = state.pages.map((p) => p.id);
    renderSelection();
    redrawVisible();
  }

  function create(page: PageRef): Entry {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.dataset.pageId = page.id;
    el.tabIndex = 0;
    const canvas = document.createElement('canvas');
    const numEl = document.createElement('span');
    numEl.className = 'thumb-num';
    el.append(canvas, numEl);
    const e: Entry = { page, el, canvas, numEl, drawn: '', visible: false };
    layout(e);
    el.addEventListener('pointerdown', (ev) => onPointerDown(e, ev));
    el.addEventListener('click', (ev) => onClick(e, ev));
    entries.set(page.id, e);
    io.observe(el);
    return e;
  }

  function layout(e: Entry) {
    const { w, h } = viewSize(geomOf(e.page));
    e.el.style.width = w + 'px';
    e.el.style.height = h + 'px';
  }

  function onIntersect(list: IntersectionObserverEntry[]) {
    for (const it of list) {
      const e = entries.get((it.target as HTMLElement).dataset.pageId!);
      if (!e) continue;
      e.visible = it.isIntersecting;
      if (e.visible) void draw(e);
    }
  }

  function redrawVisible() {
    for (const e of entries.values()) if (e.visible) void draw(e);
  }

  async function draw(e: Entry) {
    const dpr = window.devicePixelRatio || 1;
    const geom = geomOf(e.page);
    const key = [geom.scale, e.page.rotation, e.page.sourceId, e.page.sourceIndex].join('|');
    if (e.drawn === key) return;
    e.drawn = key;
    const { w, h } = viewSize({ ...geom, scale: geom.scale * dpr });
    e.canvas.width = Math.round(w);
    e.canvas.height = Math.round(h);
    const ctx = e.canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, e.canvas.width, e.canvas.height);
    if (!e.page.sourceId) return;
    try {
      const doc = await api.pdfjsDoc(e.page.sourceId);
      if (e.drawn !== key) return;
      const page = await doc.getPage(e.page.sourceIndex + 1);
      if (e.drawn !== key) return;
      await page.render({
        canvas: e.canvas,
        canvasContext: ctx,
        viewport: page.getViewport({ scale: geom.scale * dpr, rotation: e.page.rotation }),
      }).promise;
    } catch {
      if (e.drawn === key) e.drawn = '';
    }
  }

  /* ---------- בחירה ---------- */

  function renderSelection() {
    for (const e of entries.values()) e.el.classList.toggle('selected', selection.has(e.page.id));
  }

  function onClick(e: Entry, ev: MouseEvent) {
    if (dragging?.moved) return;
    if (ev.ctrlKey || ev.metaKey) selection.toggle(e.page.id);
    else if (ev.shiftKey) selection.range(e.page.id, order);
    else selection.only(e.page.id);
    api.viewOf(e.page.id)?.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ---------- סידור מחדש בגרירה ---------- */

  function onPointerDown(e: Entry, ev: PointerEvent) {
    if (ev.button !== 0) return;
    dragging = { id: e.page.id, startY: ev.clientY, moved: false, tx: api.store.begin() };
    e.el.setPointerCapture(ev.pointerId);
    const move = (m: PointerEvent) => {
      if (!dragging) return;
      if (!dragging.moved && Math.abs(m.clientY - dragging.startY) < 6) return;
      dragging.moved = true;
      e.el.classList.add('dragging');
      const after = order
        .filter((id) => id !== dragging!.id)
        .find((id) => {
          const el = entries.get(id)!.el;
          const r = el.getBoundingClientRect();
          return m.clientY < r.top + r.height / 2;
        });
      const state = api.store.get();
      const rest = state.pages.filter((p) => p.id !== dragging!.id);
      const moving = state.pages.find((p) => p.id === dragging!.id)!;
      const idx = after ? rest.findIndex((p) => p.id === after) : rest.length;
      rest.splice(idx, 0, moving);
      api.store.setPages(rest, { record: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      e.el.classList.remove('dragging');
      dragging?.tx.commit();
      dragging = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* ---------- מספר עמוד ומעבר לעמוד ---------- */

  nav.innerHTML = `<span class="pages-count"></span>
    <input type="number" class="pages-goto" min="1" step="1">`;
  const countEl = nav.querySelector<HTMLElement>('.pages-count')!;
  const gotoInput = nav.querySelector<HTMLInputElement>('.pages-goto')!;
  gotoInput.title = gotoInput.ariaLabel = api.t('pages.gotoLabel');
  gotoInput.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const n = Number(gotoInput.value);
    const pages = api.store.get().pages;
    const page = pages[n - 1];
    if (page) {
      selection.only(page.id);
      api.viewOf(page.id)?.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    gotoInput.blur();
  });

  function updateNav() {
    const total = api.store.get().pages.length;
    countEl.textContent = api.t('pages.count', { total });
    gotoInput.max = String(total);
  }

  const offStore = api.store.subscribe((s, prev) => {
    if (s.pages !== prev.pages || s.sources !== prev.sources) {
      syncList();
      updateNav();
    }
  });
  const offSel = selection.subscribe(renderSelection);

  syncList();
  updateNav();

  return {
    destroy() {
      offStore();
      offSel();
      io.disconnect();
    },
  };
}
