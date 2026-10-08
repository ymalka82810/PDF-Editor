/**
 * תצוגת כל העמודים: canvas מ-pdf.js (רק לעמודים שנראים, ציור עצלני) ושכבת פעולות מעל כל עמוד.
 * השכבה הכללית מטפלת בבחירה, הזזה, שינוי גודל ולחיצה כפולה; לחיצה על מקום ריק עוברת לכלי הפעיל.
 */

import { rectToPdf, rectToView, toPdf, viewSize, type ViewGeom } from '../core/coords';
import { registry, type EditorApi, type PageView } from '../core/registry';
import type { DocState, PageRef, Rect } from '../core/types';

interface Entry extends PageView {
  canvas: HTMLCanvasElement;
  /** המפתח של מה שצויר (scale+rotation+source); ריק – צריך לצייר */
  drawn: string;
  task: { cancel(): void } | null;
  visible: boolean;
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

export class Viewer {
  readonly el: HTMLElement;
  private entries = new Map<string, Entry>();
  private order: string[] = [];
  private zoom = 1;
  private io: IntersectionObserver;
  /** נקרא אחרי כל שינוי זום */
  onZoom: (() => void) | null = null;

  constructor(
    private host: HTMLElement,
    private api: EditorApi,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pages';
    host.appendChild(this.el);
    this.io = new IntersectionObserver((list) => this.onIntersect(list), { root: host, rootMargin: '600px 0px' });
    api.store.subscribe((s, prev) => this.sync(s, prev));
    api.store.onSelect(() => this.renderAllOps());
    this.initPinchZoom();
  }

