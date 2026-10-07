import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, emptyState } from '../../src/core/model';
import { blankPage } from '../../src/core/document';
import type { PageRef } from '../../src/core/types';

const rect = { x: 10, y: 20, w: 30, h: 40 };

let store: Store;
let pages: PageRef[];

beforeEach(() => {
  store = new Store();
  pages = [blankPage(), blankPage(), blankPage()];
  store.reset({ ...emptyState(), pages });
});

const addBox = (pageId = pages[0].id, data: Record<string, unknown> = { color: 'red' }) =>
  store.addOp({ pageId, type: 'box', rect, data });

describe('ops', () => {
  it('addOp adds an op with a generated id', () => {
    const id = addBox();
    expect(id).toMatch(/^op-/);
    expect(store.get().ops).toEqual([{ id, pageId: pages[0].id, type: 'box', rect, data: { color: 'red' } }]);
    expect(store.opsOf(pages[0].id)).toHaveLength(1);
    expect(store.opsOf(pages[1].id)).toHaveLength(0);
  });

  it('addOp keeps a given id', () => {
    expect(store.addOp({ id: 'mine', pageId: pages[0].id, type: 'box', rect, data: {} })).toBe('mine');
  });

  it('updateOp patches rect and merges data, without mutating the old state', () => {
    const id = addBox(pages[0].id, { color: 'red', width: 2 });
    const before = store.get();
    store.updateOp(id, { rect: { x: 1, y: 2, w: 3, h: 4 }, data: { color: 'blue' } });
    expect(store.get().ops[0]).toMatchObject({
      rect: { x: 1, y: 2, w: 3, h: 4 },
      data: { color: 'blue', width: 2 },
    });
    expect(before.ops[0].rect).toEqual(rect);
    expect(before.ops[0].data).toEqual({ color: 'red', width: 2 });
  });

  it('updateOp with only data keeps the rect', () => {
    const id = addBox();
    store.updateOp(id, { data: { color: 'green' } });
    expect(store.get().ops[0].rect).toEqual(rect);
  });

  it('removeOp removes the op and clears its selection', () => {
    const a = addBox();
    const b = addBox();
    store.select(a);
    store.removeOp(a);
    expect(store.get().ops.map((o) => o.id)).toEqual([b]);
    expect(store.selected).toBeNull();
  });

  it('notifies subscribers with next and prev state', () => {
    const fn = vi.fn();
    store.subscribe(fn);
    const prev = store.get();
    addBox();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(store.get(), prev);
  });
});

