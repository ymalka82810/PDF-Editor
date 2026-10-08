import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { stateFromBytes } from '../../src/core/document';
import { exportPdf } from '../../src/core/export';
import { Store } from '../../src/core/model';
import { registry, type EditorApi } from '../../src/core/registry';
import { duplicatePages } from '../../src/tools/pages/duplicate';
import formsTool, { FLATTEN_KEY } from '../../src/tools/forms/index';
import { loadFixture } from '../helpers/pdf';

/** EditorApi מינימלי: onDocumentOpened ו-exportDocument של הכלי לא נוגעים ב-DOM או ב-pdfjsDoc */
function mockApi(store: Store): EditorApi {
  return {
    store,
    t: (k) => k,
    lang: () => 'he',
    activeTool: () => null,
    setActiveTool: () => {},
    views: () => [],
    viewOf: () => undefined,
    pdfjsDoc: () => Promise.reject(new Error('not needed in this test')),
    openFile: () => Promise.resolve(),
    addSource: () => Promise.reject(new Error('not needed in this test')),
    exportPdf: () => exportPdf(store.get()),
    toast: () => {},
  };
}

beforeEach(() => registry.clear());

describe('forms', () => {
  it('מזהה את כל סוגי השדות בקובץ, וממלא ערכי התחלה ב-formValues', async () => {
    const store = new Store();
    store.reset(await stateFromBytes('form.pdf', loadFixture('form.pdf')));
    await formsTool.onDocumentOpened!(mockApi(store));

    const values = store.get().formValues;
    expect(values.fullName).toBe('');
    expect(values.agree).toBe(false);
    expect(values.gender).toBe('');
    expect(Array.isArray(values.city) || typeof values.city === 'string').toBe(true);
  });

  it('לא דורס ערך שהמשתמש כבר שינה (למשל אחרי undo לפתיחה)', async () => {
    const store = new Store();
    store.reset(await stateFromBytes('form.pdf', loadFixture('form.pdf')));
    const api = mockApi(store);
    await formsTool.onDocumentOpened!(api);
    store.setFormValue('fullName', 'כבר מלא');
    await formsTool.onDocumentOpened!(api);
    expect(store.get().formValues.fullName).toBe('כבר מלא');
  });

  it('כותב ערכים בייצוא, כולל עברית, ו-pdf-lib טוען אותם בחזרה מהטופס', async () => {
    registry.register(formsTool);
    const store = new Store();
    store.reset(await stateFromBytes('form.pdf', loadFixture('form.pdf')));
    const api = mockApi(store);
    await formsTool.onDocumentOpened!(api);

    store.setFormValue('fullName', 'שלום עולם');
    store.setFormValue('agree', true);
    store.setFormValue('gender', 'female');
    store.setFormValue('city', 'Haifa');

    const out = await exportPdf(store.get());
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField('fullName').getText()).toBe('שלום עולם');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
    expect(form.getRadioGroup('gender').getSelected()).toBe('female');
    expect(form.getDropdown('city').getSelected()).toEqual(['Haifa']);
  });

  it('שיטוח (flatten) מסיר את כל השדות מהקובץ המיוצא', async () => {
    registry.register(formsTool);
    const store = new Store();
    store.reset(await stateFromBytes('form.pdf', loadFixture('form.pdf')));
    const api = mockApi(store);
    await formsTool.onDocumentOpened!(api);
    store.setFormValue('fullName', 'נועה');
    store.setFormValue(FLATTEN_KEY, true);

    const out = await exportPdf(store.get());
    expect((await PDFDocument.load(out)).getForm().getFields()).toHaveLength(0);
  });

  it('מוחק עמוד עם שדות: ה-widget שלהם לא נשאר יתום ב-AcroForm של הקובץ המיוצא', async () => {
    registry.register(formsTool);
    const store = new Store();
    const state = await stateFromBytes('form.pdf', loadFixture('form.pdf'));
    store.reset(state);
    const api = mockApi(store);
    await formsTool.onDocumentOpened!(api);

    store.setPages([]); // מוחק את העמוד היחיד, עם כל השדות
    const out = await exportPdf(store.get());
    const doc = await PDFDocument.load(out);
    // ה-widget של השדות לא נשאר יתום ב-AcroForm, גם שהעמוד שהוא היה עליו נמחק
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  it('שכפול עמוד עם widget של טופס לא שובר את הקובץ המיוצא', async () => {
    registry.register(formsTool);
    const store = new Store();
    const state = await stateFromBytes('form.pdf', loadFixture('form.pdf'));
    store.reset(state);
    const api = mockApi(store);
    await formsTool.onDocumentOpened!(api);

    duplicatePages(store, [state.pages[0].id]);
    expect(store.get().pages).toHaveLength(2);

    const out = await exportPdf(store.get());
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    // השדה עדיין קיים ותקין בעמוד המקורי
    expect(doc.getForm().getTextField('fullName')).toBeDefined();
  });
});
