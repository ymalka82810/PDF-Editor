# עורך PDF – הנחיות לעבודה

עורך PDF בדפדפן (ובהמשך APK עם Capacitor). Vite + TypeScript, בלי framework.
pdf.js מציג את הקובץ, ו-pdf-lib כותב PDF אמיתי (הטקסט נשאר טקסט). הממשק בעברית ובאנגלית.

## פקודות
- `npm run dev` – שרת פיתוח (http://localhost:5173)
- `npm test` – בדיקות יחידה (Vitest, סביבת node)
- `npm run e2e` – בדיקות Playwright (פעם ראשונה: `npx playwright install chromium`). כל worktree מקבל פורט משלו אוטומטית, כך שסשנים לא מתנגשים
- `npm run typecheck`, `npm run lint`, `npm run build`
- `npm run fixtures` – יוצר מחדש את tests/fixtures/*.pdf

לפני כל commit: `npm run typecheck && npm run lint && npm test`.

## ארכיטקטורה
- **המודל** (`src/core/model.ts`, `types.ts`):
  - הקובץ המקורי לא משתנה. כל עריכה היא `Operation` ב-`state.ops`.
  - סדר העמודים והסיבוב שלהם ב-`state.pages`. ערכי טפסים ב-`state.formValues`.
  - כל שינוי עובר דרך `store.update` או דרך הקיצורים (`addOp`, `updateOp`, `removeOp`, `setPages`, `setFormValue`). כך בטל/בצע שוב (undo/redo) עובדים לבד.
  - בגרירה: `const tx = store.begin()`, אחר כך עדכונים עם `{ record: false }`, ובסוף `tx.commit()`.
- **קואורדינטות:**
  - כל `rect` בפעולה הוא בנקודות PDF, יחסית לפינה השמאלית התחתונה של ה-CropBox, לפני סיבוב.
  - המרה למסך: `toView` ו-`rectToView`. מהמסך: `toPdf` ו-`rectToPdf`. הכל ב-`core/coords.ts`.
  - לפני כתיבה ב-pdf-lib: `userSpace(ctx.page, rect)`.
  - **אף כלי לא מחשב סיבוב בעצמו.**
- **כלים** (`src/tools/<name>/index.ts`):
  - כל קובץ כזה מייצא `default` מסוג `Tool` או `Tool[]`. החוזה: `core/registry.ts`.
  - הכלים נטענים אוטומטית. **אין רשימה משותפת לערוך.**
  - תרגומים ב-`locales/he.json` ו-`locales/en.json`, והמפתחות מקבלים קידומת `<tool id>.`.
  - כלי מלא לדוגמה: `src/tools/_example/`.
- **ייצוא** (`core/export.ts`):
  1. בונה את העמודים לפי `state.pages`.
  2. קורא ל-`exportOp` של הכלי של כל פעולה.
  3. קורא ל-`exportDocument` של כל כלי.
  - גופנים רק דרך `ctx.font()` ו-`ctx.embedFontBytes()`.
- **טקסט עברי** (`core/pdf-text.ts`):
  - כתיבה רק דרך `drawLine` או `drawTextBox`, שמסדרים bidi.
  - אם מטמיעים גופן לבד: חובה `forceLtrLayout(font)`. אחרת fontkit הופך את השורה שוב.
  - pdf.js מחזיר את הטקסט בסדר לוגי. בבדיקות משווים למחרוזת הלוגית.
- **מעטפת** (`src/ui/`):
  - `app.ts` – סרגלים, פתיחה ושמירה, מקלדת, ו-`EditorApi`.
  - `viewer.ts` – ציור עצלני, ושכבת פעולות עם בחירה, הזזה ושינוי גודל.

## כללי עבודה במקביל
- כל סשן עובד ב-worktree ובענף משלו, ונוגע **רק בתיקיות שלו** (ראו `docs/sessions/`).
- **`src/core/`:**
  - שינוי בחוזה (types, registry, model, coords, export) רק בתיאום עם הסשן המתאם.
  - הוספה תואמת לאחור (שדה אופציונלי, פונקציה חדשה) מותרת. צריך לציין אותה בתיאור המיזוג.
  - `core/pdf-text.ts` שייך לסשן A. אחרים רק משתמשים בו.
- תלות חדשה ב-package.json: לציין בתיאור המיזוג. בעת התנגשות במיזוג ב-package.json, מאחדים את שתי הרשימות.
- כל כלי מוסיף בדיקת יחידה לייצוא שלו ב-`tests/unit/<tool>.test.ts`. עזרים: `tests/helpers/pdf.ts` (`loadFixture`, `textOf`, `pageInfo`).
- לא משנים את `legacy/`. זה רק חומר קריאה להעברה, והתיקייה תימחק בסוף.

## סגנון
- ההערות בקוד בעברית, קצרות, ומסבירות "למה".
- Prettier: גרשיים בודדים, רוחב 120.
- בלי `any`. נתוני פעולה (`op.data`) מוגדרים כ-interface בכלי.
- ממשק: כל טקסט דרך `api.t()`. CSS של כלי עם קידומת ה-id שלו.
- `direction` של אזור העמודים הוא ltr. הקואורדינטות פיזיות, גם בממשק בעברית.
