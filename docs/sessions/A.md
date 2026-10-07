# סשן A – עריכת טקסט קיים

**ענף ו-worktree:**
```
git -C "C:\Users\yanivm\Documents\יוחאי\עורך PDF" worktree add "../pdf-A-text-edit" -b feat/text-edit
```
**פורט:** 5101

**תיקיות שלך:**
- `src/tools/text-edit/`
- `src/pdf-read/` (חוץ מ-`image.ts`, ששייך לסשן D)
- `src/core/pdf-text.ts` (אתה הבעלים)
- `tests/unit/text-edit*.test.ts`

## המטרה
המשתמש לוחץ על טקסט שקיים בעמוד, ויכול לשנות, למחוק או להזיז אותו. הקובץ שנשמר נראה כמו המקור: אותו גופן, גודל, צבע ומיקום, והטקסט החדש נשאר טקסט אמיתי.

## חומר קיים להעברה (`legacy/`)
- `template-read.js`:
  - `readPdf` – חילוץ טקסט, גודל, נטוי וגופן. **שם רק עמוד 1, ואצלך כל העמודים.**
  - `joinFragments` – איחוד שברי טקסט באותה שורה. להכליל: היום הוא מאחד רק ספרות עם ספרות ועברית עם עברית.
  - `fixVisualOrder`
  - `readFonts` – שליפת קובצי גופן מוטמעים מ-pdf.js עם `fontExtraProperties`.
- `template-render.js`:
  - `analyzeSlot` – צבע רקע וצבע דיו של אזור.
  - `refineBox` – הידוק תיבה לפי הדיו.
  - `templateFonts`
- `font-fill.js` – השלמת אותיות חסרות בגופן מוטמע (opentype.js מ-CDN): מגופני המערכת או מקובץ.
- `text-edit.js` – חלונית העריכה, כהשראה. אצלך עדיף עריכה במקום (contenteditable מעל הטקסט).

## משימות
1. **`src/pdf-read/text.ts`**
   - `readText(api, pageRef): Promise<TextItem[]>` – לפי `TextItem` ב-`core/types.ts`, ב-rect של נקודות PDF.
   - cache לכל עמוד.
   - בונים את זה על `api.pdfjsDoc(sourceId)`.
   - הצבע: לפי `analyzeSlot` על ה-canvas של העמוד, או מה-operator list.
   - **סשן D (OCR) יחזיר פריטים באותו מבנה, וכלי העריכה שלך צריך לעבוד גם עליהם.** מומלץ לחשוף `registerTextSource(pageId, items)` או משהו דומה, כדי ש-OCR יוכל להזין פריטים. לתאם עם D.
2. **`src/pdf-read/fonts.ts`**
   - שליפת הגופנים המוטמעים לכל מקור, כבתים.
   - בדיקה אם הגופן מכיל את כל האותיות הדרושות (`missingChars`).
3. **הכלי `text-edit`** (group: 'edit', shortcut: 'e'):
   - כשהכלי פעיל: מסגרות עדינות סביב פריטי הטקסט בעמוד (אפשר להשתמש ב-`onPageRendered`).
   - לחיצה על פריט פותחת עריכה במקום.
   - שמירה יוצרת פעולה `{ type: 'text-edit', rect, data: { original: TextItem, text, fontKey?, size, color, bg } }`.
   - מחיקה = טקסט ריק.
   - הזזה דרך השכבה הכללית: ה-rect הוא המיקום החדש, ו-`data.original.rect` הוא המקום שצריך לכסות.
4. **`exportOp`:**
   - מכסה את `original.rect` (עם ריפוד קטן) במלבן בצבע `bg`.
   - כותב את `text` עם `drawLine` או `drawTextBox`.
   - בגופן המוטמע (`ctx.embedFontBytes`) אם יש בו את כל האותיות. אחרת: השלמה בסגנון `font-fill`, או `ctx.font()` כגיבוי.
   - יישור: עברית לימין ואנגלית לשמאל, כמו המקור.
5. **שיפור `core/pdf-text.ts` לפי הצורך.**
   - לשמור על התאימות לאחור, כי סשן B משתמש ב-`drawLine` וב-`drawTextBox`.
   - `forceLtrLayout` חובה על כל גופן שמוטמע. הסיבה מתועדת שם.

## קריטריונים לסיום
- בדיקות יחידה על `tests/fixtures/hebrew.pdf` ו-`english.pdf`: עריכת שורה, ייצוא, ואז `textOf` מחזיר את הטקסט החדש במקום הנכון (±2pt) בסדר לוגי נכון.
- הטקסט הישן לא נראה בתמונה. הכיסוי לא מוחק אותו מזרם התוכן, ולכן `textOf` עוד יחזיר אותו. זה ידוע ומקובל בגרסה הזאת, ויש לתעד את זה בבדיקה.
- עובד גם על עמוד מסובב (`multipage.pdf` עמוד 3) ועל `cropbox.pdf`.
- עריכה במקום עובדת בעברית ובאנגלית, ו-undo מחזיר.