  /** פינצ'-זום בטלפון: שני מגעים על .scroller משנים את viewer.setZoom, לא את זום הדפדפן */
  private initPinchZoom() {
    let start: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    this.host.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2) start = { dist: dist(e.touches), zoom: this.zoom };
      },
      { passive: true },
    );
    this.host.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length !== 2 || !start) return;
        e.preventDefault();
        this.setZoom(start.zoom * (dist(e.touches) / start.dist));
      },
      { passive: false },
    );
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    this.host.addEventListener('touchend', end);
    this.host.addEventListener('touchcancel', end);
  }

  views(): PageView[] {
    return this.order.map((id) => this.entries.get(id)!).filter(Boolean);
  }

  viewOf(pageId: string): PageView | undefined {
    return this.entries.get(pageId);
  }

  getZoom() {
    return this.zoom;
  }

  setZoom(z: number) {
    this.zoom = Math.min(5, Math.max(0.2, z));
    for (const e of this.entries.values()) {
      e.geom = this.geomOf(e.page);
      this.layout(e);
    }
    this.renderAllOps();
    this.redrawVisible();
    this.onZoom?.();
  }

  /** זום שמתאים את העמוד הרחב ביותר לרוחב התצוגה */
  fitWidth() {
    const pages = this.api.store.get().pages;
    if (!pages.length) return;
    const widest = Math.max(...pages.map((p) => viewSize({ ...this.geomOf(p), scale: 1 }).w));
    const avail = this.host.clientWidth - 48;
    this.setZoom(Math.min(1.6, avail / widest));
  }

  scrollTo(pageId: string) {
    this.entries.get(pageId)?.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  private geomOf(p: PageRef): ViewGeom {
    return { width: p.width, height: p.height, rotation: p.rotation, scale: this.zoom };
  }

  /* ---------- סנכרון עם המודל ---------- */

  private sync(s: DocState, prev: DocState) {
    if (s.pages !== prev.pages || s.sources !== prev.sources) this.syncPages(s);
    if (s.ops !== prev.ops || s.pages !== prev.pages) this.renderAllOps();
  }

  private syncPages(s: DocState) {
    const ids = new Set(s.pages.map((p) => p.id));
    for (const [id, e] of this.entries) {
      if (ids.has(id)) continue;
      e.task?.cancel();
      this.io.unobserve(e.el);
      e.el.remove();
      this.entries.delete(id);
    }
    s.pages.forEach((p, i) => {
      let e = this.entries.get(p.id);
      if (!e) e = this.create(p);
      else if (e.page !== p) {
        const changed = e.page.rotation !== p.rotation || e.page.sourceId !== p.sourceId || e.page.sourceIndex !== p.sourceIndex;
        e.page = p;
        e.geom = this.geomOf(p);
        if (changed) e.drawn = '';
        this.layout(e);
      }
      e.el.dataset.index = String(i + 1);
      e.el.setAttribute('aria-label', this.api.t('page', { n: i + 1 }));
      // הסדר ב-DOM לפי הסדר במודל
      if (this.el.children[i] !== e.el) this.el.insertBefore(e.el, this.el.children[i] ?? null);
    });
    this.order = s.pages.map((p) => p.id);
    this.redrawVisible();
  }

  private create(page: PageRef): Entry {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.pageId = page.id;
    const canvas = document.createElement('canvas');
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    el.append(canvas, overlay);
    const e: Entry = { page, geom: this.geomOf(page), el, overlay, canvas, drawn: '', task: null, visible: false };
    this.layout(e);
    overlay.addEventListener('pointerdown', (ev) => this.onPointerDown(e, ev));
    overlay.addEventListener('dblclick', (ev) => this.onDblClick(e, ev));
    this.entries.set(page.id, e);
    this.io.observe(el);
    return e;
  }

  private layout(e: Entry) {
    const { w, h } = viewSize(e.geom);
    e.el.style.width = w + 'px';
    e.el.style.height = h + 'px';
  }

  /* ---------- ציור העמודים ---------- */

  private onIntersect(list: IntersectionObserverEntry[]) {
    for (const it of list) {
      const e = this.entries.get((it.target as HTMLElement).dataset.pageId!);
      if (!e) continue;
      e.visible = it.isIntersecting;
      if (e.visible) void this.draw(e);
    }
  }

  private redrawVisible() {
    for (const e of this.entries.values()) if (e.visible) void this.draw(e);
  }

  private async draw(e: Entry) {
    const dpr = window.devicePixelRatio || 1;
    const scale = this.zoom * dpr;
    const key = [scale, e.page.rotation, e.page.sourceId, e.page.sourceIndex].join('|');
    if (e.drawn === key) return;
    e.drawn = key;
    e.task?.cancel();
    e.task = null;
    const { w, h } = viewSize({ ...e.geom, scale });
    const target = document.createElement('canvas');
    target.width = Math.round(w);
    target.height = Math.round(h);
    const ctx = target.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, target.width, target.height);
    if (e.page.sourceId) {
      try {
        const doc = await this.api.pdfjsDoc(e.page.sourceId);
        if (e.drawn !== key) return;
        const page = await doc.getPage(e.page.sourceIndex + 1);
        if (e.drawn !== key) return;
        const task = page.render({ canvas: target, canvasContext: ctx, viewport: page.getViewport({ scale, rotation: e.page.rotation }) });
        e.task = task;
        await task.promise;
      } catch (err) {
        if ((err as Error)?.name !== 'RenderingCancelledException') console.error(err);
        if (e.drawn === key) e.drawn = '';
        return;
      }
      if (e.drawn !== key) return;
    }
    // מחליפים את ה-canvas רק כשהציור גמור, כדי שלא יהבהב
    target.className = e.canvas.className;
    e.canvas.replaceWith(target);
    e.canvas = target;
    for (const t of registry.all()) t.onPageRendered?.(e, this.api);
  }

  /* ---------- שכבת הפעולות ---------- */

  renderAllOps() {
    const ops = this.api.store.get().ops;
    for (const e of this.entries.values()) {
      // רק האלמנטים של הפעולות מתחלפים; אלמנטים שכלים הוסיפו לשכבה נשארים
      for (const el of [...e.overlay.querySelectorAll(':scope > .op')]) el.remove();
      for (const op of ops) {
        if (op.pageId !== e.page.id) continue;
        const tool = registry.forOp(op.type);
        const el = document.createElement('div');
        el.className = 'op op-' + op.type;
        el.dataset.opId = op.id;
        place(el, rectToView(e.geom, op.rect));
        tool?.renderOp?.(op, el, e, this.api);
        if (this.api.store.selected === op.id) {
          el.classList.add('selected');
          if (tool?.movable !== false)
            for (const h of HANDLES) {
              const d = document.createElement('div');
              d.className = 'handle handle-' + h;
              d.dataset.handle = h;
              el.appendChild(d);
            }
        }
        e.overlay.appendChild(el);
      }
    }
  }

  private onPointerDown(e: Entry, ev: PointerEvent) {
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement;
    const opEl = target.closest<HTMLElement>('.op');
    const active = this.api.activeTool();
    const activeTool = active ? registry.get(active) : undefined;
    // לחיצה על פעולה קיימת תמיד בוחרת אותה (ומתחילה הזזה), גם כשיש כלי פעיל
    if (opEl) {
      const id = opEl.dataset.opId!;
      this.api.store.select(id);
      const op = this.api.store.get().ops.find((o) => o.id === id);
      if (!op || registry.forOp(op.type)?.movable === false) return;
      ev.preventDefault();
      this.drag(e, ev, op.rect, id, (target.dataset.handle as Handle) || null);
      return;
    }
    if (activeTool?.onPointerDown) {
      const r = e.overlay.getBoundingClientRect();
      activeTool.onPointerDown({ view: e, event: ev, point: toPdf(e.geom, { x: ev.clientX - r.left, y: ev.clientY - r.top }) }, this.api);
      return;
    }
    this.api.store.select(null);
  }

  private onDblClick(e: Entry, ev: MouseEvent) {
    const opEl = (ev.target as HTMLElement).closest<HTMLElement>('.op');
    if (!opEl) return;
    const op = this.api.store.get().ops.find((o) => o.id === opEl.dataset.opId);
    if (op) registry.forOp(op.type)?.editOp?.(op, e, this.api);
  }

  /** הזזה (handle=null) או שינוי גודל של פעולה. הכל ביחידות מסך, ובסוף ממירים חזרה ל-PDF */
  private drag(e: Entry, ev: PointerEvent, startRect: Rect, id: string, handle: Handle | null) {
    const start = rectToView(e.geom, startRect);
    const x0 = ev.clientX,
      y0 = ev.clientY;
    const tx = this.api.store.begin();
    let moved = false;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - x0,
        dy = m.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const r = { ...start };
      if (!handle) {
        r.x += dx;
        r.y += dy;
      } else {
        if (handle.includes('w')) {
          const d = Math.min(dx, r.w - 4);
          r.x += d;
          r.w -= d;
        }
        if (handle.includes('e')) r.w = Math.max(4, r.w + dx);
        if (handle.includes('n')) {
          const d = Math.min(dy, r.h - 4);
          r.y += d;
          r.h -= d;
        }
        if (handle.includes('s')) r.h = Math.max(4, r.h + dy);
      }
      this.api.store.updateOp(id, { rect: rectToPdf(e.geom, r) }, { record: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      tx.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
}

export function place(el: HTMLElement, r: Rect) {
  el.style.left = r.x + 'px';
  el.style.top = r.y + 'px';
  el.style.width = r.w + 'px';
  el.style.height = r.h + 'px';
}
