# סשן D – טפסים, OCR ופתיחת תמונות

**ענף ו-worktree:**
```
git -C "C:\Users\yanivm\Documents\יוחאי\עורך PDF" worktree add "../pdf-D-forms-ocr" -b feat/forms-ocr
```
**פורט:** 5104

**תיקיות שלך:**
- `src/tools/forms/`
- `src/tools/ocr/`
- `src/tools/image-open/`
- `src/pdf-read/image.ts`
- `tests/unit/{forms,ocr,image-open}*.test.ts`

## 1. טפסים (`src/tools/forms/`, Tool בלי כפתור: `toolbar: false`)
**הצגה ומילוי:**
- זיהוי שדות: ב-`onPageRendered`, עם `page.getAnnotations()` של pdf.js (widget annotations עם fieldName, fieldType וכו').
- שדות HTML מעל העמוד, ב-`view.overlay`, במיקום לפי `rectToView`:
  - טקסט (גם multiline)
  - checkbox
  - radio
  - dropdown או list
- הממשק מחליט על הכיוון (`dir="auto"`).
- הערכים נשמרים ב-`store.setFormValue(name, value)`, כדי שיהיה undo.
- הערכים ההתחלתיים מגיעים מהקובץ.
- **השדות לא חלק משכבת ה-ops.** הם אלמנטים משלך ב-overlay, עם מחלקה `forms-field`. השכבה הכללית לא נוגעת בהם, אבל צריך `stopPropagation` ב-pointerdown כדי שלא יתחילו בחירה או גרירה.

**כתיבה ב-`exportDocument`:**
- `ctx.pdf.getForm()`, ואחר כך `setText`, `check`/`uncheck`, `select`.
- **עברית:** כדי שה-appearance יוצג נכון, `form.updateFieldAppearances(await ctx.font())`. לבדוק שהסדר נכון: ייתכן שצריך `visualOrder` מ-`core/pdf-text.ts` לפני setText, או appearance משלך.
- אפשרות "שיטוח" (flatten), כהגדרה או פקודה.
- שימו לב: ה-export מסיר את כל העמודים ומחזיר אותם, ושדות על עמודים שנמחקו נשארים ב-AcroForm. לטפל בזה: להסיר שדות שה-widget שלהם על עמוד שלא קיים.

## 2. OCR (`src/tools/ocr/`)
- להעביר את `readImage` ואת ה-OCR מ-`legacy/template-read.js`: tesseract.js מ-CDN, heb+eng.
- פקודה "זיהוי טקסט" על עמוד סרוק (`scanned.pdf`): מרנדרים את העמוד ל-canvas ברזולוציה גבוהה, ומריצים OCR.
- **התוצאה היא `TextItem[]` בנקודות PDF, עם `origin: 'ocr'`.** החוזה ב-`core/types.ts`. **לתאם עם סשן A** איך הפריטים מוזנים לכלי עריכת הטקסט שלו, כדי שאפשר יהיה לערוך טקסט סרוק.
- אפשרות "הפוך לניתן לחיפוש":
  - op מסוג `ocr-layer` שנכתב בייצוא כטקסט שקוף (`opacity: 0`) מעל המילים.
  - הכתיבה דרך `drawLine`.
  - בתצוגה: לא מצויר כלום.

## 3. פתיחת תמונה כ-PDF (`src/tools/image-open/`)
- `convertFile(file)` – תמונה (PNG, JPG, WebP, HEIC אם אפשר) ← PDF של עמוד אחד בגודל התמונה, או A4 עם התאמה, עם pdf-lib.
- **לא לבנות** על `legacy/image.js` (pdfBlob). הוא מייצר JPEG ידנית; עם pdf-lib זה פשוט יותר.

## קריטריונים לסיום
- בדיקות יחידה:
  - `form.pdf`: מילוי כל סוגי השדות, כולל ערך בעברית. אחרי הייצוא, `PDFDocument.load(...).getForm()` מחזיר את הערכים.
  - flatten מסיר את השדות.
  - image-open יוצר PDF תקין.
  - OCR: בדיקת יחידה למיפוי הקואורדינטות. את tesseract עצמו אפשר לדמות (mock).
- ידנית: OCR על `scanned.pdf` עובד בדפדפן.
