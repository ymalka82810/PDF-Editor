// Generates the PDF test fixtures in tests/fixtures/.
// Run with: npm run fixtures
// Output is deterministic (fixed dates, no random IDs) so the files can be committed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, PageSizes, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'fixtures');
const fontPath = path.join(root, 'src', 'assets', 'fonts', 'Alef-Regular.ttf');
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');
const bidi = bidiFactory();

async function newDoc(title) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setProducer('pdf-editor make-fixtures');
  doc.setCreator('pdf-editor make-fixtures');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

async function embedHebrewFont(doc) {
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(fontPath), { subset: true });
  // fontkit's layout() reverses glyphs on its own when the string's first strong
  // script is RTL. We already pass text in visual order, so force LTR shaping.
  const fk = font.embedder.font;
  const layout = fk.layout.bind(fk);
  fk.layout = (str, features) => layout(str, features, undefined, undefined, 'ltr');
  return font;
}

/** Logical string -> visual (display) order for an RTL paragraph. */
function visual(text) {
  const levels = bidi.getEmbeddingLevels(text, 'rtl');
  return bidi.getReorderedString(text, levels);
}

/** Draws logical-order Hebrew text right-aligned so its right edge is at `right`. */
function drawRtl(page, text, { right, y, size, font, color = rgb(0, 0, 0) }) {
  const v = visual(text);
  const width = font.widthOfTextAtSize(v, size);
  page.drawText(v, { x: right - width, y, size, font, color });
}

async function save(doc, name) {
  const bytes = await doc.save({ useObjectStreams: false });
  fs.writeFileSync(path.join(outDir, name), bytes);
  console.log(`${name}  ${bytes.length} bytes`);
}

// ---------------------------------------------------------------- hebrew.pdf
async function makeHebrew() {
  const doc = await newDoc('Hebrew fixture');
  const font = await embedHebrewFont(doc);
  const page = doc.addPage(PageSizes.A4); // 595.28 x 841.89
  const right = 545;
  drawRtl(page, 'מסמך בדיקה בעברית', { right, y: 760, size: 24, font });
  drawRtl(page, 'שלום עולם, זו שורה ראשונה.', { right, y: 700, size: 14, font });
  drawRtl(page, 'זו שורה שנייה עם עוד קצת טקסט.', { right, y: 676, size: 14, font });
  drawRtl(page, 'הזמנה מספר 12345 נשלחה ל-PDF Editor בתאריך 07/10/2026.', {
    right,
    y: 652,
    size: 14,
    font,
  });
  drawRtl(page, 'שורה אחרונה בעמוד.', { right, y: 628, size: 14, font });
  await save(doc, 'hebrew.pdf');
}

// --------------------------------------------------------------- english.pdf
async function makeEnglish() {
  const doc = await newDoc('English fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(PageSizes.A4);
  page.drawText('English Test Document', { x: 50, y: 770, size: 22, font: bold });
  const paragraphs = [
    ['The quick brown fox jumps over the lazy dog.', 'This is the first paragraph of the English fixture.'],
    ['Second paragraph: invoices 2024-001 through 2024-099 are attached.', 'Please review them before Friday.'],
    ['Third paragraph with punctuation: commas, periods; and (parentheses).'],
  ];
  let y = 720;
  for (const para of paragraphs) {
    for (const line of para) {
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 16;
    }
    y -= 12;
  }
  await save(doc, 'english.pdf');
}

// ------------------------------------------------------------- multipage.pdf
async function makeMultipage() {
  const doc = await newDoc('Multipage fixture');
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= 5; i++) {
    const size = i === 4 ? [PageSizes.Letter[1], PageSizes.Letter[0]] : PageSizes.A4;
    const page = doc.addPage(size);
    const [w, h] = size;
    const label = String(i);
    const fs_ = 200;
    page.drawText(label, {
      x: (w - font.widthOfTextAtSize(label, fs_)) / 2,
      y: (h - fs_ * 0.7) / 2,
      size: fs_,
      font,
    });
    page.drawText(`Page ${i}`, { x: 40, y: h - 50, size: 18, font });
    if (i === 3) page.setRotation(degrees(90));
  }
  await save(doc, 'multipage.pdf');
}

