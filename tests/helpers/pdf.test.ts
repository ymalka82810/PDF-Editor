import { describe, expect, it } from 'vitest';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { fontBytes, loadFixture, pageInfo, textOf } from './pdf';

describe('fixtures', () => {
  it('hebrew.pdf: A4, logical-order Hebrew text, title larger than body', async () => {
    const bytes = loadFixture('hebrew.pdf');
    const info = await pageInfo(bytes);
    expect(info.pageCount).toBe(1);
    expect(info.pages[0].width).toBeCloseTo(595.28);
    expect(info.pages[0].height).toBeCloseTo(841.89);

    const { items, text } = await textOf(bytes);
    expect(items.map((i) => i.str)).toEqual([
      'מסמך בדיקה בעברית',
      'שלום עולם, זו שורה ראשונה.',
      'זו שורה שנייה עם עוד קצת טקסט.',
      'הזמנה מספר 12345 נשלחה ל-PDF Editor בתאריך 07/10/2026.',
      'שורה אחרונה בעמוד.',
    ]);
    expect(text).toContain('12345');
    expect(items[0].size).toBeCloseTo(24);
    expect(items[1].size).toBeCloseTo(14);
    expect(items[0].y).toBeCloseTo(760);
  });

  it('english.pdf: Helvetica paragraphs', async () => {
    const bytes = loadFixture('english.pdf');
    const { items } = await textOf(bytes);
    expect(items[0]).toMatchObject({ str: 'English Test Document', x: 50, y: 770 });
    expect(items[0].size).toBeCloseTo(22);
    expect(items.map((i) => i.str)).toContain('The quick brown fox jumps over the lazy dog.');
    expect(items).toHaveLength(6);
  });

  it('multipage.pdf: 5 pages, page 3 rotated, page 4 Letter landscape', async () => {
    const bytes = loadFixture('multipage.pdf');
    const info = await pageInfo(bytes);
    expect(info.pageCount).toBe(5);
    expect(info.pages.map((p) => p.rotation)).toEqual([0, 0, 90, 0, 0]);
    expect(info.pages[3]).toMatchObject({ width: 792, height: 612 });
    for (let i = 0; i < 5; i++) {
      const { items } = await textOf(bytes, i);
      expect(items.map((it) => it.str)).toEqual([String(i + 1), `Page ${i + 1}`]);
      expect(items[0].size).toBeCloseTo(200);
    }
  });

  it('form.pdf: four field types with Hebrew labels', async () => {
    const bytes = loadFixture('form.pdf');
    const form = (await PDFDocument.load(bytes)).getForm();
    expect(form.getFields().map((f) => f.getName())).toEqual(['fullName', 'agree', 'gender', 'city']);
    expect(form.getField('fullName')).toBeInstanceOf(PDFTextField);
    expect(form.getField('agree')).toBeInstanceOf(PDFCheckBox);
    expect(form.getField('gender')).toBeInstanceOf(PDFRadioGroup);
    expect(form.getRadioGroup('gender').getOptions()).toEqual(['male', 'female']);
    expect(form.getField('city')).toBeInstanceOf(PDFDropdown);
    expect(form.getDropdown('city').getOptions()).toEqual(['Jerusalem', 'Tel Aviv', 'Haifa']);

    const { items } = await textOf(bytes);
    expect(items.map((i) => i.str)).toEqual([
      'טופס בדיקה',
      'שם מלא:',
      'מאשר את התנאים',
      'מגדר:',
      'זכר',
      'נקבה',
      'עיר:',
    ]);
  });

  it('scanned.pdf: one image, no text layer', async () => {
    const bytes = loadFixture('scanned.pdf');
    expect((await pageInfo(bytes)).pageCount).toBe(1);
    const { items, text } = await textOf(bytes);
    expect(items).toEqual([]);
    expect(text).toBe('');
  });

  it('cropbox.pdf: MediaBox not at origin, CropBox inside it', async () => {
    const bytes = loadFixture('cropbox.pdf');
    const [page] = (await pageInfo(bytes)).pages;
    expect(page.mediaBox).toEqual({ x: 50, y: 50, width: 612, height: 792 });
    expect(page.cropBox).toEqual({ x: 100, y: 100, width: 500, height: 700 });
    const { items } = await textOf(bytes);
    // Text outside the CropBox is not reported by pdf.js.
    expect(items.map((i) => i.str)).toEqual(['CropBox top-left', 'CropBox bottom-left']);
    expect(items[0]).toMatchObject({ x: 120, y: 770 });
  });
});

describe('helpers', () => {
  it('textOf does not detach the input buffer', async () => {
    const bytes = loadFixture('english.pdf');
    await textOf(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
    await textOf(bytes);
  });

  it('fontBytes reads a TrueType font', () => {
    const bytes = fontBytes('Alef-Regular.ttf');
    expect(Array.from(bytes.slice(0, 4))).toEqual([0, 1, 0, 0]);
  });
});
