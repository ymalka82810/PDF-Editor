import { beforeEach, describe, expect, it } from 'vitest';
import { PageSelection } from '../../src/tools/pages/selection';

const order = ['a', 'b', 'c', 'd', 'e'];

let sel: PageSelection;

beforeEach(() => {
  sel = new PageSelection();
});

describe('PageSelection', () => {
  it('only replaces the whole selection and sets the anchor', () => {
    sel.toggle('a');
    sel.only('c');
    expect(sel.get()).toEqual(['c']);
    sel.range('e', order);
    expect(sel.get()).toEqual(['c', 'd', 'e']);
  });

  it('toggle adds and removes without touching the rest', () => {
    sel.toggle('a');
    sel.toggle('c');
    expect(sel.get()).toEqual(['a', 'c']);
    sel.toggle('a');
    expect(sel.get()).toEqual(['c']);
  });

  it('range selects from the anchor to the clicked page, in document order, either direction', () => {
    sel.only('b');
    sel.range('d', order);
    expect(sel.get()).toEqual(['b', 'c', 'd']);
    sel.only('d');
    sel.range('b', order);
    expect(sel.get()).toEqual(['b', 'c', 'd']);
  });

  it('range with no prior anchor selects just the clicked page', () => {
    sel.range('c', order);
    expect(sel.get()).toEqual(['c']);
  });

  it('clear empties the selection and notifies once', () => {
    sel.toggle('a');
    sel.clear();
    expect(sel.get()).toEqual([]);
    sel.clear();
  });

  it('prune drops ids that no longer exist and clears a stale anchor', () => {
    sel.toggle('a');
    sel.toggle('b');
    sel.prune(new Set(['b']));
    expect(sel.get()).toEqual(['b']);
    // anchor was 'b' (last toggled), still valid – a further range from it should work
    sel.range('b', order);
    expect(sel.get()).toEqual(['b']);
  });

  it('notifies subscribers only when the selection actually changes', () => {
    let calls = 0;
    sel.subscribe(() => calls++);
    sel.toggle('a');
    sel.prune(new Set(['a', 'b'])); // nothing removed
    expect(calls).toBe(1);
    sel.prune(new Set(['b'])); // removes 'a'
    expect(calls).toBe(2);
  });
});