// ------------------------------------------------------------------ form.pdf
async function makeForm() {
  const doc = await newDoc('Form fixture');
  const heb = await embedHebrewFont(doc);
  const page = doc.addPage(PageSizes.A4);
  const form = doc.getForm();
  const labelRight = 545;
  const size = 14;

  drawRtl(page, 'טופס בדיקה', { right: labelRight, y: 770, size: 22, font: heb });

  drawRtl(page, 'שם מלא:', { right: labelRight, y: 705, size, font: heb });
  const name = form.createTextField('fullName');
  name.addToPage(page, { x: 250, y: 698, width: 220, height: 24 });

  drawRtl(page, 'מאשר את התנאים', { right: labelRight, y: 655, size, font: heb });
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 420, y: 650, width: 18, height: 18 });

  drawRtl(page, 'מגדר:', { right: labelRight, y: 605, size, font: heb });
  const gender = form.createRadioGroup('gender');
  drawRtl(page, 'זכר', { right: 470, y: 605, size, font: heb });
  gender.addOptionToPage('male', page, { x: 420, y: 600, width: 18, height: 18 });
  drawRtl(page, 'נקבה', { right: 390, y: 605, size, font: heb });
  gender.addOptionToPage('female', page, { x: 340, y: 600, width: 18, height: 18 });

  drawRtl(page, 'עיר:', { right: labelRight, y: 555, size, font: heb });
  const city = form.createDropdown('city');
  city.addOptions(['Jerusalem', 'Tel Aviv', 'Haifa']);
  city.addToPage(page, { x: 250, y: 548, width: 220, height: 24 });

  await save(doc, 'form.pdf');
}

// --------------------------------------------------------------- scanned.pdf
/** Minimal 8-bit grayscale PNG encoder. `pixels` is width*height bytes. */
function encodePng(width, height, pixels) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A "scanned page": right-aligned lines of word-shaped dark bars on off-white. */
function makeScanImage() {
  const width = 850;
  const height = 1100; // ~100 dpi for Letter-ish proportions; we place it on A4
  const px = Buffer.alloc(width * height, 245);
  const fill = (x0, y0, w, h, v) => {
    for (let y = y0; y < y0 + h && y < height; y++)
      for (let x = x0; x < x0 + w && x < width; x++) px[y * width + x] = v;
  };
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // title
  fill(450, 80, 320, 28, 30);
  for (let line = 0; line < 30; line++) {
    const y = 160 + line * 30;
    let x = 780; // RTL: start at the right margin
    const minX = line % 6 === 5 ? 400 : 80; // short last line per "paragraph"
    while (x > minX) {
      const w = 20 + Math.floor(rand() * 70);
      if (x - w < minX) break;
      fill(x - w, y, w, 14, 40 + Math.floor(rand() * 30));
      x -= w + 12;
    }
  }
  return encodePng(width, height, px);
}

async function makeScanned() {
  const doc = await newDoc('Scanned fixture');
  const png = await doc.embedPng(makeScanImage());
  const page = doc.addPage(PageSizes.A4);
  const [w, h] = PageSizes.A4;
  page.drawImage(png, { x: 0, y: 0, width: w, height: h });
  await save(doc, 'scanned.pdf');
}

// -------------------------------------------------------------- cropbox.pdf
async function makeCropbox() {
  const doc = await newDoc('CropBox fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.setMediaBox(50, 50, 612, 792); // [50 50 662 842]
  page.setCropBox(100, 100, 500, 700); // [100 100 600 800]
  // Outline of the crop box and text placed in absolute user-space coords.
  page.drawRectangle({
    x: 110,
    y: 110,
    width: 480,
    height: 680,
    borderColor: rgb(0.2, 0.4, 0.8),
    borderWidth: 2,
  });
  page.drawText('CropBox top-left', { x: 120, y: 770, size: 14, font });
  page.drawText('CropBox bottom-left', { x: 120, y: 120, size: 14, font });
  page.drawText('Outside crop (hidden)', { x: 60, y: 60, size: 10, font });
  await save(doc, 'cropbox.pdf');
}

fs.mkdirSync(outDir, { recursive: true });
await makeHebrew();
await makeEnglish();
await makeMultipage();
await makeForm();
await makeScanned();
await makeCropbox();
