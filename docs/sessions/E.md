# סשן E – ממשק, שפות, מובייל ו-APK

**ענף ו-worktree:**
```
git -C "C:\Users\yanivm\Documents\יוחאי\עורך PDF" worktree add "../pdf-E-ui-app" -b feat/ui-app
```
**פורט:** 5105

**תיקיות שלך:**
- `src/ui/` (חוץ מ-`thumbnails/` של סשן C, ו-`widgets/` של סשן B)
- `src/i18n/`
- `index.html`
- `public/`
- `android/`
- `capacitor.config.ts`
- `tests/e2e/`

## משימות
1. **עיצוב** – לבנות על `src/ui/styles.css` ועל הצבעים מ-`legacy/app.css`:
   - מצב כהה מלא, עם בחירה ידנית (`data-theme`) בנוסף להעדפת המערכת.
   - תצוגת טלפון: סרגל כלים תחתון או נפתח, ופאנלים כמגירה.
   - מצב מגע: יעדי לחיצה בגודל 44px לפחות.
   - הפינצ'-זום ב-`.scroller` משנה את `viewer.setZoom` ולא את זום הדפדפן.
2. **דיאלוגים:**
   - רכיב דיאלוג משותף ב-`src/ui/dialog.ts` (בהשראת `legacy/dialog.js`): alert, confirm ו-prompt בעיצוב שלנו, נגישים.
   - כלים של סשנים אחרים ישתמשו בו, ולכן לפרסם ממשק פשוט מוקדם: `confirmDialog(api, {title, message}) => Promise<boolean>` וכו'.
3. **i18n:**
   - כל טקסט בממשק דרך `t()`.
   - בורר שפה.
   - בדיקה שאין מחרוזות קשיחות.
   - ב-LTR הממשק מתהפך כראוי. אזור העמודים תמיד ltr.
4. **קיצורי מקשים:** כבר קיימים ב-`app.ts` (Ctrl+Z/Y/S/O, Delete, Escape, ומקש לכל כלי). להוסיף:
   - דף עזרה (`?`)
   - Ctrl+=/- לזום
   - חיצים להזזת הפעולה הנבחרת
5. **ביצועים:** ה-bundle הראשי גדול, כ-1.1MB, בגלל pdf-lib ו-fontkit. לטעון אותם דינמית רק בייצוא, עם `import()` ב-`core/export.ts`. זה שינוי ב-core, ולכן לתאם.
6. **PWA:** manifest, אייקונים ו-service worker, כדי שהאפליקציה תעבוד בלי אינטרנט. vite-plugin-pwa, או service worker ידני.
7. **Capacitor (Android):**
   - `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `npx cap add android`.
   - פתיחת קבצים:
     - מבחירת קבצים (כבר עובד דרך input).
     - מ"פתח עם" ו"שתף" של PDF: intent-filter ב-AndroidManifest, וקבלת הקובץ, למשל עם `@capawesome/capacitor-file-picker` או plugin ל-send intent.
   - שמירה: `src/ui/save.ts` (`saveBytes`) מזהה Capacitor, ושומר עם `@capacitor/filesystem` ומשתף עם `@capacitor/share`.
   - לבדוק ש-pdf.js worker נטען בתוך ה-WebView.
   - **לבדוק קודם** שמותקנים Java (JDK 17 ומעלה), Android SDK ו-ANDROID_HOME. אם חסר משהו, לדווח למשתמש מה להתקין, ולא להתקין בעצמך.
   - בניית APK debug: `npx cap sync && cd android && ./gradlew assembleDebug`.
8. **e2e:** להרחיב את `tests/e2e/` לממשק החדש: שפה, ערכת נושא, תצוגת טלפון (viewport 390×844).

## קריטריונים לסיום
- `npm run e2e` עובר.
- `npm run build` עובר.
- נבנה APK debug (או רשימה ברורה של מה חסר במחשב כדי לבנות).
- הממשק נבדק ידנית ב-RTL וב-LTR, בבהיר ובכהה, ובמחשב ובטלפון.