describe('undo / redo', () => {
  it('undoes and redoes add, update and remove', () => {
    expect(store.canUndo()).toBe(false);
    const id = addBox();
    const s1 = store.get();
    store.updateOp(id, { rect: { x: 0, y: 0, w: 1, h: 1 } });
    const s2 = store.get();
    store.removeOp(id);
    expect(store.get().ops).toEqual([]);

    store.undo();
    expect(store.get()).toBe(s2);
    store.undo();
    expect(store.get()).toBe(s1);
    store.undo();
    expect(store.get().ops).toEqual([]);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);

    store.redo();
    expect(store.get()).toBe(s1);
    store.redo();
    expect(store.get()).toBe(s2);
    store.redo();
    expect(store.get().ops).toEqual([]);
    expect(store.canRedo()).toBe(false);
  });

  it('a new change clears the redo stack', () => {
    addBox();
    store.undo();
    expect(store.canRedo()).toBe(true);
    addBox();
    expect(store.canRedo()).toBe(false);
  });

  it('undo/redo on empty stacks do nothing', () => {
    const s = store.get();
    store.undo();
    store.redo();
    expect(store.get()).toBe(s);
  });

  it('reset clears history', () => {
    addBox();
    store.reset(emptyState());
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('record:false changes are not in history', () => {
    const id = addBox();
    store.updateOp(id, { rect: { x: 5, y: 5, w: 5, h: 5 } }, { record: false });
    store.undo();
    expect(store.get().ops).toEqual([]);
  });

  it('caps history at 200 entries', () => {
    for (let i = 0; i < 205; i++) store.setFormValue('f', String(i));
    let n = 0;
    while (store.canUndo()) {
      store.undo();
      n++;
    }
    expect(n).toBe(200);
    expect(store.get().formValues.f).toBe('4');
  });

  it('a change that changes nothing does not add a history entry', () => {
    store.removeOp('missing');
    store.updateOp('missing', { rect });
    expect(store.canUndo()).toBe(false);
  });
});

describe('begin / commit / cancel', () => {
  it('commit creates one history entry for many record:false updates', () => {
    const start = store.get();
    const g = store.begin();
    const id = store.addOp({ pageId: pages[0].id, type: 'box', rect, data: {} }, { record: false });
    for (let i = 1; i <= 5; i++) store.updateOp(id, { rect: { ...rect, x: i } }, { record: false });
    g.commit();
    expect(store.get().ops[0].rect.x).toBe(5);

    store.undo();
    expect(store.get()).toBe(start);
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect(store.get().ops[0].rect.x).toBe(5);
  });

  it('commit without changes adds nothing', () => {
    store.begin().commit();
    expect(store.canUndo()).toBe(false);
  });

  it('commit clears redo', () => {
    addBox();
    store.undo();
    expect(store.canRedo()).toBe(true);
    const g = store.begin();
    store.addOp({ pageId: pages[0].id, type: 'box', rect, data: {} }, { record: false });
    g.commit();
    expect(store.canRedo()).toBe(false);
  });

  it('cancel restores the state from before begin, without history', () => {
    const id = addBox();
    const start = store.get();
    const fn = vi.fn();
    store.subscribe(fn);
    const g = store.begin();
    store.updateOp(id, { rect: { x: 99, y: 99, w: 1, h: 1 } }, { record: false });
    g.cancel();
    expect(store.get()).toBe(start);
    expect(fn).toHaveBeenLastCalledWith(start, expect.anything());
    store.undo(); // only the addBox entry is left
    expect(store.get().ops).toEqual([]);
    expect(store.canUndo()).toBe(false);
  });

  it('cancel clears the selection of an op created during the gesture', () => {
    const g = store.begin();
    const id = store.addOp({ pageId: pages[0].id, type: 'box', rect, data: {} }, { record: false });
    store.select(id);
    g.cancel();
    expect(store.get().ops).toEqual([]);
    expect(store.selected).toBeNull();
  });
});

describe('setPages', () => {
  it('drops ops of removed pages and keeps the rest; undo restores them', () => {
    addBox(pages[0].id);
    const keep = addBox(pages[1].id);
    addBox(pages[2].id);
    store.setPages([pages[2], pages[1]]);
    expect(store.get().pages.map((p) => p.id)).toEqual([pages[2].id, pages[1].id]);
    expect(store.get().ops.map((o) => o.pageId)).toEqual([pages[1].id, pages[2].id]);
    expect(store.get().ops[0].id).toBe(keep);

    store.undo();
    expect(store.get().pages).toEqual(pages);
    expect(store.get().ops).toHaveLength(3);
  });

  it('clears the selection of an op on a removed page', () => {
    const id = addBox(pages[0].id);
    store.select(id);
    store.setPages([pages[1], pages[2]]);
    expect(store.get().ops).toEqual([]);
    expect(store.selected).toBeNull();
  });
});

describe('selection', () => {
  it('select notifies listeners only on change', () => {
    const fn = vi.fn();
    store.onSelect(fn);
    const id = addBox();
    store.select(id);
    store.select(id);
    store.select(null);
    expect(fn.mock.calls).toEqual([[id], [null]]);
  });

  it('undo clears the selection when the selected op disappears', () => {
    const id = addBox();
    store.select(id);
    store.undo();
    expect(store.selected).toBeNull();
  });

  it('undo keeps the selection when the selected op still exists', () => {
    const id = addBox();
    store.updateOp(id, { rect: { x: 0, y: 0, w: 1, h: 1 } });
    store.select(id);
    store.undo();
    expect(store.selected).toBe(id);
  });

  it('redo clears the selection when the selected op disappears', () => {
    const id = addBox();
    store.removeOp(id);
    store.undo();
    store.select(id);
    store.redo();
    expect(store.selected).toBeNull();
  });
});
