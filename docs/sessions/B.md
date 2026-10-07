# סשן B – הוספת תוכן

**ענף ו-worktree:**
```
git -C "C:\Users\yanivm\Documents\יוחאי\עורך PDF" worktree add "../pdf-B-add-content" -b feat/add-content
```
**פורט:** 5102

**תיקיות שלך:**
- `src/tools/add-text/`, `src/tools/image/`, `src/tools/shapes/`, `src/tools/highlight/`, `src/tools/ink/`, `src/tools/signature/`
- `src/ui/widgets/`: פקדים קטנים משותפים, כמו בוחר צבע ועובי. סשן E עשוי להשתמש בהם.
- `tests/unit/{add-text,image,shapes,highlight,ink,signature}.test.ts`

**נקודת התחלה:** להעתיק את `src/tools/_example/`. הוא כבר עושה גרירה, תצוגה, עריכה וייצוא.

## הכלים (כל אחד תיקייה ו-Tool נפרד; group: 'insert', חוץ מהדגשה)
1. **add-text**:
   - תיבת טקסט חדשה: גרירה או לחיצה, ועריכה במקום עם contenteditable או textarea.
   - `data: { text, size, color, font: 'default' | 'default-bold', align: 'start' | 'end' | 'center' }`
   - ייצוא עם `drawTextBox` מ-`core/pdf-text.ts`. **לא לכתוב bidi משלך.** אם חסר משהו שם, לבקש מסשן A.
   - פס מאפיינים קטן ליד הבחירה: גודל, צבע, מודגש, יישור.
2. **image**:
   - בחירת קובץ, ומיקום בגרירה או במרכז העמוד.
   - שמירה על יחס גובה-רוחב בשינוי גודל.
   - **התמונה לא נשמרת ב-op.data כ-dataURL.** שומרים את הבתים פעם אחת ב-Map של המודול (`src/tools/image/store.ts`, לפי hash), ו-op.data מכיל רק `imageId`. ה-Map לא נמחק, ולכן undo/redo ו-export עובדים.
   - ייצוא עם `embedPng` או `embedJpg`. פורמטים אחרים (webp וכו') ממירים ל-PNG דרך canvas.
3. **shapes**:
   - מלבן, אליפסה, קו וחץ.
   - `data: { kind, stroke, fill?, width }`
   - לקו ולחץ: לשמור `from` ו-`to` יחסית ל-rect, כדי שהזזה ושינוי גודל ימשיכו לעבוד.
4. **highlight** (group: 'edit'):
   - הדגשה צהובה שקופה (opacity 0.35, blend multiply), וקו חוצה.
   - בגרסה ראשונה: מלבן בגרירה.
   - בונוס: הצמדה לשורות הטקסט מ-`src/pdf-read/text.ts` של סשן A, אחרי שהוא ימוזג.
5. **ink**:
   - ציור חופשי עם pointer events, גם במגע ועם עט.
   - הנקודות נשמרות בנקודות PDF, עם החלקה בסיסית.
   - ייצוא עם `drawSvgPath`. שימו לב שמערכת ה-SVG של pdf-lib הפוכה ב-y.
6. **signature**:
   - דיאלוג: ציור חתימה על canvas, או העלאת תמונה.
   - שמירה ב-localStorage (עם try/catch) לשימוש חוזר.
   - הנחה על העמוד כתמונה. אפשר לעשות שימוש חוזר בקוד של image.

## דגשים
- **עמוד מסובב:** טקסט חדש בעמוד שמוצג מסובב צריך להיראות ישר למשתמש. מוסיפים `data.rotate = -page.rotation`, ומטפלים בזה ב-renderOp וב-exportOp (`rotate` ב-drawText וב-drawImage).
- כל הטקסטים בממשק דרך `api.t()`. CSS עם קידומת ה-id של הכלי.

## קריטריונים לסיום
- בדיקת ייצוא לכל כלי:
  - טקסט חדש בעברית ובאנגלית נמצא ב-`textOf` בסדר לוגי.
  - תמונה מוטמעת (בודקים XObject בעמוד).
  - צורות וציור משנים את ה-content stream.
- עובד בעכבר ובמגע. כל פעולה ניתנת לבחירה, הזזה, שינוי גודל, מחיקה ו-undo.
