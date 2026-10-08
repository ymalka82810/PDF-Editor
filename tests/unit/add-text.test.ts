import { beforeEach, describe, expect, it } from 'vitest';
import { blankPage } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { registry } from '../../src/core/registry';
import type { DocState } from '../../src/core/types';
import { textOf } from '../helpers/pdf';
import tool, { type TextData } from '../../src/tools/add-text';

beforeEach(() => {
  registry.clear();
  registry.register(tool);
});

const op = (id: string, data: TextData) => ({ id, pageId: 'p1', type: 'add-text', rect: { x: 40, y: 700, w: 300, h: 40 }, data });

describe('add-text exportOp', () => {
  it('כותב טקסט עברי ואנגלי בסדר לוגי', async () => {
    const page = { ...blankPage(), id: 'p1' };
    const state: DocState = {
      sources: {},
      pages: [page],
      ops: [
        op('o1', { text: 'שלום עולם', size: 20, color: '#000000', font: 'default', align: 'start' }),
        op('o2', { text: 'Hello World', size: 20, color: '#000000', font: 'default', align: 'start' }),
      ],
      formValues: {},
    };
    const bytes = await exportPdf(state);
    const { text } = await textOf(bytes, 0);
    expect(text).toContain('שלום עולם');
    expect(text).toContain('Hello World');
  });

  it('לא כותב כלום כשהטקסט ריק', async () => {
    const page = { ...blankPage(), id: 'p1' };
    const state: DocState = {
      sources: {},
      pages: [page],
      ops: [op('o1', { text: '', size: 20, color: '#000000', font: 'default', align: 'start' })],
      formValues: {},
    };
    const bytes = await exportPdf(state);
    const { items } = await textOf(bytes, 0);
    expect(items).toHaveLength(0);
  });

  it('מכבד סיבוב (data.rotate) בלי לזרוק שגיאה ושומר על הטקסט', async () => {
    const page = { ...blankPage(), id: 'p1' };
    const state: DocState = {
      sources: {},
      pages: [page],
      ops: [op('o1', { text: 'rotated', size: 20, color: '#000000', font: 'default', align: 'start', rotate: 90 })],
      formValues: {},
    };
    const bytes = await exportPdf(state);
    const { text } = await textOf(bytes, 0);
    expect(text).toContain('rotated');
  });
});
