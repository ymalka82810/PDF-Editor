/**
 * מצב המסמך, עם בטל/בצע שוב. המצב לא משתנה במקום: כל עדכון מחזיר אובייקט חדש
 * (הבתים של קובצי המקור משותפים, הם לא משתנים לעולם).
 */

import type { DocState, Operation, PageRef, Rect } from './types';

export const emptyState = (): DocState => ({ sources: {}, pages: [], ops: [], formValues: {} });

let counter = 0;
/** מזהה ייחודי לפעולה, עמוד או מקור */
export const uid = (prefix = 'id') => prefix + '-' + Date.now().toString(36) + '-' + (counter++).toString(36);

type Listener = (state: DocState, prev: DocState) => void;
type SelListener = (selected: string | null) => void;

export interface UpdateOptions {
  /** false – בלי רשומה בהיסטוריה (למשל תוך כדי גרירה; ראו begin) */
  record?: boolean;
}

export class Store {
  private state: DocState = emptyState();
  private undoStack: DocState[] = [];
  private redoStack: DocState[] = [];
  private listeners = new Set<Listener>();
  private selListeners = new Set<SelListener>();
  private selectedId: string | null = null;

  get(): DocState {
    return this.state;
  }

  /** מחליף את כל המסמך (פתיחת קובץ) ומנקה את ההיסטוריה */
  reset(state: DocState) {
    const prev = this.state;
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.select(null);
    this.emit(prev);
  }

  update(recipe: (s: DocState) => DocState, opts: UpdateOptions = {}) {
    const prev = this.state;
    const next = recipe(prev);
    if (next === prev) return;
    if (opts.record !== false) this.record(prev);
    this.state = next;
    this.dropMissingSelection();
    this.emit(prev);
  }

  /**
   * פעולה מתמשכת (גרירה): העדכונים בדרך עם record:false, ובסוף commit() יוצר רשומה אחת בהיסטוריה.
   * cancel() מחזיר למצב שלפני.
   */
  begin() {
    const start = this.state;
    return {
      commit: () => {
        if (this.state !== start) this.record(start);
      },
      cancel: () => {
        const prev = this.state;
        if (prev === start) return;
        this.state = start;
        this.dropMissingSelection();
        this.emit(prev);
      },
    };
  }

  private record(prev: DocState) {
    this.undoStack.push(prev);
    this.redoStack = [];
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  canUndo = () => this.undoStack.length > 0;
  canRedo = () => this.redoStack.length > 0;

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    const prev = this.state;
    this.redoStack.push(prev);
    this.state = s;
    this.dropMissingSelection();
    this.emit(prev);
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    const prev = this.state;
    this.undoStack.push(prev);
    this.state = s;
    this.dropMissingSelection();
    this.emit(prev);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /* ---------- בחירה (לא חלק מההיסטוריה) ---------- */

  get selected() {
    return this.selectedId;
  }

  select(id: string | null) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    for (const fn of this.selListeners) fn(id);
  }

  onSelect(fn: SelListener) {
    this.selListeners.add(fn);
    return () => this.selListeners.delete(fn);
  }

  /* ---------- קיצורים לשינויים נפוצים ---------- */

  addOp<D>(op: Omit<Operation<D>, 'id'> & { id?: string }, opts?: UpdateOptions): string {
    const full = { ...op, id: op.id ?? uid('op') } as Operation;
    this.update((s) => ({ ...s, ops: [...s.ops, full] }), opts);
    return full.id;
  }

  updateOp(id: string, patch: { rect?: Rect; data?: Record<string, unknown> }, opts?: UpdateOptions) {
    // מזהה שלא קיים – מחזירים את אותו מצב, כדי שלא תיווצר רשומה ריקה בהיסטוריה
    this.update((s) => {
      if (!s.ops.some((o) => o.id === id)) return s;
      return {
        ...s,
        ops: s.ops.map((o) =>
          o.id !== id ? o : { ...o, ...(patch.rect ? { rect: patch.rect } : {}), ...(patch.data ? { data: { ...o.data, ...patch.data } } : {}) },
        ),
      };
    }, opts);
  }

  removeOp(id: string) {
    this.update((s) => (s.ops.some((o) => o.id === id) ? { ...s, ops: s.ops.filter((o) => o.id !== id) } : s));
  }

  /** מחליף את רשימת העמודים. פעולות של עמודים שנמחקו נמחקות גם הן */
  setPages(pages: PageRef[], opts?: UpdateOptions) {
    this.update((s) => {
      if (pages.length === s.pages.length && pages.every((p, i) => p === s.pages[i])) return s;
      const ids = new Set(pages.map((p) => p.id));
      return { ...s, pages, ops: s.ops.filter((o) => ids.has(o.pageId)) };
    }, opts);
  }

  setFormValue(name: string, value: DocState['formValues'][string], opts?: UpdateOptions) {
    this.update((s) => {
      const old = s.formValues[name];
      const same = Array.isArray(old) && Array.isArray(value) ? old.length === value.length && old.every((v, i) => v === value[i]) : old === value;
      return same ? s : { ...s, formValues: { ...s.formValues, [name]: value } };
    }, opts);
  }

  opsOf(pageId: string) {
    return this.state.ops.filter((o) => o.pageId === pageId);
  }

  private dropMissingSelection() {
    if (this.selectedId && !this.state.ops.some((o) => o.id === this.selectedId)) this.select(null);
  }

  private emit(prev: DocState) {
    for (const fn of this.listeners) fn(this.state, prev);
  }
}
